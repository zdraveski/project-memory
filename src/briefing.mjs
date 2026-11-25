#!/usr/bin/env node
// The SessionStart briefing (--print): where the last session stopped, who is
// working here now, anything failing, the journal's pointer and the shared
// store's lessons. brief.mjs, the hook's starter, loads it; nothing else in
// src/ imports it, so it can import the handoff, the journal and compact-gate
// without a loop (docs/adr/0003-no-import-loops-in-src.md).
import { readFileSync, realpathSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as T from './timing.mjs';
import { clip, fit, SAY } from './text.mjs';
import { lastTurn, transcripts, readTail, records, text, asked, own, TAIL } from './transcript.mjs';
import { OFF, QUIET, PRIVATE, PRIVATE_SESSION, isOff, isHushed, hushed, off, offLine, forgottenIn } from './privacy.mjs';
import { readHealth, MISSED, HELD } from './snapshot.mjs';
import { tag, storeOf, projectsRoot, sharedStore, SHARED_BUDGET, local, POINTER, ARCHIVE, memoryOff, autoMemory } from './store.mjs';
import { notes, edited } from './run-records.mjs';
import { ACTIVE, START, render, parse, sectionOf, stalled } from './handoff-log.mjs';
import { firstDay, rel } from './journal.mjs';
import { readSession, sessionLine, sessionsOf, byWords, sharesBlock, DEADLINE } from './recall.mjs';
import { recover } from './compact-gate.mjs';

const RECENT = 30 * 86400000;  // older than this, the startup line has nothing to say

// Warnings only: the startup line costs every session, so it says nothing
// here when all is well. The shared store's problems are every project's.
function health(dir) {
  const out = notes(dir);
  try {
    const { health: s } = readHealth();
    if (s.failures >= 3) out.push(`Memory snapshots have failed ${s.failures} times in a row, last ok ${s.lastOk ? local(s.lastOk) : 'never'}: ${s.error}`);
    if (s.held?.length) out.push(`Memory snapshots skip ${s.held.join(', ')}: ${HELD}`);
    if (s.missed?.length) out.push(`Memory snapshots leave out ${s.missed.join(', ')}: ${MISSED}`);
  } catch {}
  return out;
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
  for (const l of index.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!POINTER.test(l)) continue;
    if (bytes + Buffer.byteLength(l) + 1 > SHARED_BUDGET) { cut++; continue; }
    bytes += Buffer.byteLength(l) + 1;
    lines.push(l);
  }
  if (cut) lines.push(`(${cut} more shared line(s) over the ${SHARED_BUDGET} B ceiling, in ${join(at, 'MEMORY.md')})`);
  // An empty archive's line says nothing, in every session.
  const said = lines.filter((l) => !(l.includes(`](${ARCHIVE})`) && / — 0 older/.test(l)));
  // Once the user agrees: a lesson there reaches every project, the ones a
  // conversation here should not speak for too.
  const head = said.some((l) => !l.includes(`](${ARCHIVE})`))
    ? `Shared memory, every project (${at}): each line below names a file there with a lesson that holds in every project. A new lesson of that kind can go there too, once the user agrees, with a pointer in its MEMORY.md.`
    : `Shared memory: lessons that hold in every project (how the user works, machine-wide tools) can go in ${at} once the user agrees, same format, with a pointer in its MEMORY.md.`;
  return [head, ...said];
}

// The 3,500 characters the FAQ names: the last session's exchanges fill the
// startup briefing up to it, the oldest left out first, and never past it. What is there without them (the shared index alone can be 3,000 B) is
// as before.
const BRIEF = 3500;
// The exchanges' own room when the rest (the shared index can be 3,000 B) takes the 3,500: two headlines.
const EXCHANGES = 1000;
// At startup each exchange is a headline (1.6.0, headline 2c): its request, the first 160 characters of
// its answer and its files, the newest five. The whole answer stays in handoff.md and the journal.
const HEAD = 160, NEWEST = 5;
const headline = (t) => render({ ...t, did: clip(t.did, HEAD) });
// The journal's pointer, at every start and after a compaction too (the model that lost its context loses this line with it).
// It carries the two rules too, so no journal means no rules. A journal that cannot be read costs the line, never the briefing.
async function journalLine(dir) {
  let first = null; try { first = firstDay(dir); } catch {}
  return first ? [`Earlier work in this project since ${first} is in its journal: when asked about the past, search it with the memory skill before saying you don't know.`,
    // 1.6.0 headline 6: the routing line. The recall switch drops it too, so the eval's arm without runs with no line.
    ...(process.env.PROJECT_MEMORY_RECALL === '0' ? [] : ['For a question about the past that one search does not answer, hand it to the project-memory:recall agent.']),
    'When a note and the code disagree about what exists, the code wins. When the user corrects how you work, save it as a feedback note before going on.',
    'A "decided", "rejected" or "parked" in a note is a session\'s summary. Before telling the user they decided it, check their own words: memory skill, search --asked KEYWORDS.'] : [];
}

// The request in progress: the transcript's last prompt the user typed ('' for none). A slash command (/compact) is none.
// shortcut: only the last 512 KB are read; upgrade if a long last turn leaves the pointers out.
function lastAsk(p) {
  let got = '';
  try { for (const r of records(readTail(p, TAIL).text)) { const s = r.type === 'user' && !r.isMeta && !r.isCompactSummary ? text(r).trim() : ''; if (asked(r, s)) got = s; } } catch {}
  return got;
}
const FILES = 10;
// 1.6.0 headline 1e, after a compaction: the files this conversation changed (its session file's `file` lines, newest first),
// up to three pointers for the request in progress (the words matcher; entries in `skip`, "<tag> <at>" of the exchanges the
// briefing prints, left out), and a `compact` line: from it on, this conversation's older exchanges count as earlier, and the
// change hook's first-change and `told` lists start empty. Nothing at all with the recall switch off, in a conversation marked
// private or held with memory off, or when the session file will not read. A private request gets no pointers.
async function afterCompact(input, dir, me, skip) {
  if (process.env.PROJECT_MEMORY_RECALL === '0' || !/^[\w-]+$/.test(me) || isHushed(dir, me, QUIET, 1) || isHushed(projectsRoot(), me, OFF, 1)) return [];
  const at = join(sessionsOf(dir), me), lines = readSession(at);
  if (!lines) return [];
  const cwd = typeof input.cwd === 'string' ? input.cwd.replaceAll('\\', '/') : '';
  const files = [...new Set(lines.filter((l) => l.kind === 'file').map((l) => l.rest).reverse())];
  const out = files.length ? [`Files this conversation changed before the compaction, newest first: ${files.slice(0, FILES).map((f) => rel(f, cwd)).join(', ')}${files.length > FILES ? ` and ${files.length - FILES} more` : ''}. Its exchanges: memory skill, search --conversation ${me}`] : [];
  const now = new Date().toISOString(), ask = lines.findLast((l) => l.kind === 'asked' || l.kind === 'quiet')?.kind === 'quiet' ? '' : lastAsk(input.transcript_path);
  let found = [];
  if (ask && !PRIVATE.test(ask) && !PRIVATE_SESSION.test(ask)) {
    try { found = (await byWords(dir, own(ask), String(input.session_id), { journal: () => import('./journal.mjs'), deadline: performance.now() + DEADLINE, since: now, skip })) ?? []; } catch {}
  }
  const block = found.length ? sharesBlock(found, 'the request in progress') : '', shown = block ? found : [];
  // One append, the compact line first: the change hook reads the `told` lines after it. A write that fails costs pointers only.
  try { mkdirSync(dirname(at), { recursive: true, mode: 0o700 }); appendFileSync(at, sessionLine('compact', '', '', now) + shown.map((e) => sessionLine('told', e.key, '', now)).join(''), { mode: 0o600 }); } catch {}
  return [...out, ...(block ? [block] : [])];
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
  // One that cannot be read (a folder, a file another program holds) is none:
  // thrown, it took every other line of the briefing with it.
  let doc = ''; try { doc = readFileSync(file, 'utf8'); } catch {}
  const { a, b } = sectionOf(doc);
  const section = a === -1 ? '' : doc.slice(a + START.length, b);
  const all = parse(section);
  const me = tag(input.session_id);
  // `at` is local time, and so is a date-time without an offset.
  const age = (t) => Date.now() - Date.parse(t.at.replace(' ', 'T'));
  // Working is judged by the transcript, not the entry: an entry carries the
  // time of the ask, and a session an hour into one prompt read as ended.
  // Recent, with a turn still open: one that finished its turn is closed, or
  // waiting for its user, and the one closed for a restart read as working.
  const live = transcripts(dir, me, input.transcript_path);
  // Newest first, the first two only: each is a 512 KB read.
  const busy = (t) => { try { return lastTurn(t.p).open; } catch { return false; } };
  const working = [];
  for (const t of live) { if (working.length === 2 || Date.now() - t.m >= ACTIVE) break; if (busy(t)) working.push(t); }
  T.mark('handoff');
  // Never the words of a conversation marked private, though handoff.md still
  // holds them (a sweep that failed waits for the next reply): the mark is
  // kept apart. A list that won't read hides them all.
  const hid = new Map(), quiet = (s) => hid.get(s) ?? hid.set(s, hushed(dir, s) !== false).get(s);
  // By the last request recorded for it, and said so: what it works on now may be newer, and named as its work, a finished
  // ask read as the current one (audit H-F8).
  const others = working.map((t) => {
    const e = all.filter((x) => x.s === t.s && !quiet(x.s)).at(-1);
    return `Another session is working in this project: [${t.s}]${e ? `; the last request recorded for it, at ${e.at}: ${clip(e.ask, 120)}` : `, active at ${local(t.m)} (no handoff entry)`}`;
  });
  if (input.source === 'startup' || input.source === 'clear') {
    const told = all.filter((t) => !quiet(t.s));
    const last = told.filter((t) => t.s !== me).at(-1);
    // After /clear the conversation just cleared is the newest transcript and
    // the last entry: named, it brought back the ask the user had cleared away.
    const lines = input.source === 'clear' ? [] : others.length ? others
      : last && age(last) < RECENT ? [`Last session here ended ${last.at} on: ${clip(last.ask, 120)} (log: ${file})`] : [];
    // A project with no handoff is not judged: its sessions were never the
    // Stop hook's to record (from before the plugin, or `claude --bare` runs,
    // which load no hooks).
    // Where it stopped in its own words: its last exchanges, oldest first, the
    // oldest dropped until the whole briefing is within BRIEF, so they never
    // cost the shared lessons at its end (2026-10-31). None forget listed, by
    // conversation and minute as its sweep matches them: a sweep that failed
    // waits for that conversation's next reply. The line above still names the
    // newest entry: that reply puts back another exchange of a swept minute.
    // A list that won't read could name any: none is listed. Nor any of a
    // conversation held with auto memory off, unknown included: a later Stop
    // with it on reads back what was typed while it was off.
    const { listed, shut } = forgottenIn(dir);
    const gone = new Set(listed.filter(([, t]) => t).map(([, t, at]) => `${tag(basename(t))} ${at}`));
    const theirs = lines.length && last && !others.length && !shut && hushed(projectsRoot(), last.s, false, OFF) === false
      ? told.filter((t) => t.s === last.s && !gone.has(`${t.s} ${t.at}`)).slice(-NEWEST).map(headline) : [];
    const journal = await journalLine(dir);
    T.mark('journal');
    const rest = [...journal, ...health(dir), ...(doc ? stalled(live[0]) : []), ...edited(), ...shared()];
    T.mark('shared');
    const say = (ex) => fit([...lines, ...(ex.length ? ['Its last exchanges, oldest first:', ...ex] : []), ...rest].join('\n') + '\n', 1000);
    // The most that fit, from the newest back; none when not even it does.
    // Found, not looped: a while on the length, its && made ||, never ended
    // when the rest alone was over BRIEF, and no test could fail it (a mutant).
    // The budget is BRIEF, or what is there without them plus a reserve of their own: a full shared index left no room for any.
    const room = Math.max(BRIEF, say([]).length + EXCHANGES);
    const from = theirs.findIndex((_, i) => say(theirs.slice(i)).length <= room);
    const out = say(from === -1 ? [] : theirs.slice(from));
    T.mark('fit');
    return out;
  }
  let note = '';
  try { note = recover(input); } catch {}
  // Its own exchanges only. None yet (cut in its first turn, or a private
  // conversation) is none: another session's, shown here, read as its own.
  const mine = all.filter((t) => t.s === me).map(render), journal = await journalLine(dir);
  T.mark('journal');
  const recall = await afterCompact(input, dir, me, new Set(all.filter((t) => t.s === me).map((t) => `${t.s} ${t.at}`)));
  T.mark('recall');
  const tail = [...recall, ...journal, ...shared()];
  T.mark('shared');
  const say = () => [...(note || mine.length ? ['The last exchanges before this compaction, from handoff.md:', ...(note ? [note] : []), ...mine, ...others] : []), ...tail].join('\n') + '\n';
  // The oldest exchanges go first, until it fits.
  let out = say();
  while (mine.length && out.length > SAY) { mine.shift(); out = say(); }
  // The pointers' fixed last line keeps its <key> as written (fit defuses every tag-like "<"), as the change hook's does.
  out = fit(out).replaceAll('show "&lt;key>"', 'show "<key>"');
  T.mark('fit');
  return out;
}

// Run directly (the harnesses do): payload on stdin, always exit 0.
// `--print` is the SessionStart hook, for sources "startup", "clear" and "compact".
// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
// The hook's whole run: called by brief.mjs, the plugin's SessionStart starter, with the same `--print`.
export async function main({ rethrow = false } = {}) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    T.tag(input.hook_event_name, input.source);
    // Auto memory off: no record, no briefing; the tag at every start, so no
    // backfill imports a conversation whose first reply got no Stop (P1 hunt,
    // 2026-10-29). A resumed conversation has its history: no briefing.
    // A project turned off (memory off): one line at a startup, nothing at any other start, nothing written.
    const gone = isOff(storeOf(input));
    if (gone) { if (input.source === 'startup' && process.argv.includes('--print')) process.stdout.write(`${offLine(gone)}
`); }
    else if (memoryOff()) {
      // Settings turned it off, which no one is told otherwise: said at a startup (the environment variable is the user's own).
      const am = autoMemory();
      if (am.why?.startsWith('autoMemoryEnabled') && input.source === 'startup' && process.argv.includes('--print')) process.stdout.write(`Auto memory is off (${am.why}): project-memory saves and briefs nothing in this project until it is on.\n`);
      // A tag that could not be written is the next start's to write: thrown, brief.mjs advised a reinstall.
      try { off(input); } catch {}
    }
    else if (process.argv.includes('--print')) { if (input.source !== 'resume') process.stdout.write(await print(input)); }
  } catch (e) {
    if (rethrow) throw e;
    // A hook that throws on every turn is worse than one that misses a turn.
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // A reader gone before the write (Claude Code ended the hook): its EPIPE,
  // thrown with no listener, exited 1 with a stack trace once process.exit()
  // no longer came first (P1 hunt, 2026-10-29).
  process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
  (async () => {
    await main();
    // Not process.exit(): on macOS a pipe is written asynchronously, and
    // exiting cut a briefing of up to 9,500 characters at 8 KB (as memory.mjs's
    // search, CI 2026-10-29).
    process.exitCode = 0;
  })();
}
