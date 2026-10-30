// Self-check for store.mjs: whose store a payload names, a lock two processes
// never hold at once, a dead lock taken over, a held one given up on, and a
// replace that will not overwrite a write it did not see. Run: node store.test.mjs
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, rmdirSync, rmSync, readdirSync, symlinkSync, chmodSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { join, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { tool, tempHome, quick, fastClock, slug } from './harness.mjs';

const { home, env } = tempHome('store-test-');
const { storeOf, withLock, replaceIfUnchanged, sharedStore, isShared, budgetOf, local, front, gitWhy, allStores, pointerLine, POINTER, inProjects, transcriptKey, listOf, opener, same, sleep } = await import('./store.mjs');
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
// Round 6. On Windows, two links to one folder spelt in two cases are one store,
// as the snapshot reads them: listed twice, doctor said one was left out.
if (process.platform === 'win32') {
  const out19 = join(home, 'Synced19', 'memory'); mkdirSync(out19, { recursive: true }); writeFileSync(join(out19, 'MEMORY.md'), '');
  mkdirSync(join(root, 'C--a19')); mkdirSync(join(root, 'C--b19'));
  symlinkSync(out19, join(root, 'C--a19', 'memory'), 'junction');
  symlinkSync(join(home, 'SYNCED19', 'MEMORY'), join(root, 'C--b19', 'memory'), 'junction');
  ok(allStores().filter((d) => /C--[ab]19/.test(d)).length === 1, 'two links to one folder spelt in two cases are one store');
}

// 2. Six processes contend for one store: never two inside at once.
if (!quick) {
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
  const blanks = ' '.repeat(50_000), t0 = Date.now();
  const f = front(`---\nname: n${blanks}x\ndescription: d${blanks}\nsuperseded-by: ${blanks}#\ntype:\n ${blanks}\n---\n`);
  ok(Date.now() - t0 < 1000 && f.desc === 'd' && f.superseded === '', `a value with 50,000 blanks is read in linear time (${Date.now() - t0} ms, ${JSON.stringify(f).slice(0, 80)})`);
}

// A transcript is in the projects folder by its resolved path: `<projects>/../x`
// is not. Its key is `<folder>/<session>`.
{
  const { projectsRoot } = await import('./store.mjs');
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

// A value stays on its line, the body is no frontmatter, and CRLF keeps quotes off.
const emptied = front('---\nname: a\nsuperseded-by:\nmetadata:\n  type: project\n---\nbody');
ok(emptied.superseded === '' && emptied.tier === '' && emptied.type === 'project', `an empty superseded-by: is empty (got ${JSON.stringify(emptied)})`);
ok(front('---\nname: fmt\n---\nHow to retire a note:\n  superseded-by: new.md\n  tier: archive\n').tier === '', 'a body that quotes the format does not archive its note');
ok(front('---\r\nname: crlf\r\ndescription: "quoted"\r\n---\r\n').desc === 'quoted' && front('\uFEFF---\nname: bom\n---\n').name === 'bom', 'CRLF and a BOM read the same');

// 1.1.0. A pointer names a file in the store, by its name: a web link was a
// memory with no file at every startup, and `../../big.bin` was read whole by
// every Stop.
ok(POINTER.test('- [a](a.md) \u2014 x') && !POINTER.test('- [Repo](https://github.com/x/y) \u2014 the code') && !POINTER.test('- [x](../../big.bin) \u2014 x') && !POINTER.test('- [x](C:\\big.bin) \u2014 x'),
  'a pointer names a file in the store, never a link or a path');
// A date alone is that day where the user is: read as UTC midnight, it printed
// as the day before west of Greenwich. Checked there: in UTC (GitHub's
// machines) the two readings agree, and the check caught nothing.
{
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try { ok(local(front('---\nmodified: 2025-09-01\n---\n').modified).startsWith('2025-09-01 00:00'), 'a modified: date alone is that day, here'); }
  finally { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; }
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
const { gitArgs } = await import('./store.mjs');
const ga = gitArgs('status');
ok(ga.includes('commit.gpgsign=false') && ga.includes('core.longpaths=true') && ga.some((a) => /^core\.hooksPath=.*no-hooks$/.test(a)) && ga.at(-1) === 'status',
  `the snapshot repo's git turns off signing and hooks, and on long paths (got ${ga.join(' ')})`);
ok(gitWhy({ code: 'ENOENT', syscall: 'spawnSync git', message: 'spawnSync git ENOENT' }) === 'git is not installed', 'no git is said in words, not as spawnSync git ENOENT');
// A file gone between two calls is ENOENT too, and is no missing git.
ok(gitWhy({ code: 'ENOENT', syscall: 'unlink', message: "ENOENT: no such file or directory, unlink 'x\\index.lock'" }) !== 'git is not installed', 'a vanished lock is not "git is not installed"');

// Round 3 (2026-10-27).
{
  const { repoRoot, projectsRoot, memoryOff } = await import('./store.mjs');
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
  // Claude Code's folder where CLAUDE_CONFIG_DIR puts it, and a project folder
  // named by CLAUDE_CODE_PROJECT_DIR_NAME: under either, the hooks wrote nothing.
  const cfg = join(home, 'cfg');
  process.env.CLAUDE_CONFIG_DIR = cfg;
  let named, rooted;
  try { rooted = projectsRoot(); process.env.CLAUDE_CODE_PROJECT_DIR_NAME = 'shared-name'; named = storeOf({ cwd: sub }); }
  finally { delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME; }
  ok(rooted === join(cfg, 'projects') && named === join(cfg, 'projects', 'shared-name', 'memory'), `CLAUDE_CONFIG_DIR and CLAUDE_CODE_PROJECT_DIR_NAME are followed (got ${rooted} | ${named})`);
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
  ok(!existsSync(viaJ) || repoRoot(viaJ) === repo, `a worktree through a junction maps to its repository (got ${existsSync(viaJ) ? repoRoot(viaJ) : 'no junction'})`);
  process.env.CLAUDE_CONFIG_DIR = cfg; process.env.CLAUDE_CODE_PROJECT_DIR_NAME = '_shared';
  let notShared; try { notShared = storeOf({ cwd: sub }); } finally { delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CLAUDE_CODE_PROJECT_DIR_NAME; }
  ok(notShared === join(cfg, 'projects', slug(repo), 'memory'), `a project folder named _shared is ignored (got ${notShared})`);

  for (const [v, want] of [['1', true], ['true', true], ['0', false], ['', false]]) {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = v;
    try { ok(memoryOff() === want, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=${JSON.stringify(v)} is ${want ? 'off' : 'on'}`); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
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
  const { gitArgs, projectsRoot } = await import('./store.mjs');
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

  // The clock: a lock is stale after 30 s (mtime + 30 s exactly is not), and the wait is 2 s.
  const M = (Math.floor(Date.now() / 1000) - 1000) * 1000;
  const clockRun = (script, rmErrors = [], vanish = false) => {
    mkdirSync(lockPath); utimesSync(lockPath, M / 1000, M / 1000);
    const realNow = Date.now; let i = 0, k = 0;
    Date.now = () => M + script[Math.min(i++, script.length - 1)];
    const undoRm = patch('rmSync', (real) => function (p, o) { if (String(p).endsWith('.lock') && k < rmErrors.length) throw rmErrors[k++]; return real.call(this, p, o); });
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
  // again, three times, after 50 ms.
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
  ok(stuck.res === 'EBUSY' && stuck.attempts === 4, `and given up on after the fourth refusal (got ${stuck.res} after ${stuck.attempts})`);
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
  const { repoRoot } = await import('./store.mjs');
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

  // The frontmatter ends at its closing line, empty or not, and an unclosed one is all there is.
  ok(front('---\n---\ntier: archive\n').tier === '', 'an empty frontmatter ends at once: the body is no frontmatter');
  ok(front('---\nname: abc').name === 'abc', 'an unclosed frontmatter is read to its last character');
  ok(pointerLine('x.md', 'hello') === '- [x](x.md) — hello', 'a pointer line keeps the description from its first character');
}

console.log(`store: ${checks} checks passed`);
