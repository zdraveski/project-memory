#!/usr/bin/env node
// Tier the auto-memory index: MEMORY.md holds only what is worth paying for
// every session; everything else moves to MEMORY-archive.md, which is grepped
// on demand. Pointer prose is MOVED verbatim between the two files, never
// rewritten -- the hook text is hand-written and carries the recall value.
//
// Run: node memory-tier.mjs [--dry-run] [--dir <memory dir>]
// As the Stop hook (and before a manual /compact) it runs with `--stop`, the
// payload on stdin, and tiers that session's own store; a manual run walks them all.

import { readFileSync, writeFileSync, appendFileSync, unlinkSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { storeOf, withLock, replaceIfUnchanged, projectsRoot, sleep, same, BUSY, sharedStore, isShared, budgetOf, local, POINTER, ARCHIVE, allStores, front, gitWhy } from './store.mjs';

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
const GIT_LOCK_STALE = 10 * 60000;  // an index.lock this old outlived the git that made it

// The byte ceilings of an index, project and shared, are in store.mjs: the
// memory CLI reports them too.
// Of the budget left after pinned lines, the most KEEP_TYPES may hold once the
// ceiling bites (under budget nothing is evicted). Without it they never age
// out and accumulate at about one a day, so after six months the index was 69
// working rules and *zero* recent work -- measured, not guessed
// (memory-tier.soak.mjs 180). The index has two jobs: how to work here, and
// where the work stands. A rule that outlives its share is still greppable.
const RULE_SHARE = 0.5;
const DAY = 86400000;
// The archive line is matched by its target (store.mjs ARCHIVE), not its
// title: renaming the line's text must not leave the old one behind as a
// second archive pointer carrying a count that stopped being true.
const ARCHIVE_TARGET = ARCHIVE;
const dry = process.argv.includes('--dry-run');
// `--pause <ms>` holds a pass open between computing and writing it, so a test
// can land an edit in that window. Test-only, like `--now`.
const pauseAt = process.argv.indexOf('--pause');
const PAUSE = pauseAt === -1 ? 0 : Number(process.argv[pauseAt + 1]) || 0;

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

// Every store under the projects root, by every path that reaches one: the
// snapshot's .gitignore needs the junctions. Tiering walks allStores(), each
// store once -- the same store twice doubled every number reported about it.
const stores = (root) => readdirSync(root).map((p) => join(root, p, 'memory')).filter((d) => existsSync(join(d, 'MEMORY.md')));

// `modified:` in the frontmatter beats mtime: a checkout or a copy resets mtime,
// and the memory's own stamp is what the writer meant.
function factsFor(dir, file) {
  const path = join(dir, file);
  // A target that is missing or is no file (a directory) is treated as missing
  // rather than aborting the whole store. One another program holds fails the
  // pass instead: read as missing, its alarm was stamped and stayed a day.
  let head;
  try { head = readFileSync(path, 'utf8').slice(0, 1200); } catch (e) { if (BUSY.includes(e.code)) throw e; return null; }
  const { type, tier, desc, modified: stamp } = front(head);
  const modified = Number.isNaN(stamp) ? statSync(path).mtimeMs : stamp;
  const named = (file.match(/(\d{4})-(\d{2})-(\d{2})/) || [])[0];
  const eventDate = named ? Date.parse(named) : null;
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
  // A BOM binds to the first line and stops it matching POINTER, which quietly
  // demotes the top memory to prose and orphans it.
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(POINTER);
    if (m && m[1] === ARCHIVE_TARGET) continue;   // regenerated with a live count
    if (m) pointers.push({ line, target: m[1] });
    else if (line.trim() || preamble[preamble.length - 1]?.trim()) preamble.push(line);
  }
  while (preamble.length && preamble[preamble.length - 1].trim() === '') preamble.pop();
  return { preamble, pointers };
}

function tier(dir, now) {
  const mainPath = join(dir, 'MEMORY.md'), shared = isShared(dir);
  const arcPath = join(dir, ARCHIVE_TARGET);
  // What this pass is computed from. A write goes through only while the file
  // still holds it: the model may edit the index while the pass runs.
  const mainText = readFileSync(mainPath, 'utf8');
  const arcText = existsSync(arcPath) ? readFileSync(arcPath, 'utf8') : null;
  // The mirror of a young orphan: a pointer the model wrote before its file.
  // Neither is a problem while the index is this fresh. Either one leaves the
  // store `waiting`: unstamped, so the next turn looks again -- a stamp would
  // hold until the date changed, and the grace would become a day.
  const young = now - statSync(mainPath).mtimeMs < ORPHAN_GRACE;
  let waiting = false;
  const main = split(mainText);
  // No trailing blank in the default: render adds one, and a second blank was
  // trimmed on the next run -- a fresh store rewrote its archive one session late.
  const arc = arcText !== null ? split(arcText) : { preamble: ['# Archive'], pointers: [] };

  const hot = [], cold = [], missing = [], seen = new Set(), dupes = [], recovered = [];
  // One line per memory. A target already placed is a duplicate -- the store had
  // one before this guard existed -- and emitting it twice doubles its cost and
  // makes the two copies drift apart.
  const place = (p, where) => {
    if (seen.has(p.target)) { dupes.push(p.target); return; }
    seen.add(p.target);
    where.push(p);
  };
  for (const p of main.pointers) {
    p.f = factsFor(dir, p.target);
    if (!p.f) missing.push(p.target);
    place(p, isHot(p.f, now, shared) ? hot : cold);
  }
  // Already archived: sticky. Only an explicit `tier: hot` brings one back --
  // or the ceiling's mark: a line evicted for a byte count was not archived
  // by a decision, and it comes back when there is room (a pin removed, a
  // hook shortened, three event logs aged out). The mark comes off here; a
  // line that stays cold now does so by its window, and is sticky again.
  for (const p of arc.pointers) {
    p.f = factsFor(dir, p.target);
    if (!p.f) missing.push(p.target);
    const overflow = p.line.endsWith(OVERFLOW);
    if (overflow) p.line = p.line.slice(0, -OVERFLOW.length).trimEnd();
    place(p, p.f && (p.f.tier === 'hot' || (overflow && isHot(p.f, now, shared))) ? hot : cold);
  }

  // A memory no pointer names is unreachable at session start. Truncate either
  // index -- an interrupted write, a bad merge, a BOM -- and the memories are
  // still on disk with nothing to recall them by. Give each one a pointer built
  // from its own `description:`, always into the archive: recovered prose is
  // machine-written, so it is greppable but never billed at session start.
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md') || f.startsWith('MEMORY') || seen.has(f)) continue;
    // Its writer is about to point at it. A recovered line placed now would
    // beat the hand-written one to the index. Not handoff.md: this same Stop
    // just rewrote it, and its writer never adds a pointer.
    if (f !== 'handoff.md' && now - statSync(join(dir, f)).mtimeMs < ORPHAN_GRACE) { waiting = true; continue; }
    const facts = factsFor(dir, f);
    if (!facts) continue;
    const title = f.replace(/\.md$/, '').replace(/-/g, ' ');
    const hook = facts.desc.slice(0, 140) || 'recovered: no description';
    // Cold, except a pin -- which the archive would promote on the next run
    // anyway, leaving the store rewriting itself one session behind forever.
    // In the shared store hot unless archived: filed cold, a lesson whose pointer
    // was forgotten was printed nowhere, ever (review, 2026-10-27).
    place({ line: `- [${title}](${f}) — ${hook}`, target: f, f: facts }, (shared ? facts.tier !== 'archive' : facts.tier === 'hot') ? hot : cold);
    recovered.push(f);
  }

  const render = () => [...main.preamble, ...hot.map((p) => p.line),
    `- [Archive](MEMORY-archive.md) — ${cold.length} older pointers; grep it before assuming something was never learned`,
  ].join('\n') + '\n';

  // A ceiling, not a warning. The windows cap how many lines survive, not how
  // long they are, so a corpus that writes six memories a day outgrows any
  // window. Evict oldest-first until the file fits: event logs before durable
  // notes, how-to-work rules last, pinned lines never.
  const evictable = hot.filter((p) => p.f && p.f.tier !== 'hot');
  const byAge = (a, b) => a.f.when - b.f.when;
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
  // every arrow someone adds.
  while (Buffer.byteLength(render()) > budget && queue.length) {
    const victim = queue.shift();
    hot.splice(hot.indexOf(victim), 1);
    victim.line += ' ' + OVERFLOW;        // so the archive loop knows it may come back
    cold.push(victim);
  }

  const before = Buffer.byteLength(mainText);
  const nextMain = render();
  const nextArc = [...arc.preamble, '', ...cold.map((p) => p.line)].join('\n') + '\n';
  if (PAUSE) sleep(PAUSE);

  // Archive first. If the second write fails, the worst case is a pointer in
  // both files -- which the dedupe above then heals. Writing main first and
  // failing would delete hand-written prose that had nowhere else to live.
  // A conflict means the model wrote an index during the pass: its write is
  // kept, this pass is dropped, and the next turn redoes it from what it wrote.
  let wrote = false, conflict = false;
  if (!dry) {
    const a = write(arcPath, arcText, nextArc);
    const m = a === 'conflict' ? 'conflict' : write(mainPath, mainText, nextMain);
    conflict = a === 'conflict' || m === 'conflict';
    wrote = a === true || m === true;
  }

  return { dir, budget, before, after: Buffer.byteLength(nextMain), hot: hot.length, cold: cold.length,
    missing: young ? [] : missing, waiting: waiting || (young && missing.length > 0), dupes, recovered, wrote, conflict };
}

// Recall is a grep, not a flag: `rg -il <term> ~/.claude/projects/*/memory --glob '!MEMORY*'`
// finds the memory, hot or archived; its `description:` line is the hook.

// The corpus is months of lessons in one directory on one machine, with no copy
// anywhere -- the same shape as a store that once had no backup at all. A git repo tracking ONLY the memory markdown
// gives history and undo for the realistic failure: a bad edit, a stray glob, a
// deletion. It is not offsite; that half still needs somewhere to push to.
// git follows a junction as an ordinary directory, so a store reachable by two
// paths is committed twice -- 186 files became 372, and a restore could bring
// back the stale copy. allStores() already knows which paths are the same
// store; ignore every path that is not the resolved one.
function gitignore() {
  const root = projectsRoot(), real = realpathSync(root);
  const linked = stores(root)
    // Case-blind on Windows: a home dir spelt one way in USERPROFILE and another
    // on disk would otherwise read as fifteen junctions and ignore every store.
    // Against the root's real path: a symlinked ~/.claude, or macOS's /var, made
    // every store read as a link, and nothing was snapshotted.
    .filter((d) => !same(realpathSync(d), join(real, d.slice(root.length + 1))))
    .map((d) => `${d.slice(root.length + 1).replace(/\\/g, '/')}/`);
  return ['*', '!*/', '!*/memory/*.md', '!.gitignore', ...linked].join('\n') + '\n';
}

function snapshot() {
  const root = projectsRoot();
  // The C locale: "nothing to commit" is matched below, in git's English. (Git
  // for Windows here prints English whatever LC_ALL says, so no check sees it.)
  // Set on this short-lived process, which git inherits: no copy of the
  // environment is handed on.
  process.env.LC_ALL = 'C';
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const lock = join(root, '.git', 'index.lock');
  try {
    // A fresh index.lock is another session's commit in flight: busy, not a
    // failure -- the next turn retries. One older than ten minutes outlived the
    // git that made it, and would refuse every commit from now on.
    if (existsSync(lock)) {
      if (Date.now() - statSync(lock).mtimeMs < GIT_LOCK_STALE) return 'busy';
      unlinkSync(lock);
    }
    const fresh = !existsSync(join(root, '.git'));
    if (fresh) git('init', '-q');
    // Everything is ignored except the memory markdown: this directory also
    // holds ~890 MB of session transcripts that must never be committed.
    // Recomputed each run and written when it differs: a junction created
    // after the repo existed would otherwise be double-tracked forever.
    const want = gitignore();
    const ignorePath = join(root, '.gitignore');
    const have = existsSync(ignorePath) ? readFileSync(ignorePath, 'utf8') : null;
    if (have !== want) {
      // By rename: another session's `git add -A` reading it half written
      // would stage every transcript.
      replaceIfUnchanged(ignorePath, have, want);
      for (const l of want.split('\n').filter((x) => x.endsWith('/') && !x.startsWith('!'))) git('rm', '-r', '-q', '--cached', '--ignore-unmatch', l);
    }
    git('add', '-A');
    // Straight to the commit, which says so when nothing changed: a `git status`
    // first was one more git start on every snapshot, ~80-300 ms on this box.
    try {
      git('-c', 'user.email=memory@local', '-c', 'user.name=memory-tier',
        // Local time, not UTC: a snapshot stamped two hours behind the clock that
        // made it is a number that misleads whoever reads the log later.
        'commit', '-qm', `memory: ${fresh ? 'first snapshot' : local()}`);
    } catch (e) {
      if (/nothing (added )?to commit/.test(String(e.stdout))) return null;   // nothing changed
      throw e;
    }
    return fresh ? 'initialised' : 'committed';
  } catch (e) {
    const why = gitWhy(e);   // git's reason, not a warning before it, nor 'Command failed'
    // This session runs two or three git commands, and another session's commit can
    // take index.lock in a gap between them: busy, like the pre-check, not a
    // failure the startup line would count.
    if (/index\.lock/.test(why)) return 'busy';
    return `snapshot failed: ${why}`;
  }
}

// The only route to the owner's eyes: Stop output is shown to nobody, and the
// startup line (handoff-log --print) reads these.
function health(dir, problems) {
  const p = join(dir, '.health');
  const want = problems.length ? problems.join('\n') + '\n' : null;
  const have = existsSync(p) ? readFileSync(p, 'utf8') : null;
  if (want === have) return;
  if (want === null) unlinkSync(p); else writeFileSync(p, want);
}

// ponytail: two sessions updating this counter at once can miscount by one;
// it only decides whether a warning shows.
function snapshotHealth(s) {
  if (s === 'busy') return;
  const p = join(projectsRoot(), '.snapshot-health');
  let h = {}; try { h = JSON.parse(readFileSync(p, 'utf8')); } catch {}
  const failed = typeof s === 'string' && s.startsWith('snapshot failed');
  const next = failed
    ? { lastOk: h.lastOk || null, failures: (h.failures || 0) + 1, error: s.slice('snapshot failed: '.length) }
    : { lastOk: new Date().toISOString(), failures: 0 };
  try { writeFileSync(p, JSON.stringify(next)); } catch {}
}

// `--now <ms>` exists so a month of use can be simulated in one run
// (memory-tier.soak.mjs). Nothing else sets it.
const nowAt = process.argv.indexOf('--now');
const now = nowAt !== -1 ? Number(process.argv[nowAt + 1]) : Date.now();

// `--stop`: the Stop hook. The payload is on stdin (read only behind the flag,
// so a manual run never blocks on a terminal). The handoff is written first, in
// this process -- a second Node start cost a median 200 ms a turn on this box.
const stop = process.argv.includes('--stop');
let payload = null;
if (stop) {
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch {}
  // Two tries, not one: a handoff that fails to write (two sessions renaming
  // over the same store at once) must not also skip the nudge -- that was
  // the one Stop the nudge exists for.
  try {
    const { handoff } = await import(new URL('./handoff-log.mjs', import.meta.url));
    // Proof of life for the startup line (handoff-log's stalled()), once the
    // handoff has loaded: Stop output reaches nobody, so a hook that stopped
    // running was silence.
    // One line a run: when, which conversation, which copy. Two runs for one
    // reply, seconds apart, are hooks wired twice (memory.mjs doctor, which
    // reads this and never settings.json). Appended, so two copies running at
    // once both land; cut back to the newest 20 past 8 KB.
    try {
      const ran = join(projectsRoot(), '.stop-ran');
      appendFileSync(ran, JSON.stringify({ at: new Date().toISOString(), s: String(payload?.session_id || '').slice(0, 8), from: dirname(fileURLToPath(import.meta.url)) }) + '\n');
      if (statSync(ran).size > 8192) writeFileSync(ran, readFileSync(ran, 'utf8').split('\n').filter(Boolean).slice(-20).join('\n') + '\n');
    } catch {}
    if (payload) handoff(payload);
  } catch {}
  try {
    // Past the compaction trigger, the next prompt compacts: block this stop
    // once so memory is written first (compact-gate.mjs). Printed alone --
    // a Stop decision is JSON on stdout, and the tiering lines below would
    // break it; tiering waits for the next turn, which redoes it anyway.
    const nudge = payload && (await import(new URL('./compact-gate.mjs', import.meta.url))).nudge(payload);
    if (nudge) { console.log(JSON.stringify(nudge)); process.exit(0); }
  } catch {}
}

const dirAt = process.argv.indexOf('--dir');
if (dirAt !== -1 && !process.argv[dirAt + 1]) { console.log('--dir needs a path'); process.exit(1); }
// A Stop tiers its own session's store and no other. Every Stop once walked all
// sixteen: a session in one project rewrote another's index while that
// session's model was editing it -- 74 of 120 fresh pointers replaced by
// recovered machine lines in the race probe (2026-10-26). A manual run still
// walks them all. The shared store is every project's, so any Stop may tier it,
// under its own lock, when it changed.
const dirs = dirAt !== -1 ? [process.argv[dirAt + 1]]
  : stop ? [storeOf(payload || {}), sharedStore()].filter((d) => existsSync(join(d, 'MEMORY.md')))
  : allStores();

// Then only do the rest when a memory in the store changed. handoff.md changes
// every turn and is left out; every other file's name, size and mtime is the
// fingerprint. The pass plus git cost a median 600 ms under load, and on most
// turns nothing has changed. The date is part of it: the windows are
// time-based, so a quiet store is still re-tiered once a day. The stamp lives in
// its store, so sessions of different projects never share one.
const stampOf = (d) => join(d, '.tiered');
const fingerprint = (d) => new Date().toDateString() + JSON.stringify(readdirSync(d)
  .filter((f) => f.endsWith('.md') && f !== 'handoff.md')
  .map((f) => { const s = statSync(join(d, f)); return [f, s.size, s.mtimeMs]; }));
const gated = stop && !dry && dirAt === -1;
const todo = gated ? dirs.filter((d) => { try { return readFileSync(stampOf(d), 'utf8') !== fingerprint(d); } catch { return true; } }) : dirs;
if (gated && !todo.length) process.exit(0);

const clean = [];
for (const dir of todo) {
  // One unreadable store must not stop the others. This runs as a Stop hook,
  // where a thrown error is a stack trace nobody reads.
  let r;
  try { r = withLock(dir, () => tier(dir, now)); }
  catch (e) { console.log(`${dir}: skipped — ${e.message}`); if (!dry) try { health(dir, [`a pass failed: ${e.message}`]); } catch {} continue; }
  if (r === null) { console.log(`${dir}: busy — another hook holds this store; the next turn redoes it`); continue; }
  if (r.conflict) { console.log(`${dir}: changed during the pass — the edit wins; the next turn redoes it`); continue; }
  const problems = [];
  if (r.missing.length) problems.push(`pointers with no file: ${r.missing.join(', ')}`);
  // Say so when the hooks have drifted back into being content.
  if (r.after > r.budget) problems.push(`over budget: ${r.after}B > ${r.budget}B — ${Math.round(r.after / r.hot)}B a line; trim the hooks, not the count`);
  // A file an editor or a scanner holds costs this turn's note, never the hook.
  if (!dry) try { health(dir, problems); } catch {}
  // The stamp is what this pass saw, taken before the snapshot: a memory
  // another session writes while git runs differs from it, and the next turn
  // takes it up. Taken after the snapshot, it skipped that memory for a day.
  if (!r.waiting && gated) try { clean.push([dir, fingerprint(dir)]); } catch {}
  if (!dry && !r.wrote && !r.recovered.length && !r.dupes.length && !r.missing.length) continue;
  const saved = Math.round((r.before - r.after) / 4);
  console.log(`${dry ? '[dry] ' : ''}${r.dir}: ${r.hot} hot / ${r.cold} archived, ` +
    `MEMORY.md ${r.before}B -> ${r.after}B (~${saved} tokens/session)`);
  if (r.recovered.length) console.log(`  pointers recovered: ${r.recovered.join(', ')}`);
  if (r.dupes.length) console.log(`  duplicate pointers dropped: ${r.dupes.join(', ')}`);
  for (const p of problems) console.log(`  ${p}`);
}

// After the stores are tiered, not before: the snapshot should record the
// state a session will actually start from.
let snapOk = true;
if (!dry && dirAt === -1) {
  const s = snapshot();
  if (s === 'busy') console.log('memory snapshot: busy — another session is committing; the next turn retries');
  else if (s) console.log(`memory snapshot: ${s}`);
  snapshotHealth(s);
  snapOk = s !== 'busy' && !(s && s.startsWith('snapshot failed'));
}
// The tool's own writes are part of the stamp, so the next turn is quiet
// unless something else changed. None for a store that was skipped, busy,
// edited mid-pass or waiting on a writer, nor when the snapshot failed:
// without a stamp the next turn retries, with one it would skip for days.
if (gated && snapOk) for (const [d, seen] of clean) try { writeFileSync(stampOf(d), seen); } catch {}
