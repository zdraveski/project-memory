// Self-check for store.mjs: whose store a payload names, a lock two processes
// never hold at once, a dead lock taken over, a held one given up on, and a
// replace that will not overwrite a write it did not see. Run: node store.test.mjs
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, rmdirSync, rmSync, readdirSync, symlinkSync, chmodSync, statSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { join, isAbsolute, basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import { tool, tempHome, quick, fastClock, slug } from './harness.mjs';

const { home, env } = tempHome('store-test-');
const { storeOf, withLock, replaceIfUnchanged, sharedStore, isShared, budgetOf, local, front, frontEnd, isIndex, reason, allStores, pointerLine, POINTER, inProjects, transcriptKey, listOf, opener, same, sleep, lockBudget, sweepTemps, appendCapped, keyed, offSince, tag, indexLines, eolOf, wraps, archiveLine, emptyArchive, mark, unmark } = await import('../src/store.mjs'), { gitWhy } = await import('../src/snapshot.mjs'), { wasOff, OFF_PERIODS } = await import('../src/privacy.mjs');
// A test that sets TZ puts back this: assigning, because deleting TZ leaves the zone on the last one set (Node 24 on Windows).
const TZ0 = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const root = join(home, '.claude', 'projects');
const proj = join(root, 'C--some-project');
const dir = join(proj, 'memory');
mkdirSync(dir, { recursive: true });

// 1. Whose store: the transcript's project folder, not wherever the cwd went.
ok(storeOf({ cwd: 'C:\\elsewhere\\other', transcript_path: join(proj, 'abc.jsonl') }) === dir, 'the transcript names the store, not the cwd');
// Windows paths ignore case; elsewhere another case is another folder.
if (process.platform === 'win32') ok(storeOf({ cwd: 'C:\\elsewhere\\other', transcript_path: join(proj, 'abc.jsonl').replace(/\\/g, '/').toUpperCase() }).toLowerCase() === dir.toLowerCase(),
  'forward slashes and another letter case in the transcript path still find it');
ok(storeOf({ cwd: 'C:\\elsewhere\\other' }) === join(root, 'C--elsewhere-other', 'memory'), 'no transcript: the cwd slug');
ok(storeOf({ cwd: 'C:\\x', transcript_path: join(home, 'loose.jsonl') }) === join(root, 'C--x', 'memory'), 'a transcript outside the projects folder: the cwd slug');
// No cwd can name the shared store: a slug is letters, digits and `-`.
ok(sharedStore() === join(root, '_shared', 'memory') && isShared(join(root, '_shared', 'memory', '.')) && !isShared(storeOf({ cwd: 'C:\\_shared' })),
  'the shared store is its own folder, and no cwd maps to it');
ok(budgetOf(sharedStore()) === 3000 && budgetOf(dir) === 7000, 'the shared index has the smaller budget, every other store the 7000 B one');
// The hand-made local time is the string the locale API gave, DST changes and all.
const times = ['2026-03-29T00:59:59Z', '2026-03-29T01:00:00Z', '2026-10-25T00:59:59Z', '2026-10-25T01:00:00Z', '2026-01-05T09:03:00Z', '1999-12-31T23:59:59Z'];
for (let i = 0; i < 200; i++) times.push(1.6e12 + i * 7_919_351_117);
ok(times.every((t) => local(t) === new Date(t).toLocaleString('sv-SE').slice(0, 16)), 'local() is the sv-SE local time it replaced');
// One reading of a memory's frontmatter for the tiering, the CLI and promote.
const fm = front('---\nname: a-note\ndescription: "says \\"gaps\\" here"\nmetadata:\n  type: feedback\n  tier: hot\n  modified: 2026-01-02T03:04:05Z\n---\nbody');
ok(fm.name === 'a-note' && fm.desc === 'says "gaps" here' && fm.type === 'feedback' && fm.tier === 'hot' && fm.modified === Date.parse('2026-01-02T03:04:05Z')
  && Number.isNaN(front('no frontmatter').modified), 'front() reads the name, the description unescaped, the type, the tier and the stamp');
ok(front('---\nname: old\nmetadata:\n  tier: hot\n  superseded-by: "new.md"\n---\n').tier === 'archive' && front('---\nsuperseded-by: new.md\n---').superseded === 'new.md',
  'a memory a newer one replaced reads as archived, even pinned hot, and names its replacement');
// git's own reason, not a warning before it, nor the "Command failed" line.
ok(gitWhy({ stderr: 'warning: no corresponding .pack: x.idx\nfatal: the real reason\n', message: 'Command failed: git add' }) === 'fatal: the real reason'
  && gitWhy({ stderr: '', message: 'Command failed: git x\nmore' }) === 'Command failed: git x', "gitWhy() is stderr's first line that is not a warning");
// A write that failed names its temp file in the message (EPERM ... open '.gitignore.tmp4242'): the temp name is noise, as memory.mjs strips it from a failed path.
ok(gitWhy({ message: String.raw`EPERM: operation not permitted, open 'C:\p\.gitignore.tmp4242'` }) === String.raw`EPERM: operation not permitted, open 'C:\p\.gitignore'`, "gitWhy() does not name a .tmp<pid> file");
// Each store once: a project whose memory is a junction to another's is one store.
const realStore = join(root, 'C--real', 'memory');
mkdirSync(realStore, { recursive: true });
writeFileSync(join(realStore, 'MEMORY.md'), '');
mkdirSync(join(root, 'C--via-junction'));
symlinkSync(realStore, join(root, 'C--via-junction', 'memory'), 'junction');
ok(allStores().filter((d) => /C--(real|via-junction)/.test(d)).length === 1, 'allStores() lists a store reached by two paths once');
// Round 6. On Windows, two links to one folder spelt in two cases are one store,
// as the snapshot reads them: listed twice, doctor said one was left out.
if (process.platform === 'win32') {
  const out19 = join(home, 'Synced19', 'memory'); mkdirSync(out19, { recursive: true }); writeFileSync(join(out19, 'MEMORY.md'), '');
  mkdirSync(join(root, 'C--a19')); mkdirSync(join(root, 'C--b19'));
  symlinkSync(out19, join(root, 'C--a19', 'memory'), 'junction');
  symlinkSync(join(home, 'SYNCED19', 'MEMORY'), join(root, 'C--b19', 'memory'), 'junction');
  ok(allStores().filter((d) => /C--[ab]19/.test(d)).length === 1, 'two links to one folder spelt in two cases are one store');
}

// A held lock is given up on, not spun on. In a child on a fast clock, so a loop that never ends fails here in seconds, not by
// the suite's own time-out (a catch that swallowed every refusal did that).
{
  const lk = join(dir, '.lock');
  mkdirSync(lk);
  const child = `
import { withLock } from ${JSON.stringify(pathToFileURL(tool('src/store.mjs')).href)};
let t = Date.now(); Date.now = () => (t += 500);
process.stdout.write(String(withLock(process.argv[1], () => 'got')));
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', child, dir], { timeout: 8000, encoding: 'utf8' });
  ok(r.stdout === 'null' && existsSync(lk), `a held lock is given up on by a process of its own (got ${r.stdout || r.signal})`);
  rmdirSync(lk);
}

// 2. Six processes contend for one store: never two inside at once.
if (!quick) {
  const log = join(home, 'lock.log');
  writeFileSync(log, '');
  const child = `
import { withLock } from ${JSON.stringify(pathToFileURL(tool('src/store.mjs')).href)};
import { appendFileSync } from 'node:fs';
const [log, dir] = process.argv.slice(1);
const r = withLock(dir, () => { appendFileSync(log, 'in\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80); appendFileSync(log, 'out\\n'); return 'done'; });
process.stdout.write(String(r));
`;
  const outs = await Promise.all(Array.from({ length: 6 }, () => new Promise((res) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', child, log, dir], { env });
    let o = ''; p.stdout.on('data', (d) => { o += d; }); p.on('close', () => res(o));
  })));
  ok(outs.every((o) => o === 'done'), `every contender got the lock within its wait (got ${outs.join(',')})`);
  ok(readFileSync(log, 'utf8') === 'in\nout\n'.repeat(6), 'and no two were inside at once');
  ok(!existsSync(join(dir, '.lock')), 'the lock is gone when the last one leaves');
}

// 3. A lock a killed hook left behind is taken over; a live one is waited on, then given up.
mkdirSync(join(dir, '.lock'));
const old = new Date(Date.now() - 60_000);
utimesSync(join(dir, '.lock'), old, old);
ok(withLock(dir, () => 'got') === 'got' && !existsSync(join(dir, '.lock')), 'a lock older than 30 s is taken over');
if (!quick) {
  mkdirSync(join(dir, '.lock'));
  const t0 = Date.now();
  ok(withLock(dir, () => 'got') === null && Date.now() - t0 >= 1900, 'a held lock is given up on after about 2 s, with null');
  rmdirSync(join(dir, '.lock'));
}
// The same wait on a fast clock, which a run under --mutant sees too.
mkdirSync(join(dir, '.lock'));
const gaveUp = fastClock(() => withLock(dir, () => 'got'));
ok(gaveUp === null && existsSync(join(dir, '.lock')), `a held lock is given up on when the wait is up, and the holder's lock kept (got ${gaveUp})`);
// One wait for a whole hook run (lockBudget): a Stop takes up to four locks, and with another hook holding them each waited 2 s
// of its own, 8 s in all (audit H-F2). Spent on the first, a second held lock is tried once; a free one is still taken.
{
  const other = join(proj, 'other');
  mkdirSync(join(other, '.lock'), { recursive: true });
  const tries = (on, first = dir) => {
    let n = 0; const real = fs.mkdirSync;
    fs.mkdirSync = function (p, ...a) { if (String(p) === join(other, '.lock')) n++; return real.call(this, p, ...a); }; syncBuiltinESMExports();
    lockBudget(on);
    try { fastClock(() => { withLock(first, () => 'got'); withLock(other, () => 'got'); }); } finally { lockBudget(false); fs.mkdirSync = real; syncBuiltinESMExports(); }
    return n;
  };
  const alone = tries(false), shared = tries(true);
  ok(shared === 1 && alone > 1, `a hook's second held lock, its wait spent on the first, is tried once (${shared}; ${alone} with a wait of its own)`);
  // A free lock spends only the time it took: the next held lock is still waited on, for what is left.
  const free = join(proj, 'free'); mkdirSync(free, { recursive: true });
  const afterFree = tries(true, free);
  ok(afterFree > 1 && afterFree < alone, `a free lock leaves most of the wait for the next held one (${afterFree} tries; ${alone} with a wait of its own)`);
  rmSync(free, { recursive: true, force: true });
  rmdirSync(join(other, '.lock'));
  lockBudget(true);
  try { fastClock(() => withLock(dir, () => 'got')); ok(fastClock(() => withLock(other, () => 'got')) === 'got', 'and a free lock is taken with no wait left'); } finally { lockBudget(false); }
  rmSync(other, { recursive: true, force: true });
}
rmdirSync(join(dir, '.lock'));
let threw = false;
try { withLock(dir, () => { throw new Error('boom'); }); } catch { threw = true; }
ok(threw && !existsSync(join(dir, '.lock')), 'a throw inside still releases the lock');
// A holder whose lock was taken over while it ran (it outlived LOCK_STALE) leaves the new holder's lock alone: released by
// path, it removed it, and a third hook went in beside the second (audit D-2).
{
  const lk = join(dir, '.lock');
  withLock(dir, () => { rmSync(lk, { recursive: true }); mkdirSync(lk); writeFileSync(join(lk, 'owner'), 'another'); });
  ok(existsSync(lk), 'a lock taken over meanwhile is not removed by the old holder');
  rmSync(lk, { recursive: true });
}

// A fresh lock whose owner process is gone (a killed Stop) is taken over at once: waited on until LOCK_STALE, every Stop in
// the project for 30 s waited 5 s, saved nothing and blamed another session (1.6.1). A waiter can read the owner of a lock
// being released and then rename the next holder's live lock away (1.3.3): one whose owner changed meanwhile is put back.
{
  const lk = join(dir, '.lock'), gone = spawnSync(process.execPath, ['-e', '0']).pid;
  const plant = (token) => { mkdirSync(lk); if (token) writeFileSync(join(lk, 'owner'), token); };
  plant(`${gone}.abc`);
  ok(withLock(dir, () => 'got') === 'got' && !existsSync(lk), 'a fresh lock of a dead process is taken over');
  ok(!readdirSync(dir).some((f) => f.startsWith('.lock.dead')), 'and leaves no renamed copy behind');
  plant(`${gone}.abc`);
  const real = fs.renameSync;
  fs.renameSync = function (a, b, ...r) { if (String(a) === lk) writeFileSync(join(lk, 'owner'), `${process.pid}.next`); return real.call(this, a, b, ...r); }; syncBuiltinESMExports();
  let got; try { got = fastClock(() => withLock(dir, () => 'got')); } finally { fs.renameSync = real; syncBuiltinESMExports(); }
  ok(got === null && readFileSync(join(lk, 'owner'), 'utf8') === `${process.pid}.next`, `a lock whose owner changed before the takeover is put back (got ${got})`);
  rmSync(lk, { recursive: true });
  plant(`${process.pid}.abc`);
  ok(fastClock(() => withLock(dir, () => 'got')) === null && existsSync(lk), 'a fresh lock of a live process is waited on');
  rmSync(lk, { recursive: true });
  plant('another');
  ok(fastClock(() => withLock(dir, () => 'got')) === null && existsSync(lk), 'and one whose owner cannot be read as a pid');
  rmSync(lk, { recursive: true });
}
// A dead lock of any shape is taken over: a file, or a folder with something
// in it, was never removed, and the store was never tiered again, in silence
// (final review, 2026-10-26).
const backdateLock = () => utimesSync(join(dir, '.lock'), old, old);
writeFileSync(join(dir, '.lock'), '');
backdateLock();
ok(withLock(dir, () => 'got') === 'got', 'a dead lock that is a file is taken over');
mkdirSync(join(dir, '.lock'));
writeFileSync(join(dir, '.lock', 'left'), '');
backdateLock();
ok(withLock(dir, () => 'got') === 'got', 'and one that is a folder with something in it');
// Two waiters that both saw the same stale lock: only the one whose rename wins takes it over, and the other
// never deletes the lock the first made (audit #4). `other` plays the first waiter, just before our rename.
{
  const lock = join(dir, '.lock'), real = fs.renameSync;
  const race = (otherTakes) => {
    mkdirSync(lock); backdateLock();
    let n = 0;
    fs.renameSync = function (a, b, ...r) {
      if (String(a) === lock && ++n === 1) { real.call(this, a, `${lock}.dead.other`); rmSync(`${lock}.dead.other`, { recursive: true }); if (otherTakes) mkdirSync(lock); }
      return real.call(this, a, b, ...r);
    }; syncBuiltinESMExports();
    try { return { got: fastClock(() => withLock(dir, () => 'got')), n }; } finally { fs.renameSync = real; syncBuiltinESMExports(); }
  };
  let r = race(false);
  ok(r.n === 1 && r.got === 'got', `a waiter that lost the takeover to a rename finds the lock gone and takes it (got ${r.got}, ${r.n} renames)`);
  r = race(true);
  ok(r.got === null && existsSync(lock) && Math.abs(Date.now() - statSync(lock).mtimeMs) < 5000, `a waiter that lost the takeover leaves the winner's fresh lock alone (got ${r.got})`);
  ok(!readdirSync(dir).some((f) => f.startsWith('.lock.dead')), 'and leaves no renamed copy behind');
  rmdirSync(lock);
  mkdirSync(`${lock}.dead.1.2`);
  sweepTemps(dir);
  ok(!existsSync(`${lock}.dead.1.2`), 'a renamed copy a killed waiter left is swept');
  // Asked for some files only (the projects root): their copies go, a name that only looks like a copy stays.
  const gone = spawnSync(process.execPath, ['-e', '']).pid, mine = join(dir, `.log.tmp${gone}`), theirs = join(dir, `.failed-x.tmp${gone}`);
  writeFileSync(mine, 'a'); writeFileSync(theirs, 'b');
  sweepTemps(dir, ['.log']);
  ok(!existsSync(mine) && existsSync(theirs), 'swept for some files: only their temp copies go');
  rmSync(theirs);
}
// One that cannot be removed -- on Windows another process's working folder,
// elsewhere one in a read-only folder -- throws once the wait is up, so the
// pass that fails says so in .health. Busy every turn was silence.
if (!quick) {
  mkdirSync(join(dir, '.lock'));
  let holder = null;
  if (process.platform === 'win32') {
    // It speaks once running: Windows opens a child's working folder during its
    // start-up, after 'spawn', and until then the folder can still be deleted.
    holder = spawn(process.execPath, ['-e', "process.stdout.write('up'); setTimeout(() => {}, 15000)"], { cwd: join(dir, '.lock') });
    await new Promise((res) => holder.stdout.once('data', res));
  } else chmodSync(dir, 0o555);
  backdateLock();
  let wedged;
  try { wedged = `returned ${withLock(dir, () => 'got')}`; } catch (e) { wedged = e.code; }
  if (holder) { holder.kill(); await new Promise((res) => holder.on('close', res)); }
  else chmodSync(dir, 0o755);
  rmSync(join(dir, '.lock'), { recursive: true, force: true });
  ok(!/^returned/.test(wedged), `a dead lock that cannot be removed throws (got ${wedged})`);
}

// EACCES is one more way Windows says a path is settling -- a rename already
// retries on it. On the lock it threw, and the turn's handoff was skipped.
const realMkdir = fs.mkdirSync;
let refusals = 1;
const refuse = function (p, ...a) {
  if (String(p).endsWith('.lock') && refusals-- > 0) throw Object.assign(new Error('EACCES: permission denied, mkdir'), { code: 'EACCES' });
  return realMkdir.call(this, p, ...a);
};
fs.mkdirSync = refuse;
syncBuiltinESMExports();
let eacces;
try { eacces = withLock(dir, () => 'got'); } catch (e) { eacces = e.code; }
fs.mkdirSync = realMkdir;
syncBuiltinESMExports();
ok(eacces === 'got' && refusals < 0, `an EACCES on the lock is waited out like EPERM (got ${eacces})`);
// Refused every time with no lock there: a folder that takes no new entries.
// Read as busy, every turn waited 2 s and saved nothing, unseen.
refusals = Infinity; fs.mkdirSync = refuse; syncBuiltinESMExports();
let refusedAll;
try { refusedAll = `returned ${withLock(dir, () => 'got')}`; } catch (e) { refusedAll = e.code; }
fs.mkdirSync = realMkdir; syncBuiltinESMExports();
ok(refusedAll === 'EACCES', `a folder that refuses every new entry throws, not busy (got ${refusedAll})`);

// 4. A junction to the store is the same store: one lock between both names
// (the inner wait on a fast clock under --mutant).
const alias = join(root, 'C--some-project-alias');
mkdirSync(alias);
symlinkSync(dir, join(alias, 'memory'), 'junction');
ok((quick ? fastClock : (f) => f())(() => withLock(join(alias, 'memory'), () => withLock(dir, () => 'inner'))) === null, 'a lock taken through a junction holds the real path too');

// A capped log (.stop-ran, .timing, .enforce-log): appended, cut back past its limit, never over a line appended meanwhile.
{
  const log = join(proj, '.capped'), temps = () => readdirSync(proj).filter((n) => n.startsWith('.capped.tmp'));
  appendCapped(log, 'a\n', 10);
  ok(readFileSync(log, 'utf8') === 'a\n', 'appended, the file made');
  ok(process.platform === 'win32' || (statSync(log).mode & 0o777) === 0o600, 'made 0600');
  writeFileSync(log, 'abcdefgh\n');
  appendCapped(log, 'i\n', 11);
  ok(readFileSync(log, 'utf8') === 'abcdefgh\ni\n', 'a log that ends at exactly its limit is not cut');
  writeFileSync(log, 'l1\nl2\nl3\nl4\n');
  appendCapped(log, 'l5\n', 14);
  ok(readFileSync(log, 'utf8') === 'l4\nl5\n', 'past its limit the newer half stays, the new line with it');
  writeFileSync(log, 'l1\nl2\nl3\nl4\n');
  appendCapped(log, 'l5\n', 14, 3);
  ok(readFileSync(log, 'utf8') === 'l3\nl4\nl5\n', 'or the newest lines asked for');
  ok(temps().length === 0, 'no temp copy stays');
  writeFileSync(log, 'cut off');
  appendCapped(log, 'next\n', 100);
  ok(readFileSync(log, 'utf8') === 'cut off\nnext\n', 'a last line left without its newline is ended, not glued to the next');
  // Another run appends between the size check and the rename: its line would be lost, so the cut waits for the next append.
  writeFileSync(log, 'l1\nl2\nl3\nl4\n');
  let n = 0;
  appendCapped(log, 'l5\n', 14, undefined, (p) => ({ size: statSync(p).size + (n++ ? 3 : 0) }));
  ok(readFileSync(log, 'utf8') === 'l1\nl2\nl3\nl4\nl5\n', 'a cut that lost the race leaves the file as it was');
  ok(temps().length === 0, 'and leaves no temp copy');
  rmSync(log);
  assert.throws(() => appendCapped(join(proj, 'no-such-folder', 'log'), 'a\n', 10)); checks++;
}

// 5. Replace only what was read.
const f = join(dir, 'x.md');
writeFileSync(f, 'one');
ok(replaceIfUnchanged(f, 'one', 'two') === true && readFileSync(f, 'utf8') === 'two', 'replaces a file that still holds what was read');
ok(replaceIfUnchanged(f, 'two', 'two') === false, 'says so when there is nothing to write');
writeFileSync(f, 'the model wrote this');
ok(replaceIfUnchanged(f, 'two', 'three') === 'conflict' && readFileSync(f, 'utf8') === 'the model wrote this', 'a write it did not see is kept');
// A file in the Windows code page (PowerShell 5.1's `>`) or UTF-16 reads with U+FFFD: written back, its letters were gone (1.3.1 audit C-1).
for (const bytes of [Buffer.from('# Index\n- caf\xe9\n', 'latin1'), Buffer.from('﻿# Index\n', 'utf16le')]) {
  const nb = join(dir, 'not-utf8.md');
  writeFileSync(nb, bytes);
  let code = '';
  try { replaceIfUnchanged(nb, readFileSync(nb, 'utf8'), 'rewritten'); } catch (e) { code = e.code; }
  ok(code === 'not UTF-8' && readFileSync(nb).equals(bytes), `a file that is not UTF-8 is left as it is (got ${code})`);
}
ok(replaceIfUnchanged(join(dir, 'new.md'), null, 'fresh') === true && readFileSync(join(dir, 'new.md'), 'utf8') === 'fresh', 'a file that did not exist is created');
ok(replaceIfUnchanged(join(dir, 'new.md'), null, 'again') === 'conflict', 'and one that appeared meanwhile is not overwritten');
ok(!readdirSync(dir).some((x) => x.includes('.tmp')), 'no temp file is left behind');
// Nor by a write the disk cut short: half a copy of the file, then ENOSPC.
const realWrite = fs.writeFileSync;
fs.writeFileSync = function (p, d, ...a) {
  if (String(p).includes('.tmp')) { realWrite.call(this, p, String(d).slice(0, 2)); throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); }
  return realWrite.call(this, p, d, ...a);
};
syncBuiltinESMExports();
let full;
try { full = replaceIfUnchanged(f, 'the model wrote this', 'four'); } catch (e) { full = e.code; }
fs.writeFileSync = realWrite;
syncBuiltinESMExports();
ok(full === 'ENOSPC' && readFileSync(f, 'utf8') === 'the model wrote this' && !readdirSync(dir).some((x) => x.includes('.tmp')),
  `a write the disk cut short leaves the file and no half copy (got ${full}, ${readdirSync(dir)})`);

// Long runs of blanks in a value are read in linear time: 50,000 spaces took
// 12 s, and every tier pass and search paid it.
{
  // Timed at 5,000 blanks and at 50,000 (a linear read costs ten times the first; the old 12 s one a hundred): a slow runner slows both, the old
  // fixed 1 s stays as the floor (audit #18).
  const read = (n) => { const blanks = ' '.repeat(n), t = performance.now(); const g = front(`---\nname: n${blanks}x\ndescription: d${blanks}\nsuperseded-by: ${blanks}#\ntype:\n ${blanks}\n---\n`); return [performance.now() - t, g]; };
  // The fastest of three small reads: one slow sample on a busy CI runner once pulled a quadratic read under 50x (1.3.1 mutant run).
  read(5_000);
  const small = Math.min(...[1, 2, 3].map(() => read(5_000)[0])), [big, f] = read(50_000);
  ok(big < Math.max(1000, 50 * small) && f.desc === 'd' && f.superseded === '', `a value with 50,000 blanks is read in linear time (${big.toFixed(0)} ms, ${small.toFixed(1)} ms at a tenth, ${JSON.stringify(f).slice(0, 80)})`);
}

// A transcript is in the projects folder by its resolved path: `<projects>/../x`
// is not. Its key is `<folder>/<session>`.
{
  const { projectsRoot } = await import('../src/store.mjs');
  const inside = join(projectsRoot(), 'C--x', 'abc.jsonl');
  ok(inProjects(inside) && !inProjects(`${projectsRoot()}/../history.jsonl`), 'a transcript under the projects folder is in it; one reached by .. is not');
  ok(transcriptKey(inside) === 'C--x/abc', `a transcript's key is its folder and session (got ${transcriptKey(inside)})`);
  // A relative transcript path (from the projects folder) still names an
  // absolute store: left as given, the store was a path relative to the hook's cwd.
  // Absolute is all that is asked: on macOS the cwd comes back as /private/var,
  // not the /var the projects folder is named by, and the store is the cwd's.
  const was = process.cwd();
  mkdirSync(join(projectsRoot(), 'C--rel'), { recursive: true });
  process.chdir(projectsRoot());
  let got; try { got = storeOf({ transcript_path: join('C--rel', 's.jsonl') }); } finally { process.chdir(was); }
  ok(isAbsolute(got), `a relative transcript path names an absolute store (got ${got})`);
}

// A list file (private conversations, forgotten keys, a journal's folders) is
// its lines as written: an editor's CRLF or a space left after one is still
// the line, and a blank one is none.
ok(listOf(' a1 \r\n\r\n\tb2\n  \n').join() === 'a1,b2' && listOf(null).length === 0, `a list file is its trimmed, non-blank lines (got ${JSON.stringify(listOf(' a1 \r\n\r\n\tb2\n  \n'))})`);

// An index line's file is the listed note the disk opens for it: (Kase.md) is
// kase.md's where the disk folds case, a name no file has is itself, and the
// Kelvin sign and k, two notes NTFS keeps apart, stay two. The Kelvin sign is
// listed first: a fold that takes the first name it finds takes the wrong one.
{
  const od = join(home, 'opener'), K = String.fromCharCode(0x212A);
  mkdirSync(od, { recursive: true });
  for (const n of ['kase.md', 'kelvin.md', `${K}elvin.md`]) writeFileSync(join(od, n), n);
  const ls = readdirSync(od), listed = [...ls.filter((n) => n.startsWith(K)), ...ls.filter((n) => !n.startsWith(K))], opens = opener(od, listed);
  const folds = existsSync(join(od, 'KASE.md')), apart = listed.length === 3;
  ok(opens('kase.md') === 'kase.md' && opens('Kase.md') === (folds ? 'kase.md' : 'Kase.md') && opens('gone.md') === 'gone.md',
    `a line's file is the listed note it opens, and a name no file has is itself (got ${opens('Kase.md')}, ${opens('gone.md')})`);
  ok(!apart || (opens(`${K}elvin.md`) === `${K}elvin.md` && opens('KELVIN.md') === (folds ? 'kelvin.md' : 'KELVIN.md')),
    `two notes the disk keeps apart (the Kelvin sign and k) stay two, each found by the disk (got ${opens(`${K}elvin.md`)}, ${opens('KELVIN.md')})`);
}

// A line made for a memory no index names reads back, and its hook ends whole.
const made = pointerLine('[draft] plan.md', 'a'.repeat(139) + '\u{1F600} and more');
ok(made.match(POINTER)?.[1] === '[draft] plan.md' && !/[\uD800-\uDFFF]$/.test(made), `a made line reads back and is cut whole (got ${made})`);
// POINTER reads one level of brackets in a title; the made title has none, so two levels in a name read back too.
ok(pointerLine('[[a]] b.md', 'x').match(POINTER)?.[1] === '[[a]] b.md', 'a made line for a name with nested [brackets] reads back');

// The index format's other parts, one definition each.
ok(indexLines('\uFEFF- [a](a.md) — x\r\n- [b](b.md) — y\n')[0].match(POINTER)?.[1] === 'a.md', 'a BOM does not hide the first index line');
ok(indexLines('a\r\nb\nc').join() === 'a,b,c', 'index lines split on either line ending');
ok(eolOf('# x\r\n- [a](a.md) — y\n') === '\r\n' && eolOf('# x\n- [a](a.md) — y\r\n') === '\n' && eolOf('one line') === '\n', 'a file\'s line ending is its first line\'s');
ok(wraps('  wrapped on') && wraps('\tmore') && !wraps('   ') && !wraps('- [a](a.md) — y'), 'an indented line with text is a wrapped hook; a blank one is not');
ok(archiveLine(3).match(POINTER)?.[1] === 'MEMORY-archive.md', 'the archive line points at the archive');
ok(emptyArchive(archiveLine(0)) && !emptyArchive(archiveLine(1)) && !emptyArchive(archiveLine(10)) && !emptyArchive('- [a](a.md) — 0 older ones'), 'only an empty archive\'s line reads as empty, by the words archiveLine writes');
for (const l of ['- [a](a.md) — y', '- [a](a.md) — ends in a space ', '- [a](a.md) — y\n  wrapped']) ok(unmark(mark(l)) === l && mark(l) !== l, `mark then unmark gives the line back (got ${JSON.stringify(unmark(mark(l)))})`);
ok(unmark('- [a](a.md) — y') === '- [a](a.md) — y', 'an unmarked line is left as it is');

// A value stays on its line, the body is no frontmatter, and CRLF keeps quotes off.
const emptied = front('---\nname: a\nsuperseded-by:\nmetadata:\n  type: project\n---\nbody');
ok(emptied.superseded === '' && emptied.tier === '' && emptied.type === 'project', `an empty superseded-by: is empty (got ${JSON.stringify(emptied)})`);
// Archiving is a one-way door: a value that says "none" in YAML's or a person's words is no replacement (1.3.1 audit E-3).
for (const v of ['[]', '[ ]', 'none', 'None', 'false', 'no', '""']) ok(front(`---\nsuperseded-by: ${v}\n---\n`).tier === '', `superseded-by: ${v} does not archive the note`);
ok(front('---\ntier: hot-ish\n---\n').tier === '' && front('---\ntier: hot # pinned\n---\n').tier === 'hot', 'only a whole tier word pins a note');
ok(front('---\nname: fmt\n---\nHow to retire a note:\n  superseded-by: new.md\n  tier: archive\n').tier === '', 'a body that quotes the format does not archive its note');
ok(front('---\r\nname: crlf\r\ndescription: "quoted"\r\n---\r\n').desc === 'quoted' && front('\uFEFF---\nname: bom\n---\n').name === 'bom', 'CRLF and a BOM read the same');

// 1.1.0. A pointer names a file in the store, by its name: a web link was a
// memory with no file at every startup, and `../../big.bin` was read whole by
// every Stop.
ok(POINTER.test('- [a](a.md) \u2014 x') && !POINTER.test('- [Repo](https://github.com/x/y) \u2014 the code') && !POINTER.test('- [x](../../big.bin) \u2014 x') && !POINTER.test('- [x](C:\\big.bin) \u2014 x'),
  'a pointer names a file in the store, never a link or a path');
// A hand-written title with brackets in it: unmatched, the line was prose and tiering added a second pointer to its note.
ok(POINTER.exec('- [Fix [WIP] thing](a.md) — x')?.[1] === 'a.md', 'a title holding [brackets] still names its file');
// A date alone is that day where the user is: read as UTC midnight, it printed
// as the day before west of Greenwich. Checked there: in UTC (GitHub's
// machines) the two readings agree, and the check caught nothing.
{
  process.env.TZ = 'America/New_York';
  try {
    ok(local(front('---\nmodified: 2025-09-01\n---\n').modified).startsWith('2025-09-01 00:00'), 'a modified: date alone is that day, here');
    // A date and a time with a space between, as people write it: the time was dropped at the space.
    ok(local(front('---\nmodified: 2025-09-01 12:30\n---\n').modified) === '2025-09-01 12:30', 'a modified: date and time with a space keeps the time');
  }
  finally { process.env.TZ = TZ0; }
}
// A transcript path that is no string threw, and the Stop hook with it; one
// that climbs out of the projects folder named a store outside it.
ok(storeOf({ cwd: 'C:\\x', transcript_path: 42 }) === join(root, 'C--x', 'memory') && storeOf({ cwd: 'C:\\x', transcript_path: `${root}/../x.jsonl` }) === join(root, 'C--x', 'memory'),
  'a transcript path that is no string, or leaves the projects folder, falls back to the cwd');
// A lock dated in the future (a clock set back) is as dead as an old one.
mkdirSync(join(dir, '.lock'));
const later = new Date(Date.now() + 3600_000);
utimesSync(join(dir, '.lock'), later, later);
ok(withLock(dir, () => 'taken') === 'taken', 'a lock dated an hour ahead is taken over');
// The snapshot repo's git ignores the user's own config: commit signing failed
// every snapshot, a global hooks folder ran the user's hooks on it, and on
// Windows a path past 260 characters was skipped with only a warning.
const { gitArgs } = await import('../src/snapshot.mjs');
const ga = gitArgs('status');
ok(ga.includes('commit.gpgsign=false') && ga.includes('core.longpaths=true') && ga.some((a) => /^core\.hooksPath=.*no-hooks$/.test(a)) && ga.at(-1) === 'status',
  `the snapshot repo's git turns off signing and hooks, and on long paths (got ${ga.join(' ')})`);
ok(reason({ message: "EPERM: x, rename '/p/.checked.tmp4242' -> '/p/.checked'\nmore" }) === "EPERM: x, rename '/p/.checked' -> '/p/.checked'" && reason(null) === 'undefined', "reason() is the message's first line without a temp file's name");
ok(gitWhy({ code: 'ENOENT', syscall: 'spawnSync git', message: 'spawnSync git ENOENT' }) === 'git is not installed', 'no git is said in words, not as spawnSync git ENOENT');
// A file gone between two calls is ENOENT too, and is no missing git.
ok(gitWhy({ code: 'ENOENT', syscall: 'unlink', message: "ENOENT: no such file or directory, unlink 'x\\index.lock'" }) !== 'git is not installed', 'a vanished lock is not "git is not installed"');

// Round 3 (2026-10-27).
{
  const { repoRoot, projectsRoot, memoryOff } = await import('../src/store.mjs');
  const slug = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
  // A repository, a subfolder of it, a worktree of it (its .git a file naming
  // a folder in the main .git), and a submodule (one with no commondir).
  const repo = join(home, 'work', 'repo'), sub = join(repo, 'packages', 'web');
  mkdirSync(join(repo, '.git', 'worktrees', 'wt1'), { recursive: true }); mkdirSync(sub, { recursive: true });
  writeFileSync(join(repo, '.git', 'worktrees', 'wt1', 'commondir'), '../..\n');
  const wt = join(home, 'work', 'repo-wt1'); mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'wt1')}\n`);
  writeFileSync(join(repo, '.git', 'worktrees', 'wt1', 'gitdir'), `${join(wt, '.git').replace(/\\/g, '/')}\n`);   // git writes it with forward slashes
  const subm = join(repo, 'vendor', 'lib'); mkdirSync(join(repo, '.git', 'modules', 'lib'), { recursive: true }); mkdirSync(subm, { recursive: true });
  writeFileSync(join(subm, '.git'), `gitdir: ../../.git/modules/lib\n`);
  ok(repoRoot(repo) === repo && repoRoot(sub) === repo && repoRoot(wt) === repo && repoRoot(subm) === subm && repoRoot(join(home, 'work')) === null,
    `the repository a folder is in: itself, its root, a worktree's main one, a submodule its own, none (got ${[repoRoot(sub), repoRoot(wt), repoRoot(subm)].join(' | ')})`);
  // A relative path is in no repository, whatever folder the hook runs in.
  { const was = process.cwd(); process.chdir(repo); try { ok(repoRoot('packages') === null, 'a path that is no absolute one is in no repository'); } finally { process.chdir(was); } }
  ok(repoRoot(undefined) === null, 'a folder that is no string is in no repository');
  // startCwd reads a transcript's head: 64 KB at a time, up to 4 MB, and the first cwd it finds is the one.
  {
    const { startCwd } = await import('../src/store.mjs');
    const put = (name, text) => { const f = join(home, name); writeFileSync(f, text); return f; };
    const two = put('sc-two.jsonl', `${JSON.stringify({ type: 'user', cwd: '/first' })}\n${JSON.stringify({ pad: 'x'.repeat(70000) })}\n${JSON.stringify({ type: 'user', cwd: '/second' })}\n`);
    ok(startCwd(two) === '/first', `a later cwd never replaces the first (got ${startCwd(two)})`);
    // The 4 MB limit: a cwd that starts 2,000 bytes inside it is found, one that starts 100 bytes past it is not.
    const at = (name, off) => put(name, `{"pad":"${'x'.repeat(off - 11)}"}\n{"cwd":"/late"}\n`);
    ok(startCwd(at('sc-in.jsonl', 4_194_304 - 2000)) === '/late', 'a cwd inside the first 4 MB is found');
    const decode = Buffer.prototype.toString; let decoded = 0;
    Buffer.prototype.toString = function (...x) { const t = decode.apply(this, x); decoded += t.length; return t; };
    try { ok(startCwd(at('sc-out.jsonl', 4_194_304 + 100)) === null, 'a cwd past the first 4 MB is not looked for'); } finally { Buffer.prototype.toString = decode; }
    ok(decoded < 8_000_000, `each look reads the new chunk and a margin, not all there is (decoded ${decoded} characters)`);
    // A cwd that runs over a chunk's edge is whole in the next look, however long its path (up to the 4096 units its pattern takes).
    const big = `{"a":"${'x'.repeat(60528)}","cwd":"${'\\\\'.repeat(3000)}"}\n`;
    ok(startCwd(put('sc-long.jsonl', big)) === '\\'.repeat(3000), 'a cwd of 6,000 characters across the 64 KB edge is read whole');
  }
  // A session started in a subfolder or a worktree has its store at the
  // repository's folder, as Claude Code keeps auto memory, though its
  // transcript sits in a folder named for where it started.
  const started = (cwd) => {
    const t = join(projectsRoot(), slug(cwd), 's.jsonl');
    mkdirSync(join(projectsRoot(), slug(cwd)), { recursive: true });
    writeFileSync(t, JSON.stringify({ type: 'summary' }) + '\n' + JSON.stringify({ type: 'user', cwd, message: { content: 'hi' } }) + '\n');
    return storeOf({ cwd: join(home, 'moved', 'elsewhere'), transcript_path: t });
  };
  const repoStore = join(projectsRoot(), slug(repo), 'memory');
  ok(started(sub) === repoStore && started(wt) === repoStore, `a session started in a subfolder or a worktree keeps the repository's store (got ${started(sub)})`);
  ok(started(repo) === join(projectsRoot(), slug(repo), 'memory') && started(join(home, 'work')) === join(projectsRoot(), slug(join(home, 'work')), 'memory'),
    'one started at the root, or outside any repository, keeps its own folder');
  ok(storeOf({ cwd: sub }) === repoStore, 'with no transcript, the cwd goes by its repository too');
  // A first cwd past the first 64 KB of the transcript is still the start folder (1.3.2): not the cwd of the moment.
  { const tb = join(projectsRoot(), slug(sub), 'big.jsonl');
    writeFileSync(tb, JSON.stringify({ type: 'attachment', attachment: { content: 'x'.repeat(150000) } }) + '\n' + JSON.stringify({ type: 'user', cwd: sub, message: { content: 'hi' } }) + '\n');
    ok(storeOf({ cwd: join(home, 'moved', 'elsewhere'), transcript_path: tb }) === repoStore, 'a start cwd after 64 KB of other records is found'); }
  // Claude Code's folder where CLAUDE_CONFIG_DIR puts it, and a project folder
  // named by CLAUDE_CODE_PROJECT_DIR_NAME: under either, the hooks wrote nothing.
  const cfg = join(home, 'cfg');
  process.env.CLAUDE_CONFIG_DIR = cfg;
  let named, rooted;
  try { rooted = projectsRoot(); process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'shared-name'; named = storeOf({ cwd: sub }); }
  finally { delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME; }
  ok(rooted === join(cfg, 'projects') && named === join(cfg, 'projects', 'shared-name', 'memory'), `CLAUDE_CONFIG_DIR and CLAUDE_CODE_PROJECT_DIR_NAME are followed (got ${rooted} | ${named})`);
  // A relative one is one folder, not one per hook's cwd (1.3.1 audit C-3).
  process.env.CLAUDE_CONFIG_DIR = '.claude-rel';
  try { rooted = projectsRoot(); } finally { delete process.env.CLAUDE_CONFIG_DIR; }
  ok(rooted === resolve('.claude-rel', 'projects'), `a relative CLAUDE_CONFIG_DIR is made absolute (got ${rooted})`);
  // A .git file is followed only as Claude Code follows it: one pointing into
  // another project's .git, with no worktree there naming it back, is its own.
  const victim = join(home, 'work', 'victim'); mkdirSync(join(victim, '.git'), { recursive: true });
  const lure = join(home, 'work', 'unpacked'), gd = join(lure, 'gd'); mkdirSync(gd, { recursive: true });
  writeFileSync(join(lure, '.git'), 'gitdir: gd\n'); writeFileSync(join(gd, 'commondir'), `${join(victim, '.git')}\n`);
  ok(repoRoot(lure) === lure, `a .git file that does not check out leads nowhere else (got ${repoRoot(lure)})`);
  // Nothing it reads throws: a commondir that is a folder.
  const odd = join(home, 'work', 'odd'), ogd = join(repo, '.git', 'worktrees', 'odd'); mkdirSync(join(ogd, 'commondir'), { recursive: true }); mkdirSync(odd, { recursive: true });
  writeFileSync(join(odd, '.git'), `gitdir: ${ogd}\n`);
  let thrown = null; try { repoRoot(odd); } catch (e) { thrown = e; }
  ok(!thrown, `an unreadable worktree file never throws (got ${thrown?.message})`);
  // A bare repository's worktree shares the bare folder's memory.
  const bare = join(home, 'work', 'proj.bare'), bwt = join(home, 'work', 'proj-main'), bgd = join(bare, 'worktrees', 'main');
  mkdirSync(bgd, { recursive: true }); mkdirSync(bwt, { recursive: true });
  writeFileSync(join(bwt, '.git'), `gitdir: ${bgd}\n`); writeFileSync(join(bgd, 'commondir'), '../..\n'); writeFileSync(join(bgd, 'gitdir'), `${join(bwt, '.git')}\n`);
  ok(repoRoot(bwt) === bare, `a bare repository's worktree is the bare folder's (got ${repoRoot(bwt)})`);
  // CLAUDE_CODE_PROJECT_DIR_NAME as it is, `_` and all; any other name ignored.
  process.env.CLAUDE_CONFIG_DIR = cfg;
  let under, ignored;
  try { process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'my_proj'; under = storeOf({ cwd: sub }); process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'a/b'; ignored = storeOf({ cwd: sub }); }
  finally { delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME; }
  ok(under === join(cfg, 'projects', 'my_proj', 'memory') && ignored === join(cfg, 'projects', slug(repo), 'memory'), `a project folder name is used as it is, or ignored (got ${under} | ${ignored})`);
  // At a session's start its transcript may record no cwd yet: the payload's is where it started.
  const fresh = join(projectsRoot(), slug(sub), 'new.jsonl');
  writeFileSync(fresh, JSON.stringify({ type: 'summary' }) + '\n');
  ok(storeOf({ cwd: sub, transcript_path: fresh }) === repoStore, 'with no cwd recorded yet, the payload\'s cwd finds the repository');

  // A worktree reached through a junction is still the repository's: git
  // records the real path. And `_shared` names no project.
  const viaJ = join(home, 'work', 'jwt');
  try { symlinkSync(wt, viaJ, 'junction'); } catch {}
  if (!existsSync(viaJ)) console.log('skip: this machine cannot make a junction to a worktree');
  ok(!existsSync(viaJ) || repoRoot(viaJ) === repo, `a worktree through a junction maps to its repository (got ${existsSync(viaJ) ? repoRoot(viaJ) : 'no junction'})`);
  process.env.CLAUDE_CONFIG_DIR = cfg; process.env.CLAUDE_CODE_PROJECT_DIR_NAME = '_shared';
  let notShared; try { notShared = storeOf({ cwd: sub }); } finally { delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME; }
  ok(notShared === join(cfg, 'projects', slug(repo), 'memory'), `a project folder named _shared is ignored (got ${notShared})`);

  for (const [v, want] of [['1', true], ['true', true], ['0', false], ['', false]]) {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = v;
    try { ok(memoryOff() === want, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=${JSON.stringify(v)} is ${want ? 'off' : 'on'}`); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  }

  // Settings Claude Code reads (item 28): the first autoMemoryEnabled in managed, project local, project, user; the env var over all.
  {
    const { autoMemory } = await import('../src/store.mjs');
    const lab = join(home, 'lab28'), mg = join(lab, 'managed'), pr = join(lab, 'proj'), cf = join(lab, 'cfg');
    for (const d of [join(mg, 'managed-settings.d'), join(pr, '.claude'), cf]) mkdirSync(d, { recursive: true });
    const put = (f, v) => writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v));
    const user = join(cf, 'settings.json'), local_ = join(pr, '.claude', 'settings.local.json'), shared = join(pr, '.claude', 'settings.json');
    const was = process.env.CLAUDE_CONFIG_DIR; process.env.CLAUDE_CONFIG_DIR = cf;
    const am = () => autoMemory({ managed: mg, cwd: pr });
    try {
      ok(am().off === false, 'no setting: on');
      put(user, { autoMemoryEnabled: false });
      ok(am().off === true && /autoMemoryEnabled is false in .*settings\.json/.test(am().why), 'user false: off, and says where');
      put(local_, { autoMemoryEnabled: true });
      ok(am().off === false, 'project local true over user false: on');
      put(local_, {}); put(shared, { autoMemoryEnabled: false }); put(user, { autoMemoryEnabled: true });
      ok(am().off === true, 'project false over user true: off');
      put(shared, { autoMemoryEnabled: 'false' }); put(user, '{ broken');
      ok(am().off === false, 'a string and a broken file are ignored');
      // Claude Code reads a settings file that starts with a UTF-8 BOM (live check 7), and skips one with comments.
      put(user, '\uFEFF' + JSON.stringify({ autoMemoryEnabled: false }));
      ok(am().off === true, 'a settings file with a BOM is read');
      put(user, '// off\n' + JSON.stringify({ autoMemoryEnabled: false }));
      ok(am().off === false, 'a settings file with comments is skipped, as Claude Code skips it');
      put(user, { autoMemoryEnabled: false });
      process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0';
      ok(am().off === false, 'env 0 over a file false: on');
      put(user, { autoMemoryEnabled: true }); process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
      ok(am().off === true && am().why === 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'env 1 over a file true: off');
      delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
      put(join(mg, 'managed-settings.json'), { autoMemoryEnabled: false });
      ok(am().off === true, 'managed false beats the files below it');
      put(join(mg, 'managed-settings.d', '10.json'), { autoMemoryEnabled: true });
      ok(am().off === false, 'a managed .d file overrides the managed base');
      put(join(mg, 'managed-settings.d', '20.txt'), { autoMemoryEnabled: false });
      ok(am().off === false, 'a file in managed-settings.d that is no .json is not read');
    } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was; }
  }

  // Valid YAML in every spelling: quoted either way, any case, a comment after
  // it, a list, a folded description. Read only bare, a pin aged out.
  const f1 = front('---\ntier: "hot"\ntype: Feedback\n---\nbody tier: archive');
  const f2 = front("---\nmetadata:\n  tier: 'Hot'\n---\n");
  const f3 = front('---\nsuperseded-by: "b.md" # the newer one\n---\n');
  const f4 = front('---\nsuperseded-by:\n  - c.md\n  - d.md\nname: x\n---\n');
  const f5 = front('---\ndescription: >-\n  folded line one\n  and two\nname: n\n---\n');
  const f6 = front('---\nsuperseded-by:\nname: next\n---\n');
  ok(f1.tier === 'hot' && f1.type === 'feedback' && f2.tier === 'hot' && f3.superseded === 'b.md' && f4.superseded === 'c.md' && f5.desc === 'folded line one and two' && f6.superseded === '' && f6.name === 'next',
    `frontmatter is read in every YAML spelling (got ${JSON.stringify([f1, f2, f3, f4, f5, f6].map((f) => [f.tier, f.type, f.superseded, f.desc]))})`);
  // Saved CRLF, the block is every line still: its first alone was read (review, 2026-10-30).
  const f7 = front('---\r\ndescription: >-\r\n  folded line one\r\n  and two\r\nname: n\r\n---\r\n');
  ok(f7.desc === 'folded line one and two', `a folded description saved CRLF is read whole (got ${JSON.stringify(f7.desc)})`);
}

// Round 4. The snapshots keep line endings as written, whatever git is told
// elsewhere: Git for Windows sets core.autocrlf=true for the whole machine.
{
  const { projectsRoot } = await import('../src/store.mjs'), { gitArgs } = await import('../src/snapshot.mjs');
  const git = (...a) => execFileSync('git', gitArgs(...a), { encoding: 'utf8' });
  mkdirSync(projectsRoot(), { recursive: true });
  if (!existsSync(join(projectsRoot(), '.git'))) {
    try {
      git('init', '-q'); git('config', 'core.autocrlf', 'true');
      writeFileSync(join(projectsRoot(), 'crlf.md'), 'a\r\nb\r\n');
      git('add', 'crlf.md');
      ok(git('cat-file', '-p', ':crlf.md') === 'a\r\nb\r\n', 'a CRLF file is kept CRLF, autocrlf or not');
    } finally { rmSync(join(projectsRoot(), '.git'), { recursive: true, force: true }); rmSync(join(projectsRoot(), 'crlf.md'), { force: true }); }
  }
}

// The caller's repo-locating git variables never reach a snapshot's git (a pre-commit hook running `claude -p` sets them); the rest stay.
{
  const { gitArgs } = await import('../src/snapshot.mjs');
  const names = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CONFIG_PARAMETERS'];
  for (const k of names) process.env[k] = '/elsewhere';
  process.env.GIT_SSH_COMMAND = 'ssh';
  gitArgs('status');
  ok(names.every((k) => !(k in process.env)) && process.env.GIT_SSH_COMMAND === 'ssh' && Object.keys(process.env).some((k) => /^path$/i.test(k)), 'a snapshot git runs without the caller\'s repo-locating variables, with the rest of the environment');
  delete process.env.GIT_SSH_COMMAND;
}

// Round 6. Front matter as YAML reads it: null is no replacement, quotes
// only around a whole value, '' in single quotes, a ` #` comment cut.
{
  const f6 = (s) => front(`---\n${s}\n---\nbody`);
  const cases6 = [['superseded-by: null', 'superseded', ''], ['superseded-by: ~', 'superseded', ''], ['superseded-by: # none yet', 'superseded', ''],
    ['superseded-by: "new.md" # moved', 'superseded', 'new.md'], ['superseded-by: new.md', 'superseded', 'new.md'],
    ["name: 'deploy checklist'", 'name', 'deploy checklist'], ["name: 'it''s'", 'name', "it's"],
    ['description: Use the "fast" path', 'desc', 'Use the "fast" path'], ['description: Use the "fast"', 'desc', 'Use the "fast"'],
    ['description: "quoted \\"x\\""', 'desc', 'quoted "x"'], ['description: plain # comment', 'desc', 'plain # comment'], ['description: Fix issue #42 in the parser', 'desc', 'Fix issue #42 in the parser'],
    ['name: Sprint #3 retro', 'name', 'Sprint #3 retro'], ['description: "Long text wrapped', 'desc', 'Long text wrapped'], ['description: "a" and "b"', 'desc', '"a" and "b"'],
    ['description: "Never" force-push main', 'desc', '"Never" force-push main'], ['description: null', 'desc', ''], ['description: ~', 'desc', ''],
    ['description: # fill in later', 'desc', ''], ['description: #42 first', 'desc', '#42 first'], ['superseded-by: #none', 'superseded', ''], ['superseded-by: "new #2.md"', 'superseded', 'new #2.md'],
    ['description: C# tips', 'desc', 'C# tips'], ['description: "keep # this"', 'desc', 'keep # this']];
  for (const [src, k, want] of cases6) ok(f6(src)[k] === want, `${JSON.stringify(src)} reads ${k} ${JSON.stringify(want)} (got ${JSON.stringify(f6(src)[k])})`);
  ok(f6('superseded-by: null\nmetadata:\n  tier: hot').tier === 'hot', 'a null superseded-by leaves a pin a pin');
}

// The automatic mutants that lived (store.mjs, Task 8).
{
  const patch = (name, make) => { const real = fs[name]; fs[name] = make(real); syncBuiltinESMExports(); return () => { fs[name] = real; syncBuiltinESMExports(); }; };
  const err = (code) => Object.assign(new Error(code), { code });
  const rep = (c, n) => Array(n).fill(c);
  // Outside Windows another letter case is another folder.
  const was = process.platform, setPlatform = (v) => Object.defineProperty(process, 'platform', { value: v, configurable: true });
  setPlatform('linux');
  try { ok(same(join(home, 'Aa'), join(home, 'Aa')) && !same(join(home, 'Aa'), join(home, 'aA')), 'two paths in another case are two folders off Windows'); } finally { setPlatform(was); }

  // sleep() waits.
  { const t0 = Date.now(); sleep(80); ok(Date.now() - t0 >= 60, `sleep(80) sleeps (${Date.now() - t0} ms)`); }

  // The lock: mkdir of it fails with the given codes in turn, then works.
  const lockDir = join(home, 'lockdir'), lockPath = join(lockDir, '.lock');
  mkdirSync(lockDir, { recursive: true });
  const lockRun = (codes) => {
    let n = 0;
    const undo = patch('mkdirSync', (real) => function (p, ...a) { if (String(p).endsWith('.lock') && n < codes.length) throw err(codes[n++]); return real.call(this, p, ...a); });
    const t0 = Date.now(); let res;
    try { res = withLock(lockDir, () => 'got'); } catch (e) { res = e.code; } finally { undo(); }
    return { res, ms: Date.now() - t0 };
  };
  // A holder that lets go within the wait: tried again after a pause each time,
  // and a lock that is gone is no refusal.
  const waited = lockRun(rep('EEXIST', 9));
  ok(waited.res === 'got' && waited.ms >= 150, `a held lock is tried again every 25 ms (got ${waited.res} after ${waited.ms} ms)`);
  // Eight refusals in a row with no lock there are still a wait; the ninth is a folder that takes nothing.
  ok(lockRun(rep('EACCES', 8)).res === 'got', 'eight refusals with no lock there are waited out');
  ok(lockRun(rep('EACCES', 9)).res === 'EACCES', 'nine in a row throw');
  ok(lockRun(['EEXIST', ...rep('EACCES', 8)]).res === 'got', 'a held lock between the refusals starts the count again');

  // The unlock: refused for a moment (EBUSY), it is tried again; ENOENT is not retried. ENOTEMPTY too: on Windows the
  // owner file a scanner holds stays in the folder a moment after its unlink (1.3.1 final review).
  for (const [code, n, gone] of [['EBUSY', 1, true], ['EPERM', 2, true], ['ENOTEMPTY', 1, true], ['EBUSY', 3, false]]) {
    let k = 0, waits = 0;
    const undo = patch('rmdirSync', (real) => function (p, ...a) { if (String(p).endsWith('.lock') && k++ < n) throw err(code); return real.call(this, p, ...a); });
    const wait = Atomics.wait; Atomics.wait = (...a) => { waits++; return wait(...a); };
    try { withLock(lockDir, () => 'got'); } finally { undo(); Atomics.wait = wait; }
    ok(existsSync(lockPath) !== gone && k === Math.min(n + 1, 3), `an unlock refused ${n} time(s) with ${code}: ${gone ? 'tried again and gone' : 'given up after three tries'} (${k} calls)`);
    ok(waits === Math.min(n, 2), `a pause between tries, none after the last (${waits} for ${n} refusals)`);
    rmSync(lockPath, { recursive: true, force: true });
  }
  { let k = 0; const undo = patch('rmdirSync', (real) => function (p, ...a) { if (String(p).endsWith('.lock')) { k++; throw err('ENOENT'); } return real.call(this, p, ...a); });
    try { withLock(lockDir, () => 'got'); } finally { undo(); }
    ok(k === 1, `an unlock that finds no lock is not tried again (${k} calls)`); rmSync(lockPath, { recursive: true, force: true }); }

  // The clock: a lock is stale after 30 s (mtime + 30 s exactly is not), and the wait is 2 s.
  const M = (Math.floor(Date.now() / 1000) - 1000) * 1000;
  const clockRun = (script, rmErrors = [], vanish = false) => {
    mkdirSync(lockPath); utimesSync(lockPath, M / 1000, M / 1000);
    const realNow = Date.now; let i = 0, k = 0;
    Date.now = () => M + script[Math.min(i++, script.length - 1)];
    const undoRm = patch('renameSync', (real) => function (p, o) { if (String(p).endsWith('.lock') && k < rmErrors.length) throw rmErrors[k++]; return real.call(this, p, o); });
    const undoStat = vanish ? patch('statSync', (real) => function (p, ...a) { const r = real.call(this, p, ...a); if (String(p).endsWith('.lock')) rmdirSync(p); return r; }) : () => {};
    let res; try { res = withLock(lockDir, () => 'got'); } catch (e) { res = `threw ${e.message}`; } finally { Date.now = realNow; undoRm(); undoStat(); }
    rmSync(lockPath, { recursive: true, force: true });
    return res;
  };
  ok(clockRun([30000, 30000, 33000]) === null, 'a lock exactly 30 s old is not stale yet');
  ok(clockRun([100000, 100000, 200000], [], true) === 'got', 'a stale lock someone else removed first is retaken at once');
  ok(clockRun([100000, 100000, 101000, 200000], [err('E1')]) === null, 'a stale lock that will not go is waited on while the wait lasts');
  ok(clockRun([100000, 100000, 102000, 102000, 100000, 200000], [err('E1'), err('E2')]) === 'threw E2', 'and given up on only once the wait is over, not at its last instant');

  // The rename: Windows refuses it while another program holds the file, so it is tried
  // again, three times after 50 ms (eight after 125 ms on Windows: a scanner holds it longer).
  const g = join(dir, 'rn.md');
  const renameRun = (codes) => {
    writeFileSync(g, 'old'); let attempts = 0;
    const undo = patch('renameSync', (real) => function (a, b) { if (attempts < codes.length) throw err(codes[attempts++]); attempts++; return real.call(this, a, b); });
    const t0 = Date.now(); let res;
    try { res = replaceIfUnchanged(g, 'old', 'new'); } catch (e) { res = e.code; } finally { undo(); }
    return { res, attempts, ms: Date.now() - t0 };
  };
  const slow = renameRun(rep('EBUSY', 3));
  ok(slow.res === true && readFileSync(g, 'utf8') === 'new' && slow.ms >= 100, `a rename refused three times is done on the fourth try, after pauses (got ${slow.res}, ${slow.ms} ms)`);
  const stuck = renameRun(rep('EBUSY', 9));
  ok(stuck.res === 'EBUSY' && stuck.attempts === (process.platform === 'win32' ? 9 : 4), `and given up on after the last refusal (got ${stuck.res} after ${stuck.attempts})`);
  // The pause and the number of tries are the platform's: 8 tries 125 ms apart on Windows, 3 tries 50 ms apart elsewhere.
  for (const [plat, pauses] of [['linux', rep(50, 3)], ['win32', rep(125, 8)]]) {
    setPlatform(plat); const waits = [], wait = Atomics.wait; Atomics.wait = (a, i, v, ms) => { waits.push(ms); return 'ok'; };
    let r; try { r = renameRun(rep('EBUSY', 9)); } finally { Atomics.wait = wait; setPlatform(was); }
    ok(r.res === 'EBUSY' && r.attempts === pauses.length + 1 && waits.join() === pauses.join(), `a refused rename is tried ${pauses.length} more times, ${pauses[0]} ms apart, on ${plat} (got ${r.attempts} attempts, pauses ${waits})`);
  }
  const bad = renameRun(rep('EINVAL', 9));
  ok(bad.res === 'EINVAL' && bad.attempts === 1, `any other refusal is thrown at once (got ${bad.res} after ${bad.attempts})`);

  // A transcript whose first record is all there is, from its first byte to its last.
  const rr = join(home, 'work75', 'r'), sb = join(rr, 'sub'), tp = join(root, 'C--w75', 's1.jsonl');
  mkdirSync(join(rr, '.git'), { recursive: true }); mkdirSync(sb, { recursive: true }); mkdirSync(join(root, 'C--w75'), { recursive: true });
  writeFileSync(tp, `"cwd":${JSON.stringify(sb)}`);
  ok(storeOf({ transcript_path: tp }) === join(root, slug(rr), 'memory'), 'the folder a session started in is read from the whole of its head');

  // A .git file is a worktree's only when every check passes; each alone fails it.
  const mk = (name, { sub = 'worktrees', common = '../..', back = 'ok' } = {}) => {
    const base = join(home, 'work59', name), r = join(base, 'repo'), w = join(base, 'wt'), gd = join(r, '.git', sub, 'wt1');
    mkdirSync(gd, { recursive: true }); mkdirSync(w, { recursive: true });
    writeFileSync(join(w, '.git'), `gitdir: ${gd}\n`);
    writeFileSync(join(gd, 'commondir'), common);
    writeFileSync(join(gd, 'gitdir'), back === 'ok' ? join(w, '.git') : back);
    return [w, r];
  };
  const { repoRoot } = await import('../src/store.mjs');
  const [wGood, rGood] = mk('good');
  ok(repoRoot(wGood) === rGood, 'a worktree that checks out is its repository');
  for (const [name, o] of [['nocommon', { common: '' }], ['noback', { back: '' }], ['notworktrees', { sub: 'other' }], ['elsewhere', { back: join(home, 'work59', 'elsewhere', '.git') }]]) {
    const [w] = mk(name, o);
    ok(repoRoot(w) === w, `a .git file with ${name} is its own repository (got ${repoRoot(w)})`);
  }

  // The listed name a line opens, by the disk's own ids (64 bits: 2^53 and 2^53 + 1 are two files).
  {
    const od = join(home, 'opener2'), big = 2n ** 53n;
    mkdirSync(od, { recursive: true });
    const inos = { 'KASE.md': big, 'kase.md': big + 1n, 'Kase.md': big + 1n, 'Foo.md': 7n, 'foo.md': 7n };
    const undo = patch('statSync', (real) => function (p, o) {
      const ino = inos[basename(String(p))];
      return ino === undefined ? real.call(this, p, o) : o?.bigint ? { dev: 1n, ino } : { dev: 1, ino: Number(ino) };
    });
    let a, b;
    try { a = opener(od, ['KASE.md', 'kase.md'])('Kase.md'); b = opener(od, ['Foo.md', 'foo.md'])('foo.md'); } finally { undo(); }
    ok(a === 'kase.md', `ids are compared whole, not rounded to a double (got ${a})`);
    ok(b === 'foo.md', `a name the folder lists is itself, though another case opens the same file (got ${b})`);
  }

  // A store whose link leads nowhere is none.
  const gone = join(home, 'gone-target'), dang = join(root, 'C--dangling');
  mkdirSync(gone); mkdirSync(dang); symlinkSync(gone, join(dang, 'memory'), 'junction'); rmdirSync(gone);
  ok(!allStores().some((d) => d.includes('C--dangling')), 'allStores() skips a store whose link leads nowhere');

  // frontEnd() is the newline before the closing ---; none opened, or never closed, is -1 (search then reads the whole note).
  ok(frontEnd('---\na: b\n---\nbody') === 8 && frontEnd('---\r\na: b\r\n---\r\nbody') === 10, 'frontEnd is the newline before the closing ---');
  ok(frontEnd('---\na: b\nbody') === -1 && frontEnd('----\na: b\n---\n') === -1, 'unclosed, or opened by ----, frontEnd is -1');

  // Only the two files the plugin writes are indexes; a note may be named MEMORY-anything.md.
  ok(isIndex('MEMORY.md') && isIndex('MEMORY-archive.md'), 'the two index files are indexes');
  ok(!isIndex('MEMORY-leak.md') && !isIndex('MEMORY') && !isIndex('note.md'), 'any other name is a note');

  // The frontmatter ends at its closing line, empty or not, and an unclosed one is all there is.
  ok(front('---\n---\ntier: archive\n').tier === '', 'an empty frontmatter ends at once: the body is no frontmatter');
  ok(front('---\nname: abc').name === 'abc', 'an unclosed frontmatter is read to its last character');
  ok(front('----\nsome text\ntier: archive\ntype: feedback\n').tier === '' && front('----\ntype: feedback\n').type === '', 'a note that opens with ---- has no frontmatter: its body cannot archive it');
  ok(front('---\ndescription: |\n  a\n---x\n  b\ntier: archive\n---\n').tier === 'archive', 'a ---x line inside the frontmatter does not close it');
  ok(front('---\ndescription: |\n  a\n----\ntier: archive\n---\n').tier === 'archive', 'a ---- line inside the frontmatter does not close it');
  ok(front('---\r\ntier: hot\r\n---  \r\ntier: archive\r\n').tier === 'hot', 'a CRLF closing line, trailing blanks too, closes it');
  ok(front('---\ndescription: |\n  how to\n  tier: archive\n---\n').tier === '', 'a tier: line inside a block description is text, not the tier');
  ok(pointerLine('x.md', 'hello') === '- [x](x.md) — hello', 'a pointer line keeps the description from its first character');
}

// A repository whose folder name Claude Code shortens (past 200 characters, with a hash of its own) is not followed: a
// conversation in its subfolder keeps its handoff in its own folder. Under the whole long name, past the 255 characters a
// folder name can have, it saved nothing, and the failure's record failed too (audit H-F11). One of 200 is followed.
{
  // Six names: past 255 characters whatever the home's length (/tmp/... on Linux is short).
  const long = join(home, 'r', ...Array.from({ length: 6 }, (_, i) => `a-rather-long-repository-folder-name-number-${i}`));
  const at200 = join(home, 'q', 'x'.repeat(200 - slug(join(home, 'q')).length - 1));
  for (const repo of [long, at200]) { mkdirSync(join(repo, '.git'), { recursive: true }); mkdirSync(join(repo, 'web'), { recursive: true }); }
  const t = (repo) => {
    const f = join(root, `${slug(join(repo, 'web')).slice(0, 200)}-1a2b3c`), p = join(f, `${basename(repo)}.jsonl`);
    mkdirSync(f, { recursive: true });
    writeFileSync(p, JSON.stringify({ type: 'user', cwd: join(repo, 'web'), message: { content: 'q' } }) + '\n');
    return p;
  };
  const tl = t(long), t2 = t(at200);
  ok(slug(long).length > 255 && storeOf({ transcript_path: tl }) === join(dirname(tl), 'memory'), `a repository named past 200 characters is not followed: the conversation's own folder (got ${storeOf({ transcript_path: tl })})`);
  ok(slug(at200).length === 200 && storeOf({ transcript_path: t2 }) === join(root, slug(at200), 'memory'), `one of exactly 200 is (got ${storeOf({ transcript_path: t2 })})`);
  for (const p of [tl, t2]) rmSync(dirname(p), { recursive: true, force: true });
  rmSync(join(home, 'r'), { recursive: true, force: true }); rmSync(join(home, 'q'), { recursive: true, force: true });
}
// A temp copy a killed hook left (`<file>.tmp<pid>`) goes: its writer is gone, or it is older than a held lock can be. It
// can hold text forget then removed (audit H-F3). One a live writer may still rename stays.
{
  const d = join(root, 'C--temps', 'memory'), j = join(d, 'journal');
  mkdirSync(j, { recursive: true });
  const gone = spawnSync(process.execPath, ['-e', '']).pid, old = new Date(Date.now() - 60_000);
  const put = (p, aged = false) => { writeFileSync(p, 'the vault word'); if (aged) utimesSync(p, old, old); return p; };
  const deadDay = put(join(j, `2026-11-01.md.tmp${gone}`)), deadHandoff = put(join(d, `handoff.md.tmp${gone}`));
  // This process is the live writer: no other process is asked about (a mutant that sends a real signal hits only this one).
  const mine = put(join(d, `MEMORY.md.tmp${process.pid}`)), live = put(join(j, `.imported.tmp${process.pid}`)), stale = put(join(d, `MEMORY-archive.md.tmp${process.pid}`), true);
  const note = put(join(d, 'tmp123.md')), deadList = put(join(j, `.forgotten.tmp${gone}`));
  // Only this tool's names (a note, an index, a day: `.md`; a list: a dotfile): a user's own file of that shape is theirs.
  const users = [put(join(d, `x.tmp${gone}`), true), put(join(j, `notes.txt.tmp${gone}`), true)];
  sweepTemps(d);
  ok(!existsSync(deadDay) && !existsSync(deadHandoff) && !existsSync(stale) && !existsSync(deadList), "a temp copy whose writer is gone, or older than 30 s, is swept from the store and its journal");
  ok(existsSync(mine) && existsSync(live) && existsSync(note), "one a live writer may still rename stays, and so does a note that only looks like one");
  ok(users.every((p) => existsSync(p)), "and a user's own file named like a temp copy (x.tmp5) stays");
  rmSync(join(root, 'C--temps'), { recursive: true, force: true });
}

// 99. A project turned off (memory off) is a marker in its store: isOff says since when, fails closed on a marker it cannot stat.
{
  const { isOff, PROJECT_OFF } = await import('../src/privacy.mjs');
  const od = join(root, 'C--off-project', 'memory');
  mkdirSync(od, { recursive: true });
  ok(PROJECT_OFF === '.project-off' && isOff(od) === null, 'no marker: not off');
  ok(isOff(join(od, 'no', 'such')) === null, 'no store folder: not off');
  writeFileSync(join(od, PROJECT_OFF), JSON.stringify({ t: 1700000000000 }));
  ok(isOff(od)?.since === 1700000000000, 'a marker is off, since the time it holds');
  writeFileSync(join(od, PROJECT_OFF), 'not json');
  ok(isOff(od) && isOff(od).since === null, 'a marker that does not read is still off, since an unknown date');
  rmSync(join(od, PROJECT_OFF));
  // A marker that cannot be stat'ed stays off (fails closed); EACCES on a stat cannot be made real on Windows, so inject it.
  const real = fs.lstatSync;
  fs.lstatSync = (p, ...a) => { if (String(p).endsWith(PROJECT_OFF)) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return real(p, ...a); };
  syncBuiltinESMExports();
  try {
    const r = isOff(od);
    ok(r && r.unread === 'EACCES' && r.since === null, 'a marker that cannot be statted is off, and says why');
  } finally { fs.lstatSync = real; syncBuiltinESMExports(); }
  ok(isOff(od) === null, 'and with the stat working again, not off');
}

// B7: a turn whose time is unknown (a record with no timestamp) cannot be placed outside a period the project was off: it is kept out
// once the project has been off, and kept as before when it never was.
{
  const wd = join(home, 'wasoff-store'); mkdirSync(wd, { recursive: true });
  const unknown = { ms: NaN };
  ok(!wasOff(wd)(unknown), 'no off period: a turn of unknown time is kept');
  writeFileSync(join(wd, OFF_PERIODS), '1000 2000\n');
  ok(wasOff(wd)(unknown), 'with an off period, a turn of unknown time is kept out');
  ok(wasOff(wd)({ ms: 1500 }) && !wasOff(wd)({ ms: 3000 }), 'a turn of known time goes by the periods as before');
}

// Fake secrets, built from pieces so no scanner sees a literal.
const GH = ['gh', 'p_', 'Zq8Xk2Lm4Nv6Bt1Rw3Ys5Df7Gh9Jk0Pa2Cd4'].join(''), PW = ['Zx9', 'Qv', '7!', 'mT3', 'kLp'].join('');
// Paths that skipped redact (1.4.1 J): an index line, a stored failure reason and git's reason hold no secret.
{
  const line = pointerLine(`n-${GH}.md`, `token ${GH} and password: ${PW}`);
  const shown = line.replace(`](n-${GH}.md)`, "]()");
  ok(!shown.includes(GH) && !shown.includes(PW), "a pointer line shows no token in its label or description");
  ok(line.includes(`](n-${GH}.md)`) || line.includes(`](n-${GH}.md `), 'the pointer line still links the real file name, so the note is found by its own line');
  ok(!reason(new Error(`bad JSON (near "{"token": "${GH}"}")`)).includes(GH), 'reason() of an error quoting a token holds none');
  const e = Object.assign(new Error('Command failed: git push'), { stderr: `fatal: unable to access 'https://bob:${PW}@example.com/r.git/': Could not resolve host
` });
  ok(!gitWhy(e).includes(PW), 'gitWhy() of a credentialed URL holds no password');
}

// keyed: n hex characters of an HMAC under a per-machine salt, kept in a file made with its folders; a short salt file is the salt.
{
  const was = process.env.CLAUDE_CONFIG_DIR, cfgK = join(home, 'keyed-cfg', 'deeper');   // none of its folders exist yet
  process.env.CLAUDE_CONFIG_DIR = cfgK;
  try {
    const f = join(cfgK, 'projects', '.hash-salt'), hmac = (salt, text, n) => createHmac('sha256', salt).update(text).digest('hex').slice(0, n);
    const a = keyed('hello', 12);
    ok(existsSync(f) && readFileSync(f, 'utf8').length === 64, 'the salt is made, with its folders, at the first fingerprint');
    ok(a === hmac(readFileSync(f, 'utf8'), 'hello', 12) && keyed('hello', 12) === a && keyed('world', 12) !== a, 'a fingerprint is the salted HMAC of its text, the same each time');
    ok(keyed('hello', 1).length === 1 && keyed('hello', 12).length === 12 && keyed('hello', 64).length === 64, 'and as long as asked');
    writeFileSync(f, 'short');
    ok(keyed('x', 16) === hmac('short', 'x', 16) && keyed('x', 16) === keyed('x', 16), 'a salt file under 32 characters is still the salt, and not written over');
    writeFileSync(f, 'k'.repeat(32));
    ok(keyed('x', 16) === hmac('k'.repeat(32), 'x', 16) && readFileSync(f, 'utf8') === 'k'.repeat(32), 'a salt file of exactly 32 characters is kept');
  } finally { if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = was; }
}

// The managed settings folder Claude Code reads on each system (autoMemory with no `managed` given).
{
  const platform = Object.getOwnPropertyDescriptor(process, 'platform'), want = { win32: 'C:/Program Files/ClaudeCode', darwin: '/Library/Application Support/ClaudeCode', linux: '/etc/claude-code' };
  for (const [p, path] of Object.entries(want)) {
    Object.defineProperty(process, 'platform', { value: p });
    let first = null; const real = fs.readdirSync;
    try {
      const m = await import(`../src/store.mjs?managed-${p}`);
      fs.readdirSync = function (d, ...a) { first ??= String(d); return real.call(this, d, ...a); }; syncBuiltinESMExports();
      m.autoMemory({ cwd: join(home, 'no-such-project') });
    } finally { fs.readdirSync = real; syncBuiltinESMExports(); Object.defineProperty(process, 'platform', platform); }
    ok(first?.replace(/\\/g, '/') === `${path}/managed-settings.d`, `managed settings are read from ${path} on ${p} (got ${first})`);
  }
}

// wasOff: a turn is inside a period when its time is from it to its end, both ends counted, in any one of them.
{
  const d = join(home, 'periods'); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, OFF_PERIODS), '100 200\n300 400\n');
  const was = wasOff(d);
  ok([100, 150, 200, 300, 350, 400].every((ms) => was({ ms })) && [99, 201, 250, 299, 401].every((ms) => !was({ ms })), 'a turn is inside a period from its start to its end, both counted');
  ok(offSince({ since: new Date(2026, 0, 15, 12, 30).getTime() }) === '2026-01-15' && offSince({ since: null }) === 'an unknown date', 'a project off since a day is told by the day');
}

// opener: a name the folder does not hold is itself; two spellings of different files stay as asked; one file is its listed name.
{
  const od = join(home, 'opener-dir'); mkdirSync(od, { recursive: true });
  ok(opener(od, ['kase.md'])('KASE.md') === 'KASE.md', 'a name nothing in the folder opens is itself');
  const real = fs.statSync; let same_ = false, gone = false;
  fs.statSync = function (p, o) { const s = String(p); if (gone && s.endsWith('Kase.md')) throw Object.assign(new Error('gone'), { code: 'ENOENT' }); return o?.bigint && s.startsWith(od) ? { dev: 1n, ino: s.endsWith('Kase.md') ? 2n : same_ ? 2n : 3n } : real.call(this, p, o); }; syncBuiltinESMExports();
  try {
    ok(opener(od, ['kase.md'])('Kase.md') === 'Kase.md', 'two spellings that open different files keep the name asked for');
    same_ = true;
    ok(opener(od, ['kase.md'])('Kase.md') === 'kase.md', 'one that opens the same file is the listed name');
    gone = true;
    ok(opener(od, ['kase.md'])('Kase.md') === 'Kase.md', 'a spelling that opens nothing is itself');
  } finally { fs.statSync = real; syncBuiltinESMExports(); }
}

// withLock's own token, and a lock released or kept by who holds it.
{
  const lk = join(dir, '.lock'), owner = join(lk, 'owner');
  const rnd = Math.random; Math.random = () => 0.5; let seen;
  try { withLock(dir, () => { seen = readFileSync(owner, 'utf8'); }); } finally { Math.random = rnd; }
  ok(seen === `${process.pid}.i`, `the owner file names the process and a random token (got ${seen})`);
  // An owner file the disk refused: the lock is still ours and is released.
  const wf = fs.writeFileSync;
  fs.writeFileSync = function (p, ...a) { if (String(p) === owner) throw Object.assign(new Error('refused'), { code: 'EACCES' }); return wf.call(this, p, ...a); }; syncBuiltinESMExports();
  try { ok(withLock(dir, () => 'got') === 'got' && !existsSync(lk), 'a lock whose owner file could not be written is released'); } finally { fs.writeFileSync = wf; syncBuiltinESMExports(); rmSync(lk, { recursive: true, force: true }); }
  // A lock taken over meanwhile, its new holder not yet signed, is not ours to remove.
  withLock(dir, () => { rmSync(lk, { recursive: true }); mkdirSync(lk); });
  ok(existsSync(lk), 'a lock another holder made, with no owner file yet, is left alone');
  rmSync(lk, { recursive: true });
}

// tag(): the first 8 characters of a session id; none for a missing id.
ok(tag('abcdefghij') === 'abcdefgh' && tag('abcdefgh') === 'abcdefgh' && tag('abc') === 'abc' && tag('') === '' && tag(null) === '' && tag(undefined) === '' && tag(0) === '', 'a session tag is the first 8 characters of its id, empty with no id');

// The page of the journal: one file in Claude Code's folder, written whole and mode 0600, and gone when dropPage runs.
{
  const { pagePath, writePage, dropPage, claimPage, configDir } = await import('../src/store.mjs');
  const here = process.env.CLAUDE_CONFIG_DIR;
  const cfg = join(home, 'my config é');
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    ok(pagePath() === join(cfg, 'project-memory', 'journal.html') && configDir() === resolve(cfg), `the page is project-memory/journal.html in Claude Code's folder (got ${pagePath()})`);
    ok(dropPage() === false, 'dropping a page that is not there is no error, and says nothing was dropped');
    ok(writePage('<p>one</p>') === pagePath() && readFileSync(pagePath(), 'utf8') === '<p>one</p>', 'the page is written where pagePath says');
    ok(writePage('<p>two</p>') === pagePath() && readFileSync(pagePath(), 'utf8') === '<p>two</p>', 'and written again over the first');
    if (process.platform !== 'win32') ok((statSync(pagePath()).mode & 0o777) === 0o600 && (statSync(dirname(pagePath())).mode & 0o777) === 0o700, 'the file is 0600 and its folder 0700');
    ok(readdirSync(dirname(pagePath())).join() === 'journal.html', 'no temporary file is left');
    ok(dropPage() === true && !existsSync(pagePath()), 'dropPage removes it and says so');
    ok(dropPage() === false, 'a second time there is nothing to remove');
    mkdirSync(pagePath(), { recursive: true });
    const bad = dropPage();
    ok(bad instanceof Error && existsSync(pagePath()), 'a path that will not go (a folder) is no throw, it runs in the hooks: the error comes back, for the commands to say');
    rmSync(pagePath(), { recursive: true });
    // A kill between the write and the rename leaves journal.html.<pid>.tmp with journal text: dropPage takes every such file; writePage only its own pid's, since another live run's is being written.
    const strays = () => { for (const n of ['journal.html.123.tmp', 'journal.html.x.y.tmp']) writeFileSync(join(dirname(pagePath()), n), 'text'); writeFileSync(join(dirname(pagePath()), 'keep.txt'), 'mine'); };
    strays(); writeFileSync(`${pagePath()}.${process.pid}.tmp`, 'old'); writePage('<p>three</p>');
    ok(readdirSync(dirname(pagePath())).sort().join() === 'journal.html,journal.html.123.tmp,journal.html.x.y.tmp,keep.txt' && readFileSync(pagePath(), 'utf8') === '<p>three</p>', "writePage replaces its own pid's leftover and leaves another run's temp file alone");
    strays(); ok(dropPage() === true && readdirSync(dirname(pagePath())).join() === 'keep.txt', 'dropPage takes them too');
    strays(); ok(dropPage() === false && readdirSync(dirname(pagePath())).join() === 'keep.txt', 'and with no page, they still go, and it says no page was there');
    rmSync(join(dirname(pagePath()), 'keep.txt'));
    // A page run's claim on what it read: a file beside the page, taken by dropPage, kept by writePage.
    const tok = claimPage(), mine = `${pagePath()}.${process.pid}.reading`;
    ok(tok === mine && existsSync(tok), 'claimPage makes journal.html.<pid>.reading and says where');
    writePage('<p>four</p>'); ok(existsSync(tok), 'a write leaves the claim for its owner to remove');
    writeFileSync(join(dirname(pagePath()), 'journal.html.77.reading'), '');
    ok(dropPage() === true && readdirSync(dirname(pagePath())).length === 0, 'dropPage takes every claim, its own and another run\'s');
    ok(claimPage() === mine && dropPage() === false && readdirSync(dirname(pagePath())).length === 0, 'and with no page it takes them too, and says no page was there');
  } finally { if (here === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = here; }
}

console.log(`store: ${checks} checks passed`);
