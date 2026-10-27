#!/usr/bin/env node
// Run by the Stop hook (memory-tier.mjs, in-process): after EVERY assistant
// turn, refresh the auto section of the project's handoff.md from the
// transcript. SessionEnd is not enough -- a crash, a closed window or a
// killed process never reaches it, and the narrative for that session is then
// gone. This costs no model call: the transcript already holds what was asked
// and what was answered.
//
// It rewrites ONLY the text between the markers. Everything a person or a
// session wrote by hand around them is left alone.
//
// Several sessions can share one project. Each entry carries its session's tag,
// each session keeps its own last ten, and the file is written by one hook at a
// time (store.mjs).
//
// Every snapshot keeps this file, so what must not stay is kept out before it
// is written: secrets (SECRETS), the answer to a <private> message (answer()),
// and every entry of a conversation marked <private-session> (hushed()).
import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync, fstatSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { storeOf, withLock, replaceIfUnchanged, projectsRoot, sharedStore, SHARED_BUDGET, local, POINTER, ARCHIVE } from './store.mjs';

const TURNS = 10;         // how many exchanges to keep, per session
const SESSIONS = 3;       // how many sessions: parallel work keeps the depth one session had alone
const ASK = 240;          // chars kept of what was asked
const DID = 400;          // chars kept of the answer
const CHANGED = 8;        // files an entry names: the turn's last
const TAIL = 512_000;     // first read; grown 4× until it reaches the latest prompt
const ACTIVE = 30 * 60000;    // a transcript this recently changed: its session is still working
export const GRACE = 60000;   // the Stop hook runs seconds after a turn ends
const RECENT = 7 * 86400000;  // older than this, the startup line has nothing to say
// What compact-gate's Stop nudge opens with. `asked()` skips it because it
// begins with `[SYSTEM`, and `turns()` freezes the turn's answer at it: the
// words written after it are the memory update, not what the turn did.
export const NUDGE_TAG = '[SYSTEM: compaction gate]';
const START = '<!-- auto:start -->';
const END = '<!-- auto:end -->';

export function readTail(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const from = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    return { text: buf.toString('utf8'), whole: from === 0 };
  } finally { closeSync(fd); }
}

export const text = (r) => {
  const c = r?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((b) => b?.type === 'text').map((b) => b.text).join(' ');
  return '';
};

// Claude Code may hand a Stop reason back wrapped ("Stop hook feedback: ..."),
// and no real nudge record survives to show which: look near the start, not
// only at it.
const nudged = (s) => s.slice(0, 200).includes(NUDGE_TAG);

// A user record can also be a tool result, a slash-command echo, or something
// the harness injected (`isMeta`: a skill body, a hook's output). None is a
// prompt. Without the isMeta test a skill body became the "ask" of the turn.
// "[Request interrupted by user]" is the harness reporting an Escape, not a
// question; 18 of them had been recorded as asks.
// A compaction summary ("This session is being continued from...") is a user
// record too, flagged isCompactSummary; 17 had been recorded as asks.
// A tool result has no text, so `s` is empty.
// A message the user opens with <private> or <private-session> is still theirs.
// Skipped like the harness's own <...> messages, its answer was saved as the
// answer to the message before.
export const asked = (r, s) => s && !r.isMeta && !r.isCompactSummary && (!s.trimStart().startsWith('<') || /^<private/i.test(s.trimStart())) && !s.includes('<command-name>')
  && !s.startsWith('[SYSTEM') && !nudged(s) && !s.startsWith('[Request interrupted');

export { local };
// A session's short tag: enough to tell parallel sessions apart in one file.
export const tag = (id) => String(id || '').slice(0, 8);

function turns(raw) {
  const out = [];
  let pending = null;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;        // a tail starts mid-line
    let r; try { r = JSON.parse(line); } catch { continue; }
    // A turn's edits are tool calls with no text: taken before the text test skips them.
    if (r.type === 'assistant' && pending && Array.isArray(r.message?.content)) {
      for (const b of r.message.content) {
        const f = b.type === 'tool_use' && /^(Edit|Write|NotebookEdit)$/.test(b.name) && (b.input?.file_path || b.input?.notebook_path);
        if (!f) continue;
        const name = String(f).split(/[\\/]/).pop();   // a Windows path read on any system
        if (!pending.changed.includes(name)) pending.changed.push(name);
      }
    }
    const t = text(r).trim();
    if (!t) continue;
    if (r.type === 'user' && asked(r, t)) pending = { at: local(r.timestamp), ask: t, did: '', changed: [] };
    else if (r.type === 'user' && pending && nudged(t)) pending.frozen = true;
    else if (r.type === 'assistant' && pending) {
      if (!pending.frozen) pending.did = t;     // last text block of the turn wins, unless a nudge froze it
      if (out[out.length - 1] !== pending) out.push(pending);
    }
  }
  return out;
}

// A secret pasted into a message is never written: the snapshots would keep it
// for good. A key or token is known by its issuer's prefix, or by the word
// before it; anything in <private>...</private> goes whole. Before clipping,
// so no half of a key is left behind.
const SECRETS = [
  [/<private>[\s\S]*?(?:<\/private>|$)/gi, '[private]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted]'],
  [/\b(?:sk|rk|pk)-(?:ant-|proj-|live_|test_)?[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/g, '[redacted]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{35}/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  [/\b(Bearer|Basic) [A-Za-z0-9._~+/=-]{20,}/g, '$1 [redacted]'],
  [/\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd|pwd)["']?[ \t]*[:=][ \t]*["']?)[^\s"',;]{6,}/gi, '$1[redacted]'],
];
export const redact = (s) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s);
// The answer to a private message often repeats what it was told, so it is
// withheld whole.
export const answer = (ask, did, n) => (/<private>/i.test(ask) ? '[private]' : clip(plain(did), n));

// Marker text inside an ask or an answer would become the section boundary on
// the next run and strand every entry before it as prose. Defuse it.
export const clip = (s, n) => {
  const one = redact(s).replace(/\s+/g, ' ').replace(/<!--/g, '<!- -').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

// An answer is markdown, and its marks carry no words: heading hashes, bold,
// table rules and pipes cost characters a 400-character entry cannot spare
// ("## What a surety agent is **The 3 parties in a bond:** ...", 2026-10-26).
// Line by line, and no pattern that can match a newline: a `\s` in the rule
// pattern was cubic on blank lines -- 800 of them took a second, every Stop.
// Only marks are dropped: `2**32 and 2**64`, `**kwargs`, `__init__.py` and
// `a || b` keep their meaning. Bold opens after a space or the line start and
// closes before a space, punctuation or the line end, hugging its words.
export const plain = (s) => s.split('\n')
  .filter((l) => !(l.includes('-') && /^[ \t|:-]*$/.test(l)))   // a table rule, or a horizontal one
  .map((l) => (l.trimStart().startsWith('|') ? l.replace(/\|/g, ' ') : l).replace(/^#{1,6}[ \t]+/, '')
    .replace(/(^|[ \t(])\*\*(?=[^\s*])([^*]*?[^\s*])\*\*(?=$|[\s).,:;!?])/g, '$1$2'))
  .join('\n');

// One turn can be megabytes of tool output, so a fixed tail read nothing on
// 65 of 76 transcripts here. Grow until the latest prompt is inside it; the
// section on disk already holds the earlier ones, so that is all it needs.
function latest(path) {
  for (let bytes = TAIL; ; bytes *= 4) {
    const { text: raw, whole } = readTail(path, bytes);
    const got = turns(raw);
    if (got.length || whole) return got;
  }
}

const render = (t) => `- **asked** ${t.at}${t.s ? ` [${t.s}]` : ''}: ${clip(t.ask, ASK)}\n  **did:** ${clip(t.did, DID)}`
  + (t.changed ? `\n  **changed:** ${clip(t.changed, DID)}` : '');
// The newest n of a list, and how many older ones it leaves out.
export const newest = (xs, n, older = 'more') => (xs.length > n ? `${xs.slice(-n).join(', ')}, and ${xs.length - n} ${older}` : xs.join(', '));
// \r-tolerant: an editor that saves this file CRLF must not make every entry
// unparseable, which silently emptied the section. The tag is optional:
// entries written before it read as one untagged session. The time is lazy:
// greedy, it took the colon of an untagged "[word]: ..." ask, and the word read as a tag.
const ENTRY = /^- \*\*asked\*\* (\S+ \S+?)(?: \[([\w-]+)\])?: (.*?)\r?\n  \*\*did:\*\* (.*?)\r?$(?:\n  \*\*changed:\*\* (.*?)\r?$)?/gm;
export const parse = (section) => [...section.matchAll(ENTRY)].map((m) => ({ at: m[1], s: m[2] || '', ask: m[3], did: m[4], changed: m[5] || '' }));
// The LAST marker pair. Searching for the first START let a stray START --
// one whose END was lost -- pair with the next run's END, and everything
// hand-written between them was replaced.
export const sectionOf = (doc) => { const b = doc.lastIndexOf(END), a = b === -1 ? -1 : doc.lastIndexOf(START, b); return { a, b }; };

// The newest SESSIONS sessions, the last TURNS of each, in time order. `at` is
// a fixed-width `2026-10-27 01:07`, so code-unit order is time order;
// localeCompare loaded ICU's collator for it, ~16 ms of every Stop (profiled).
const byAt = (x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);
function keep(all) {
  const by = new Map();
  for (const t of [...all].sort(byAt)) { if (!by.has(t.s)) by.set(t.s, []); by.get(t.s).push(t); }
  return [...by.values()]
    .sort((x, y) => byAt(y[y.length - 1], x[x.length - 1]))
    .slice(0, SESSIONS)
    .flatMap((g) => g.slice(-TURNS))
    .sort(byAt);
}

const FRONT = `---\nname: handoff\ndescription: "The rolling handoff"\nmetadata:\n  node_type: memory\n  type: project\n  tier: hot\n---\n\n`;

// What handoff.md should say, from what it says now and this turn's entries:
// the new text, 'unchanged', or null when there is nothing to write.
function build(raw, fresh, drop = null) {
  let doc = (raw ?? '').replace(/^﻿/, '');
  // A file emptied by a failed edit has no `tier: hot`, so tiering would age
  // the handoff out of the index a week later.
  if (!doc.startsWith('---')) doc = FRONT + doc;
  const { a, b } = sectionOf(doc);
  const has = a !== -1;                       // a START before the last END
  const have = has ? parse(doc.slice(a, b)) : [];
  // Merge, keyed by session + time + ask: a turn seen again replaces its own
  // line, a new one is added, and two sessions on the same project interleave
  // by time. Without the session in the key, "continue" typed into two
  // sessions in the same minute was one turn, and each Stop dropped the
  // other's. An untagged entry (written before tags) whose time and ask match
  // is this session's own, re-seen: replaced, not kept beside.
  const key = (t) => `${t.s} ${t.at} ${t.ask}`;
  const bare = (t) => `${t.at} ${t.ask}`;
  const seen = new Set(fresh.map(key)), seenBare = new Set(fresh.map(bare));
  const kept = have.filter((t) => !seen.has(key(t)) && !(t.s === '' && seenBare.has(bare(t))) && t.s !== drop);
  const merged = keep([...kept, ...fresh]);
  if (!merged.length && !(drop && has)) return null;
  // An entry kept from the file is rendered once, for the comparison and the
  // write: each render runs every secret pattern over it.
  const shown = new Map(), show = (t) => shown.get(t) ?? shown.set(t, render(t)).get(t);
  const core = merged.map(show).join('\n');
  // Compare the entries, not the stamp line, or the guard is dead code.
  if (have.map(show).join('\n') === core) return 'unchanged';
  const body = [START,
    `_Written after every turn by \`handoff-log.mjs\`, so an interrupted session still leaves this. Last: ${local()}._`,
    '', core, END].join('\n');
  return has ? doc.slice(0, a) + body + doc.slice(b + END.length)
    : doc.trimEnd() + `\n\n## Last ${TURNS} exchanges\n\n` + body + '\n';
}

// Exported so memory-tier.mjs can run it in the same process from the Stop
// hook: a second Node start cost a median 200 ms a turn on this box.
// The conversations marked private, by tag: the newest 50, one per line.
const QUIET = '.private-sessions';
export function hushed(dir, s, mark = false) {
  const p = join(dir, QUIET);
  let have = []; try { have = readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch {}
  if (!s) return false;
  if (mark && !have.includes(s)) { have = [...have, s].slice(-50); writeFileSync(p, have.join('\n') + '\n'); }
  return have.includes(s);
}

export function handoff(input) {
  const dir = storeOf(input);
  const file = join(dir, 'handoff.md');
  // What happened is returned -- true written, 'unchanged', false nothing to
  // write, 'busy' another hook held the store -- because a caller that reads
  // silence as success reports "handoff written" over a store that does not
  // exist (the compaction gate did).
  if (!existsSync(dir) || !input.transcript_path || !existsSync(input.transcript_path)) return false;
  // The transcript is read outside the lock: it is the slow part, and this session's alone.
  const s = tag(input.session_id);
  const turns = latest(input.transcript_path);
  const fresh = turns.map((t) => ({ ...t, s, ask: clip(t.ask, ASK), did: answer(t.ask, t.did, DID), changed: newest(t.changed, CHANGED) }));
  const hush = turns.some((t) => /<private-session>/i.test(t.ask));
  // Sessions of one project write this file at once, so they take turns: 8 at
  // once lost 22 of 40 turns without the lock (2026-10-26). The model can still
  // edit the file by hand meanwhile -- the nudge asks it to -- and then the
  // merge is redone from what it wrote.
  const r = withLock(dir, () => {
    // A conversation marked private writes nothing, and what it wrote before
    // the mark goes. The mark is kept in a file: only the turn that typed it
    // sees it in the transcript.
    const quiet = hushed(dir, s, hush);
    for (let i = 0; i < 3; i++) {
      const raw = existsSync(file) ? readFileSync(file, 'utf8') : null;
      const next = build(raw, quiet ? [] : fresh, quiet ? s : null);
      if (next === null || next === 'unchanged') return quiet ? 'private' : next ?? false;
      const w = replaceIfUnchanged(file, raw, next);
      if (w !== 'conflict') return quiet ? 'private' : w || 'unchanged';
    }
    return false;
  });
  return r ?? 'busy';
}

// Warnings only: the startup line costs every session, so it says nothing
// here when all is well. The shared store's problems are every project's.
function health(dir) {
  const out = [];
  for (const d of [dir, sharedStore()]) {
    try { const h = readFileSync(join(d, '.health'), 'utf8').trim(); if (h) out.push(`Memory store needs attention (${d}): ${h.split('\n').join('; ')}`); } catch {}
  }
  try {
    const s = JSON.parse(readFileSync(join(projectsRoot(), '.snapshot-health'), 'utf8'));
    if (s.failures >= 3) out.push(`Memory snapshots have failed ${s.failures} times in a row, last ok ${s.lastOk || 'never'}: ${s.error}`);
  } catch {}
  return out;
}

// The project's other sessions, newest first: Claude Code keeps each one's
// transcript, named by its id, in the folder above the store.
export function transcripts(dir, me) {
  const project = dirname(dir);
  try {
    return readdirSync(project).filter((f) => f.endsWith('.jsonl') && tag(f) !== me)
      .map((f) => ({ s: tag(f), p: join(project, f), m: statSync(join(project, f)).mtimeMs }))
      .sort((x, y) => y.m - x.m);
  } catch { return []; }
}

// When a transcript's last finished turn ended (NaN: none in its tail), and how
// many of its last messages are model replies the hooks know.
export function lastTurn(p) {
  const raw = readTail(p, TAIL).text;
  let end = NaN, seen = 0, known = 0;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('{')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    // Messages only: a session's start-up records (attachments, modes, titles)
    // ran to 41 before its first reply.
    if (r.type === 'user' || r.type === 'assistant') seen++;
    if (r.type !== 'assistant' || !r.message?.usage) continue;
    known++;
    if (r.message.stop_reason === 'end_turn') end = Date.parse(r.timestamp);
  }
  return { end, seen, known };
}

// Stop output reaches nobody, so a Stop hook that stopped running -- unwired,
// or failing before it loads the handoff -- was silence. memory-tier touches
// `.stop-ran` on every `--stop`: a turn the newest other session finished
// after that went unrecorded. A tail full of messages the hooks cannot read
// means the transcript format moved under them.
export function stalled(t) {
  if (!t) return [];
  let end, seen, known; try { ({ end, seen, known } = lastTurn(t.p)); } catch { return []; }
  if (seen >= 50 && !known) return [`Memory hooks cannot read [${t.s}]'s transcript: none of its last ${seen} messages is a model reply they know. Has Claude Code's transcript format changed?`];
  // No file is not knowing (just installed, or cleaned away), not "never ran".
  let ran; try { ran = statSync(join(projectsRoot(), '.stop-ran')).mtimeMs; } catch { return []; }
  if (end - ran > GRACE && Date.now() - end > GRACE) {
    return [`Memory hooks look stopped: [${t.s}] finished a turn at ${local(end)}, and the Stop hook last ran ${local(ran)}. Run: node "${join(dirname(fileURLToPath(import.meta.url)), 'memory.mjs')}" doctor`];
  }
  return [];
}

export const hash = (buf) => createHash('sha256').update(buf).digest('hex');

// The hooks run from the copy deploy.mjs made after the full check. A file
// changed or gone there since is live and untested: name it. Run from the
// repo, with no manifest, there is nothing to say; nor with a damaged one:
// thrown, it took every other line of the startup message with it.
export function edited(here = dirname(fileURLToPath(import.meta.url))) {
  try {
    const m = JSON.parse(readFileSync(join(here, '.deployed.json'), 'utf8'));
    const bad = Object.keys(m.files).filter((f) => {
      try {
        // Size and mtime as deployed: not read, as git's index judges. Hashing all
        // nine files was 8-11 ms of every startup (measured 2026-10-27).
        const s = statSync(join(here, f)), was = m.stat?.[f];
        if (was && s.size === was[0] && s.mtimeMs === was[1]) return false;
        return hash(readFileSync(join(here, f))) !== m.files[f];
      } catch { return true; }
    });
    return bad.length ? [`Memory hooks changed outside deploy.mjs, live and untested: ${bad.join(', ')} in ${here}. For the user: edit ${m.repo || 'the hooks repo'} and run node deploy.mjs there (a deploy replaces these edits).`] : [];
  } catch { return []; }
}

// The shared store's index, printed into every session of every project: Claude
// Code loads only the project's own. Every line is printed, even one whose file
// name the project also has: auto-memory names repeat (`feedback_testing.md`),
// and hiding the shared line for a different memory of the same name lost the
// lesson there (reviews, 2026-10-27). With nothing shared yet, one line says
// where such a lesson goes -- the model is told of no store but the project's,
// so without it the shared one stayed empty.
function shared() {
  const at = sharedStore();
  let index = '';
  try { index = readFileSync(join(at, 'MEMORY.md'), 'utf8'); } catch {}
  // Tiering holds the index to its budget but never evicts a pin or a pointer
  // whose file is gone: the ceiling is held here too, since this prints everywhere.
  const lines = [];
  let bytes = 0, cut = 0;
  for (const l of index.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!POINTER.test(l)) continue;
    if (bytes + Buffer.byteLength(l) + 1 > SHARED_BUDGET) { cut++; continue; }
    bytes += Buffer.byteLength(l) + 1;
    lines.push(l);
  }
  if (cut) lines.push(`(${cut} more shared line(s) over the ${SHARED_BUDGET} B ceiling, in ${join(at, 'MEMORY.md')})`);
  const head = lines.some((l) => !l.includes(`](${ARCHIVE})`))
    ? `Shared memory, every project (${at}): open a file there when its line applies; a new lesson that holds in every project goes there too, with a pointer in its MEMORY.md.`
    : `Shared memory: lessons that hold in every project (how the user works, machine-wide tools) go in ${at}, same format, with a pointer in its MEMORY.md.`;
  return [head, ...lines];
}

// The SessionStart hook. After a compaction (source "compact"): the note on a
// turn the compaction cut, then this session's own exchanges -- a parallel
// session's asks are never taken for this one's -- then who else is working
// here. At startup (or a /clear, a fresh context too): who is working here
// now, or where the last session stopped, and anything failing. Either way the
// shared store last: what the compaction summarised away, or never loaded.
async function print(input) {
  const dir = storeOf(input);
  const file = join(dir, 'handoff.md');
  const doc = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const { a, b } = sectionOf(doc);
  const section = a === -1 ? '' : doc.slice(a + START.length, b);
  const all = parse(section);
  const me = tag(input.session_id);
  // `at` is local time, and so is a date-time without an offset.
  const age = (t) => Date.now() - Date.parse(t.at.replace(' ', 'T'));
  // Working is judged by the transcript, not the entry: an entry carries the
  // time of the ask, and a session an hour into one prompt read as ended.
  const live = transcripts(dir, me);
  const others = live.filter((t) => Date.now() - t.m < ACTIVE).slice(0, 2).map((t) => {
    const e = all.filter((x) => x.s === t.s).at(-1);
    return `Another session is working in this project: ${e ? `${e.at} [${t.s}] ${clip(e.ask, 120)}` : `${local(t.m)} [${t.s}] (no handoff entry)`}`;
  });
  if (input.source === 'startup' || input.source === 'clear') {
    const last = all.filter((t) => t.s !== me).at(-1);
    // After /clear the conversation just cleared is the newest transcript and
    // the last entry: named, it brought back the ask the user had cleared away.
    const lines = input.source === 'clear' ? [] : others.length ? others
      : last && age(last) < RECENT ? [`Last session here ended ${last.at} on: ${clip(last.ask, 120)} (log: ${file})`] : [];
    // A project with no handoff is not judged: its sessions (`claude -p` runs
    // that load no user hooks) were never the Stop hook's to record.
    lines.push(...health(dir), ...(doc ? stalled(live[0]) : []), ...edited(), ...shared());
    return lines.join('\n') + '\n';
  }
  let note = '';
  try { note = (await import(new URL('./compact-gate.mjs', import.meta.url))).recover(input); } catch {}
  const mine = all.filter((t) => t.s === me);
  // None of its own yet (cut in its first turn): the newest TURNS, not every
  // session's -- three sessions' thirty were ~5k tokens.
  const shown = (mine.length ? mine : all.slice(-TURNS)).map(render);
  const lines = note || shown.length ? ['The last exchanges before this compaction, from handoff.md:', ...(note ? [note] : []), ...shown, ...others] : [];
  return [...lines, ...shared()].join('\n') + '\n';
}

// Run directly (the harnesses do): payload on stdin, always exit 0.
// `--print` is the SessionStart hook, for sources "startup", "clear" and "compact".
// Not a top-level await: print() imports compact-gate, which imports this
// module, and a module still awaiting at its top level can never be imported
// back -- Node gives up with "unsettled top-level await".
// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  (async () => {
    try {
      const input = JSON.parse(readFileSync(0, 'utf8'));
      if (process.argv.includes('--print')) process.stdout.write(await print(input));
      else handoff(input);
    } catch {
      // A hook that throws on every turn is worse than one that misses a turn.
    }
    process.exit(0);
  })();
}
