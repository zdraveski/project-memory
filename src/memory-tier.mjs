#!/usr/bin/env node
// Tier the auto-memory index: MEMORY.md holds only what is worth paying for
// every session; everything else moves to MEMORY-archive.md, which is grepped
// on demand. Pointer prose is MOVED verbatim between the two files, never
// rewritten -- the hook text is hand-written and carries the recall value.
//
// Run: node memory-tier.mjs [--dry-run] [--dir <memory dir>] [--tidy <memory dir>]
// As the Stop hook (and before a manual /compact) it runs with `--stop`, the
// payload on stdin, and tiers that session's own store (a Stop hands that to a `--tidy` process of its own); a manual run walks them all.

import { mkdirSync, readFileSync, writeFileSync, writeSync, unlinkSync, readdirSync, existsSync, statSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import * as T from './timing.mjs';
import { isOff } from './privacy.mjs';
import { snapshot, snapshotHealth, owed, reset, GIT_TIMEOUT, BATCH } from './snapshot.mjs';
import { storeOf, withLock, lockBudget, sweepTemps, replaceIfUnchanged, projectsRoot, opener, sleep, same, BUSY, sharedStore, isShared, budgetOf, POINTER, ARCHIVE, isIndex, pointerLine, allStores, front, raw, memoryOff, reason, redact, tag } from './store.mjs';
import { HANDOFF_FAILED, health, stopRecord, plugins } from './run-records.mjs';

// --- the rules. Change these, not the code below. ---------------------------
const KEEP_TYPES = new Set(['feedback', 'user']); // how-to-work rules: always hot
const EVENT_DAYS = 3;    // a memory whose *filename* carries a date is an event log
const STALE_DAYS = 7;    // anything not touched this long stops earning its line
// Frontmatter `tier: hot` / `tier: archive` overrides both windows, and
// `superseded-by:` reads as `tier: archive` (store.mjs's front()). The archive
// is a one-way door: a pointer already there stays there unless `tier: hot`,
// because moving it was a decision and a date is not grounds to overturn it.
// The one exception is a line the byte ceiling evicted: it is marked, and it
// returns when there is room, because nobody decided it should go.
const OVERFLOW = '<!-- overflow -->';
// A memory file this young with no pointer is not lost: its writer is about to
// add one (the model writes the file, then edits the index, seconds apart).
const ORPHAN_GRACE = 2 * 60000;

// The byte ceilings of an index, project and shared, are in store.mjs: the
// memory CLI reports them too.
// Of the budget left after pinned lines, the most KEEP_TYPES may hold once the
// ceiling bites (under budget nothing is evicted). Without it they never age
// out and accumulate at about one a day, so after six months the index was 69
// working rules and *zero* recent work -- measured, not guessed
// (memory-tier.soak.mjs 180). The index has two jobs: how to work here, and
// where the work stands. A rule that outlives its share is still greppable.
const RULE_SHARE = 0.5;
const LINES = 200;   // of MEMORY.md, all Claude Code loads at a session's start
const DAY = 86400000;
// Set from the arguments by main() at each start, before anything reads them:
// the suite runs main() many times in one process, and one run's --dry-run
// must not reach the next.
let dry;
// `--pause <ms>` holds a pass open between computing and writing it, so a test
// can land an edit in that window, and says `paused` on stderr as it starts:
// waited out instead, 1.5 s, the test guessed how long a loaded box takes to
// start. Test-only, like `--now`.
let PAUSE;
// `--batch <files>` and `--git-timeout <ms>`, test-only too: a part of a first snapshot, and git's timeout, made small.
let batch, gitWait;

// A line Claude Code's own backfill of the index adds for a journal day; the journal is searched, never listed.
const DEBRIS = /^- \[[^\]]*\]\(journal\/\d{4}-\d\d-\d\d\.md\)\s*$/;

// A killed process must not leave a half-written index (temp + rename), and a
// write must not land over an edit this pass did not see (store.mjs). Nothing
// is written when the file already says it: churning every store would destroy
// mtime as a signal, and it is the difference between "the hook ran" and "the
// hook changed something". The same lines in another order is no change
// either: the index is re-rendered with the archive line last and the model
// appends below it, so every new memory used to cost a rewrite -- each one a
// moment the model's next edit could be lost in (2026-10-26).
const sameLines = (a, b) => {
  const norm = (t) => t.replace(/\n+$/, '').split('\n').sort().join('\n');
  return norm(a) === norm(b);
};
const write = (path, read, next) => (read !== null && sameLines(read, next) ? false : replaceIfUnchanged(path, read, next));

// What factsFor read of each note, by name, with the size and mtime it had: read again only when one of them changed. Reading
// every note's head cost a Stop that tidied ~1 ms a note on Windows, a second at 1,000 (audit H-F2). The Stop's gate already
// trusts size and mtime to say a note changed. No text in it: a type, a tier and a date a note.
const FACTS = '.facts';

// `modified:` in the frontmatter beats mtime: a checkout or a copy resets mtime,
// and the memory's own stamp is what the writer meant.
function factsFor(dir, file, memo = null) {
  const path = join(dir, file);
  // A target that is missing or is no file (a directory) is treated as missing
  // rather than aborting the whole store. One another program holds fails the
  // pass instead: read as missing, its alarm was stamped and stayed a day.
  // The head only: the frontmatter is at the top, and a 1.5 GB file read whole
  // cost seconds of every Stop. 1,200 characters, as before: up to 4 bytes each.
  let head, st, k, was;
  try {
    // As the Stop's gate saw it, when it did: a note changed since is read anew next pass, its size or time no longer the key.
    st = memo?.seen?.get(file) ?? statSync(path);
    if (!st.isFile()) return null;
    // `2 `: what 1.3.0 read is read again; it took `superseded-by: none` for archive (1.3.1 final review).
    k = `2 ${st.size} ${st.mtimeMs}`; was = memo?.was[file];
    if (!Array.isArray(was) || was[0] !== k) {
      was = null;
      // 16 KB: the first 1,200 characters missed a pin set after a long folded
      // description, and the note was archived for good (audit, 2026-10-28).
      const fd = openSync(path, 'r'), buf = Buffer.alloc(16384);
      try { head = buf.toString('utf8', 0, readSync(fd, buf, 0, buf.length, 0)); } finally { closeSync(fd); }
    }
  } catch (e) { if (BUSY.includes(e.code)) throw e; return null; }
  const { type, tier, desc, modified: stamp } = was ? { type: was[1], tier: was[2], modified: was[3] ?? NaN } : front(head);
  if (memo) memo.now[file] = [k, type, tier, Number.isNaN(stamp) ? null : stamp];
  // A stamp over a day in the future is a typo (2099): it kept the note hot forever (1.3.1 audit E-4).
  const modified = Number.isNaN(stamp) || stamp > Date.now() + DAY ? st.mtimeMs : stamp;
  const named = (file.match(/(\d{4})-(\d{2})-(\d{2})/) || [])[0];
  // A name's date that is not one (2026-13-45, or Feb 31 that Date.parse rolls to March) is no date: NaN archived the note at once.
  const d = named ? Date.parse(named) : NaN;
  const eventDate = d === d && new Date(d).toISOString().slice(0, 10) === named ? d : null;
  return { type, tier, modified, eventDate, desc, when: eventDate ?? modified };
}

// `shared`: a lesson in the shared store holds in every project for as long as
// it holds at all, so no window ages it out -- a `reference` one was archived
// a week after it was shared, and never printed again (review, 2026-10-27).
// Only the byte ceiling, or `tier: archive`, moves it.
function isHot(f, now, shared) {
  if (!f) return true;                       // target missing: leave it alone, report it
  if (f.tier === 'hot') return true;
  if (f.tier === 'archive') return false;
  if (shared || KEEP_TYPES.has(f.type)) return true;
  if (f.eventDate !== null) return now - f.eventDate < EVENT_DAYS * DAY;
  return now - f.modified < STALE_DAYS * DAY;
}

// Split an index into its non-pointer prose and its pointer lines. Prose is
// collected wherever it sits and re-emitted at the top: a heading someone adds
// mid-file gets relocated, never dropped. Only the Archive line is discarded --
// it is regenerated with a live count.
function split(text) {
  const pointers = [];
  const preamble = [];
  // `gap`: a blank line between the prose and the first pointer, kept: dropped, a `# Memory Index` heading lost the line
  // under it at the first pass (audit I-F4).
  let gap = false, last = null;
  // A BOM binds to the first line and stops it matching POINTER, which quietly
  // demotes the top memory to prose and orphans it.
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(POINTER);
    // The Archive line counts for the gap too: with every pointer cold it is the only line after the blank one.
    if (m) gap ||= !pointers.length && preamble.at(-1)?.trim() === '';
    if (m && m[1] === ARCHIVE) { last = null; continue; }   // by its target, not its title: regenerated with a live count
    // An indented line right under a pointer is its hook, wrapped: it goes where the pointer goes (1.3.1 audit D-1).
    // Held with \n inside; the writes below turn it into the file's own line ending.
    if (m) pointers.push(last = { line, target: m[1] });
    else if (last && /^[ \t]+\S/.test(line)) last.line += '\n' + line;
    else { last = null; if (line.trim() || preamble[preamble.length - 1]?.trim()) preamble.push(line); }
  }
  while (preamble.length && preamble[preamble.length - 1].trim() === '') preamble.pop();
  return { preamble, pointers, gap };
}
// A file's line ending, as its first line has it: a CRLF index was written back LF (audit I-F4).
const eolOf = (text) => (/^[^\n]*\r\n/.test(text) ? '\r\n' : '\n');

// `seen`: the Stop's stat of each note, by name (main()); none, each is stat'ed here.
function tier(dir, now, seen = null) {
  const mainPath = join(dir, 'MEMORY.md'), shared = isShared(dir);
  const arcPath = join(dir, ARCHIVE);
  // What this pass is computed from. A write goes through only while the file
  // still holds it: the model may edit the index while the pass runs.
  const mainText = readFileSync(mainPath, 'utf8');
  const arcText = raw(arcPath);
  // The mirror of a young orphan: a pointer the model wrote before its file.
  // Neither is a problem while the index is this fresh. Either one leaves the
  // store `waiting`: unstamped, so the next turn looks again -- a stamp would
  // hold until the date changed, and the grace would become a day.
  const young = Math.abs(now - statSync(mainPath).mtimeMs) < ORPHAN_GRACE;   // dated ahead of the clock is no younger
  let waiting = false;
  const main = split(mainText.split(/\r?\n/).filter((l) => !DEBRIS.test(l)).join('\n'));
  // No trailing blank in the default: render adds one, and a second blank was
  // trimmed on the next run -- a fresh store rewrote its archive one session late.
  const arc = arcText !== null ? split(arcText) : { preamble: ['# Archive'], pointers: [] };

  const hot = [], cold = [], missing = [], dupes = [], recovered = [], odd = [];
  // One line per memory. A target already placed is a duplicate -- the store had
  // one before this guard existed -- and emitting it twice doubles its cost and
  // makes the two copies drift apart. In the index the newer, lower line wins,
  // where the first was: Claude appends an updated line below the old one, and
  // keeping the first threw the update away, in no file and no snapshot (the
  // old one is in the history). An index line beats an archived one.
  // By the file the disk opens (store.mjs `opener`): on Windows and macOS
  // (Kase.md) is kase.md's line, and read as no line for it, kase.md got a
  // second, machine-written one.
  let listed = []; try { listed = readdirSync(dir); } catch {}
  const key = opener(dir, listed);
  // A cache: one that does not parse is none.
  const memo = { was: {}, now: {}, seen };
  try { memo.was = JSON.parse(raw(join(dir, FACTS))) ?? {}; } catch {}
  const placed = new Map();
  const place = (p, where, inIndex = false) => {
    const was = placed.get(key(p.target));
    if (was) { dupes.push(p.target); if (inIndex && was.inIndex) was.p.line = p.line; return; }
    placed.set(key(p.target), { p, inIndex });
    where.push(p);
  };
  for (const p of main.pointers) {
    p.f = factsFor(dir, p.target, memo);
    if (!p.f) missing.push(p.target);
    place(p, isHot(p.f, now, shared) ? hot : cold, true);
  }
  // Already archived: sticky. Only an explicit `tier: hot` brings one back --
  // or the ceiling's mark: a line evicted for a byte count was not archived
  // by a decision, and it comes back when there is room (a pin removed, a
  // hook shortened, three event logs aged out). The mark comes off here; a
  // line that stays cold now does so by its window, and is sticky again.
  // One whose file is gone stays, unreported: the archive is history, and a
  // note deleted after its line was archived warned at every startup, for good.
  for (const p of arc.pointers) {
    // 1.3.0 archived what it misread as `tier: archive` (`superseded-by: none`), unmarked: on the one pass that still sees
    // its cache, the window decides that line as it would a marked one (1.3.1 fix review).
    const old = memo?.was[p.target];
    p.f = factsFor(dir, p.target, memo);
    const misread = Array.isArray(old) && !String(old[0]).startsWith('2 ') && old[2] === 'archive';
    const overflow = p.line.endsWith(OVERFLOW);
    p.was = p.line;   // as the archive holds it, mark and all
    // The one space the mark was added with: a trailing one the line had is its own.
    if (overflow) p.line = p.line.slice(0, -OVERFLOW.length).replace(/ $/, '');
    place(p, p.f && (p.f.tier === 'hot' || ((overflow || misread) && isHot(p.f, now, shared))) ? hot : cold);
  }

  // A memory no pointer names is unreachable at session start. Truncate either
  // index -- an interrupted write, a bad merge, a BOM -- and the memories are
  // still on disk with nothing to recall them by. Give each one a pointer built
  // from its own `description:`, hot or archived by the note's age.
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md') || isIndex(f) || placed.has(key(f))) continue;
    // Its writer is about to point at it. A recovered line placed now would
    // beat the hand-written one to the index. Not handoff.md: this same Stop
    // just rewrote it, and its writer never adds a pointer. Nor journal.md's.
    if (f !== 'handoff.md' && f !== 'journal.md') {
      let at; try { at = statSync(join(dir, f)).mtimeMs; } catch (e) { if (BUSY.includes(e.code)) throw e; continue; }   // a dangling link, or deleted since the listing: no note; a held file fails the pass, as in factsFor
      if (Math.abs(now - at) < ORPHAN_GRACE) { waiting = true; continue; }
    }
    // A name no index line can point at (`lesson (1).md`): its line, read back,
    // named another file, and a new one was added on every pass.
    // Nor one whose name holds a secret: the pointer links the real name, so it would reach MEMORY.md (named redacted here).
    if ((`- [x](${f})`.match(POINTER) || [])[1] !== f || redact(f) !== f) { odd.push(redact(f)); continue; }
    const facts = factsFor(dir, f);
    if (!facts) continue;
    // Filed by its age like any line, so a note written today is not hidden from the next session; the ceiling evicts it
    // like any other (a pin the archive would promote anyway, and the shared store's lessons are hot unless archived).
    place({ line: pointerLine(f, facts.desc || 'recovered: no description'), target: f, f: facts }, isHot(facts, now, shared) ? hot : cold);
    recovered.push(f);
  }

  const archiveLine = (n) => `- [Archive](${ARCHIVE}) — ${n} older pointers; grep it before assuming something was never learned`;
  // Each file in its own line endings (a new archive in the index's), the blank under the prose kept.
  const eol = eolOf(mainText), arcEol = arcText !== null ? eolOf(arcText) : eol;
  const render = () => [...main.preamble, ...(main.gap ? [''] : []), ...hot.map((p) => p.line), archiveLine(cold.length)].join(eol).replace(/\r?\n/g, eol) + eol;

  // A ceiling, not a warning. The windows cap how many lines survive, not how
  // long they are, so a corpus that writes six memories a day outgrows any
  // window. Evict oldest-first until the file fits: event logs before durable
  // notes, how-to-work rules last, pinned lines never.
  const evictable = hot.filter((p) => p.f && p.f.tier !== 'hot');
  // Equal dates by file name: in the order the lines happened to be in, the
  // lines a pass brought back went last, and each pass evicted different ones.
  const byAge = (a, b) => a.f.when - b.f.when || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0);
  const rules = evictable.filter((p) => KEEP_TYPES.has(p.f.type)).sort(byAge);
  // Event logs before durable notes, and only then by age: a day's log is
  // worth less at session start than the note on where the work stands.
  const work = evictable.filter((p) => !KEEP_TYPES.has(p.f.type));
  const rest = [...work.filter((p) => p.f.eventDate !== null).sort(byAge), ...work.filter((p) => p.f.eventDate === null).sort(byAge)];

  // Rules over their share are evicted *before* recent work, oldest first;
  // the ones inside it are evicted last, as they were. The share is of the
  // budget left after the pinned lines (and pointers whose file is missing:
  // kept and unevictable alike). Measured on the whole budget, 16 pins at
  // 44 % and 21 rules at their 50 % left two lines for where the work
  // stands (2026-09-13, the owner's call).
  const over = [], budget = budgetOf(dir);
  const pinnedBytes = hot.filter((p) => !p.f || p.f.tier === 'hot').reduce((n, p) => n + Buffer.byteLength(p.line) + 1, 0);
  const share = Math.max(0, budget - pinnedBytes) * RULE_SHARE;
  let ruleBytes = rules.reduce((n, p) => n + Buffer.byteLength(p.line) + 1, 0);
  while (ruleBytes > share && rules.length) {
    const p = rules.shift();
    ruleBytes -= Buffer.byteLength(p.line) + 1;
    over.push(p);
  }
  const queue = [...over, ...rest, ...rules];
  // Bytes, not string length: `.length` counts UTF-16 units, and every em-dash
  // costs three bytes. Only 1.4 % on this index -- but a budget measured in the
  // wrong unit enforces a number that does not exist, and the gap grows with
  // every arrow someone adds. Counted once and kept up to date: a render per
  // eviction was quadratic, 24 s for a store of 10,000 notes.
  const bytes = (s) => Buffer.byteLength(s);
  let size = bytes(render());
  // And lines: Claude Code loads the first 200, and 7 KB of short lines is more.
  // A pointer with its wrapped hook is several lines.
  const lines = (p) => p.line.split('\n').length;
  let count = main.preamble.length + Number(main.gap) + hot.reduce((n, p) => n + lines(p), 0) + 1;
  const evicted = new Set();
  for (let q = 0; (size > budget || count > LINES) && q < queue.length; q++) {
    const victim = queue[q];
    count -= lines(victim);
    size -= bytes(victim.line) + eol.length + bytes(archiveLine(cold.length)) - bytes(archiveLine(cold.length + 1));
    evicted.add(victim);
    victim.line += ' ' + OVERFLOW;        // so the archive loop knows it may come back
    cold.push(victim);
  }
  if (evicted.size) hot.splice(0, hot.length, ...hot.filter((p) => !evicted.has(p)));

  const before = Buffer.byteLength(mainText);
  const nextMain = render();
  const nextArc = [...arc.preamble, '', ...cold.map((p) => p.line)].join(arcEol).replace(/\r?\n/g, arcEol) + arcEol;
  // Written at once: the sleep blocks the loop an async write would wait on.
  if (PAUSE) { writeSync(2, 'paused\n'); sleep(PAUSE); }

  // Archive first. If the second write fails, the worst case is a pointer in
  // both files -- which the dedupe above then heals. Writing main first and
  // failing would delete hand-written prose that had nowhere else to live.
  // A line going back to the index stays in the archive, as it was, until the
  // index has it: taken out first, a failed index write (an edit meanwhile, a
  // file another program held, a killed hook) left it in neither file, and the
  // next pass filed a machine-written line for it in the archive for good.
  // A conflict means the model wrote an index during the pass: its write is
  // kept, this pass is dropped, and the next turn redoes it from what it wrote.
  let wrote = false, conflict = false;
  if (!dry) {
    const back = arc.pointers.filter((p) => hot.includes(p));
    const first = back.length ? [...arc.preamble, '', ...cold.map((p) => p.line), ...back.map((p) => p.was)].join(arcEol).replace(/\r?\n/g, arcEol) + arcEol : nextArc;
    const a = write(arcPath, arcText, first);
    const m = a === 'conflict' ? 'conflict' : write(mainPath, mainText, nextMain);
    const b = back.length && a !== 'conflict' && m !== 'conflict' ? write(arcPath, a === true ? first : arcText, nextArc) : false;
    conflict = a === 'conflict' || m === 'conflict' || b === 'conflict';
    wrote = a === true || m === true || b === true;
    // Whole, so a note deleted leaves it too; under the store's lock, and a cache: a write that fails costs the next pass a read.
    const facts = JSON.stringify(memo.now);
    // Not after a conflict: the pass that still sees a 1.3.0 entry is the one that brings a misread line back.
    if (!conflict && facts !== JSON.stringify(memo.was)) try { writeFileSync(join(dir, FACTS), facts, { mode: 0o600 }); } catch {}
  }

  return { dir, budget, before, after: Buffer.byteLength(nextMain), hot: hot.length, cold: cold.length,
    missing: young ? [] : missing, waiting: waiting || (young && missing.length > 0), dupes, recovered, odd, wrote, conflict,
    // A merge left unresolved (a store synced between two machines): loaded into
    // every session as it is, and one side's line for a note silently dropped.
    // Both ends: a heading underlined with seven `=` is no conflict.
    merged: /^<{7}(?:[ \t].*)?\r?$/m.test(mainText) && /^>{7}(?:[ \t].*)?\r?$/m.test(mainText) };
}

// Recall is a grep, not a flag: `rg -il <term> ~/.claude/projects/*/memory --glob '!MEMORY*'`
// finds the memory, hot or archived; its `description:` line is the hook.

// A store the plugin has written to (a handoff or a journal) with no MEMORY.md gets a title-only one: Claude Code never made it,
// and tiering walks only stores that have one. Exclusive create, so an index written meanwhile is never overwritten.
function ensureIndex(d) {
  try {
    if (existsSync(join(d, 'MEMORY.md')) || !(existsSync(join(d, 'handoff.md')) || existsSync(join(d, 'journal')))) return;
    writeFileSync(join(d, 'MEMORY.md'), '# Memory Index\n', { flag: 'wx', mode: 0o600 });
  } catch {}
}

// An update installs a newer copy, but a session runs the one it started with
// until /reload-plugins, which no plugin can run itself: say so once per
// conversation and version, as a line for the user (a Stop's systemMessage).
const reloadNotice = (payload) => {
  const ver = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')).version; } catch { return null; } };
  const all = plugins('installed_plugins.json')?.plugins;
  const entry = Object.entries(all ?? {}).find(([k]) => k.split('@')[0] === 'project-memory')?.[1]?.[0];
  const have = entry && (entry.version ?? (entry.installPath && ver(join(entry.installPath, '.claude-plugin', 'plugin.json'))));
  const runs = ver(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)));
  if (typeof have !== 'string' || typeof runs !== 'string' || !newer(have, runs)) return null;
  const mark = join(projectsRoot(), '.nudge', `${tag(String(payload.session_id || 'none').replace(/[^\w-]/g, ''))}.reload`);
  let was = null; try { was = readFileSync(mark, 'utf8'); } catch {}
  if (was === have) return null;
  // Unwritable: quiet, or it would be said at every Stop.
  try { mkdirSync(dirname(mark), { recursive: true }); writeFileSync(mark, have); } catch { return null; }
  return `project-memory ${have} is installed, run /reload-plugins to use it`;
};
// Whether version a is past b, part by part; 1.5.3.1 is past 1.5.3, anything not numbers is not.
const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  if (x.concat(y).some((n) => !Number.isInteger(n))) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== (y[i] ?? -1)) return x[i] > (y[i] ?? -1);
  return false;
};

// A run: its arguments and, behind --stop, stdin's text; it returns the exit
// code. The entry at the end calls it once, the suite many times in its own
// process, as memory.test.mjs calls memory.mjs's: a process a check cost ~0.2 s.
export async function main(argv, input) {
  dry = argv.includes('--dry-run');
  const pauseAt = argv.indexOf('--pause');
  PAUSE = pauseAt === -1 ? 0 : Number(argv[pauseAt + 1]) || 0;
  const arg = (flag, or) => (argv.includes(flag) ? Number(argv[argv.indexOf(flag) + 1]) || or : or);
  batch = arg('--batch', BATCH); gitWait = arg('--git-timeout', GIT_TIMEOUT);
  reset();
  // `--now <ms>` exists so a month of use can be simulated in one run
  // (memory-tier.soak.mjs). Nothing else sets it.
  const nowAt = argv.indexOf('--now');
  const now = nowAt !== -1 ? Number(argv[nowAt + 1]) : Date.now();

  // `--stop`: the Stop hook. The payload is `input`, stdin's text (the entry
  // reads it only behind the flag, so a manual run never blocks on a
  // terminal). The handoff is written first, in this process -- a second Node
  // start cost a median 200 ms a turn on this box.
  const stop = argv.includes('--stop');
  // Its locks wait 2 s in all, not 2 s each (store.mjs).
  lockBudget(stop);
  // Auto memory turned off: no record, no nudge, no tiering. Only the
  // conversation's tag, so no later Stop's backfill imports it (handoff-log OFF).
  if (stop && memoryOff()) {
    let p = null;
    try {
      p = JSON.parse(input);
      (await import(new URL('./privacy.mjs', import.meta.url))).off(p);
    } catch (e) {
      // A tag that could not be kept is said at the next start with memory on, as a handoff that could not be saved is (R67), in its
      // own words (`off`): nothing was to be saved, and the journal may take the conversation in later (release review).
      if (p) try { writeFileSync(join(projectsRoot(), `${HANDOFF_FAILED}${basename(dirname(storeOf(p)))}`), JSON.stringify({ at: new Date().toISOString(), error: reason(e), off: true }), { mode: 0o600 }); } catch {}
    }
    // The 7-day rule on session files holds with memory off too (recall.mjs).
    try { (await import(new URL('./recall.mjs', import.meta.url))).sweepSessions(); } catch {}
    return 0;
  }
  let payload = null;
  // PreCompact's stdout becomes the compaction's instructions, so its run reports nothing.
  const say = (m) => { if (payload?.hook_event_name !== 'PreCompact') console.log(m); };
  if (stop) {
    try { payload = JSON.parse(input); } catch {}
    T.tag(payload?.hook_event_name);
    // A project turned off (memory off): nothing is written, not even .stop-ran.
    try { if (payload && isOff(storeOf(payload))) return 0; } catch {}
    T.mark('input');
    // SubagentStop: the agent's report goes to the journal, nothing else runs (no tiering, no nudge, no handoff).
    if (payload?.hook_event_name === 'SubagentStop') { try { (await import(new URL('./journal.mjs', import.meta.url))).subagent(payload); } catch {} return 0; }
    // Two tries, not one: a handoff that fails to write (two sessions renaming
    // over the same store at once) must not also skip the nudge -- that was
    // the one Stop the nudge exists for.
    try {
      const { handoff } = await import(new URL('./handoff-log.mjs', import.meta.url));
      // Proof of life for the startup line (handoff-log's stalled()), once the
      // handoff has loaded: Stop output reaches nobody, so a hook that stopped
      // running was silence.
      stopRecord(payload);
      // One that throws (a store folder that takes no new files) is kept in a
      // file the next start reads: swallowed, nothing was saved, and nothing said.
      // One per project, beside the projects, not in the store that refused it:
      // shared, another project's next save cleared this one's.
      const failed = join(projectsRoot(), `${HANDOFF_FAILED}${basename(dirname(storeOf(payload || {})))}`);
      // The journal in a try of its own: a journal.mjs that cannot load costs
      // the journal, never the handoff.
      let sink = null, kept = null;
      try { ({ write: sink, keptUnder: kept } = await import(new URL('./journal.mjs', import.meta.url))); } catch {}
      T.mark('load');
      // A store still held after one wait (twenty Stops at once) gets one more, after a pause and with a fresh wait: the session's
      // last Stop has no later one to redo the turn (defect hunt 1.3.2, C5).
      try {
        let s = payload && handoff(payload, sink, kept);
        if (s === 'busy' && stop) { sleep(200 + Math.random() * 600); lockBudget(true); s = handoff(payload, sink, kept); }
        // Still held: the reply is unsaved, so say so, and keep any earlier record.
        if (s === 'busy' && stop) throw new Error('the store stayed busy: another session held it through two tries, so this reply was not saved');
        try { unlinkSync(failed); } catch {}
      }
      catch (e) { writeFileSync(failed, JSON.stringify({ at: new Date().toISOString(), error: reason(e) }), { mode: 0o600 }); }
      T.mark('handoff');
      // The index of a store the plugin writes to, in the same Stop that wrote its handoff; the nudge below must not skip it.
      if (payload && !dry) ensureIndex(storeOf(payload));
      // The temp copies a killed Stop left here (store.mjs).
      if (payload) try { sweepTemps(storeOf(payload)); } catch {}
      // Session files older than 7 days, in every project (recall.mjs).
      try { (await import(new URL('./recall.mjs', import.meta.url))).sweepSessions(); } catch {}
      T.mark('index');
      // Then a few of the conversations still on disk, into the journal, without
      // a word; in a try of its own, so a failed import costs only the import.
      // Not due, no lock taken: another hook holding the store cost the Stop a
      // second wait to learn there was nothing to do.
      try {
        const { backfill, due, JOURNAL } = await import(new URL('./journal.mjs', import.meta.url)), d = payload && storeOf(payload);
        if (d && due(d) && (existsSync(join(d, JOURNAL)) || readdirSync(dirname(d)).some((f) => f.endsWith('.jsonl')))) withLock(d, () => backfill(d, { skip: payload.transcript_path }));
      } catch {}
      T.mark('backfill');
    } catch {}
    try {
      // Past the compaction trigger, the next prompt compacts: nudge this stop
      // once so memory is written first (compact-gate.mjs). Printed alone --
      // a Stop hook's output is JSON on stdout, and the tiering lines below would
      // break it; tiering waits for the next turn, which redoes it anyway.
      let notice = null; try { notice = payload && reloadNotice(payload); } catch {}
      const nudge = payload && (await import(new URL('./compact-gate.mjs', import.meta.url))).nudge(payload);
      T.mark('notice');
      const out = (nudge || notice) && { ...nudge, ...(notice && { systemMessage: notice }) };
      // Done once it is written: on macOS a pipe is written asynchronously, and
      // an exit right after a write can cut it (handoff-log's --print, CI 2026-10-29).
      if (out) { await new Promise((done) => process.stdout.write(JSON.stringify(out) + '\n', done)); return 0; }
    } catch {}
  }

  const dirAt = argv.indexOf('--dir'), tidyAt = argv.indexOf('--tidy');
  if (!stop && !dry && dirAt === -1 && tidyAt === -1) try { for (const p of readdirSync(projectsRoot())) { const d = join(projectsRoot(), p, 'memory'); if (!isOff(d)) ensureIndex(d); } } catch {}
  if (dirAt !== -1 && !argv[dirAt + 1]) { console.log('--dir needs a path'); return 1; }
  // A Stop tiers its own session's store and no other. Every Stop once walked all
  // sixteen: a session in one project rewrote another's index while that
  // session's model was editing it -- 74 of 120 fresh pointers replaced by
  // recovered machine lines in the race probe (2026-10-26). A manual run still
  // walks them all. The shared store is every project's, so any Stop may tier it,
  // under its own lock, when it changed.
  // `--tidy <dir>`: the rest of a Stop, in the process the Stop started (below); the same stores, gated the same way.
  if (tidyAt !== -1 && !argv[tidyAt + 1]) { console.log('--tidy needs a path'); return 1; }
  const own = tidyAt !== -1 ? argv[tidyAt + 1] : (() => { try { return storeOf(payload || {}); } catch { return null; } })();
  const dirs = dirAt !== -1 ? [argv[dirAt + 1]]
    : stop || tidyAt !== -1 ? [...new Set([own, sharedStore()])].filter((d) => d && existsSync(join(d, 'MEMORY.md')))
    : allStores();
  for (let i = dirs.length; i--;) if (isOff(dirs[i])) dirs.splice(i, 1);

  // Then only do the rest when a memory in the store changed. handoff.md changes
  // every turn and is left out; every other file's name, size and mtime is the
  // fingerprint. The pass plus git cost a median 600 ms under load, and on most
  // turns nothing has changed. The date is part of it: the windows are
  // time-based, so a quiet store is still re-tiered once a day. The stamp lives in
  // its store, so sessions of different projects never share one.
  const stampOf = (d) => join(d, '.tiered');
  // Each note is stat'ed once a Stop: the gate, the pass and its stamp each did it, three stats of every note (audit H-F2).
  // One that cannot be stat'ed (a dangling link) is left out, or the store was never stamped and re-tiered on every turn.
  const scan = (d) => new Map(readdirSync(d).filter((f) => f.endsWith('.md') && f !== 'handoff.md')
    .flatMap((f) => { try { return [[f, statSync(join(d, f))]]; } catch { return []; } }));
  const fingerprint = (s) => new Date().toDateString() + JSON.stringify([...s].map(([f, st]) => [f, st.size, st.mtimeMs]));
  const seen = new Map();
  // The stamp: what the pass saw, with the index and archive as it left them. A note written while it ran is not in it, and
  // the next turn takes it up. An archive it made is a new name: the folder listed again, in its own order.
  const stampAfter = (d) => {
    const s = new Map(seen.get(d));
    if (!s.has('MEMORY.md') || !s.has(ARCHIVE)) return fingerprint(scan(d));
    for (const f of ['MEMORY.md', ARCHIVE]) s.set(f, statSync(join(d, f)));
    return fingerprint(s);
  };
  const gated = (stop || tidyAt !== -1) && !dry && dirAt === -1;
  const todo = gated ? dirs.filter((d) => { try { seen.set(d, scan(d)); return readFileSync(stampOf(d), 'utf8') !== fingerprint(seen.get(d)); } catch { return true; } }) : dirs;
  // Nothing to tidy: done, unless a snapshot is owed, which runs alone.
  T.mark('scan');
  if (gated && !todo.length && !owed()) return 0;
  // The tidy-up and the snapshot after a reply run in a process of their own, which the user never waits for: git on a
  // loaded PC held the reply 31 s (.timing, 2026-11-22). The child scans again and does what is still owed then.
  // A spawn that throws runs it here, as before; one that fails later (an 'error' event) leaves it to the next Stop,
  // since nothing was stamped. A manual /compact (PreCompact) still waits for it: the index it compacts with should be tidy.
  // PROJECT_MEMORY_TIDY=inline keeps it in the hook: the suites assert what a Stop did once it returns.
  if (stop && gated && ['Stop', 'StopFailure'].includes(payload?.hook_event_name) && process.env.PROJECT_MEMORY_TIDY !== 'inline') {
    try {
      spawn(process.execPath, [fileURLToPath(import.meta.url), '--tidy', own || sharedStore()], { detached: true, stdio: 'ignore', windowsHide: true })
        .on('error', () => {}).unref();
      T.mark('spawn');
      return 0;
    } catch {}
  }
  // The first time, the notebook is kept as it was found before the tidy-up
  // changes it: snapshotted after, the table of contents as the user had
  // written it could never come back (docs review, 2026-10-28).
  if (!dry && dirAt === -1 && todo.length && !existsSync(join(projectsRoot(), '.git'))) snapshot({ gitWait, batch });
  T.mark('snapshot');

  const clean = [];
  for (const dir of todo) {
    // One unreadable store must not stop the others. This runs as a Stop hook,
    // where a thrown error is a stack trace nobody reads.
    let r;
    try { r = withLock(dir, () => tier(dir, now, seen.get(dir))); }
    catch (e) { say(`${dir}: skipped — ${reason(e)}`); if (!dry) try { health(dir, [`a pass failed: ${reason(e)}`]); } catch {} continue; }
    if (r === null) { say(`${dir}: busy — another hook holds this store; the next turn redoes it`); continue; }
    if (r.conflict) { say(`${dir}: changed during the pass — the edit wins; the next turn redoes it`); continue; }
    const problems = [];
    if (r.missing.length) problems.push(`pointers with no file: ${r.missing.join(', ')}`);
    if (r.merged) problems.push('merge-conflict markers in MEMORY.md (<<<<<<< ======= >>>>>>>): every session loads them as they are; resolve them by hand');
    if (r.odd.length) problems.push(`file names an index line cannot point at, so they are unlisted (rename them): ${r.odd.join(', ')}`);
    // Say so when the hooks have drifted back into being content.
    // With no line in it, it is the prose at the top: "InfinityB a line" said nothing.
    if (r.after > r.budget) problems.push(`over budget: ${r.after}B > ${r.budget}B — ${r.hot ? `${Math.round(r.after / r.hot)}B a line; shorten the text after each link rather than removing lines` : 'the text above the lines; shorten it'}`);
    // A file an editor or a scanner holds costs this turn's note, never the hook.
    if (!dry) try { health(dir, problems); } catch {}
    // The stamp is what this pass saw, taken before the snapshot: a memory
    // another session writes while git runs differs from it, and the next turn
    // takes it up. Taken after the snapshot, it skipped that memory for a day.
    if (!r.waiting && gated) try { clean.push([dir, stampAfter(dir)]); } catch {}
    if (!dry && !r.wrote && !r.recovered.length && !r.dupes.length && !r.missing.length) continue;
    const saved = Math.round((r.before - r.after) / 4);
    say(`${dry ? '[dry] ' : ''}${r.dir}: ${r.hot} hot / ${r.cold} archived, ` +
      // A growth (pointer lines added) said as one: "~-26 tokens/session" read as a saving (audit I-F3).
      `MEMORY.md ${r.before}B -> ${r.after}B (${saved < 0 ? `grew ~${-saved}` : `~${saved}`} tokens/session)`);
    if (r.recovered.length) say(`  pointers recovered: ${r.recovered.join(', ')}`);
    if (r.dupes.length) say(`  duplicate pointers dropped: ${r.dupes.join(', ')}`);
    for (const p of problems) say(`  ${p}`);
  }
  T.mark('tier');

  // After the stores are tiered, not before: the snapshot should record the
  // state a session will actually start from.
  if (!dry && dirAt === -1) {
    const s = snapshot({ gitWait, batch });
    if (s === 'busy') say('memory snapshot: busy — another session is committing; the next turn retries');
    else if (s) say(`memory snapshot: ${s}`);
    try { snapshotHealth(s); } catch {}   // a record the disk will not read or write is skipped (a fault), never a crash
    T.mark('snapshot');
  }
  // The tool's own writes are part of the stamp, so the next turn is quiet
  // unless something else changed. None for a store that was skipped, busy,
  // edited mid-pass or waiting on a writer: without a stamp the next turn
  // retries. A snapshot that did not go through is owed (snapshotHealth), and
  // retried alone: left unstamped for it, every Stop redid the whole pass.
  if (gated) for (const [d, seen] of clean) try { writeFileSync(stampOf(d), seen, { mode: 0o600 }); } catch {}
  return 0;
}

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
// The code as exitCode, not process.exit(): on macOS a pipe is written
// asynchronously, and an exit right after a write can cut it.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // A reader gone before the nudge is written: its EPIPE, thrown with no
  // listener, exited the Stop 1 (P1 hunt, 2026-10-29).
  process.stdout.on('error', () => {}); process.stderr.on('error', () => {});
  const argv = process.argv.slice(2);
  if (argv.includes('--stop')) T.begin('save');
  else if (argv.includes('--tidy')) T.begin('tidy');
  // stdin only behind --stop: a manual run never blocks on a terminal. One that
  // cannot be read is no payload, as before.
  let input;
  if (argv.includes('--stop')) try { input = readFileSync(0, 'utf8'); } catch {}
  try { process.exitCode = await main(argv, input); } finally { await T.flush(); }
}
