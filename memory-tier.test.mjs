// Self-check for memory-tier.mjs. Part one builds a throwaway store and asserts
// the tiering rules that would silently lose or duplicate a pointer. Part two
// builds a throwaway HOME with two stores and breaks the git snapshot path and
// the --stop gate. Run: node memory-tier.test.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync, unlinkSync, utimesSync, rmdirSync, renameSync, symlinkSync, openSync, closeSync, copyFileSync } from 'node:fs';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert';
import { tool, tempDir, tempHome, pointers } from './harness.mjs';

const TOOL = tool('memory-tier.mjs');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

// --- part one: the rules ------------------------------------------------------
const dir = tempDir('memtier-');
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

// Files are dated ten minutes back unless `fresh`: a pointerless file younger
// than two minutes is its writer's, not an orphan (ORPHAN_GRACE).
const backdate = (name) => { const t = new Date(Date.now() - 10 * 60000); utimesSync(join(dir, `${name}.md`), t, t); };
function memory(name, { type = 'project', tier, days = 0, fresh = false } = {}) {
  writeFileSync(join(dir, `${name}.md`), `---
name: ${name}
description: "desc of ${name}"
metadata:
  type: ${type}${tier ? `\n  tier: ${tier}` : ''}
  modified: ${iso(days)}
---

body of ${name}
`);
  if (!fresh) backdate(name);
  return `- [${name}](${name}.md) — hook for ${name}`;
}

const lines = {
  rule: memory('a-working-rule', { type: 'feedback', days: 400 }),      // never ages out
  pinned: memory('pinned-front-door', { tier: 'hot', days: 400 }),      // pin beats the window
  fresh: memory('fresh-note', { days: 1 }),                             // inside STALE_DAYS
  stale: memory('stale-note', { days: 90 }),                            // outside it
  event: memory('an-audit-2020-01-01', { days: 0 }),                    // dated name = event log
  buried: memory('already-archived', { days: 0 }),                      // sticky: stays archived
  dupe: memory('seen-twice', { days: 0 }),
  cold: memory('pinned-cold', { tier: 'archive', days: 0 }),            // pin beats freshness the other way
};
writeFileSync(join(dir, 'MEMORY.md'),
  // A BOM on the index must not orphan the first pointer.
  '\uFEFF' + ['# Index', '', lines.rule, lines.pinned, lines.fresh, lines.stale, lines.event,
    lines.dupe, lines.dupe, lines.cold, '- [Archive](MEMORY-archive.md) — 0 older pointers'].join('\n') + '\n');
writeFileSync(join(dir, 'MEMORY-archive.md'), ['# Archive', '', lines.buried].join('\n') + '\n');

const run = (...args) => execFileSync(process.execPath, [TOOL, '--dir', dir, ...args], { encoding: 'utf8' });
const out = run();
const main = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
const arc = readFileSync(join(dir, 'MEMORY-archive.md'), 'utf8');
const has = (text, line) => text.split('\n').includes(line);

ok(has(main, lines.rule), 'a feedback memory must stay hot however old');
ok(has(main, lines.pinned), 'tier: hot must beat the stale window');
ok(has(main, lines.fresh), 'a memory inside the stale window stays hot');
ok(has(arc, lines.stale), 'a memory past the stale window is archived');
ok(has(arc, lines.cold) && !has(main, lines.cold), 'tier: archive beats freshness');
ok(has(arc, lines.event), 'a dated filename is an event log and archives fast');
ok(has(arc, lines.buried) && !has(main, lines.buried), 'the archive is a one-way door');
ok(main.split('\n').filter((l) => l === lines.dupe).length === 1, 'a duplicate pointer is dropped');
ok(/duplicate pointers dropped: seen-twice\.md/.test(out), 'and it is reported');
ok(main.startsWith('# Index'), 'prose above the list survives, and the BOM is gone');
ok(!/pointers recovered/.test(out), 'a BOM on the index orphans nothing');
ok((main.match(/\(MEMORY-archive\.md\)/g) || []).length === 1, 'exactly one archive line');
ok(/older pointers/.test(main), 'the archive line carries a live count');

// Nothing may be lost: every pointer written is in exactly one of the two files.
ok(new Set([...pointers(main), ...pointers(arc)]).size === Object.keys(lines).length, 'every memory keeps exactly one pointer');

// A memory nobody points at is unreachable at session start: recover it from
// its own description, cold — unless it is pinned, which must land in one pass.
memory('lost-note', { days: 0 });
memory('lost-but-pinned', { tier: 'hot', days: 400 });
run();
const main2 = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
const arc2 = readFileSync(join(dir, 'MEMORY-archive.md'), 'utf8');
ok(/^- \[lost note\]\(lost-note\.md\) — desc of lost-note$/m.test(arc2), 'an orphan is recovered into the archive');
ok(/lost-but-pinned\.md/.test(main2), 'a pinned orphan is recovered hot, in the same pass');
ok(!/lost-note\.md/.test(main2), 'recovered prose is machine-written and never billed at session start');

// A file written a minute ago with no pointer is its writer's, not an orphan:
// the model writes the memory, then points at it. Recovering it now would put
// a machine line ahead of the model's own.
memory('just-written', { fresh: true });
run();
const both = () => readFileSync(join(dir, 'MEMORY.md'), 'utf8') + readFileSync(join(dir, 'MEMORY-archive.md'), 'utf8');
ok(!/just-written\.md/.test(both()), 'a pointerless memory under two minutes old is left for its writer');
backdate('just-written');
run();
ok(/^- \[just written\]\(just-written\.md\)/m.test(readFileSync(join(dir, 'MEMORY-archive.md'), 'utf8')), 'and recovered once it is older');

// A second run must be a no-op, or the hook rewrites the store every session.
const before = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
const mtime = statSync(join(dir, 'MEMORY.md')).mtimeMs;   // bytes alone cannot tell a needless rewrite
run();
ok(readFileSync(join(dir, 'MEMORY.md'), 'utf8') === before, 'tiering is idempotent');
ok(statSync(join(dir, 'MEMORY.md')).mtimeMs === mtime, 'a quiet run does not touch the index');

// The model appends its pointer below the archive line. Moving it up is not
// worth a write, and each write is a moment the model's next edit can be lost in.
const moved = memory('appended-below', { days: 0 });
writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8') + moved + '\n');
const mt2 = statSync(join(dir, 'MEMORY.md')).mtimeMs;
run();
ok(statSync(join(dir, 'MEMORY.md')).mtimeMs === mt2, 'a pass that would only reorder lines leaves the index alone');

// Another hook holding the store: this pass waits, then stands down.
mkdirSync(join(dir, '.lock'));
ok(/busy/.test(run()), 'a store another hook holds is left alone, and said so');
rmdirSync(join(dir, '.lock'));

// The model edits the index while a pass sits between reading and writing it:
// the pass stands down and the edit survives. A duplicate line gives the pass
// something to write; --pause holds it open.
writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8') + moved + '\n');
const added = memory('added-mid-pass', { days: 0 });
// The child gets 1.5 s to start and read: a loaded 4-core box took 0.5 s.
const paused = spawn(process.execPath, [TOOL, '--dir', dir, '--pause', '3000']);
let pausedOut = ''; paused.stdout.on('data', (d) => { pausedOut += d; });
await new Promise((res) => setTimeout(res, 1500));
writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8') + added + '\n');
await new Promise((res) => paused.on('close', res));
ok(has(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), added), 'an index edited during a pass keeps the edit');
ok(/changed during the pass/.test(pausedOut), 'and the pass says it stood down');
run();
ok(readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').filter((l) => l === moved).length === 1, 'the next pass does the work it dropped');

// --- the ceiling -------------------------------------------------------------
// Forty long note lines are ~9 KB against a 7000 B budget. `lost-but-pinned`
// is on disk with no pointer, so it is recovered hot in the same pass -- and
// the ceiling may not take it. A recovered pointer once carried its filename
// where its facts belong: that made a pinned orphan evictable, gave it an age
// of NaN, and a NaN in the comparator scrambles the whole eviction order.
const today = new Date().toISOString().slice(0, 10);
const pad = ' and a hook long enough to make the ceiling bite ' + 'x'.repeat(110);
const evLines = [], noteLines = [];
for (let i = 0; i < 40; i++) noteLines.push(memory(`note-${i}`, { days: 5 }) + pad);
for (let i = 0; i < 25; i++) evLines.push(memory(`log-${today}-${i}`, { days: 0 }) + pad);
writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', ...noteLines].join('\n') + '\n');
run();
const main3 = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
ok(Buffer.byteLength(main3) <= 7000, `the ceiling holds: ${Buffer.byteLength(main3)}B`);
ok(noteLines.some((l) => !has(main3, l)), 'the ceiling evicted notes');
ok(/^- \[lost but pinned\]\(lost-but-pinned\.md\)/m.test(main3), 'a pinned orphan recovered in the same pass is never what the ceiling takes');

// Event logs go before durable notes, whatever their age: a day's log is worth
// less at session start than the note on where the work stands. The notes are
// the older kind here, so age alone would evict them first.
writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', ...evLines, ...noteLines].join('\n') + '\n');
run();
const main4 = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
const arc4 = readFileSync(join(dir, 'MEMORY-archive.md'), 'utf8');
ok(evLines.every((l) => has(arc4, l + ' <!-- overflow -->')), 'every event log was evicted, each marked as the ceiling\'s');
ok(noteLines.some((l) => has(main4, l)), 'before any durable note, though every note is older');

// The rule share is of the budget left after the pinned lines, not of the
// whole budget. Pins ~3.7 KB, rules ~2.4 KB, recent work ~1.5 KB: over the
// 7000 B ceiling by ~4 lines. Measured on the whole budget the rules are under
// their 3500 B share and the recent work goes; measured after pins the share
// is ~1650 B and the oldest rules go instead.
// A clean store: the logs and notes above would otherwise return through the
// overflow door below and take the room this block measures.
for (const l of [...evLines, ...noteLines]) rmSync(join(dir, l.match(/\((.+?\.md)\)/)[1]));
writeFileSync(join(dir, 'MEMORY-archive.md'), '# Archive\n');
const big = ' ' + 'x'.repeat(180);
const pinLines = [], ruleLines = [], workLines = [];
for (let i = 0; i < 17; i++) pinLines.push(memory(`pin-${i}`, { tier: 'hot', days: 400 }) + big);
for (let i = 0; i < 11; i++) ruleLines.push(memory(`rule-${i}`, { type: 'feedback', days: 300 - i }) + big);
for (let i = 0; i < 7; i++) workLines.push(memory(`work-${i}`, { days: 1 }) + big);
writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', ...pinLines, ...ruleLines, ...workLines].join('\n') + '\n');
run();
const main5 = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
ok(Buffer.byteLength(main5) <= 7000, `the ceiling holds: ${Buffer.byteLength(main5)}B`);
ok(pinLines.every((l) => has(main5, l)), 'every pin stays');
ok(ruleLines.some((l) => !has(main5, l)) && has(main5, ruleLines[10]), 'the oldest rules over the share after pins are evicted, the newest kept');
ok(workLines.every((l) => has(main5, l)), 'and recent work keeps every line');

// A ceiling eviction is not the one-way door: the victims are marked in the
// archive and come back when there is room -- here, eight pins unpinned.
const arc5 = readFileSync(join(dir, 'MEMORY-archive.md'), 'utf8');
ok(ruleLines.some((l) => has(arc5, l + ' <!-- overflow -->')), 'a line the ceiling evicted carries the overflow mark in the archive');
ok(!/<!-- overflow -->/.test(main5), 'and no mark ever sits in the index');
for (let i = 0; i < 8; i++) memory(`pin-${i}`, { tier: 'archive', days: 400 });
run();
const main6 = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
const arc6 = readFileSync(join(dir, 'MEMORY-archive.md'), 'utf8');
ok(ruleLines.every((l) => has(main6, l)), 'with room again, every evicted rule is back in the index');
ok(!/<!-- overflow -->/.test(arc6), 'and the marks are gone from the archive');
ok(Buffer.byteLength(main6) <= 7000, `still under the ceiling: ${Buffer.byteLength(main6)}B`);

// Over budget with nothing left to evict (every line pinned) is for the owner
// to fix: it goes where the startup line will show it, and goes when fixed.
const many = [];
for (let i = 0; i < 45; i++) many.push(memory(`pinned-many-${i}`, { tier: 'hot', days: 400 }) + big);
writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', ...many].join('\n') + '\n');
run();
ok(/over budget/.test(readFileSync(join(dir, '.health'), 'utf8')), 'an index over budget is written to .health');
for (let i = 0; i < 45; i++) memory(`pinned-many-${i}`, { tier: 'archive', days: 400 });
run();
ok(!existsSync(join(dir, '.health')), 'and .health goes once it fits');
// A pointer the model wrote before its file is its writer's for two minutes,
// like a file written before its pointer. It reached .health, and another
// session's startup line, seconds before the file did (final review, 2026-10-26).
writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8') + '- [coming](coming-soon.md) — written next\n');
run();
ok(!existsSync(join(dir, '.health')), 'a pointer under two minutes old with no file yet is not a problem');
const tenAgo = new Date(Date.now() - 10 * 60000);
utimesSync(join(dir, 'MEMORY.md'), tenAgo, tenAgo);
run();
ok(/pointers with no file: coming-soon\.md/.test(existsSync(join(dir, '.health')) ? readFileSync(join(dir, '.health'), 'utf8') : ''), 'and is one once the index has been left alone as long');
rmSync(join(dir, '.health'));
// A file the hook cannot write (an editor or a scanner holding it; here a
// directory in its place) costs this turn's note, never the hook: exit 0.
mkdirSync(join(dir, '.health'));
let healthStatus = 0; try { run(); } catch (e) { healthStatus = e.status; }
ok(healthStatus === 0, `a .health that cannot be written does not fail the hook (exit ${healthStatus})`);
rmdirSync(join(dir, '.health'));
rmSync(dir, { recursive: true, force: true });

// --- part two: the snapshot path and the --stop gate ---------------------------
const { home, env } = tempHome('memtier-home-');
const root = join(home, '.claude', 'projects');
const store = (name) => {
  const d = join(root, name, 'memory'); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'a.md'), '---\nname: a\ndescription: "a"\nmetadata:\n  type: project\n---\nbody\n');
  writeFileSync(join(d, 'MEMORY.md'), '# Index\n\n- [a](a.md) — a\n');
  return d;
};
store('proj-one'); store('proj-two');
writeFileSync(join(root, 'proj-one', 'session.jsonl'), 'x'.repeat(50_000));   // must never be tracked

const plain = (extra) => spawnSync(process.execPath, [TOOL], { env: { ...env, ...extra }, encoding: 'utf8' });
writeFileSync(join(root, 'proj-two', 'session.jsonl'), '');
const stop = (proj = 'proj-one') => spawnSync(process.execPath, [TOOL, '--stop'], { env, encoding: 'utf8',
  input: JSON.stringify({ cwd: 'C:\\nowhere', transcript_path: join(root, proj, 'session.jsonl'), session_id: 'tst' }) });
const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
const tracked = () => git('ls-files').split('\n').filter(Boolean).sort();
// Ten minutes old, past the orphan grace: their writer is done with them.
const tenMin = new Date(Date.now() - 10 * 60000);
const note = (name, s) => {
  const f = join(root, name, 'memory', `${s}.md`);
  writeFileSync(f, `---\nname: ${s}\ndescription: "${s}"\nmetadata:\n  type: project\n---\nbody\n`);
  utimesSync(f, tenMin, tenMin);
};

let r = plain();
ok(r.status === 0 && existsSync(join(root, '.git')), 'first run initialises the repo');
ok(tracked().every((f) => f === '.gitignore' || /\/memory\/[^/]+\.md$/.test(f)) && tracked().length === 7, 'only memory markdown and .gitignore are tracked');
// A home reached through a symlink (a dotfiles-managed ~/.claude; macOS's /var
// under every temp folder): every store's real path differs from the path it
// was found by, yet none is a link to another. All were ignored as links, and
// the snapshots tracked nothing.
{
  const { home: realHome } = tempHome('memtier-real-'), linkedHome = join(tempDir('memtier-link-'), 'home');
  symlinkSync(realHome, linkedHome, 'junction');
  const lroot = join(linkedHome, '.claude', 'projects'), d = join(lroot, 'proj-l', 'memory');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'a.md'), '---\nname: a\ndescription: "a"\nmetadata:\n  type: project\n---\nbody\n');
  writeFileSync(join(d, 'MEMORY.md'), '# Index\n\n- [a](a.md) — a\n');
  const lr = spawnSync(process.execPath, [TOOL], { env: { ...env, HOME: linkedHome, USERPROFILE: linkedHome }, encoding: 'utf8' });
  const files = existsSync(join(lroot, '.git')) ? execFileSync('git', ['-C', lroot, 'ls-files'], { encoding: 'utf8' }) : '';
  ok(lr.status === 0 && /proj-l\/memory\/a\.md/.test(files), `a home reached through a symlink still has its stores snapshotted (got ${JSON.stringify(files || lr.stdout)})`);
}

note('proj-one', 'b');
writeFileSync(join(root, '.git', 'index.lock'), '');
r = plain();
ok(r.status === 0 && /memory snapshot: busy/.test(r.stdout) && existsSync(join(root, 'proj-one', 'memory', 'b.md')), 'a fresh index.lock is another commit in flight: busy, exit 0, store kept');
unlinkSync(join(root, '.git', 'index.lock'));
r = plain();
ok(r.status === 0 && tracked().includes('proj-one/memory/b.md'), 'next run commits what the locked run could not');

writeFileSync(join(root, '.gitignore'), '# hand edited\n*.log\n');
const ignoreId = () => statSync(join(root, '.gitignore'), { bigint: true }).ino;
const idBefore = ignoreId();
r = plain();
ok(r.status === 0 && !tracked().some((f) => f.endsWith('.jsonl')) && readFileSync(join(root, '.gitignore'), 'utf8').includes('!*/memory/*.md'), 'hand-edited .gitignore is rewritten, jsonl still untracked');
// By rename, a new file: another session's `git add -A` reading it half
// written would stage every transcript (final review, 2026-10-26).
ok(ignoreId() !== idBefore, '.gitignore is replaced whole, never written in place');

store('proj-three');
r = plain();
ok(r.status === 0 && tracked().includes('proj-three/memory/MEMORY.md'), 'a store created after the repo is picked up');

r = plain({ PATH: '', Path: '' });
ok(r.status === 0 && /snapshot failed/.test(r.stdout), 'git missing from PATH: exit 0, says so');
r = plain({ PATH: '', Path: '' });
const sh = () => JSON.parse(readFileSync(join(root, '.snapshot-health'), 'utf8'));
ok(sh().failures === 2 && sh().error, 'failed snapshots are counted for the startup line');
r = plain();
ok(sh().failures === 0 && sh().lastOk, 'and a good one resets the count');
// Another session's git took index.lock between this one's git calls: the
// pre-check passed and `git add` failed. That is busy, not a failure -- three
// sessions stopping in the same half-second raised a false alarm (final
// review, 2026-10-26). A `.git` file pointing at the real repo puts the lock
// where the pre-check does not look: the race, made deterministic.
const realGit = join(root, '.gitreal');
renameSync(join(root, '.git'), realGit);
writeFileSync(join(root, '.git'), `gitdir: ${realGit.replace(/\\/g, '/')}\n`);
writeFileSync(join(realGit, 'index.lock'), '');
note('proj-one', 'mid');
const failsBefore = sh().failures;
r = plain();
ok(r.status === 0 && /memory snapshot: busy/.test(r.stdout) && sh().failures === failsBefore, `an index.lock taken mid-sequence is busy, not a failure (got: ${r.stdout.trim()})`);
unlinkSync(join(realGit, 'index.lock'));
// git's own reason reaches the startup line, not "Command failed: git ...".
writeFileSync(join(root, '.git'), `gitdir: ${join(root, 'no-such-repo').replace(/\\/g, '/')}\n`);
r = plain();
// git words it by version ("not a git repository", "gitfile does not point to a valid repository").
ok(/repository/.test(sh().error) && !/^Command failed/.test(sh().error), `a failed snapshot records git's reason (got: ${sh().error})`);
unlinkSync(join(root, '.git'));
renameSync(realGit, join(root, '.git'));
r = plain();
ok(sh().failures === 0, 'and with the repo back, the count resets');
// A warning before the reason is not the reason: a stale pack index makes git
// warn on every command. A pre-commit hook makes the failure deterministic.
mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "warning: no corresponding .pack: x.idx" >&2\necho "the real reason" >&2\nexit 1\n', { mode: 0o755 });
note('proj-one', 'warned');
r = plain();
ok(sh().error === 'the real reason', `a failed snapshot records the reason, not a warning before it (got: ${sh().error})`);
unlinkSync(join(root, '.git', 'hooks', 'pre-commit'));
r = plain();

r = plain();
ok(r.status === 0 && r.stdout.trim() === '', 'quiet run prints nothing (a fresh store must not rewrite its archive a run late)');

// --stop, the way the hook runs: the session's own store only, gated by that
// store's fingerprint stamp. A busy or failed snapshot, or a skipped store,
// must not stamp, or the next turn skips a retry.
const stamp = (p) => join(root, p, 'memory', '.tiered');
r = stop();
ok(r.status === 0 && existsSync(stamp('proj-one')) && !existsSync(stamp('proj-two')), '--stop: tiers and stamps its own store only');
// The startup line's proof that the Stop hook still runs (handoff-log's stalled()).
const ranBefore = statSync(join(root, '.stop-ran')).mtimeMs;
r = stop();
ok(statSync(join(root, '.stop-ran')).mtimeMs > ranBefore, '--stop: every Stop, even a quiet one, leaves its proof of life');
// A handoff-log.mjs that cannot load writes no handoff: no proof of life either.
const broken = tempDir('broken-');
for (const f of ['memory-tier.mjs', 'store.mjs', 'compact-gate.mjs']) copyFileSync(tool(f), join(broken, f));
writeFileSync(join(broken, 'handoff-log.mjs'), 'this is not javascript (');
const ranBroken = statSync(join(root, '.stop-ran')).mtimeMs;
spawnSync(process.execPath, [join(broken, 'memory-tier.mjs'), '--stop'], { env, input: JSON.stringify({ transcript_path: join(root, 'proj-one', 'session.jsonl'), session_id: 'tst' }) });
rmSync(broken, { recursive: true, force: true });
ok(statSync(join(root, '.stop-ran')).mtimeMs === ranBroken, '--stop: a handoff-log.mjs that cannot load leaves no proof of life');
r = stop();
ok(r.status === 0 && r.stdout.trim() === '', '--stop: quiet turn is silent');
// Another project's store is never touched by this one's Stop, even changed.
note('proj-two', 'c');
writeFileSync(join(root, 'proj-two', 'memory', 'MEMORY.md'), '# Index\n\n- [a](a.md) — a\n- [c](c.md) — c by hand\n');
const two = () => readFileSync(join(root, 'proj-two', 'memory', 'MEMORY.md'), 'utf8') + '|' + statSync(join(root, 'proj-two', 'memory', 'MEMORY.md')).mtimeMs;
const twoBefore = two();
note('proj-one', 'e');   // so proj-one's Stop has a pass to run
r = stop('proj-one');
ok(r.status === 0 && two() === twoBefore, "--stop in one project leaves another project's index alone, bytes and mtime");
// A day boundary must re-run the pass even when no file changed: the windows are time-based.
r = stop('proj-two');
writeFileSync(stamp('proj-two'), readFileSync(stamp('proj-two'), 'utf8').replace(/^\S+ \S+ \d+ \d+/, 'Wed Sep 10 2025'));
r = stop('proj-two');
ok(r.status === 0 && readFileSync(stamp('proj-two'), 'utf8').startsWith(new Date().toDateString()), '--stop: a stamp from another day is not a pass; today re-stamps');
rmSync(join(root, 'proj-two', 'memory', 'MEMORY.md'));
mkdirSync(join(root, 'proj-two', 'memory', 'MEMORY.md'));               // an index that cannot be read throws in tier()
r = stop('proj-two');
const r2 = stop('proj-two');
ok(r.status === 0 && /skipped/.test(r.stdout) && /skipped/.test(r2.stdout), '--stop: a store that throws is reported again next turn');
rmSync(join(root, 'proj-two', 'memory', 'MEMORY.md'), { recursive: true });
writeFileSync(join(root, 'proj-two', 'memory', 'MEMORY.md'), '# Index\n\n- [a](a.md) — a\n');
// Another session's commit in flight: busy, no stamp, and the next turn commits.
note('proj-two', 'f');
writeFileSync(join(root, '.git', 'index.lock'), '');
r = stop('proj-two');
ok(r.status === 0 && /memory snapshot: busy/.test(r.stdout) && !tracked().includes('proj-two/memory/f.md'), '--stop: a fresh index.lock is busy');
const stampBusy = existsSync(stamp('proj-two')) ? readFileSync(stamp('proj-two'), 'utf8') : '';
ok(!stampBusy.includes('"f.md"'), '--stop: and a busy snapshot stamps nothing');
unlinkSync(join(root, '.git', 'index.lock'));
r = stop('proj-two');
ok(r.status === 0 && tracked().includes('proj-two/memory/f.md'), '--stop: next turn retries and commits');
// An index.lock a dead git left behind would refuse every commit from now on.
note('proj-two', 'g');
writeFileSync(join(root, '.git', 'index.lock'), '');
const stale = new Date(Date.now() - 15 * 60000);
utimesSync(join(root, '.git', 'index.lock'), stale, stale);
r = stop('proj-two');
ok(r.status === 0 && tracked().includes('proj-two/memory/g.md') && !existsSync(join(root, '.git', 'index.lock')), '--stop: an index.lock older than ten minutes is cleared and the commit lands');
// A store that throws says so where the startup line will show it.
rmSync(join(root, 'proj-two', 'memory', 'MEMORY.md'));
mkdirSync(join(root, 'proj-two', 'memory', 'MEMORY.md'));
stop('proj-two');
ok(/a pass failed/.test(readFileSync(join(root, 'proj-two', 'memory', '.health'), 'utf8')), 'a store that throws is written to .health');
rmSync(join(root, 'proj-two', 'memory', 'MEMORY.md'), { recursive: true });
writeFileSync(join(root, 'proj-two', 'memory', 'MEMORY.md'), '# Index\n\n- [a](a.md) — a\n');
stop('proj-two');
ok(!existsSync(join(root, 'proj-two', 'memory', '.health')), 'and .health goes once the store is fine');
// A stamp the hook cannot write does not fail the Stop hook either.
note('proj-two', 'h');
rmSync(stamp('proj-two'), { force: true });
mkdirSync(stamp('proj-two'));
r = stop('proj-two');
ok(r.status === 0, `a stamp that cannot be written does not fail the Stop hook (exit ${r.status})`);
rmdirSync(stamp('proj-two'));
// A store waiting on a writer is not stamped, so the next turn looks again:
// its fingerprint does not change until the writer finishes, and a stamp
// turned the two-minute grace into a day.
const memTwo = join(root, 'proj-two', 'memory');
const stampNow = () => (existsSync(stamp('proj-two')) ? readFileSync(stamp('proj-two'), 'utf8') : '');
writeFileSync(join(memTwo, 'MEMORY.md'), readFileSync(join(memTwo, 'MEMORY.md'), 'utf8') + '- [soon](soon.md) — written next\n');
let s0 = stampNow();
stop('proj-two');
ok(stampNow() === s0, 'a pointer whose file is still to come leaves the store unstamped');
const longAgo = new Date(Date.now() - 10 * 60000);
utimesSync(join(memTwo, 'MEMORY.md'), longAgo, longAgo);
stop('proj-two');
ok(stampNow() !== s0 && /soon\.md/.test(readFileSync(join(memTwo, '.health'), 'utf8')), 'once the index is older it is reported, and stamped');
note('proj-two', 'pointless');
utimesSync(join(memTwo, 'pointless.md'), new Date(), new Date());   // written just now
s0 = stampNow();
stop('proj-two');
ok(stampNow() === s0, 'a memory whose pointer is still to come leaves the store unstamped too');
ok(!tracked().some((f) => /\.tiered|\.health|\.lock|\.snapshot-health|\.stop-ran/.test(f)), 'stamps, health files and locks are never tracked');
// The hook's own handoff.md is rewritten by this same Stop, so it is always
// young: under the orphan grace, a store whose index lacks its pointer was
// never stamped, and every turn paid the full pass and a commit (audit, 2026-10-26).
store('proj-four');
writeFileSync(join(root, 'proj-four', 'session.jsonl'), [
  { type: 'user', message: { content: 'q1' }, timestamp: new Date().toISOString() },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'a1' }] } },
].map((x) => JSON.stringify(x)).join('\n') + '\n');
stop('proj-four');
ok(existsSync(stamp('proj-four')) && /^- \[handoff\]\(handoff\.md\)/m.test(readFileSync(join(root, 'proj-four', 'memory', 'MEMORY.md'), 'utf8')),
  "a store whose index lacks the handoff's pointer gets it, hot, and is stamped in one Stop");
// One store reached by two paths is one store: tiered once, committed once --
// 186 files once became 372.
mkdirSync(join(root, 'proj-link'));
symlinkSync(join(root, 'proj-one', 'memory'), join(root, 'proj-link', 'memory'), 'junction');
r = spawnSync(process.execPath, [TOOL, '--dry-run'], { env, encoding: 'utf8' });
ok((r.stdout.match(/proj-(one|link)[\\/]memory: \d+ hot/g) || []).length === 1, `a junctioned store is tiered once (got: ${r.stdout.trim()})`);
plain();
ok(tracked().some((f) => f.startsWith('proj-one/')) && !tracked().some((f) => f.startsWith('proj-link/')), 'and committed once, by its real path');
// A memory another program holds open for one Stop is not missing. Read as
// missing, its alarm was stamped with the store and stayed until the date
// changed (audit, 2026-10-26); now the pass fails unstamped and the next Stop heals.
store('proj-five');
const five = join(root, 'proj-five', 'memory');
for (const f of ['a.md', 'MEMORY.md']) utimesSync(join(five, f), tenMin, tenMin);
writeFileSync(join(root, 'proj-five', 'session.jsonl'), '');
stop('proj-five');                     // committed, so git need not read the file while it is held
note('proj-five', 'b');                // and a change, pointed at, so the next Stop runs a pass
writeFileSync(join(five, 'MEMORY.md'), readFileSync(join(five, 'MEMORY.md'), 'utf8') + '- [b](b.md) — b\n');
utimesSync(join(five, 'MEMORY.md'), tenMin, tenMin);   // an index this old reports a missing target at once
const EXLOCK = 0x10000000;             // libuv's UV_FS_O_EXLOCK: Windows share mode 0, as an editor might hold it
const held = openSync(join(five, 'a.md'), EXLOCK);
stop('proj-five');
closeSync(held);
stop('proj-five');
ok(existsSync(stamp('proj-five')) && !existsSync(join(five, '.health')), 'a memory held open for one Stop leaves no lasting alarm');

// The shared store: any project's Stop tiers it when it changed, under its own
// smaller budget -- its index is printed into every session of every project.
const shared = join(root, '_shared', 'memory');
mkdirSync(shared, { recursive: true });
// A shared lesson does not age out: a months-old reference stays printed in
// every project; only `tier: archive` moves one.
for (const [n, extra] of [['old-tool', ''], ['retired', '\n  tier: archive'], ['no-pointer', ''], ['no-pointer-retired', '\n  tier: archive']]) {
  writeFileSync(join(shared, `${n}.md`), `---\nname: ${n}\ndescription: "${n}"\nmetadata:\n  type: reference\n  modified: 2026-01-01T00:00:00Z${extra}\n---\nbody\n`);
  utimesSync(join(shared, `${n}.md`), tenMin, tenMin);
}
writeFileSync(join(shared, 'MEMORY.md'), '- [Old tool](old-tool.md) — a tool\n- [Retired](retired.md) — retired\n');
execFileSync(process.execPath, [TOOL, '--dir', shared], { env, encoding: 'utf8' });
ok(/old-tool\.md/.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8')) && /retired\.md/.test(readFileSync(join(shared, 'MEMORY-archive.md'), 'utf8')),
  'the shared store has no age window: an old reference stays hot, tier: archive still archives');
// A shared lesson written with no pointer is recovered hot: filed cold, it was printed nowhere.
ok(/no-pointer\.md/.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8')) && /no-pointer-retired\.md/.test(readFileSync(join(shared, 'MEMORY-archive.md'), 'utf8')),
  'a shared lesson with no pointer gets a hot line; with tier: archive, an archive one');
for (const f of ['old-tool.md', 'retired.md', 'no-pointer.md', 'no-pointer-retired.md', 'MEMORY.md', 'MEMORY-archive.md']) rmSync(join(shared, f));
const wide = (d, n) => {
  const ls = [];
  for (let i = 0; i < n; i++) {
    const f = join(d, `lesson-${i}.md`);
    writeFileSync(f, `---\nname: lesson-${i}\ndescription: "lesson ${i}"\nmetadata:\n  type: project\n---\nbody\n`);
    utimesSync(f, tenMin, tenMin);
    ls.push(`- [lesson ${i}](lesson-${i}.md) — ${'a hook long enough to fill the shared budget quickly '.repeat(2)}${i}`);
  }
  writeFileSync(join(d, 'MEMORY.md'), '# Shared\n\n' + ls.join('\n') + '\n');
  utimesSync(join(d, 'MEMORY.md'), tenMin, tenMin);
};
wide(shared, 40);
const twoNow = two();
r = stop('proj-one');
const sharedMain = () => readFileSync(join(shared, 'MEMORY.md'), 'utf8');
ok(r.status === 0 && Buffer.byteLength(sharedMain()) <= 3000 && /overflow/.test(readFileSync(join(shared, 'MEMORY-archive.md'), 'utf8')),
  `--stop: a changed shared store is tiered to its 3000 B budget (got ${Buffer.byteLength(sharedMain())} B)`);
ok(two() === twoNow, '--stop: and tiering it touches no other project');
ok(existsSync(join(shared, '.tiered')), '--stop: the shared store is stamped like any other');
const sharedAt = statSync(join(shared, 'MEMORY.md')).mtimeMs;
r = stop('proj-two');
ok(r.status === 0 && statSync(join(shared, 'MEMORY.md')).mtimeMs === sharedAt, '--stop: an unchanged shared store is left alone');
// The smaller budget is the shared store's alone.
const six = join(root, 'proj-six', 'memory');
mkdirSync(six, { recursive: true });
wide(six, 40);
writeFileSync(join(root, 'proj-six', 'session.jsonl'), '');
stop('proj-six');
ok(Buffer.byteLength(readFileSync(join(six, 'MEMORY.md'), 'utf8')) > 3000, 'a project store keeps its own 7000 B budget');

rmSync(home, { recursive: true, force: true });
console.log(`memory-tier: ${checks} checks passed`);
