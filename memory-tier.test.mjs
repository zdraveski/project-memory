// Self-check for memory-tier.mjs. Part one builds a throwaway store and asserts
// the tiering rules that would silently lose or duplicate a pointer. Part two
// builds a throwaway HOME with two stores and breaks the git snapshot path and
// the --stop gate. Run: node memory-tier.test.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, existsSync, unlinkSync, utimesSync, rmdirSync, renameSync, symlinkSync, copyFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import assert from 'node:assert';
import { tool, tempDir, tempHome, pointers, quick } from './harness.mjs';

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
if (!quick) {
  mkdirSync(join(dir, '.lock'));
  ok(/busy/.test(run()), 'a store another hook holds is left alone, and said so');
  rmdirSync(join(dir, '.lock'));
}

// The model edits the index while a pass sits between reading and writing it:
// the pass stands down and the edit survives. A duplicate line gives the pass
// something to write; --pause holds it open.
writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8') + moved + '\n');
const added = memory('added-mid-pass', { days: 0 });
// The edit lands when the pass says it holds the window open (or has ended
// without, and the checks after say so): a fixed 1.5 s guessed how long a
// loaded box takes to start. One second open is room for one write.
const pause = (d) => {
  const child = spawn(process.execPath, [TOOL, '--dir', d, '--pause', '1000']);
  let out = ''; child.stdout.on('data', (b) => { out += b; });
  const closed = new Promise((res) => child.on('close', () => res(out)));
  const ready = new Promise((res) => { child.stderr.on('data', (b) => { if (String(b).includes('paused')) res(); }); closed.then(res); });
  return { ready, closed };
};
if (!quick) {
  const paused = pause(dir);
  await paused.ready;
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8') + added + '\n');
  const pausedOut = await paused.closed;
  ok(has(readFileSync(join(dir, 'MEMORY.md'), 'utf8'), added), 'an index edited during a pass keeps the edit');
  ok(/changed during the pass/.test(pausedOut), 'and the pass says it stood down');
}
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
// A folder named like a note is none: read as one, every pass failed.
mkdirSync(join(dir, 'drafts.md'));
utimesSync(join(dir, 'drafts.md'), new Date(Date.now() - 10 * 60000), new Date(Date.now() - 10 * 60000));
run();
ok(!existsSync(join(dir, '.health')), `a folder named drafts.md leaves the pass whole (got ${existsSync(join(dir, '.health')) ? readFileSync(join(dir, '.health'), 'utf8') : ''})`);
rmSync(join(dir, 'drafts.md'), { recursive: true });
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
const noGit = () => spawnSync(process.execPath, [TOOL], { env: { HOME: home, USERPROFILE: home, PATH: '', ...(process.env.NODE_V8_COVERAGE && { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }) }, encoding: 'utf8' });
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
ok(r.status === 0 && /memory snapshot: off: git is not installed/.test(r.stdout) && sh().failures === 0 && sh().off && typeof sh().lastOk === 'string', `git missing from PATH: exit 0, snapshots off, no failure counted (got ${r.stdout.trim()})`);
r = plain();
ok(sh().failures === 0 && sh().lastOk && !sh().off, 'and with git back, snapshots are on again');
// A repository that cannot be read is a failure, counted for the startup line.
renameSync(join(root, '.git'), join(root, '.gitaside'));
writeFileSync(join(root, '.git'), `gitdir: ${join(root, 'no-such-repo').replace(/\\/g, '/')}\n`);
note('proj-one', 'counted'); plain(); plain();
ok(sh().failures === 2 && sh().error && typeof sh().lastOk === 'string', `failed snapshots are counted for the startup line (got ${JSON.stringify(sh())})`);
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
ok(/^- \[journal\]\(journal\.md\)/m.test(readFileSync(join(root, 'proj-four', 'memory', 'MEMORY.md'), 'utf8')),
  'journal.md, written by that same Stop, has its index line on the first pass, with no two-minute wait');
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
// Held, its open fails busy: made so by a preload in that Stop, on every
// system. A real lock, this process's or PowerShell's, held on GitHub's test
// machines but not on its mutate machines, and the mutant lived (2026-10-30).
const busy = join(tempDir('memtier-busy-'), 'busy.cjs');
writeFileSync(busy, `const fs = require('node:fs'), open = fs.openSync, hit = ${JSON.stringify(busy + '.hit')};
fs.openSync = (p, ...a) => {
  if (!String(p).endsWith(${JSON.stringify(join('proj-five', 'memory', 'a.md'))})) return open(p, ...a);
  fs.writeFileSync(hit, '');
  throw Object.assign(new Error('EBUSY: resource busy or locked, open'), { code: 'EBUSY' });
};
require('node:module').syncBuiltinESMExports();
`);
spawnSync(process.execPath, ['--require', busy, TOOL, '--stop'], { env, encoding: 'utf8',
  input: JSON.stringify({ cwd: 'C:\\nowhere', transcript_path: join(root, 'proj-five', 'session.jsonl'), session_id: 'tst' }) });
// The Stop read it and found it busy, or the check below proves nothing.
ok(existsSync(busy + '.hit'), 'a Stop reading a memory held open finds it busy');
stop('proj-five');
ok(existsSync(stamp('proj-five')) && !existsSync(join(five, '.health')), 'a memory held open for one Stop leaves no lasting alarm');
// The same with a real lock, where the machine holds one: PowerShell opens the
// file sharing nothing. GitHub's mutate machines do not hold it (2026-10-30),
// so there it is skipped, and CI's Windows test jobs set REAL_LOCKS to require it.
if (!quick && process.platform === 'win32') {
  store('proj-lock');
  const lockd = join(root, 'proj-lock', 'memory');
  for (const f of ['a.md', 'MEMORY.md']) utimesSync(join(lockd, f), tenMin, tenMin);
  writeFileSync(join(root, 'proj-lock', 'session.jsonl'), '');
  stop('proj-lock');
  note('proj-lock', 'b');
  writeFileSync(join(lockd, 'MEMORY.md'), readFileSync(join(lockd, 'MEMORY.md'), 'utf8') + '- [b](b.md) — b\n');
  utimesSync(join(lockd, 'MEMORY.md'), tenMin, tenMin);
  const heldLock = join(lockd, 'a.md');
  const holder = spawn('powershell', ['-NoProfile', '-Command', [
    `try { $f = [IO.File]::Open($env:HELD, 'Open', 'Read', 'None') } catch { 'failed ' + $_.Exception.Message; exit }`,
    `$again = try { [IO.File]::Open($env:HELD, 'Open', 'Read', 'ReadWrite').Close(); 'reopened' } catch { 'refused' }`,
    `'held ' + $again + ' ' + [IO.DriveInfo]::new([IO.Path]::GetPathRoot($env:HELD)).DriveFormat`,
    '[Console]::In.ReadToEnd() | Out-Null; $f.Close()'].join('; ')], { stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, HELD: heldLock } });
  let said = '';
  const released = new Promise((res) => holder.on('close', res));
  await new Promise((res) => { holder.stdout.on('data', (b) => { said += b; if (/held|failed/.test(said)) res(); }); released.then(res); });
  let how = 'opened';
  try {   // finally lets go on every path, so a throw cannot leave the hold open
    try { readFileSync(heldLock); } catch (e) { how = e.code; }
    if (['EPERM', 'EBUSY', 'EACCES'].includes(how)) stop('proj-lock');
  } finally { holder.stdin.end(); await released; }
  if (['EPERM', 'EBUSY', 'EACCES'].includes(how)) {
    stop('proj-lock');
    ok(existsSync(stamp('proj-lock')) && !existsSync(join(lockd, '.health')), 'a memory another program really holds open for one Stop leaves no lasting alarm');
  } else {
    if (process.env.REAL_LOCKS === '1') ok(false, `a real lock was asked for and this machine does not hold one (PowerShell: ${said.trim() || 'nothing'})`);
    else console.log('skip: this machine does not hold a file another program opened');
  }
}

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

// 1.1.0. A web link in an index is prose, not a memory with no file; a name no
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
  if (!quick) {
    const held = pause(back);
    await held.ready;
    writeFileSync(join(back, 'MEMORY.md'), '# Index\n\nWritten by the model during the pass.\n');
    await held.closed;
    const both = readFileSync(join(back, 'MEMORY.md'), 'utf8') + readFileSync(join(back, 'MEMORY-archive.md'), 'utf8');
    ok(both.includes('- [Pinned](pinned.md) — the hand-written hook'), `a line coming back from the archive survives an index write that conflicts (got ${both})`);
  }
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

  // Auto memory turned off: the Stop hook does nothing, not even its log. It
  // keeps the conversation's tag beside the projects, so no backfill imports
  // it later, and makes no store for it.
  const before = runLines().length, po = join(root, 'proj-off');
  mkdirSync(po); writeFileSync(join(po, 'offline1-0000.jsonl'), '');
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  let offRun;
  try { offRun = spawnSync(process.execPath, [TOOL, '--stop'], { env, input: JSON.stringify({ transcript_path: join(po, 'offline1-0000.jsonl'), session_id: 'offline1-0000' }) }); }
  finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  let off = ''; try { off = readFileSync(join(root, '.memory-off'), 'utf8'); } catch {}
  ok(offRun.status === 0 && runLines().length === before && !existsSync(join(po, 'memory')) && off.split(/\r?\n/).includes('offline1'),
    `with auto memory off the Stop hook keeps only the conversation's tag and exits 0 (got ${offRun.status}, ${JSON.stringify(off)})`);

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
  // The failure file keeps the error's first line, whole, for the startup line to quote.
  const failedNote = JSON.parse(readFileSync(join(root, '.handoff-failed-proj-broken'), 'utf8'));
  ok(typeof failedNote.error === 'string' && failedNote.error.length > 0 && !failedNote.error.includes('\n'), `the failure file holds the error's first line (got ${JSON.stringify(failedNote)})`);
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
// before 1.1.0 whose untracking never landed) does not commit it again.
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

// Round 6. An index of prose alone over budget says so, not "InfinityB a line".
{
  const d9 = tempDir('memtier-prose-');
  writeFileSync(join(d9, 'MEMORY.md'), '# Notes\n\n' + 'Some long prose about the project. '.repeat(240) + '\n');
  execFileSync(process.execPath, [TOOL, '--dir', d9], { encoding: 'utf8' });
  const h9 = existsSync(join(d9, '.health')) ? readFileSync(join(d9, '.health'), 'utf8') : '';
  ok(/over budget/.test(h9) && !/Infinity|NaN/.test(h9) && /the text above the lines/.test(h9), `a prose-only index over budget is said plainly (got ${h9})`);
}

// Round 6. A memory folder linked to a folder outside the projects root is
// its store's only path: snapshotted where git follows the link (a junction
// on Windows), and said to be left out where it does not (a symlink on
// Linux and macOS). It was ignored as a second path, and doctor said ok.
{
  const was = [process.env.HOME, process.env.USERPROFILE];
  const h12 = tempDir('memtier-outside-'), root12 = join(h12, '.claude', 'projects'), out12 = join(h12, 'Synced', 'memory');
  mkdirSync(out12, { recursive: true }); mkdirSync(join(root12, 'C--ext'), { recursive: true });
  const t12 = new Date(Date.now() - 10 * 60000);
  writeFileSync(join(out12, 'price.md'), '---\nname: price\ndescription: "p"\nmetadata:\n  type: project\n---\n\nbody\n'); utimesSync(join(out12, 'price.md'), t12, t12);
  writeFileSync(join(out12, 'MEMORY.md'), '- [Price](price.md) — p\n'); utimesSync(join(out12, 'MEMORY.md'), t12, t12);
  symlinkSync(out12, join(root12, 'C--ext', 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
  process.env.HOME = h12; process.env.USERPROFILE = h12;
  let doc12;
  try {
    spawnSync(process.execPath, [TOOL], { encoding: 'utf8' });
    doc12 = spawnSync(process.execPath, [join(dirname(TOOL), 'memory.mjs'), 'doctor', '--store', join(root12, 'C--ext', 'memory')], { encoding: 'utf8', cwd: h12 }).stdout;
  } finally { process.env.HOME = was[0]; process.env.USERPROFILE = was[1]; }
  const files12 = spawnSync('git', ['-C', root12, 'ls-files'], { encoding: 'utf8' }).stdout;
  const sh12 = JSON.parse(readFileSync(join(root12, '.snapshot-health'), 'utf8'));
  ok(!/C--ext/.test(readFileSync(join(root12, '.gitignore'), 'utf8')), 'a store linked outside the root is not ignored as a second path');
  const tracked12 = /C--ext\/memory\/price\.md/.test(files12);
  ok(process.platform !== 'win32' || tracked12, `a junction outside the root is snapshotted on Windows (got ${files12})`);
  ok(tracked12 ? !sh12.missed && !/leave out/.test(doc12) : sh12.missed?.length === 1 && /PROBLEM\s+snapshots: ok, last [^\n]*but they leave out [^\n]*C--ext/.test(doc12),
    `a store the snapshot cannot reach is said to be left out (got ${JSON.stringify(sh12)} / ${doc12})`);
}

// Round 6. Two links to one folder elsewhere: its notes are in the history once.
{
  const was = [process.env.HOME, process.env.USERPROFILE];
  const h18 = tempDir('memtier-twolinks-'), root18 = join(h18, '.claude', 'projects'), out18 = join(h18, 'Synced', 'memory');
  mkdirSync(out18, { recursive: true });
  const t18 = new Date(Date.now() - 10 * 60000);
  writeFileSync(join(out18, 'price.md'), '---\nname: price\ndescription: "p"\nmetadata:\n  type: project\n---\n\nbody\n'); utimesSync(join(out18, 'price.md'), t18, t18);
  writeFileSync(join(out18, 'MEMORY.md'), '- [Price](price.md) — p\n'); utimesSync(join(out18, 'MEMORY.md'), t18, t18);
  for (const p of ['C--a18', 'C--b18']) { mkdirSync(join(root18, p), { recursive: true }); symlinkSync(out18, join(root18, p, 'memory'), process.platform === 'win32' ? 'junction' : 'dir'); }
  process.env.HOME = h18; process.env.USERPROFILE = h18;
  try { spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }); } finally { process.env.HOME = was[0]; process.env.USERPROFILE = was[1]; }
  const n18 = spawnSync('git', ['-C', root18, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => l.endsWith('/price.md')).length;
  ok(process.platform === 'win32' ? n18 === 1 : n18 <= 1, `two links to one folder elsewhere: its notes in the history once (got ${n18})`);
}

// The Stop imports a conversation still on disk, quiet for a month, into the journal.
{
  const pb = join(root, 'proj-backfill'), was = join(pb, 'was.jsonl'), now = join(pb, 'now.jsonl'), jd = join(pb, 'memory', 'journal');
  const turn = (ask, ts) => [{ type: 'user', timestamp: ts, message: { content: ask } },
    { type: 'assistant', timestamp: ts, message: { content: [{ type: 'text', text: 'answered' }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n';
  mkdirSync(pb); writeFileSync(was, turn('asked last month', '2026-09-28T09:00:00Z')); writeFileSync(now, turn('asked now', '2026-10-28T09:00:00Z'));
  const month = new Date(Date.now() - 30 * 86400e3); utimesSync(was, month, month);
  spawnSync(process.execPath, [TOOL, '--stop'], { env, input: JSON.stringify({ transcript_path: now, session_id: 'now' }) });
  const all = (existsSync(jd) ? readdirSync(jd).filter((f) => f.endsWith('.md')) : []).map((f) => readFileSync(join(jd, f), 'utf8')).join();
  ok(all.includes('asked last month') && all.includes('asked now'), `--stop: the Stop backfills the journal (got ${all.length} chars)`);
}

// A journal day is committed once it is over, never while it is today's.
{
  const { local } = await import('./store.mjs');
  const today = local().slice(0, 10), yesterday = local(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 1, 12)).slice(0, 10);   // noon: DST-safe
  const jd = join(root, 'proj-one', 'memory', 'journal'), rel = (d) => `proj-one/memory/journal/${d}.md`;
  mkdirSync(jd, { recursive: true });
  writeFileSync(join(jd, `${yesterday}.md`), `# Journal ${yesterday}\n`); writeFileSync(join(jd, `${today}.md`), `# Journal ${today}\n`);
  plain();
  ok(tracked().includes(rel(yesterday)) && !tracked().includes(rel(today)), `a closed journal day is committed, today's is not (tracked: ${tracked().filter((f) => f.includes('journal')).join(', ')})`);
  // The day rolled over mid-run: what was committed as a closed day is today's again.
  git('add', '-f', rel(today)); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'rolled');
  writeFileSync(join(root, '.gitignore'), readFileSync(join(root, '.gitignore'), 'utf8').replace(`*/memory/journal/${today}.md\n`, ''));
  plain();
  ok(!tracked().includes(rel(today)) && tracked().includes(rel(yesterday)), `today's journal leaves the snapshots even once committed (tracked: ${tracked().filter((f) => f.includes('journal')).join(', ')})`);
}

// The journal is pinned by its own line and its folder is no note.
{
  const jm = tempDir('memtier-journal-');
  mkdirSync(join(jm, 'journal'));
  writeFileSync(join(jm, 'journal', '2026-10-27.md'), '# Journal 2026-10-27\n');
  writeFileSync(join(jm, 'MEMORY.md'), '# Index\n');
  writeFileSync(join(jm, 'journal.md'), '---\nname: journal\ndescription: "Every exchange"\nmetadata:\n  node_type: memory\n  type: reference\n  tier: hot\n---\n\nbody\n');
  const at = statSync(join(jm, 'journal.md')).mtimeMs, tierAt = (ms) => execFileSync(process.execPath, [TOOL, '--dir', jm, '--now', String(ms)], { encoding: 'utf8' });
  tierAt(at + 3 * 60000);
  const pinned = (f) => readFileSync(join(jm, f), 'utf8').split('\n').filter((l) => l.includes('](journal.md)'));
  ok(pinned('MEMORY.md').length === 1, `journal.md gets a pinned index line (got ${JSON.stringify(pinned('MEMORY.md'))})`);
  tierAt(at + 30 * 86400e3);
  ok(pinned('MEMORY.md').length === 1 && pinned('MEMORY-archive.md').length === 0, 'and it stays after 30 days');
  const health = existsSync(join(jm, '.health')) ? readFileSync(join(jm, '.health'), 'utf8') : '';
  ok(!/journal/.test(health) && !/\]\(journal\)/.test(readFileSync(join(jm, 'MEMORY-archive.md'), 'utf8')), `the journal folder is no note (health: ${health.trim()})`);
}

// A journal.mjs that cannot load costs the journal, never the handoff.
{
  const was = [process.env.HOME, process.env.USERPROFILE];
  const hj = tempDir('memtier-nojournal-'), pj = join(hj, '.claude', 'projects', 'C--nj'), copy = tempDir('nojournal-'), tj = join(pj, 'nj.jsonl');
  for (const f of ['memory-tier.mjs', 'store.mjs', 'compact-gate.mjs', 'handoff-log.mjs']) copyFileSync(tool(f), join(copy, f));
  writeFileSync(join(copy, 'journal.mjs'), 'this is not javascript (');
  mkdirSync(pj, { recursive: true });
  writeFileSync(tj, [{ type: 'user', timestamp: '2026-10-28T09:00:00Z', message: { content: 'asked with no journal' } },
    { type: 'assistant', timestamp: '2026-10-28T09:01:00Z', message: { content: [{ type: 'text', text: 'answered' }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  process.env.HOME = hj; process.env.USERPROFILE = hj;
  try { spawnSync(process.execPath, [join(copy, 'memory-tier.mjs'), '--stop'], { input: JSON.stringify({ transcript_path: tj, session_id: 'nojournl' }) }); }
  finally { process.env.HOME = was[0]; process.env.USERPROFILE = was[1]; }
  let hd = ''; try { hd = readFileSync(join(pj, 'memory', 'handoff.md'), 'utf8'); } catch {}
  ok(hd.includes('asked with no journal'), '--stop: a journal.mjs that cannot load leaves the handoff written');
}

// Nothing due to import (a look within the half hour): the Stop does not try
// the store's lock for it. Under contention it waited for the lock a second
// time to learn there was nothing to do (4.2 s, P1 hunt, 2026-10-29). Seen
// without a clock (a timed bound flips under the mutation run's load): a
// killed hook's stale lock goes only when a hook tries the lock. The
// transcript is gone, so the handoff tries none.
{
  const pw = join(root, 'C--lockwait'), dw = join(pw, 'memory'), lock = join(dw, '.lock'), left = join(lock, 'left-by-a-killed-hook');
  mkdirSync(join(dw, 'journal'), { recursive: true });
  const stopWith = (looked) => {
    mkdirSync(lock, { recursive: true }); writeFileSync(left, '');
    const old = new Date(Date.now() - 120_000); utimesSync(lock, old, old);
    writeFileSync(join(dw, 'journal', '.looked'), String(looked));
    spawnSync(process.execPath, [TOOL, '--stop'], { env, input: JSON.stringify({ cwd: 'C:\\nowhere', transcript_path: join(pw, 'gone.jsonl'), session_id: 'lockwait', hook_event_name: 'Stop' }) });
    return existsSync(left);
  };
  const notDue = stopWith(Date.now()), wasDue = stopWith(Date.now() - 3600e3);
  rmSync(lock, { recursive: true, force: true });
  ok(notDue && !wasDue, `with nothing due, a Stop does not try the store's lock for the import; with a look due it does (kept ${notDue}, ${wasDue})`);
}

// The nudge's reader gone before it is written: exit 0. Thrown with no
// listener, the pipe's EPIPE made the Stop exit 1 (P1 hunt, 2026-10-29).
{
  const { TRIGGER, WINDOW } = await import('./compact-gate.mjs');
  const pe = join(root, 'C--epipe'), te = join(pe, 'epipe.jsonl'), ctx = Math.round(TRIGGER * WINDOW) + 5000;
  mkdirSync(pe, { recursive: true });
  writeFileSync(te, [{ type: 'user', timestamp: '2026-10-28T09:00:00Z', message: { content: 'go' } },
    { type: 'assistant', timestamp: '2026-10-28T09:01:00Z', message: { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
      usage: { input_tokens: 3, cache_read_input_tokens: ctx - 3, cache_creation_input_tokens: 0, output_tokens: 9 } } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const nudged = spawnSync(process.execPath, [TOOL, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ cwd: 'C:\\nowhere', transcript_path: te, session_id: 'epipe001', hook_event_name: 'Stop' }) });
  const code = await new Promise((done) => {
    const c = spawn(process.execPath, [TOOL, '--stop'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    c.stdout.destroy();
    c.on('exit', done);
    c.stdin.end(JSON.stringify({ cwd: 'C:\\nowhere', transcript_path: te, session_id: 'epipe002', hook_event_name: 'Stop' }));
  });
  ok(/compaction gate/.test(nudged.stdout) && code === 0, `a Stop whose nudge has no reader left exits 0 (got ${code}; ${nudged.stdout.slice(0, 60)})`);
}

// --- the automatic mutants: edges, exact sizes and failures made on purpose -----
// Each check below sits on one line's boundary or one failing call, where the
// real code and its one-character break give the same answer almost everywhere.
{
  const DAY = 86400000;
  const bytesOf = (s) => Buffer.byteLength(s);
  const readOr = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
  const asHome = (h, fn) => {
    const was = [process.env.HOME, process.env.USERPROFILE];
    process.env.HOME = h; process.env.USERPROFILE = h;
    try { return fn(); } finally { process.env.HOME = was[0]; process.env.USERPROFILE = was[1]; }
  };
  const tierDir = (d, ...a) => spawnSync(process.execPath, [TOOL, '--dir', d, ...a], { encoding: 'utf8' });
  const writeNote = (d, name, { type = 'project', tier, modified, when = tenMin } = {}) => {
    writeFileSync(join(d, `${name}.md`), `---\nname: ${name}\ndescription: "${name}"\nmetadata:\n  type: ${type}${tier ? `\n  tier: ${tier}` : ''}${modified ? `\n  modified: ${modified}` : ''}\n---\n\nbody\n`);
    utimesSync(join(d, `${name}.md`), when, when);
  };
  const scratch = tempDir('memtier-edges-');
  const preload = (name, src) => { const f = join(scratch, name); writeFileSync(f, src); return f; };
  const withPreload = (f, args) => spawnSync(process.execPath, ['--require', f, TOOL, ...args], { encoding: 'utf8' });

  // The windows are exact, and --now is the clock: an event log is hot for three
  // days, any other note for seven since its stamp, a pointer or a memory is the
  // writer's for two minutes. One millisecond inside keeps, the edge itself does not.
  const hotAt = (note, nowMs) => {
    const d = tempDir('memtier-edge-');
    writeNote(d, note.name, note);
    writeFileSync(join(d, 'MEMORY.md'), `- [${note.name}](${note.name}.md) — hook\n`);
    tierDir(d, '--now', String(nowMs));
    return readOr(join(d, 'MEMORY.md')).includes(`(${note.name}.md)`);
  };
  const logDay = Date.parse('2026-01-10'), stamped = '2026-02-01T00:00:00.000Z';
  ok(hotAt({ name: 'log-2026-01-10' }, logDay + 3 * DAY - 1), 'an event log is still hot a millisecond before its third day is out');
  ok(!hotAt({ name: 'log-2026-01-10' }, logDay + 3 * DAY), 'and archived when the third day is out');
  ok(hotAt({ name: 'seen', modified: stamped }, Date.parse(stamped) + 7 * DAY - 1), 'a note is still hot a millisecond before its seventh day is out');
  ok(!hotAt({ name: 'seen', modified: stamped }, Date.parse(stamped) + 7 * DAY), 'and archived when the seventh day is out');

  const whole = Math.floor(Date.now() / 1000) * 1000 - 600000, wholeAt = new Date(whole);   // to the second: the mtime is read back exact
  const ghost = (nowMs) => {
    const d = tempDir('memtier-ghost-');
    writeFileSync(join(d, 'MEMORY.md'), '- [Ghost](ghost.md) — gone\n');
    utimesSync(join(d, 'MEMORY.md'), wholeAt, wholeAt);
    tierDir(d, '--now', String(nowMs));
    return readOr(join(d, '.health'));
  };
  ok(!/ghost\.md/.test(ghost(whole + 119999)), 'a pointer with no file, in an index a millisecond short of two minutes old, is its writer\'s');
  ok(/pointers with no file: ghost\.md/.test(ghost(whole + 120000)), 'and a problem when the index is two minutes old');
  const orphaned = (nowMs) => {
    const d = tempDir('memtier-orphan-');
    writeFileSync(join(d, 'MEMORY.md'), '# Index\n');
    utimesSync(join(d, 'MEMORY.md'), wholeAt, wholeAt);
    writeNote(d, 'orphan', { when: wholeAt });
    const r = tierDir(d, '--now', String(nowMs));
    return { out: r.stdout, arc: readOr(join(d, 'MEMORY-archive.md')) };
  };
  const young = orphaned(whole + 119999), old = orphaned(whole + 120000);
  ok(!/orphan\.md/.test(young.out + young.arc), 'a memory with no pointer, a millisecond short of two minutes old, is left for its writer');
  ok(/pointers recovered: orphan\.md/.test(old.out) && /\]\(orphan\.md\)/.test(old.arc), 'and recovered, and said so, at two minutes');

  // Prose is kept as written: one blank line stays, a run of them is one.
  {
    const d = tempDir('memtier-prose2-');
    writeNote(d, 'a');
    writeFileSync(join(d, 'MEMORY.md'), '# Index\n\nSome prose\n\n\n- [a](a.md) — a\n');
    tierDir(d);
    ok(readFileSync(join(d, 'MEMORY.md'), 'utf8').startsWith('# Index\n\nSome prose\n- [a](a.md)'), 'the blank line under a heading survives, and a run of blank lines is one');
  }

  // --pause <ms> holds a pass open and says so on stderr: only when asked, and only with a number.
  {
    const d = tempDir('memtier-pause-');
    writeNote(d, 'a'); writeFileSync(join(d, 'MEMORY.md'), '- [a](a.md) — a\n');
    ok(/paused/.test(tierDir(d, '--pause', '1').stderr), '--pause 1 holds the pass open and says paused on stderr');
    ok(!/paused/.test(tierDir(d).stderr), 'a pass with no --pause never pauses');
    ok(!/paused/.test(tierDir(d, '--pause', 'soon').stderr), 'and --pause with no number does not either');
  }

  // An edit landing while a pass is held open (made deterministic: the preload
  // writes it when the pass says paused). The pass stands down, the edit wins.
  const editing = (target, text) => preload(`edit-${bytesOf(target)}-${bytesOf(text)}.cjs`, `const fs = require('node:fs'), write = fs.writeSync;
fs.writeSync = (fd, ...a) => {
  if (fd === 2 && String(a[0]).startsWith('paused')) fs.appendFileSync(${JSON.stringify(target)}, ${JSON.stringify(text)});
  return write(fd, ...a);
};
require('node:module').syncBuiltinESMExports();
`);
  {
    const d = tempDir('memtier-conflict-');
    writeNote(d, 'stale-one', { modified: iso(90) }); writeNote(d, 'fresh-one', { modified: iso(1) });
    writeFileSync(join(d, 'MEMORY.md'), '- [stale](stale-one.md) — old\n- [fresh](fresh-one.md) — new\n');
    const r = withPreload(editing(join(d, 'MEMORY.md'), '- [added](added.md) — by the model\n'), ['--dir', d, '--pause', '1']);
    ok(/changed during the pass/.test(r.stdout) && readFileSync(join(d, 'MEMORY.md'), 'utf8').includes('by the model'), `an index edited during a pass wins, and the pass says it stood down (got ${r.stdout.trim()})`);
  }
  {
    const d = tempDir('memtier-back-');
    writeNote(d, 'pinned', { tier: 'hot' });
    writeFileSync(join(d, 'MEMORY.md'), '# Index\n');
    writeFileSync(join(d, 'MEMORY-archive.md'), '# Archive\n\n- [Pinned](pinned.md) — the hand-written hook\n');
    withPreload(editing(join(d, 'MEMORY.md'), '\nWritten by the model during the pass.\n'), ['--dir', d, '--pause', '1']);
    ok((readOr(join(d, 'MEMORY.md')) + readOr(join(d, 'MEMORY-archive.md'))).includes('- [Pinned](pinned.md) — the hand-written hook'), 'a line coming back from the archive is in one file or the other when the index write conflicts');
  }
  // A pass that changed only the index (the archive already as it would be) still says what it did.
  {
    const d = tempDir('memtier-wrote-');
    writeNote(d, 'only');
    writeFileSync(join(d, 'MEMORY.md'), '- [only](only.md) — hook\n- [Archive](MEMORY-archive.md) — 0 older pointers\n');
    writeFileSync(join(d, 'MEMORY-archive.md'), '# Archive\n');
    const r = tierDir(d);
    ok(/1 hot \/ 0 archived/.test(r.stdout), `a pass that rewrote only the index says so (got ${r.stdout.trim()})`);
  }
  // Conflict markers need both ends: one alone is a line of text.
  for (const [what, body] of [['an opening', '<<<<<<< HEAD'], ['a closing', '>>>>>>> laptop']]) {
    const d = tempDir('memtier-marker-');
    writeNote(d, 'a');
    writeFileSync(join(d, 'MEMORY.md'), `# Index\n${body}\n- [a](a.md) — a\n`);
    tierDir(d);
    ok(!/merge-conflict/.test(readOr(join(d, '.health'))), `${what} marker alone is not an unresolved merge`);
  }

  // The ceiling to the byte. A store of one hundred-byte lines, the last padded so the
  // index is exactly 7000 B plus `over`; `cold` pointers already in the archive.
  const AL = (n) => `- [Archive](MEMORY-archive.md) — ${n} older pointers; grep it before assuming something was never learned`;
  const lineFor = (name, len) => { const head = `- [${name}](${name}.md) — `; return head + 'x'.repeat(len - bytesOf(head)); };
  const settle = (specs, { cold = 0 } = {}) => {
    const d = tempDir('memtier-fit-');
    const ls = specs.map((s) => { writeNote(d, s.name, { type: s.type, tier: s.tier, modified: new Date(Date.now() - s.days * DAY).toISOString() }); return lineFor(s.name, s.len); });
    writeFileSync(join(d, 'MEMORY.md'), [...ls, AL(cold)].join('\n') + '\n');
    if (cold) writeFileSync(join(d, 'MEMORY-archive.md'), ['# Archive', '', ...Array.from({ length: cold }, (_, i) => `- [Old ${i}](old${i}.md) — o`)].join('\n') + '\n');
    const out = tierDir(d).stdout;
    return { d, ls, out, main: readOr(join(d, 'MEMORY.md')), arc: readOr(join(d, 'MEMORY-archive.md')) };
  };
  const fit = (over, cold) => {
    const want = 7000 + over, n = Math.floor((want - bytesOf(AL(cold)) - 1) / 101);
    const total = n * 101 + bytesOf(AL(cold)) + 1;
    const specs = Array.from({ length: n }, (_, i) => ({ name: `c${String(i).padStart(2, '0')}`, days: 3 + (n - i) * 0.001, len: 100 + (i === n - 1 ? want - total : 0) }));
    const s = settle(specs, { cold });
    return { ...s, evicted: (s.arc.match(/<!-- overflow -->/g) || []).length, bytes: bytesOf(s.main) };
  };
  const exact = fit(0, 0);
  ok(exact.bytes === 7000 && exact.evicted === 0 && !existsSync(join(exact.d, '.health')), `an index of exactly 7000 B is within its ceiling: nothing evicted, nothing reported (got ${exact.bytes} B, ${exact.evicted} evicted)`);
  const two = fit(102, 0);
  ok(two.evicted === 2 && two.bytes <= 7000, `a store 102 B over, in lines of 101, loses two (got ${two.evicted}, ${two.bytes} B)`);
  const [was, now2, saved] = /MEMORY\.md (\d+)B -> (\d+)B \(~(-?\d+) tokens/.exec(two.out).slice(1).map(Number);
  ok(was - now2 >= 100 && saved === Math.round((was - now2) / 4), `the tokens saved are a quarter of the bytes (got ${was} -> ${now2}, ~${saved})`);
  const digits = fit(101, 8);
  ok(digits.evicted === 1 && digits.bytes <= 7000, `with eight pointers already archived, 101 B over loses one line, the count's width unchanged (got ${digits.evicted})`);

  // Claude Code loads 200 lines: 198 of prose and a note make exactly 200 with the archive line.
  {
    const d = tempDir('memtier-200-');
    writeNote(d, 'only');
    writeFileSync(join(d, 'MEMORY.md'), Array.from({ length: 198 }, (_, i) => `Line ${i}`).join('\n') + '\n- [only](only.md) — hook\n');
    tierDir(d);
    ok(readFileSync(join(d, 'MEMORY.md'), 'utf8').split('\n').filter(Boolean).length === 200 && !/overflow/.test(readOr(join(d, 'MEMORY-archive.md'))), 'exactly 200 lines is within what Claude Code loads: nothing is evicted');
  }

  // The rule share, to the byte: B = 7000, P = the pinned lines + 1 each, R = the rules'.
  // A rule is evicted ahead of recent work only when R exceeds (B - P) / 2.
  const shared3 = (pinLen, workCount) => {
    const specs = [{ name: 'pin', tier: 'hot', days: 400, len: pinLen },
      ...[0, 1, 2].map((i) => ({ name: `rule-${i}`, type: 'feedback', days: 300 - i * 10, len: 499 })),
      ...Array.from({ length: workCount }, (_, i) => ({ name: `work-${i}`, days: 3 - i * 0.01, len: 499 }))];
    return settle(specs);
  };
  {
    // P = 4000, R = 1500 = (7000 - 4000) / 2: the rules fit their share exactly, and the work goes.
    const s = shared3(3999, 6);
    ok(s.ls.slice(0, 4).every((l) => has(s.main, l)) && bytesOf(s.main) <= 7000 && s.ls.slice(4).some((l) => !has(s.main, l)),
      'rules exactly at their share are kept while older work is evicted, and the pinned line is never counted twice or short');
    // P = 5002: the share is 999 and the rules are 1500: two go (the oldest), the third (1000 > 999 after the first) too.
    const t = shared3(5001, 3);
    ok(has(t.main, t.ls[0]) && !has(t.main, t.ls[1]) && !has(t.main, t.ls[2]) && has(t.main, t.ls[3]),
      `rules over their share go oldest first until the rest fit it, one byte over included (got ${t.main.split('\n').map((l) => l.slice(0, 12)).join('|')})`);
  }

  // --- the snapshot, with a git that fails on purpose ---
  const gitHome = () => {
    const h = tempDir('memtier-gh-'), r = join(h, '.claude', 'projects'), s = join(r, 'C--p', 'memory');
    mkdirSync(s, { recursive: true });
    writeNote(s, 'a'); writeFileSync(join(s, 'MEMORY.md'), '- [a](a.md) — a\n');
    asHome(h, () => spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }));
    writeNote(s, 'b'); writeFileSync(join(s, 'MEMORY.md'), '- [a](a.md) — a\n- [b](b.md) — b\n');
    return { h, r, s };
  };
  const gitPre = (name, hook, log) => preload(name, `const cp = require('node:child_process'), real = cp.execFileSync, fs = require('node:fs');
const hook = ${hook};
cp.execFileSync = (f, a, ...r) => {
  if (f === 'git' && Array.isArray(a)) { fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n'); const e = hook(a); if (e) throw e; }
  return real(f, a, ...r);
};
require('node:module').syncBuiltinESMExports();
`);
  const snapshotWith = (g, file) => asHome(g.h, () => spawnSync(process.execPath, ['--require', file, TOOL], { encoding: 'utf8' })).stdout;
  {
    // The untrack lists what is ignored, one path each, never everything; and it is remembered.
    const g = gitHome(), log = join(scratch, 'rm.log');
    rmSync(join(g.r, '.git', 'project-memory-ignored'), { force: true });
    const out = snapshotWith(g, gitPre('log.cjs', '() => false', log));
    const rm = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.includes('rm'));
    ok(rm.length >= 2 && rm.every((a) => a.at(-1) !== '*' && a.at(-1).startsWith('*/')) && rm.some((a) => a.at(-1) === '*/memory/handoff.md'), `the untrack names each ignored path, never all of them (got ${JSON.stringify(rm.map((a) => a.at(-1)))})`);
    ok(readOr(join(g.r, '.git', 'project-memory-ignored')) === readOr(join(g.r, '.gitignore')) && /committed/.test(out), 'and the run remembers it did it: what it untracked is what .gitignore says');
  }
  {
    // A note deleted between git's listing and its read: one more try, not a failure.
    const g = gitHome();
    const out = snapshotWith(g, gitPre('gone.cjs', `(() => { let n = 0; return (a) => a.includes('add') && a.includes('-A') && n++ === 0 && Object.assign(new Error('Command failed: git add'), { status: 128, stdout: '', stderr: 'error: open("b.md"): No such file or directory\\nfatal: adding files failed\\n' }); })()`, join(scratch, 'gone.log')));
    ok(/memory snapshot: committed/.test(out), `a note that vanished under git's add gets one more try (got ${out.trim()})`);
  }
  {
    // Nothing staged but changes unstaged: another session took what this one staged. Busy, not a failure.
    const g = gitHome();
    const out = snapshotWith(g, gitPre('nochange.cjs', `(a) => a.includes('commit') && Object.assign(new Error('Command failed: git commit'), { status: 1, stdout: 'no changes added to commit (use "git add" and/or "git commit -a")\\n', stderr: '' })`, join(scratch, 'nochange.log')));
    ok(/memory snapshot: busy/.test(out) && !/snapshot failed/.test(out), `a commit with nothing staged is busy (got ${out.trim()})`);
  }
  {
    // A missing file that is not git's spawn is a failure, never "git is not installed".
    const g = gitHome();
    const out = snapshotWith(g, gitPre('enoent.cjs', `(a) => a.includes('commit') && Object.assign(new Error('ENOENT: no such file or directory, open'), { code: 'ENOENT', syscall: 'open' })`, join(scratch, 'enoent.log')));
    ok(/snapshot failed/.test(out) && !/not installed/.test(out), `an ENOENT from somewhere other than git's start is a failed snapshot (got ${out.trim()})`);
  }
  {
    // A lock exactly ten minutes old is dead (the clock held still so "exactly" can be said).
    const g = gitHome(), T = Math.floor(Date.now() / 1000) * 1000, lock = join(g.r, '.git', 'index.lock');
    writeFileSync(lock, '');
    utimesSync(lock, new Date(T - 600000), new Date(T - 600000));
    const clock = preload('clock.cjs', `Date.now = () => ${T};\n`);
    const out = asHome(g.h, () => spawnSync(process.execPath, ['--require', clock, TOOL], { encoding: 'utf8' })).stdout;
    ok(!existsSync(lock) && !/busy/.test(out), `an index.lock ten minutes old to the millisecond is cleared, not waited for (got ${out.trim()})`);
  }
  {
    // A stale lock gone by the time it is unlinked is gone: carry on. Any other failure is not.
    const g = gitHome(), lock = join(g.r, '.git', 'index.lock');
    writeFileSync(lock, '');
    utimesSync(lock, new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));
    const vanish = preload('vanish.cjs', `const fs = require('node:fs'), unlink = fs.unlinkSync;
fs.unlinkSync = (p, ...a) => {
  if (String(p).endsWith('index.lock')) { unlink(p, ...a); throw Object.assign(new Error('ENOENT: no such file or directory, unlink'), { code: 'ENOENT' }); }
  return unlink(p, ...a);
};
require('node:module').syncBuiltinESMExports();
`);
    const out = asHome(g.h, () => spawnSync(process.execPath, ['--require', vanish, TOOL], { encoding: 'utf8' })).stdout;
    ok(/memory snapshot: committed/.test(out), `a stale lock that vanishes before it is removed does not stop the snapshot (got ${out.trim()})`);
  }
  {
    // What git cannot reach is said: a store linked from outside the root, with git unable to list it.
    // Stores inside the root are never "missed", and a failed listing counts as missed.
    const g = gitHome(), outside = join(g.h, 'Synced', 'memory');
    mkdirSync(outside, { recursive: true });
    writeNote(outside, 'p'); writeFileSync(join(outside, 'MEMORY.md'), '- [p](p.md) — p\n');
    mkdirSync(join(g.r, 'C--ext'));
    symlinkSync(outside, join(g.r, 'C--ext', 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
    snapshotWith(g, gitPre('lsfiles.cjs', `(a) => a.includes('ls-files') && Object.assign(new Error('Command failed: git ls-files'), { status: 128, stdout: '', stderr: 'fatal: boom' })`, join(scratch, 'ls.log')));
    const missed = JSON.parse(readFileSync(join(g.r, '.snapshot-health'), 'utf8')).missed;
    ok(Array.isArray(missed) && missed.length === 1 && /C--ext/.test(missed[0]), `only the store outside the root is missed when git cannot list it (got ${JSON.stringify(missed)})`);
  }
  {
    // A store whose real path cannot be read at that moment is not one git missed.
    const g = gitHome(), target = join('C--p', 'memory');
    const vanish = preload('realpath.cjs', `const cp = require('node:child_process'), fs = require('node:fs'), exec = cp.execFileSync, real = fs.realpathSync;
let armed = false, n = 0;
cp.execFileSync = (f, a, ...r) => { if (f === 'git' && Array.isArray(a) && a.includes('add')) armed = true; return exec(f, a, ...r); };
const rp = (p, ...a) => { if (armed && String(p).endsWith(${JSON.stringify(target)}) && ++n === 2) throw Object.assign(new Error('ENOENT: no such file or directory, realpath'), { code: 'ENOENT' }); return real(p, ...a); };
rp.native = real.native; fs.realpathSync = rp;
require('node:module').syncBuiltinESMExports();
`);
    asHome(g.h, () => spawnSync(process.execPath, ['--require', vanish, TOOL], { encoding: 'utf8' }));
    const sh9 = JSON.parse(readFileSync(join(g.r, '.snapshot-health'), 'utf8'));
    ok(!sh9.missed && sh9.failures === 0, `a store whose path cannot be resolved is not "missed" by the snapshot (got ${JSON.stringify(sh9)})`);
  }

  // Where a run writes outside its stores: a dry run, and one on a single --dir, never start a history.
  {
    const h = tempDir('memtier-nohist-'), r = join(h, '.claude', 'projects'), s = join(r, 'C--q', 'memory');
    mkdirSync(s, { recursive: true });
    writeNote(s, 'a'); writeFileSync(join(s, 'MEMORY.md'), '- [a](a.md) — a\n');
    asHome(h, () => spawnSync(process.execPath, [TOOL, '--dry-run'], { encoding: 'utf8' }));
    ok(!existsSync(join(r, '.git')), 'a dry run starts no history');
    asHome(h, () => spawnSync(process.execPath, [TOOL, '--dir', s], { encoding: 'utf8' }));
    ok(!existsSync(join(r, '.git')), 'a run on one --dir starts no history');
    asHome(h, () => spawnSync(process.execPath, [TOOL], { encoding: 'utf8' }));
    ok(existsSync(join(r, '.git')), 'a run over every store does');
  }

  // --dir with no path says so and fails.
  {
    const r = spawnSync(process.execPath, [TOOL, '--dir'], { encoding: 'utf8' });
    ok(r.status === 1 && /--dir needs a path/.test(r.stdout), `--dir with no path exits 1 and says what it needs (got ${r.status}: ${r.stdout.trim()})`);
  }

  // The Stop's gate fingerprints notes, not the handoff: a handoff rewritten alone is no change to look at.
  {
    const d = store('proj-gate'), gateStamp = () => readOr(join(d, '.tiered'));
    for (const f of ['a.md', 'MEMORY.md']) utimesSync(join(d, f), tenMin, tenMin);
    writeFileSync(join(root, 'proj-gate', 'session.jsonl'), '');
    let last = null;
    for (let i = 0; i < 5 && gateStamp() !== last; i++) { last = gateStamp(); stop('proj-gate'); }
    const settled = gateStamp();
    writeFileSync(join(d, 'handoff.md'), `---\nname: handoff\n---\nrewritten alone ${Date.now()}\n`);
    stop('proj-gate');
    ok(settled !== '' && gateStamp() === settled, '--stop: a store whose only change is its handoff is not tiered again');
  }

  // The run log: the conversation is named by its first eight characters, and the log is
  // trimmed only past 8 KB (8192 B itself stays).
  {
    const ran = join(root, '.stop-ran'), payload = { transcript_path: join(root, 'proj-one', 'session.jsonl'), session_id: 'abcdefghijkl', hook_event_name: 'Stop', stop_hook_active: true };
    const stopRan = () => spawnSync(process.execPath, [TOOL, '--stop'], { env, encoding: 'utf8', input: JSON.stringify(payload) });
    stopRan();
    const lineBytes = bytesOf(runLines().at(-1)) + 1;
    ok(JSON.parse(runLines().at(-1)).s === 'abcdefgh', `--stop: the run log names a conversation by its first eight characters (got ${runLines().at(-1)})`);
    const fill = 8192 - lineBytes, whole100 = Math.floor(fill / 100) - 1, rest = fill - whole100 * 100;
    writeFileSync(ran, ('j'.repeat(99) + '\n').repeat(whole100) + 'j'.repeat(rest - 1) + '\n');
    stopRan();
    ok(statSync(ran).size === 8192, `--stop: a run log of exactly 8192 B is not trimmed (got ${statSync(ran).size} B)`);
  }
}

rmSync(home, { recursive: true, force: true });
console.log(`memory-tier: ${checks} checks passed`);
