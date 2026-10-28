// Self-check for memory-tier.mjs. Part one builds a throwaway store and asserts
// the tiering rules that would silently lose or duplicate a pointer. Part two
// builds a throwaway HOME with two stores and breaks the git snapshot path and
// the --stop gate. Run: node memory-tier.test.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync, unlinkSync, utimesSync, rmdirSync, renameSync, symlinkSync, openSync, closeSync, copyFileSync, readdirSync } from 'node:fs';
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
function memory(name, { type = 'project', tier, days = 0, fresh = false, extra = '' } = {}) {
  writeFileSync(join(dir, `${name}.md`), `---
name: ${name}
description: "desc of ${name}"
metadata:
  type: ${type}${tier ? `\n  tier: ${tier}` : ''}${extra}
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
  replaced: memory('replaced-note', { tier: 'hot', days: 0, extra: '\n  superseded-by: fresh-note.md' }),  // replaced beats a pin
};
writeFileSync(join(dir, 'MEMORY.md'),
  // A BOM on the index must not orphan the first pointer.
  '\uFEFF' + ['# Index', '', lines.rule, lines.pinned, lines.fresh, lines.stale, lines.event,
    lines.dupe, lines.dupe, lines.cold, lines.replaced, '- [Archive](MEMORY-archive.md) — 0 older pointers'].join('\n') + '\n');
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
ok(has(arc, lines.replaced) && !has(main, lines.replaced), 'a memory another replaced is archived, even one pinned hot');
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

const plain = () => spawnSync(process.execPath, [TOOL], { encoding: 'utf8' });
// No git: an environment made of the throwaway home and an empty PATH, nothing
// read from this process's.
const noGit = () => spawnSync(process.execPath, [TOOL], { env: { HOME: home, USERPROFILE: home, PATH: '' }, encoding: 'utf8' });
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
  const realHome = tempDir('memtier-real-'), linkedHome = join(tempDir('memtier-link-'), 'home');
  symlinkSync(realHome, linkedHome, 'junction');
  const lroot = join(linkedHome, '.claude', 'projects'), d = join(lroot, 'proj-l', 'memory');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'a.md'), '---\nname: a\ndescription: "a"\nmetadata:\n  type: project\n---\nbody\n');
  writeFileSync(join(d, 'MEMORY.md'), '# Index\n\n- [a](a.md) — a\n');
  process.env.HOME = linkedHome; process.env.USERPROFILE = linkedHome;
  let lr; try { lr = spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }); } finally { process.env.HOME = home; process.env.USERPROFILE = home; }
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

// No git is a setup, not a failure: no count, no startup warning, and the
// store is stamped, or every reply redid the whole pass.
r = noGit();
const sh = () => JSON.parse(readFileSync(join(root, '.snapshot-health'), 'utf8'));
ok(r.status === 0 && /memory snapshot: off: git is not installed/.test(r.stdout) && sh().failures === 0 && sh().off, `git missing from PATH: exit 0, snapshots off, no failure counted (got ${r.stdout.trim()})`);
r = plain();
ok(sh().failures === 0 && sh().lastOk && !sh().off, 'and with git back, snapshots are on again');
// A repository that cannot be read is a failure, counted for the startup line.
renameSync(join(root, '.git'), join(root, '.gitaside'));
writeFileSync(join(root, '.git'), `gitdir: ${join(root, 'no-such-repo').replace(/\\/g, '/')}\n`);
note('proj-one', 'counted'); plain(); plain();
ok(sh().failures === 2 && sh().error, `failed snapshots are counted for the startup line (got ${JSON.stringify(sh())})`);
unlinkSync(join(root, '.git'));
renameSync(join(root, '.gitaside'), join(root, '.git'));
r = plain();
ok(sh().failures === 0 && sh().lastOk, 'and a good one resets the count');
// The user's own git settings are not the snapshot's: a global hooks path
// (a pre-commit that fails) and commit signing with no signer failed every
// snapshot, and ran the user's hooks on the memory repo.
{
  const hooks = tempDir('memtier-hooks-');
  for (const h of ['pre-commit', 'prepare-commit-msg', 'commit-msg']) writeFileSync(join(hooks, h), '#!/bin/sh\necho "the user\'s hook ran" >&2\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(home, '.gitconfig'), `[core]\n\thooksPath = ${hooks.replace(/\\/g, '/')}\n[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = no-such-signer\n`);
  note('proj-one', 'signed');
  try { r = plain(); } finally { rmSync(join(home, '.gitconfig'), { force: true }); }
  ok(sh().failures === 0 && tracked().includes('proj-one/memory/signed.md'), `a global hooks path and commit signing do not reach the snapshot (got ${r.stdout.trim()})`);
}
// The handoff is not snapshotted, and one an older version committed leaves
// the index when the new .gitignore is written.
writeFileSync(join(root, 'proj-one', 'memory', 'handoff.md'), 'the last exchanges\n');
writeFileSync(join(root, '.gitignore'), '*\n!*/\n!*/memory/*.md\n!.gitignore\n');
git('add', '-f', 'proj-one/memory/handoff.md'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'an older version');
r = plain();
ok(!tracked().includes('proj-one/memory/handoff.md') && readFileSync(join(root, '.gitignore'), 'utf8').includes('*/memory/handoff.md'), `handoff.md leaves the snapshots (tracked: ${tracked().join(', ')})`);
// A repository the user made there is theirs: nothing committed into it, its
// .gitignore untouched. One this tool made before it marked them is adopted.
{
  renameSync(join(root, '.git'), join(root, '.gitmine'));
  const ours = readFileSync(join(root, '.gitignore'), 'utf8');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  execFileSync('git', ['-C', root, 'init', '-q']);
  // Its commit in progress: an hour-old lock, which this tool would clear in its own repository.
  writeFileSync(join(root, '.git', 'index.lock'), '');
  utimesSync(join(root, '.git', 'index.lock'), new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  note('proj-one', 'theirs');
  r = plain();
  const commits = spawnSync('git', ['-C', root, 'rev-list', '--all'], { encoding: 'utf8' }).stdout.trim();
  ok(/off: .*did not make/.test(r.stdout) && readFileSync(join(root, '.gitignore'), 'utf8') === 'node_modules/\n' && commits === '' && existsSync(join(root, '.git', 'index.lock')),
    `a git repository the user made there is left alone, its lock too (got ${r.stdout.trim()})`);
  rmSync(join(root, '.git'), { recursive: true, force: true });
  renameSync(join(root, '.gitmine'), join(root, '.git'));
  writeFileSync(join(root, '.gitignore'), ours);
  git('config', '--remove-section', 'project-memory');
  note('proj-one', 'adopted');
  r = plain();
  ok(tracked().includes('proj-one/memory/adopted.md') && /\[project-memory\]/.test(readFileSync(join(root, '.git', 'config'), 'utf8')), `a repository this tool made before the mark is adopted (got ${r.stdout.trim()})`);
}
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
// A lock git may not take, or a dead one that cannot be deleted, is a failure:
// read as busy, it stopped every snapshot unseen. A folder named index.lock,
// an hour old, is both.
mkdirSync(join(root, '.git', 'index.lock'));
writeFileSync(join(root, '.git', 'index.lock', 'x'), '');
const hourAgo = new Date(Date.now() - 3600_000);
utimesSync(join(root, '.git', 'index.lock'), hourAgo, hourAgo);
note('proj-one', 'locked-out');
r = plain();
ok(/snapshot failed/.test(r.stdout) && sh().failures === 1, `an index.lock that cannot be removed is a failure, not busy (got ${r.stdout.trim()})`);
rmSync(join(root, '.git', 'index.lock'), { recursive: true, force: true });
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
// The proof is a line a run, naming the conversation and the copy that ran, and
// the log is cut back to its newest 20 lines once it passes 8 KB.
const runLines = () => readFileSync(join(root, '.stop-ran'), 'utf8').split('\n').filter(Boolean);
const lastRun = JSON.parse(runLines().at(-1));
ok(lastRun.s && lastRun.from && !Number.isNaN(Date.parse(lastRun.at)), `--stop: a run's line says when, which conversation and which copy (got ${runLines().at(-1)})`);
writeFileSync(join(root, '.stop-ran'), Array.from({ length: 200 }, (_, i) => JSON.stringify({ at: new Date(i).toISOString(), s: 'old', from: 'x'.repeat(30) })).join('\n') + '\n');
stop();
ok(runLines().length <= 20 && JSON.parse(runLines().at(-1)).s !== 'old', `--stop: the log keeps the newest runs only (got ${runLines().length} lines)`);
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

// 1.0.8. A web link in an index is prose, not a memory with no file; a name no
// index line can carry (`lesson (1).md`) is reported, not given a new line on
// every pass.
{
  const seven = join(root, 'proj-seven', 'memory');
  mkdirSync(seven, { recursive: true });
  const put = (f, body) => { writeFileSync(join(seven, f), body); utimesSync(join(seven, f), tenMin, tenMin); };
  put('a.md', '---\nname: a\ndescription: "a"\nmetadata:\n  type: feedback\n---\nbody\n');
  put('lesson (1).md', '---\nname: copy\ndescription: "a copy"\nmetadata:\n  type: project\n---\nbody\n');
  writeFileSync(join(seven, 'MEMORY.md'), '# Index\n\n- [Repo](https://github.com/x/y) — the code\n- [a](a.md) — a\n');
  const tierSeven = () => spawnSync(process.execPath, [TOOL, '--dir', seven], { encoding: 'utf8' });
  tierSeven();
  const m7 = readFileSync(join(seven, 'MEMORY.md'), 'utf8'), a7 = readFileSync(join(seven, 'MEMORY-archive.md'), 'utf8');
  tierSeven();
  const h7 = readFileSync(join(seven, '.health'), 'utf8');
  ok(/github\.com/.test(m7) && !/pointers with no file/.test(h7) && /cannot point at[^\n]*lesson \(1\)\.md/.test(h7)
    && readFileSync(join(seven, 'MEMORY.md'), 'utf8') === m7 && readFileSync(join(seven, 'MEMORY-archive.md'), 'utf8') === a7,
    `a web link stays as prose, and a name no line can carry is reported, not added each pass (health: ${h7.trim()})`);
}
// Notes of one date: every pass evicts the same lines. In index order, the
// lines a pass brought back went last, and each pass evicted different ones.
{
  const eight = join(root, 'proj-eight', 'memory'), day = new Date(Date.now() - 86400000).toISOString().slice(0, 10), ls = [];
  mkdirSync(eight, { recursive: true });
  for (let i = 0; i < 60; i++) {
    const n = `same-day-${String(i).padStart(2, '0')}`;
    writeFileSync(join(eight, `${n}.md`), `---\nname: ${n}\ndescription: "${n}"\nmetadata:\n  type: project\n  modified: ${day}\n---\nbody\n`);
    utimesSync(join(eight, `${n}.md`), tenMin, tenMin);
    ls.push(`- [${n}](${n}.md) — ${'a hook long enough that sixty of them overflow '.repeat(2).trim()}`);
  }
  writeFileSync(join(eight, 'MEMORY.md'), '# Index\n\n' + ls.join('\n') + '\n');
  const tierEight = () => spawnSync(process.execPath, [TOOL, '--dir', eight], { encoding: 'utf8' });
  tierEight();
  const m8 = readFileSync(join(eight, 'MEMORY.md'), 'utf8'), a8 = readFileSync(join(eight, 'MEMORY-archive.md'), 'utf8');
  tierEight(); tierEight();
  ok(/overflow/.test(a8) && readFileSync(join(eight, 'MEMORY.md'), 'utf8') === m8 && readFileSync(join(eight, 'MEMORY-archive.md'), 'utf8') === a8, 'notes of one date: every pass evicts the same lines');
}
// A run says which event ran it, and whether a block sent it back; a transcript
// path that is no string still exits 0.
spawnSync(process.execPath, [TOOL, '--stop'], { encoding: 'utf8', input: JSON.stringify({ transcript_path: join(root, 'proj-one', 'session.jsonl'), session_id: 'evt', hook_event_name: 'Stop', stop_hook_active: true }) });
const evt = JSON.parse(runLines().at(-1));
ok(evt.e === 'Stop' && evt.h === 1, `--stop: a run says which event ran it, and whether a block sent it back (got ${runLines().at(-1)})`);
r = spawnSync(process.execPath, [TOOL, '--stop'], { encoding: 'utf8', input: JSON.stringify({ transcript_path: 42, session_id: 'bad' }) });
ok(r.status === 0, `--stop: a transcript path that is no string still exits 0 (got ${r.status}: ${r.stderr.slice(0, 200)})`);
// A note's head is its first 1,200 characters, not bytes: a long Cyrillic
// description pushed `tier: hot` past 1,200 bytes, and the pin was lost.
{
  const nine = join(root, 'proj-nine', 'memory');
  mkdirSync(nine, { recursive: true });
  writeFileSync(join(nine, 'pin.md'), `---\nname: pin\ndescription: "${'я'.repeat(600)}"\nmetadata:\n  type: project\n  tier: hot\n  modified: 2020-01-01\n---\nbody\n`);
  // Old by its file date too: cut before `modified:`, a fresh file would stay by its date.
  const monthAgo = new Date(Date.now() - 30 * 86400000);
  utimesSync(join(nine, 'pin.md'), monthAgo, monthAgo);
  writeFileSync(join(nine, 'MEMORY.md'), '# Index\n\n- [Pin](pin.md) — pinned\n');
  spawnSync(process.execPath, [TOOL, '--dir', nine], { encoding: 'utf8' });
  ok(readFileSync(join(nine, 'MEMORY.md'), 'utf8').includes('- [Pin](pin.md)'), 'a pin past 1,200 bytes, inside 1,200 characters, holds');
}

// Round 3 (2026-10-27).
{
  // A store of its own, run alone with --dir.
  const fresh3 = (name) => { const d = join(root, name, 'memory'); mkdirSync(d, { recursive: true }); return d; };
  const noteIn = (d, s, head = '', when = tenMin) => {
    writeFileSync(join(d, `${s}.md`), `---\nname: ${s}\ndescription: "${s}"\nmetadata:\n  type: project${head}\n---\nbody\n`);
    utimesSync(join(d, `${s}.md`), when, when);
  };
  const tierOne = (d, ...a) => spawnSync(process.execPath, [TOOL, '--dir', d, ...a], { encoding: 'utf8' });

  // A line going back from the archive to the index survives an index write
  // that fails: taken out of the archive first, an edit during the pass (a
  // conflict) left it in neither file.
  const back = fresh3('proj-back');
  noteIn(back, 'pinned', '\n  tier: hot');
  writeFileSync(join(back, 'MEMORY.md'), '# Index\n');
  writeFileSync(join(back, 'MEMORY-archive.md'), '# Archive\n\n- [Pinned](pinned.md) — the hand-written hook\n');
  const held = spawn(process.execPath, [TOOL, '--dir', back, '--pause', '2500'], { stdio: 'ignore' });
  await new Promise((res) => setTimeout(res, 900));
  writeFileSync(join(back, 'MEMORY.md'), '# Index\n\nWritten by the model during the pass.\n');
  await new Promise((res) => held.on('exit', res));
  const both = readFileSync(join(back, 'MEMORY.md'), 'utf8') + readFileSync(join(back, 'MEMORY-archive.md'), 'utf8');
  ok(both.includes('- [Pinned](pinned.md) — the hand-written hook'), `a line coming back from the archive survives an index write that conflicts (got ${both})`);
  tierOne(back);
  ok(readFileSync(join(back, 'MEMORY.md'), 'utf8').includes('- [Pinned](pinned.md) — the hand-written hook') && !readFileSync(join(back, 'MEMORY-archive.md'), 'utf8').includes('pinned.md'),
    'and the next pass moves it back, hook and all, out of the archive');

  // A note dated ahead of the clock is no younger than its age: it read as
  // just written for as long as the skew lasted, and was never indexed.
  const ahead = fresh3('proj-ahead');
  writeFileSync(join(ahead, 'MEMORY.md'), '# Index\n');
  utimesSync(join(ahead, 'MEMORY.md'), tenMin, tenMin);   // an index edited just now is left alone
  noteIn(ahead, 'from-the-future', '', new Date(Date.now() + 3 * 3600_000));
  tierOne(ahead);
  const idx3 = readFileSync(join(ahead, 'MEMORY.md'), 'utf8') + (existsSync(join(ahead, 'MEMORY-archive.md')) ? readFileSync(join(ahead, 'MEMORY-archive.md'), 'utf8') : '');
  ok(idx3.includes('(from-the-future.md)'), `a note dated ahead of the clock is indexed (got ${idx3})`);

  // An archive line whose note is gone is history, not a warning at every
  // startup; merge-conflict markers in the index are one.
  const hist = fresh3('proj-hist');
  noteIn(hist, 'kept');
  writeFileSync(join(hist, 'MEMORY.md'), '# Index\n\n- [Kept](kept.md) — kept\n<<<<<<< HEAD\n- [Kept](kept.md) — kept here\n=======\n- [Kept](kept.md) — kept there\n>>>>>>> laptop\n');
  writeFileSync(join(hist, 'MEMORY-archive.md'), '# Archive\n\n- [Gone](gone.md) — deleted since\n');
  utimesSync(join(hist, 'MEMORY.md'), tenMin, tenMin);   // an index edited just now reports no missing lines at all
  tierOne(hist);
  const h3 = existsSync(join(hist, '.health')) ? readFileSync(join(hist, '.health'), 'utf8') : '';
  ok(!/gone\.md/.test(h3) && /merge-conflict markers/.test(h3), `an archived line to a deleted note warns of nothing; conflict markers in the index do (got ${h3})`);

  // handoff.md leaves the snapshots even when the run that rewrote .gitignore
  // lost its untrack (a busy index, a killed hook): nothing retried it.
  writeFileSync(join(root, 'proj-one', 'memory', 'handoff.md'), '---\nname: handoff\n---\n');
  git('add', '-f', 'proj-one/memory/handoff.md');
  rmSync(join(root, '.git', 'project-memory-ignored'), { force: true });
  note('proj-one', 'r3a');
  plain();
  ok(!tracked().includes('proj-one/memory/handoff.md'), `an untrack a run lost is redone by the next (tracked: ${tracked().filter((f) => f.includes('handoff')).join(', ')})`);

  // Stale locks a killed commit leaves: HEAD's as well as the index's, and one
  // dated ahead of the clock is as stale as one long behind it.
  const gitDir = join(root, '.git');
  writeFileSync(join(gitDir, 'HEAD.lock'), '');
  utimesSync(join(gitDir, 'HEAD.lock'), new Date(Date.now() - 11 * 60000), new Date(Date.now() - 11 * 60000));
  note('proj-one', 'r3b');
  r = plain();
  ok(!existsSync(join(gitDir, 'HEAD.lock')) && /memory snapshot: committed/.test(r.stdout), `a dead HEAD.lock is cleared and the snapshot goes on (got ${r.stdout.trim().split('\n').at(-1)})`);
  writeFileSync(join(gitDir, 'index.lock'), '');
  utimesSync(join(gitDir, 'index.lock'), new Date(Date.now() + 86400000), new Date(Date.now() + 86400000));
  note('proj-one', 'r3c');
  r = plain();
  ok(!existsSync(join(gitDir, 'index.lock')) && /memory snapshot: committed/.test(r.stdout), `an index.lock dated a day ahead is stale, not busy forever (got ${r.stdout.trim().split('\n').at(-1)})`);

  // The run log from before 1.0.7 was one time with no newline: the first new
  // line was glued to it, and that run was lost.
  writeFileSync(join(root, '.stop-ran'), '2026-10-01T00:00:00.000Z');
  stop();
  let glued = null; try { glued = JSON.parse(runLines().at(-1)); } catch {}
  ok(glued?.s === 'tst', `a run logged after the old format is a line of its own (got ${runLines().at(-1)})`);

  // Auto memory turned off: the Stop hook does nothing, not even its log.
  const before = runLines().length;
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  try { stop(); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  ok(runLines().length === before, 'with auto memory off the Stop hook does nothing');

  // A record of where you left off that cannot be saved (here the store's
  // folder is a file, so its lock cannot be taken) is said at the next start,
  // and the next save that works clears it. Swallowed, it was silence.
  const broken = join(root, 'proj-broken');
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'memory'), 'not a folder');
  const tb = join(broken, 's.jsonl');
  writeFileSync(tb, [JSON.stringify({ type: 'user', timestamp: '2026-10-27T10:00:00Z', message: { content: [{ type: 'text', text: 'save me' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-27T10:00:05Z', message: { content: [{ type: 'text', text: 'saved' }] } })].join('\n') + '\n');
  const stopB = () => spawnSync(process.execPath, [TOOL, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ transcript_path: tb, session_id: 'brkn' }) });
  stopB();
  const said = execFileSync(process.execPath, [tool('handoff-log.mjs'), '--print'], { input: JSON.stringify({ transcript_path: tb, session_id: 'other', source: 'startup' }), env }).toString();
  ok(existsSync(join(root, '.handoff-failed-proj-broken')) && /could not be saved/.test(said), `a handoff that cannot be saved is said at the next start (got ${said.slice(0, 200)})`);
  rmSync(join(broken, 'memory'));
  mkdirSync(join(broken, 'memory'));
  stopB();
  ok(!existsSync(join(root, '.handoff-failed-proj-broken')), 'and the next save that works clears it');

  // A history to adopt (its own .gitignore, no mark yet) with a stale
  // config.lock: swept first, then adopted. Adopted first, `git config` was
  // refused, read as busy, and the history never started.
  git('config', '--unset', 'project-memory.snapshots');
  writeFileSync(join(gitDir, 'config.lock'), '');
  utimesSync(join(gitDir, 'config.lock'), new Date(Date.now() - 11 * 60000), new Date(Date.now() - 11 * 60000));
  note('proj-one', 'r3d');
  r = plain();
  ok(/^\[project-memory\]/m.test(readFileSync(join(gitDir, 'config'), 'utf8')) && /memory snapshot: committed/.test(r.stdout), `a stale config.lock does not stop the adoption (got ${r.stdout.trim().split('\n').at(-1)})`);

  // A heading underlined with seven `=` is no merge conflict.
  const head7 = fresh3('proj-head7');
  noteIn(head7, 'n7');
  writeFileSync(join(head7, 'MEMORY.md'), 'Index\n=======\n\n- [N7](n7.md) — n7\n');
  utimesSync(join(head7, 'MEMORY.md'), tenMin, tenMin);
  tierOne(head7);
  ok(!/merge-conflict/.test(existsSync(join(head7, '.health')) ? readFileSync(join(head7, '.health'), 'utf8') : ''), 'a heading underlined with ======= is not taken for a merge conflict');
}

// Round 4. A second index line for one note: the newer, lower line wins, where
// the first was. On Windows a line written (Kase.md) is kase.md's own: no
// second, machine-written line for it.
{
  const d8 = tempDir('memtier-r4-');
  const note8 = (name) => { writeFileSync(join(d8, `${name}.md`), `---\nname: ${name}\ndescription: "desc of ${name}"\nmetadata:\n  type: feedback\n---\n\nbody\n`); const t = new Date(Date.now() - 10 * 60000); utimesSync(join(d8, `${name}.md`), t, t); };
  note8('pricing'); note8('other'); note8('kase');
  writeFileSync(join(d8, 'MEMORY.md'), ['# Index', '', '- [Pricing](pricing.md) — the old hook', '- [Other](other.md) — o',
    '- [Kase](Kase.md) — k', '- [Pricing](pricing.md) — the updated hook'].join('\n') + '\n');
  execFileSync(process.execPath, [TOOL, '--dir', d8], { encoding: 'utf8' });
  const m8 = readFileSync(join(d8, 'MEMORY.md'), 'utf8'), a8 = existsSync(join(d8, 'MEMORY-archive.md')) ? readFileSync(join(d8, 'MEMORY-archive.md'), 'utf8') : '';
  const p8 = m8.split('\n').filter((l) => l.includes('(pricing.md)'));
  ok(p8.length === 1 && p8[0].endsWith('the updated hook') && m8.indexOf('(pricing.md)') < m8.indexOf('(other.md)'),
    `the newer of two lines for one note is kept, where the first was (got ${m8})`);
  if (process.platform === 'win32') ok(!/\(kase\.md\)/.test(m8 + a8) && /\(Kase\.md\)/.test(m8), `a line written (Kase.md) is kase.md's: no second line for it (got ${m8} | ${a8})`);
}

// Round 4. Claude Code loads the first 200 lines of MEMORY.md: 230 short lines
// under 7 KB are cut to 200, the rest to the archive, marked to come back.
{
  const d9 = tempDir('memtier-lines-');
  const t9 = new Date(Date.now() - 10 * 60000), lines9 = [];
  for (let i = 0; i < 230; i++) {
    const n = `n${String(i).padStart(3, '0')}`;
    writeFileSync(join(d9, `${n}.md`), `---\nname: ${n}\ndescription: "d"\nmetadata:\n  type: project\n---\n\nb\n`);
    utimesSync(join(d9, `${n}.md`), t9, t9);
    lines9.push(`- [${n}](${n}.md) — h${i % 2 ? ' ' : ''}`);   // some hand-written with a trailing space
  }
  writeFileSync(join(d9, 'MEMORY.md'), lines9.join('\n') + '\n');
  execFileSync(process.execPath, [TOOL, '--dir', d9], { encoding: 'utf8' });
  const m9 = readFileSync(join(d9, 'MEMORY.md'), 'utf8'), a9 = readFileSync(join(d9, 'MEMORY-archive.md'), 'utf8');
  ok(m9.replace(/\n$/, '').split('\n').length <= 200 && Buffer.byteLength(m9) < 7000 && (a9.match(/<!-- overflow -->/g) || []).length >= 30,
    `MEMORY.md is held to 200 lines, the rest archived and marked (got ${m9.split('\n').length} lines)`);
  // A second pass changes nothing: a line ending in a space lost it when it
  // came back, and the archive was written again (tiering fuzzer).
  execFileSync(process.execPath, [TOOL, '--dir', d9], { encoding: 'utf8' });
  ok(readFileSync(join(d9, 'MEMORY-archive.md'), 'utf8') === a9 && readFileSync(join(d9, 'MEMORY.md'), 'utf8') === m9, 'a second pass changes nothing, trailing spaces and all');
}
// The first snapshot holds the notebook as it was found, before the first tidy-up.
{
  const was = [process.env.HOME, process.env.USERPROFILE];
  const h9 = tempDir('memtier-first-'), root9 = join(h9, '.claude', 'projects'), s9 = join(root9, 'C--first', 'memory');
  mkdirSync(s9, { recursive: true });
  writeFileSync(join(s9, 'old-note.md'), `---\nname: old-note\ndescription: "an old note"\nmetadata:\n  type: project\n  modified: ${iso(30)}\n---\n\nbody\n`);
  const t = new Date(Date.now() - 10 * 60000); utimesSync(join(s9, 'old-note.md'), t, t);
  const original = '# My notes\n\n- [Old note](old-note.md) — written by hand\n';
  writeFileSync(join(s9, 'MEMORY.md'), original);
  process.env.HOME = h9; process.env.USERPROFILE = h9;
  try { spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }); } finally { process.env.HOME = was[0]; process.env.USERPROFILE = was[1]; }
  const first = execFileSync('git', ['-C', root9, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).trim();
  const firstIdx = execFileSync('git', ['-C', root9, 'cat-file', '-p', `${first}:C--first/memory/MEMORY.md`], { encoding: 'utf8' });
  ok(firstIdx === original && readFileSync(join(s9, 'MEMORY.md'), 'utf8') !== original, `the first snapshot holds the index as found, and the tidy-up comes after (got ${JSON.stringify(firstIdx)})`);
}

// Round 5. A damaged index (a crash or a full disk while git wrote it) is
// rebuilt from the last commit: before, every snapshot after it failed.
{
  const was = [process.env.HOME, process.env.USERPROFILE];
  const h5 = tempDir('memtier-index-'), root5 = join(h5, '.claude', 'projects'), s5 = join(root5, 'C--idx', 'memory');
  mkdirSync(s5, { recursive: true });
  const note5 = (n) => { writeFileSync(join(s5, `${n}.md`), `---\nname: ${n}\ndescription: "${n}"\nmetadata:\n  type: project\n---\n\nbody\n`); const t = new Date(Date.now() - 10 * 60000); utimesSync(join(s5, `${n}.md`), t, t); };
  note5('a'); writeFileSync(join(s5, 'MEMORY.md'), '- [A](a.md) — a\n');
  process.env.HOME = h5; process.env.USERPROFILE = h5;
  let out5;
  try {
    spawnSync(process.execPath, [TOOL], { encoding: 'utf8' });
    writeFileSync(join(root5, '.git', 'index'), 'not an index at all');
    note5('b'); writeFileSync(join(s5, 'MEMORY.md'), '- [A](a.md) — a\n- [B](b.md) — b\n');
    out5 = spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }).stdout;
  } finally { process.env.HOME = was[0]; process.env.USERPROFILE = was[1]; }
  const has5 = spawnSync('git', ['-C', root5, 'cat-file', '-e', 'HEAD:C--idx/memory/b.md']).status === 0;
  ok(/memory snapshot: committed/.test(out5) && has5, `a damaged index is rebuilt and the snapshot goes on (got ${out5})`);
}

// Round 5. Two notes NTFS keeps apart (the Kelvin sign and k) are two notes:
// each keeps its own line.
{
  const d6 = tempDir('memtier-kelvin-'), K = String.fromCharCode(0x212A);
  const t6 = new Date(Date.now() - 10 * 60000);
  for (const n of [`${K}elvin-units`, 'kelvin-units']) {
    writeFileSync(join(d6, `${n}.md`), `---\nname: x\ndescription: "units"\nmetadata:\n  type: feedback\n---\n\nbody\n`);
    utimesSync(join(d6, `${n}.md`), t6, t6);
  }
  const both = readdirSync(d6).length === 2;
  writeFileSync(join(d6, 'MEMORY.md'), `- [Kelvin sign](${K}elvin-units.md) — LINE-ONE\n- [Kelvin](kelvin-units.md) — LINE-TWO\n`);
  execFileSync(process.execPath, [TOOL, '--dir', d6], { encoding: 'utf8' });
  const m6 = readFileSync(join(d6, 'MEMORY.md'), 'utf8');
  ok(!both || (/LINE-ONE/.test(m6) && /LINE-TWO/.test(m6)), `two notes the disk keeps apart keep a line each (got ${m6})`);
  // And a line naming one that is not there is no line for the other.
  const d7 = tempDir('memtier-kelvin2-');
  writeFileSync(join(d7, 'kelvin-units.md'), `---\nname: x\ndescription: "units"\nmetadata:\n  type: feedback\n---\n\nbody\n`);
  utimesSync(join(d7, 'kelvin-units.md'), t6, t6);
  if (!existsSync(join(d7, `${K}elvin-units.md`))) {
    writeFileSync(join(d7, 'MEMORY.md'), `- [Kelvin sign](${K}elvin-units.md) — gone\n`);
    execFileSync(process.execPath, [TOOL, '--dir', d7], { encoding: 'utf8' });
    const all7 = readFileSync(join(d7, 'MEMORY.md'), 'utf8') + (existsSync(join(d7, 'MEMORY-archive.md')) ? readFileSync(join(d7, 'MEMORY-archive.md'), 'utf8') : '');
    ok(/\]\(kelvin-units\.md\)/.test(all7), `a line naming a note that is not there is not taken for another's (got ${all7})`);
  }
}
// An index rebuilt from a commit that still tracks handoff.md (a history from
// before 1.0.8 whose untracking never landed) does not commit it again.
{
  const was = [process.env.HOME, process.env.USERPROFILE];
  const h7 = tempDir('memtier-retrack-'), root7 = join(h7, '.claude', 'projects'), s7 = join(root7, 'C--rt', 'memory');
  mkdirSync(s7, { recursive: true });
  const t7 = new Date(Date.now() - 10 * 60000);
  writeFileSync(join(s7, 'a.md'), '---\nname: a\ndescription: "a"\nmetadata:\n  type: project\n---\n\nbody\n'); utimesSync(join(s7, 'a.md'), t7, t7);
  writeFileSync(join(s7, 'MEMORY.md'), '- [A](a.md) — a\n');
  writeFileSync(join(s7, 'handoff.md'), '---\nname: handoff\n---\nold exchanges\n');
  const g7 = (...a) => spawnSync('git', ['-C', root7, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  process.env.HOME = h7; process.env.USERPROFILE = h7;
  try {
    spawnSync(process.execPath, [TOOL], { encoding: 'utf8' });
    g7('add', '-f', 'C--rt/memory/handoff.md'); g7('commit', '-qm', 'as an old version left it');
    writeFileSync(join(root7, '.git', 'index'), 'damaged');
    writeFileSync(join(s7, 'handoff.md'), '---\nname: handoff\n---\nLATEST EXCHANGE\n');
    writeFileSync(join(s7, 'b.md'), '---\nname: b\ndescription: "b"\nmetadata:\n  type: project\n---\n\nbody\n'); utimesSync(join(s7, 'b.md'), t7, t7);
    writeFileSync(join(s7, 'MEMORY.md'), '- [A](a.md) — a\n- [B](b.md) — b\n');
    spawnSync(process.execPath, [TOOL], { encoding: 'utf8' });
  } finally { process.env.HOME = was[0]; process.env.USERPROFILE = was[1]; }
  const head7 = g7('cat-file', '-p', 'HEAD:C--rt/memory/handoff.md');
  ok(head7.status !== 0 && g7('cat-file', '-e', 'HEAD:C--rt/memory/b.md').status === 0, `a rebuilt index untracks handoff.md again (got ${JSON.stringify(head7.stdout)})`);
}

// Round 6. A pin set after a long folded description is still a pin: the
// first 1,200 characters were all that was read, and the note was archived.
{
  const d8 = tempDir('memtier-longfm-'), t8 = new Date(Date.now() - 30 * 86400000);
  writeFileSync(join(d8, 'pinned.md'), `---\nname: pinned\ndescription: >-\n${'  a long folded description line\n'.repeat(70)}metadata:\n  type: project\n  tier: hot\n---\n\nbody\n`);
  utimesSync(join(d8, 'pinned.md'), t8, t8);
  writeFileSync(join(d8, 'MEMORY.md'), '- [Pinned](pinned.md) — p\n');
  execFileSync(process.execPath, [TOOL, '--dir', d8], { encoding: 'utf8' });
  ok(/\(pinned\.md\)/.test(readFileSync(join(d8, 'MEMORY.md'), 'utf8')), 'a pin after a 2,000-character description stays in the index');
}

rmSync(home, { recursive: true, force: true });
console.log(`memory-tier: ${checks} checks passed`);
