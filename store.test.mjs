// Self-check for store.mjs: whose store a payload names, a lock two processes
// never hold at once, a dead lock taken over, a held one given up on, and a
// replace that will not overwrite a write it did not see. Run: node store.test.mjs
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, rmdirSync, rmSync, readdirSync, symlinkSync, chmodSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { tool, tempHome } from './harness.mjs';

const { home, env } = tempHome('store-test-');
process.env.HOME = home; process.env.USERPROFILE = home;
const { storeOf, withLock, replaceIfUnchanged, sharedStore, isShared, budgetOf, local, front, gitWhy, allStores } = await import('./store.mjs');
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
// Each store once: a project whose memory is a junction to another's is one store.
const realStore = join(root, 'C--real', 'memory');
mkdirSync(realStore, { recursive: true });
writeFileSync(join(realStore, 'MEMORY.md'), '');
mkdirSync(join(root, 'C--via-junction'));
symlinkSync(realStore, join(root, 'C--via-junction', 'memory'), 'junction');
ok(allStores().filter((d) => /C--(real|via-junction)/.test(d)).length === 1, 'allStores() lists a store reached by two paths once');

// 2. Six processes contend for one store: never two inside at once.
const log = join(home, 'lock.log');
writeFileSync(log, '');
const child = `
import { withLock } from ${JSON.stringify(pathToFileURL(tool('store.mjs')).href)};
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

// 3. A lock a killed hook left behind is taken over; a live one is waited on, then given up.
mkdirSync(join(dir, '.lock'));
const old = new Date(Date.now() - 60_000);
utimesSync(join(dir, '.lock'), old, old);
ok(withLock(dir, () => 'got') === 'got' && !existsSync(join(dir, '.lock')), 'a lock older than 30 s is taken over');
mkdirSync(join(dir, '.lock'));
const t0 = Date.now();
ok(withLock(dir, () => 'got') === null && Date.now() - t0 >= 1900, 'a held lock is given up on after about 2 s, with null');
rmdirSync(join(dir, '.lock'));
let threw = false;
try { withLock(dir, () => { throw new Error('boom'); }); } catch { threw = true; }
ok(threw && !existsSync(join(dir, '.lock')), 'a throw inside still releases the lock');

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
// One that cannot be removed -- on Windows another process's working folder,
// elsewhere one in a read-only folder -- throws once the wait is up, so the
// pass that fails says so in .health. Busy every turn was silence.
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

// EACCES is one more way Windows says a path is settling -- a rename already
// retries on it. On the lock it threw, and the turn's handoff was skipped.
const realMkdir = fs.mkdirSync;
let refusals = 1;
fs.mkdirSync = function (p, ...a) {
  if (String(p).endsWith('.lock') && refusals-- > 0) throw Object.assign(new Error('EACCES: permission denied, mkdir'), { code: 'EACCES' });
  return realMkdir.call(this, p, ...a);
};
syncBuiltinESMExports();
let eacces;
try { eacces = withLock(dir, () => 'got'); } catch (e) { eacces = e.code; }
fs.mkdirSync = realMkdir;
syncBuiltinESMExports();
ok(eacces === 'got' && refusals < 0, `an EACCES on the lock is waited out like EPERM (got ${eacces})`);

// 4. A junction to the store is the same store: one lock between both names.
const alias = join(root, 'C--some-project-alias');
mkdirSync(alias);
symlinkSync(dir, join(alias, 'memory'), 'junction');
ok(withLock(join(alias, 'memory'), () => withLock(dir, () => 'inner')) === null, 'a lock taken through a junction holds the real path too');

// 5. Replace only what was read.
const f = join(dir, 'x.md');
writeFileSync(f, 'one');
ok(replaceIfUnchanged(f, 'one', 'two') === true && readFileSync(f, 'utf8') === 'two', 'replaces a file that still holds what was read');
ok(replaceIfUnchanged(f, 'two', 'two') === false, 'says so when there is nothing to write');
writeFileSync(f, 'the model wrote this');
ok(replaceIfUnchanged(f, 'two', 'three') === 'conflict' && readFileSync(f, 'utf8') === 'the model wrote this', 'a write it did not see is kept');
ok(replaceIfUnchanged(join(dir, 'new.md'), null, 'fresh') === true && readFileSync(join(dir, 'new.md'), 'utf8') === 'fresh', 'a file that did not exist is created');
ok(replaceIfUnchanged(join(dir, 'new.md'), null, 'again') === 'conflict', 'and one that appeared meanwhile is not overwritten');
ok(!readdirSync(dir).some((x) => x.includes('.tmp')), 'no temp file is left behind');

// A value stays on its line, the body is no frontmatter, and CRLF keeps quotes off.
const emptied = front('---\nname: a\nsuperseded-by:\nmetadata:\n  type: project\n---\nbody');
ok(emptied.superseded === '' && emptied.tier === '' && emptied.type === 'project', `an empty superseded-by: is empty (got ${JSON.stringify(emptied)})`);
ok(front('---\nname: fmt\n---\nHow to retire a note:\n  superseded-by: new.md\n  tier: archive\n').tier === '', 'a body that quotes the format does not archive its note');
ok(front('---\r\nname: crlf\r\ndescription: "quoted"\r\n---\r\n').desc === 'quoted' && front('\uFEFF---\nname: bom\n---\n').name === 'bom', 'CRLF and a BOM read the same');

console.log(`store: ${checks} checks passed`);
