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
// What it writes stays until newer exchanges replace it -- the snapshots leave
// this file out -- and what must not be written is kept out before it is:
// secrets (SECRETS), the answer to a <private> message and the files its turn
// changed (answer()), and every entry of a conversation marked
// <private-session> (hushed(), in privacy.mjs).
import { readFileSync, existsSync, openSync, closeSync, statSync, statfsSync, realpathSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import * as T from './timing.mjs';
import { clip, plain } from './text.mjs';
import { readTail, turns, promptBefore, TAIL, FORGETS, userText, tailOf, joined, lastTurn } from './transcript.mjs';
import { PRIVATE, QUIET, OFF, isOff, wasOff, hushed, off, unreadable, forgottenIn } from './privacy.mjs';
import { tag, storeOf, withLock, replaceIfUnchanged, projectsRoot, local, same, memoryOff, pathKey, transcriptKey, raw, inProjects, norm } from './store.mjs';
import { stopRan } from './run-records.mjs';

const TURNS = 10;         // how many exchanges to keep, per session
const SESSIONS = 3;       // how many sessions: parallel work keeps the depth one session had alone
// The startup briefing prints these exchanges whole, a line each under fit()'s
// 1,000 at startup: detail over tokens (KIRE, 2026-10-31; were 240 and 400).
const ASK = 500;          // chars kept of what was asked
const DID = 900;          // chars kept of the answer
const CHANGED = 8;        // files an entry names: the turn's last
export const GRACE = 60000;   // the Stop hook runs seconds after a turn ends
export const START = '<!-- auto:start -->';
const END = '<!-- auto:end -->';


export { norm };   // it lives in store.mjs, so the git-rule hook reads it without loading this file

// tag lives in store.mjs (QUIET and OFF in privacy.mjs), so the enforce hook can read them without loading this file.
export { tag };


// The answer to a private message often repeats what it was told, so it is
// withheld whole.
export const answer = (ask, did, n) => (PRIVATE.test(ask) ? '[private]' : clip(plain(did), n));

// One turn can be megabytes of tool output, so a fixed tail read nothing on
// 65 of 76 transcripts here. Grow until the latest prompt is inside it, and
// back to `since`, the last turn the section holds for this session (its time
// and ask; by the minute alone, a turn skipped in that same minute was lost): a turn
// skipped while another hook held the store, then pushed out of the tail by a
// long next turn, was never written. Bounded: about 32 MB (2 ** 25 let it grow
// once more, to 128 MB).
// A turn's ask and answer as handoff.md shows them: one rule for the writer
// and for latest(), which looks for the last one written. Matched against the
// turn as read, a turn that ran forget (shown [private]) was never found, and
// the next Stop read up to four times the transcript, the last 32 MB.
const shown = (t) => {
  // A turn that ran forget says nothing, as a private one.
  const gone = t.ran.some((c) => FORGETS.test(c));
  const ask = gone ? '[private]' : clip(t.ask, ASK);
  // As render writes it: an ask that quotes [private] has no answer either (I2, R36).
  return { ask, did: gone || ask.includes('[private]') ? '[private]' : answer(userText(t), t.did, DID) };
};
// `all`: on to the whole file whatever the tail holds, for a hint that would not read (F21).
function latest(path, since = null, all) {
  for (let bytes = TAIL; ; bytes *= 4) {
    const { text: tail, whole } = readTail(path, bytes);
    const got = turns(tail);
    const same = (t) => { const e = shown(t); return e.ask === since.ask && e.did === since.did; };
    const there = since && got.some((t) => t.at === since.at && same(t));
    // The newest entry's turn read at another minute, and not at its own: the
    // clock moved to another zone, and every entry of this conversation is in
    // the old one. Read on to the whole file, where build() takes them all
    // back: read in part, a long one listed each turn twice (fuzz, review,
    // 2026-10-30). Not at its own minute too: two identical exchanges are no move.
    const moved = since && !there && got.some(same);
    const back = !moved && (!since || got[0]?.at < since.at || there);
    if ((got.length && back && !all) || whole || bytes >= 32e6) {
      // 32 MB read and no prompt in them: the turn's prompt is further back (a long browser task's screenshots), and its
      // own Stops never wrote it (audit H-F6). Found by a look back, and read with the tail: its tools are the tail's.
      const p = !whole && !got.open ? promptBefore(path, bytes) : null;
      const out = p ? turns(`${p}\n${tail}`) : got;
      // Given up: 32 MB read, no turn in them and no prompt before. Thrown, so the Stop records the failure and the briefing says so.
      if (!whole && !out.length) throw new Error(`no turn found in the last ${Math.round(bytes / 1e6)} MB of ${path}`);
      out.whole = whole; return out;
    }
  }
}

// An entry whose ask is private shows no answer and no files, whoever wrote
// it: one written before 1.0.5 kept an answer that repeated the secret.
export const render = (t) => {
  // As shown: 1.0.4 wrote the ask raw, <private> and all.
  // shortcut: a question that quotes `[private]` loses its answer too; an old
  // entry's only mark is that text, and its answer repeats the secret.
  const ask = clip(t.ask, ASK), hid = ask.includes('[private]');
  return `- **asked** ${t.at}${t.s ? ` [${t.s}]` : ''}: ${ask}\n  **did:** ${hid ? '[private]' : clip(t.did, DID)}`
    + (t.changed && !hid ? `\n  **changed:** ${clip(t.changed, DID)}` : '');
};
// The newest n of a list, and how many older ones it leaves out.
export const newest = (xs, n, older = 'more') => (xs.length > n ? `${xs.slice(-n).join(', ')}, and ${xs.length - n} ${older}` : xs.join(', '));
// \r-tolerant: an editor that saves this file CRLF must not make every entry
// unparseable, which silently emptied the section. The tag is optional:
// entries written before it read as one untagged session. The time is lazy:
// greedy, it took the colon of an untagged "[word]: ..." ask, and the word read as a tag.
const ENTRY = /^- \*\*asked\*\* (\S+ \S+?)(?: \[([\w-]+)\])?: (.*?)\r?\n  \*\*did:\*\* (.*?)\r?$(?:\n  \*\*changed:\*\* (.*?)\r?$)?/gm;
export const parse = (section) => [...section.matchAll(ENTRY)].map((m) => ({ at: m[1], s: m[2] || '', ask: m[3], did: m[4], changed: m[5] || '' }));
// The LAST START that has an END after it, and the first END after it.
// Searching for the first START let a stray START -- one whose END was lost --
// pair with the next run's END; taking the last END let one quoted below the
// section pair with the real START. Either way, everything hand-written
// between them was replaced.
// And a marker counts only on a line of its own, as this file writes it: one
// quoted in a sentence below the section was taken for it, the next Stop
// wrote into that sentence, and the real section went stale (audit, 2026-10-28).
const alone = (doc, i, mark) => {
  const end = doc.indexOf('\n', i);
  return /^[ \t﻿]*$/.test(doc.slice(doc.lastIndexOf('\n', i - 1) + 1, i)) && /^[ \t]*\r?$/.test(doc.slice(i + mark.length, end === -1 ? doc.length : end));
};
export const sectionOf = (doc) => {
  for (let a = doc.lastIndexOf(START); a !== -1; a = a ? doc.lastIndexOf(START, a - 1) : -1) {
    if (!alone(doc, a, START)) continue;
    for (let b = doc.indexOf(END, a); b !== -1; b = doc.indexOf(END, b + 1)) if (alone(doc, b, END)) return { a, b };
  }
  return { a: -1, b: -1 };
};
// handoff.md without its automatic log: only what a person wrote, for search.
// A start marker with no end marker (a half-written file): the log runs to the end of the file.
// Every block is cut, last first (sectionOf finds the last one); each cut shortens the text, and a cut that does not ends the loop.
export function handWritten(body) {
  for (;;) {
    const { a, b } = [body, `${body}\n${END}`].map(sectionOf).find((x) => x.a !== -1) ?? { a: -1 };
    if (a === -1) return body;
    const next = body.slice(0, a) + body.slice(b).replace(/^[^\n]*/, '');
    if (next.length >= body.length) return body;
    body = next;
  }
}

// The newest SESSIONS sessions, the last TURNS of each, in time order. `at` is
// a fixed-width `2026-10-27 01:07`, so code-unit order is time order;
// localeCompare loaded ICU's collator for it, ~16 ms of every Stop (profiled).
const byAt = (x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0);
// The writing session's always, then the newest others: ranked by when its
// last ask was made, a turn asked first and finished last lost to three
// later asks, and its own Stop dropped it.
function keep(all, me) {
  const by = new Map();
  for (const t of [...all].sort(byAt)) { if (!by.has(t.s)) by.set(t.s, []); by.get(t.s).push(t); }
  return [...by.values()]
    .sort((x, y) => (y[0].s === me) - (x[0].s === me) || byAt(y[y.length - 1], x[x.length - 1]))
    .slice(0, SESSIONS)
    .flatMap((g) => g.slice(-TURNS))
    // Ties by session: in the order the writer came first, two sessions with
    // entries in one minute swapped places on every Stop, and the file was
    // rewritten each time (audit, 2026-10-28).
    .sort((x, y) => byAt(x, y) || (x.s < y.s ? -1 : x.s > y.s ? 1 : 0));
}

const FRONT = `---\nname: handoff\ndescription: "The rolling handoff"\nmetadata:\n  node_type: memory\n  type: project\n  tier: hot\n---\n\n`;

// What handoff.md should say, from what it says now and this turn's entries:
// the new text, 'unchanged', or null when there is nothing to write. `drop`:
// which of its entries go. `note`: the compaction gate's in-flight note, put
// after the entries in the same write, so no other write lands between them.
function build(before, fresh, drop = null, me = fresh[0]?.s, whole = false, note = null) {
  let doc = (before ?? '').replace(/^\uFEFF/, '');
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
  // is this session's own, re-seen: replaced, not kept beside. The ask as it
  // is written: one an older version wrote with a raw tag still matches.
  // 1.0.7 wrote a marker in an ask as `<!- -`.
  const key = (t) => `${t.s} ${bare(t)}`;
  const bare = (t) => `${t.at} ${clip(t.ask.replace(/<!- -/g, '<!--'), ASK)}`;
  const seenBare = new Set(fresh.map(bare));
  // One turn, two spellings: an ask an older version wrote otherwise (with a
  // trailing reminder before 1.0.6, its leading element cut in 1.0.6-1.0.7)
  // is the turn re-read when the session and minute match and one ask holds
  // the other. Kept beside it, an upgrade doubled every resumed turn.
  const ask = (t) => clip(t.ask, ASK).replace(/… \(\+\d+ chars\)$|…$/, '');
  // Only over a minute the read covered whole (the file, or a turn of this
  // session before it): then every real turn of that minute is fresh, and a
  // leftover is an old spelling. Not so, "fix it" was taken for an old
  // spelling of "fix it and run tests" a minute later, and lost.
  const covered = (t) => whole || fresh.some((f) => f.s === t.s && f.at < t.at);
  const twin = (x, y) => x.s === y.s && x.at === y.at && covered(y) && !!ask(x) && !!ask(y) && (ask(x).includes(ask(y)) || ask(y).includes(ask(x)));
  // And one entry twice: a window still on 1.0.7 keyed its entries raw,
  // matched none of the escaped ones, and added each again every Stop. The
  // whole entry, answer and all: "continue" asked twice in a minute is two.
  const whole1 = (t) => `${key(t)}\n${clip(t.did, DID)}\n${t.changed}`;
  const last = new Map(have.map((t) => [whole1(t), t]));
  // A turn read again replaces its own line, one for one, newest first:
  // "continue" twice in a minute is two lines of one key, and replacing every
  // line of the key lost the first when only the second was read again.
  const uniq = have.filter((t) => last.get(whole1(t)) === t), left = new Map(), gone = new Set();
  for (const f of fresh) left.set(key(f), (left.get(key(f)) ?? 0) + 1);
  for (const t of [...uniq].reverse()) { const n = left.get(key(t)); if (n) { gone.add(t); left.set(key(t), n - 1); } }
  // Read whole, the writer's turns are all fresh: an entry of its own left over
  // is no turn now, as a clock moved to another time zone leaves every minute.
  // Kept, each turn was listed twice, and the old zone's later-sorting minutes
  // crowded out the newest (audit, 2026-10-30). Never the untagged: a writer
  // with no session id is not every entry written before tags.
  const kept = uniq.filter((t) => !(whole && me && t.s === me) && !gone.has(t) && !(t.s === '' && seenBare.has(bare(t))) && !drop?.(t) && !fresh.some((f) => twin(f, t)));
  const merged = keep([...kept, ...fresh], me);
  if (!merged.length && !((drop || note) && has)) return null;
  // An entry kept from the file is rendered once, for the comparison and the
  // write: each render runs every secret pattern over it.
  const shown = new Map(), show = (t) => shown.get(t) ?? shown.set(t, render(t)).get(t);
  const core = merged.map(show).join('\n');
  // Compare the entries, not the stamp line, or the guard is dead code. A note
  // the compaction gate left lives until the next write: with one there, this
  // is a write.
  const notes = has && doc.slice(a, b).includes('**cut mid-turn**');
  if (!note && !notes && have.map(show).join('\n') === core) return 'unchanged';
  const head = [START,
    `_Written after every turn by \`handoff-log.mjs\`, so an interrupted session still leaves this. Last: ${local()}._`,
    '', core].join('\n');
  const body = note ? `${head.trimEnd()}\n${note}\n${END}` : `${head}\n${END}`;
  return has ? doc.slice(0, a) + body + doc.slice(b + END.length)
    : doc.trimEnd() + `\n\n## Last ${TURNS} exchanges\n\n` + body + '\n';
}

// Exported so memory-tier.mjs can run it in the same process from the Stop
// hook: a second Node start cost a median 200 ms a turn on this box.
// `note`: the compaction gate's in-flight note (compact-gate.mjs decides whether
// one may be written), placed in the section with this turn's entries, under
// one lock and one replace; never in a private conversation. With a note, true
// is both written and anything else is neither.
export function handoff(input, sink = null, keptUnder = null, note = null) {
  const dir = storeOf(input);
  const file = join(dir, 'handoff.md');
  // What happened is returned -- true written, 'unchanged', false nothing to
  // write, 'busy' another hook held the store, 'changed' another write kept
  // landing first (theirs is kept) -- because a caller that reads
  // silence as success reports "handoff written" over a store that does not
  // exist (the compaction gate did).
  if (typeof input.transcript_path !== 'string' || !existsSync(input.transcript_path)) return false;
  // Claude Code makes a project's memory folder when Claude first saves a
  // note: until then, no conversation in it was recorded. Made here for a
  // real session, one whose transcript Claude Code keeps in the projects
  // folder; never for a payload's cwd alone. Its project folder too: one
  // started in a repository's subfolder, with none yet at its root, has its
  // store in a folder Claude Code makes with the first note, and recorded
  // nothing until then (audit, 2026-10-28).
  // Recursive: two sessions starting in a new project at once both make it.
  if (!existsSync(dir)) {
    if (!inProjects(input.transcript_path)) return false;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  // The transcript is read outside the lock: it is the slow part, and this session's alone.
  const s = tag(input.session_id);
  // Read without the lock: a hint for how far back to read, nothing more.
  // One the disk won't read (EBUSY: a scan holding it) is no hint, and no sign of no entry: read as none, only the tail was read,
  // and after a clock moved to another zone each turn was listed twice (F21, fuzz 169429179). Read whole, as for a moved clock:
  // build() takes the old entries back. One that never reads throws under the lock, as before, and the Stop records the failure.
  let since = null, refused = false;
  try { const d = readFileSync(file, 'utf8'), { a, b } = sectionOf(d); if (a !== -1) since = parse(d.slice(a, b)).filter((t) => t.s === s).sort(byAt).at(-1) ?? null; } catch (e) { refused = e.code !== 'ENOENT'; }
  const got = latest(input.transcript_path, since, refused);
  T.mark('read');
  // The transcript can lag the reply that ends it: on Stop, Claude Code passes
  // that reply itself (hooks docs). Not after a block: then it is the reply
  // to the block. Nor when the hold has just ended and nothing was said since:
  // the reply it passes is then the memory update's.
  const open = got.open, last = input.last_assistant_message;
  if (open && !open.frozen && !open.reopened && input.hook_event_name === 'Stop' && !input.stop_hook_active && typeof last === 'string' && last.trim()) {
    open.did = last.trim();
    if (!open.said.endsWith(open.did)) open.said = tailOf(joined(open.said, open.did));
    if (got.at(-1) !== open) got.push(open);
  } else if (open && !open.frozen && input.hook_event_name === 'StopFailure' && (open.changed.length || open.ran.length) && got.at(-1) !== open) {
    // The error record may not be in the transcript yet: save the open turn's edits and commands without waiting for it.
    open.did ||= '[stopped before a reply]';
    got.push(open);
  }
  // File names, not paths; none for a private message's turn, read by what the
  // user typed as well as the ask made of it (userText): a wrapper own()
  // strips, or a command, hid the tag from the ask.
  const off = wasOff(dir);
  const fresh = got.filter((t) => !off(t)).map((t) => ({ ...t, s, ...shown(t),
    changed: PRIVATE.test(userText(t)) ? '' : newest(t.changed.map((f) => f.split(/[\\/]/).pop()), CHANGED) }));
  const hush = got.hush === true;
  // Sessions of one project write this file at once, so they take turns: 8 at
  // once lost 22 of 40 turns without the lock (2026-10-26). The model can still
  // edit the file by hand meanwhile -- the nudge asks it to -- and then the
  // merge is redone from what it wrote.
  const r = withLock(dir, () => {
    // A conversation marked private writes nothing, and what it wrote before
    // the mark goes. The mark is kept in a file: only the turn that typed it
    // sees it in the transcript.
    // Private by this read even when the mark could not be kept.
    const was = hushed(dir, s);
    // Unknown (the list won't read): nothing written, nothing swept; the next
    // Stop does it. Taken as private, a normal conversation's lines and entries
    // went (F12). Thrown, so the Stop records it: a list that never read again
    // stopped the store in silence (R64).
    if (was === null) throw unreadable(dir, QUIET);
    let quiet = was || hushed(dir, s, hush) || hush || hushed(projectsRoot(), s, false, OFF);
    // Held with auto memory off once (OFF): kept out as the journal keeps it out (take()), what it wrote before included. Read by
    // the journal alone, what was typed while auto memory was off reached handoff.md at the first Stop with it back on (e2e audit,
    // 2026-11-01). A list that won't read is unknown here too: nothing written or swept (F12).
    if (quiet === null) throw unreadable(projectsRoot(), OFF);
    // The journal (memory-tier's Stop passes its writer) takes this lock too,
    // not one of its own; whatever it throws is its own. Swept anew only by the
    // read that first marks it: while the mark stayed in the tail each Stop
    // reads (~25 Stops of 20 KB turns), every one swept every journal day
    // again, under the lock (1.5 s with three years of journal).
    if (sink) try { sink(dir, input.transcript_path, got, { quiet, hush: hush && !was }); } catch {}
    T.mark('journal');
    // Or by the journal's look at the whole transcript, past this read.
    quiet ||= hushed(dir, s);
    if (quiet === null) throw unreadable(dir, QUIET);
    // An exchange forget took out stays out: read again, the forget turn's own
    // Stop put it back (R36). By its transcript and minute, as forget lists it,
    // and by its key, the prompt's id: a clock moved to another time zone gave
    // it another minute, and it came back.
    // A list that won't read could name any of this turn's exchanges: none goes in, the startup line's rule (below).
    const { listed, shut } = forgottenIn(dir), me = pathKey(transcriptKey(input.transcript_path));
    const keys = new Set(listed.map(([k]) => k)), out = new Set(listed.filter(([, t]) => t && pathKey(t) === me).map(([, , at]) => at));
    // A turn with a key goes by it alone: the minute it was listed under, in
    // another zone's clock, can be another turn's minute here (fuzz, 2026-10-30).
    const forgot = (t) => (t.id ? keys.has(t.id) : out.has(t.at));
    // One already listed goes too, by what it says: forget took it out of
    // handoff.md by minute, and one listed under another zone's minute stayed (fuzz, 2026-10-30).
    const gone = fresh.filter(forgot);
    const drop = quiet ? (t) => t.s === s : gone.length ? (t) => t.s === s && gone.some((g) => g.ask === t.ask && g.did === t.did) : null;
    // A fork's copy of its parent's turn (the journal, written just above, holds that uuid under the parent's transcript) is
    // listed under the parent already. shortcut: found by the journal's day of the turn only; a clock moved across midnight lists it again.
    // The journal answers (keptUnder, passed in by the Stop hook and the compaction gate): none passed, or a journal that failed
    // to load, is no copy. shortcut: the day file is read once per new turn, not once per day; cache it if a Stop carries many turns.
    const mineT = transcriptKey(input.transcript_path);
    const copy = (t) => {
      const d = (t.at ?? '').slice(0, 10); if (!keptUnder || !t.id || !d) return false;
      // An unreadable day (the journal's own failure, kept elsewhere) is no copy: the handoff is still written.
      let k = null; try { k = keptUnder(dir, d, t.id); } catch {}
      return k !== null && k !== mineT;
    };
    if (!quiet) backup(dir);
    const w = put(dir, quiet || shut ? [] : fresh.filter((t) => !forgot(t) && !copy(t)), drop, s, got.whole, quiet ? null : note);
    return quiet ? 'private' : w;
  });
  return r ?? 'busy';
}

// A copy of handoff.md beside it, made at the first Stop of a day (by the copy's own date) and never for a private conversation: the
// file is kept out of the snapshots, so a bad edit or a failed write lost what was written by hand. Under the lock. Best effort.
const PREV = 'handoff.md.prev';
function backup(dir) {
  const file = join(dir, 'handoff.md'), prev = join(dir, PREV);
  try {
    if (!existsSync(file)) return;
    let at = 0; try { at = statSync(prev).mtimeMs; } catch {}
    if (new Date(at).toDateString() === new Date().toDateString()) return;
    copyFileSync(file, `${prev}.tmp`); renameSync(`${prev}.tmp`, prev);
  } catch {}
}

// handoff.md with these entries merged in, and without those `drop` takes (a
// private conversation's). Call under withLock(dir). True written,
// 'unchanged', false nothing to write, 'changed' another write landed first
// three times.
function put(dir, fresh, drop, me, whole, note = null) {
  const file = join(dir, 'handoff.md');
  // The copy holds what a sweep takes out of the file, so it goes with it, even when the file has nothing left to drop (the
  // exchange rolled out of it); the next Stop of a day makes a clean one.
  // The .tmp is a copy killed half way; the temp sweeper (digits after .tmp) never takes it.
  if (drop) for (const f of [PREV, `${PREV}.tmp`]) try { rmSync(join(dir, f), { force: true }); } catch {}
  for (let i = 0; i < 3; i++) {
    const before = raw(file);
    const next = build(before, fresh, drop, me, whole, note);
    if (next === null || next === 'unchanged') return next ?? false;
    const w = replaceIfUnchanged(file, before, next);
    if (w !== 'conflict') return w || 'unchanged';
  }
  return 'changed';
}
// The entries `gone` takes go from handoff.md: a conversation the journal's
// import found marked private, as its own Stop's would have, or the exchanges
// forget took out. Call under withLock(dir).
export const unsay = (dir, gone) => put(dir, [], gone);



// Stop output reaches nobody, so a Stop hook that stopped running -- unwired,
// or failing before it loads the handoff -- was silence. memory-tier touches
// `.stop-ran` on every `--stop`: a turn the newest other session finished
// after that went unrecorded. A tail full of messages the hooks cannot read
// means the transcript format moved under them.
// `hint`: the startup line says how to look closer; doctor, which is that,
// does not tell the user to run itself.
export function stalled(t, hint = true) {
  if (!t) return [];
  let end, seen, known; try { ({ end, seen, known } = lastTurn(t.p)); } catch { return []; }
  if (seen >= 50 && !known) return [`Memory hooks cannot read [${t.s}]'s transcript: none of its last ${seen} messages is a model reply they know. Has Claude Code's transcript format changed?`];
  // No file is not knowing (just installed, or cleaned away), not "never ran".
  let ran; try { ran = statSync(stopRan()).mtimeMs; } catch { return []; }
  if (end - ran > GRACE && Date.now() - end > GRACE) {
    // A full disk, or a folder that takes no writes, stops the proof of life too: said as hooks stopped or turned off, the
    // failed write was never named (audit H-F5). The file opened for writing, not written: a full disk opens it all the same.
    const root = projectsRoot();
    let refused = '';
    try { const s = statfsSync(root); if (s.bavail * s.bsize < 1048576) refused = `the disk holding ${root} is full`; } catch {}
    if (!refused) try { closeSync(openSync(stopRan(), 'r+')); } catch (e) { if (e.code !== 'ENOENT') refused = `${root} refuses writes (${e.code})`; }
    if (refused) return [`Memory could not be saved after [${t.s}]'s reply at ${local(end)}: ${refused}. project-memory saves again once it can write there.`];
    return [`Memory hooks look stopped: [${t.s}] finished a reply at ${local(end)}, but project-memory last saved after one at ${local(ran)}. ` +
      `If project-memory was turned off meanwhile, this clears after the next reply.` +
      (hint ? ` If not: node "${join(dirname(fileURLToPath(import.meta.url)), 'memory.mjs')}" doctor` : '')];
  }
  return [];
}

// Run directly (the tests and fuzz.mjs do): payload on stdin, always exit 0. The briefing (--print) is briefing.mjs's.
// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
export async function main() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    T.tag(input.hook_event_name, input.source);
    // Auto memory off: no record; the tag at every Stop, so no
    // backfill imports a conversation whose first reply got no Stop (P1 hunt,
    // 2026-10-29). A project turned off (memory off): nothing written.
    if (isOff(storeOf(input))) {}
    // A tag that could not be written is the next start's to write.
    else if (memoryOff()) { try { off(input); } catch {} }
    else handoff(input);
  } catch {
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
