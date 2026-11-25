// Self-check for snapshot.mjs, called in this process with a scripted git in place of the real one (useGit): how a failure of git is
// mapped (off, in parts, busy, failed), a damaged index rebuilt once, a note held back, the health record after a failure and after
// a success, and a missing or a broken health file. The expected values are what snapshot() answered before it moved out of
// memory-tier.mjs. Real git stays in memory-tier.test.mjs. Run: node snapshot.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, utimesSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome } from './harness.mjs';

const { home } = tempHome('snapshot-test-');
const { projectsRoot } = await import('../src/store.mjs');
const S = await import('../src/snapshot.mjs');
const { snapshot, snapshotHealth, owed, reset, useGit, gitWhy, gitArgs } = S;

let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

const root = projectsRoot(), g = join(root, '.git');
const fail = (message, extra) => Object.assign(new Error(message), extra);
// The stand-in: `script(sub, args, opts)` answers each git command by its name (the words after the fixed -c settings), or throws.
// Every call is kept in `calls`, as `sub args...`.
let calls = [];
const scripted = (script) => {
  calls = [];
  useGit((cmd, args, opts) => {
    assert(cmd === 'git', 'only git is run');
    const a = args.slice(args.findIndex((x) => x.startsWith('core.hooksPath=')) + 1);
    calls.push(a.join(' '));
    return script(a[0] === '-c' ? a[4] : a[0], a, opts);
  });
};
const health = () => JSON.parse(readFileSync(join(root, '.snapshot-health'), 'utf8'));
const store = (name, body = 'x\n') => { const d = join(root, name, 'memory'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'MEMORY.md'), '- [a](a.md) — a\n'); writeFileSync(join(d, 'a.md'), body); return d; };
// A repository this tool made: its config carries the mark, so nothing is adopted or initialised.
const ours = () => { mkdirSync(g, { recursive: true }); writeFileSync(join(g, 'config'), '[project-memory]\n\tsnapshots = true\n'); };

mkdirSync(root, { recursive: true });
ok(root.startsWith(home), 'the projects root is under the throwaway HOME');

// How a failure of git maps to the answer.
{
  scripted(() => { throw fail('spawnSync git ENOENT', { code: 'ENOENT', syscall: 'spawnSync git' }); });
  ok(snapshot() === 'off: git is not installed', 'no git is off, not a failure');
  ok(calls.length === 1 && calls[0] === 'init -q', 'the first call of a new repository is git init');
  ok(existsSync(join(root, '.gitignore')), 'a new repository gets its .gitignore before git runs');

  ours();
  scripted(() => { throw fail('Command failed: git', { code: 'ETIMEDOUT' }); });
  ok(snapshot({ gitWait: 5000 }) === 'snapshot failed: git took longer than 5 s; the next replies take the history in parts', 'a timeout is in parts, with the time said');
  ok(existsSync(join(g, 'project-memory-parts')), 'a timeout leaves the mark that takes the next history in parts');
  scripted(() => { throw fail('Command failed: git', { code: 'ETIMEDOUT' }); });
  ok(snapshot().includes('took longer than 30 s'), 'the default timeout is 30 s');

  for (const [why, busy] of [
    ["fatal: Unable to create '/r/.git/index.lock': File exists.", true],
    ["error: cannot lock ref 'refs/heads/main': is at abc but expected def", true],
    ["fatal: cannot lock ref 'HEAD': reference already exists", true],
    ['error: could not lock config file /r/.git/config: File exists', true],
    ["fatal: Unable to create '/r/.git/index.lock': Permission denied", false],
    ['fatal: something else broke', false],
  ]) {
    scripted(() => { throw fail('Command failed: git x', { stderr: `warning: ignored\n${why}\n`, status: 128 }); });
    const r = snapshot();
    ok(busy ? r === 'busy' : r === `snapshot failed: ${why}`, `"${why}" is ${busy ? 'busy' : 'a failure'} (got ${r})`);
  }
}

// A fresh lock is busy before any git runs; an old one is swept.
{
  scripted(() => '');
  writeFileSync(join(g, 'index.lock'), '');
  ok(snapshot() === 'busy' && calls.length === 0, 'a fresh index.lock is busy, and git is not run');
  const old = new Date(Date.now() - 11 * 60000);
  utimesSync(join(g, 'index.lock'), old, old);
  writeFileSync(join(g, 'index'), '');
  scripted(() => '');
  ok(snapshot() === 'committed' && !existsSync(join(g, 'index.lock')), 'a lock older than ten minutes is removed, and the snapshot goes on');
}

// A damaged index is rebuilt once: dropped, reset from the commit, and the add tried again.
{
  writeFileSync(join(g, 'index'), 'torn');
  let adds = 0;
  scripted((sub) => { if (sub === 'add' && ++adds === 1) throw fail('Command failed: git add', { stderr: 'error: index file smaller than expected\n' }); return ''; });
  ok(snapshot() === 'committed', 'a damaged index is rebuilt and the snapshot commits');
  ok(adds === 2 && calls.includes('reset -q') && !existsSync(join(g, 'index')) , 'the index was dropped, reset once, and the add run again');
  adds = 0;
  scripted((sub) => { if (sub === 'add') { adds++; throw fail('Command failed: git add', { stderr: 'error: index file smaller than expected\n' }); } return ''; });
  writeFileSync(join(g, 'index'), 'torn');
  ok(snapshot().startsWith('snapshot failed: error: index file smaller than expected') && adds === 2, 'a second damage is a failure, not another rebuild');
}

// Held and missed.
{
  store('p');
  const secret = 'password: hunter2hunter2\n', blob = `${'a'.repeat(40)} blob ${Buffer.byteLength(secret)}\n${secret}\n`;
  writeFileSync(join(g, 'index'), '');
  scripted((sub, a) => {
    if (sub === 'diff' && a.includes('--cached')) return 'p/memory/a.md\0';
    if (sub === 'cat-file') return Buffer.from(blob);
    return '';
  });
  reset();
  ok(snapshot() === 'committed', 'a held note alone does not stop the commit');
  ok(calls.includes('reset -q -- :(literal)p/memory/a.md'), 'the note that holds a secret is unstaged');
  snapshotHealth('committed');
  ok(JSON.stringify(health().held) === '["p/memory/a.md"]' && health().failures === 0, 'the health record names the held note');
  reset(); snapshotHealth('committed');
  ok(!('held' in health()) && !('missed' in health()), 'reset() empties held and missed');

  // A store linked to a folder outside the root: missed when git has none of its index.
  const out = join(home, 'Synced', 'memory'); mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'MEMORY.md'), '- [b](b.md) — b\n'); writeFileSync(join(out, 'b.md'), 'y\n');
  mkdirSync(join(root, 'C--ext'), { recursive: true });
  symlinkSync(out, join(root, 'C--ext', 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
  scripted(() => '');
  snapshot(); snapshotHealth('committed');
  ok(health().missed?.length === 1 && /C--ext/.test(health().missed[0]), 'a linked store git has no index of is missed');
  scripted((sub, a) => (sub === 'ls-files' && a.includes('--') && /C--ext/.test(a.join(' ')) ? 'C--ext/memory/MEMORY.md\n' : ''));
  reset(); snapshot(); snapshotHealth('committed');
  ok(!('missed' in health()), 'a linked store git does hold is not missed');
}

// The health record: counts after failures and after a success, then the other answers.
{
  reset();
  const p = join(root, '.snapshot-health'); rmSync(p, { force: true });
  ok(owed() === false, 'no health file: nothing owed');
  snapshotHealth('snapshot failed: boom');
  let h = health();
  ok(h.failures === 1 && h.error === 'boom' && h.pending === true && h.lastOk === null, 'one failure is counted, with its reason, and the snapshot is owed');
  ok(owed() === true, 'a failed snapshot is owed');
  snapshotHealth('snapshot failed: boom');
  ok(health().failures === 2, 'the failures in a row add up');
  snapshotHealth('committed');
  h = health();
  ok(h.failures === 0 && !('pending' in h) && !('error' in h) && typeof h.lastOk === 'string', 'a success clears the failures and what is owed');
  ok(owed() === false, 'a committed snapshot owes nothing');
  const lastOk = h.lastOk;
  snapshotHealth('in parts: 7 file(s) still to add; each reply adds more');
  ok(health().partial === 7 && health().pending === true && health().failures === 0, 'a snapshot in parts says how many files are left, and is owed');
  snapshotHealth('off: git is not installed');
  h = health();
  ok(h.off === 'git is not installed' && h.failures === 0 && typeof h.lastOk === 'string' && !('pending' in h), 'off is recorded with no failure');
  snapshotHealth('busy');
  h = health();
  ok(h.pending === true && typeof h.busySince === 'string' && !('failures' in h && h.failures > 0) && h.lastOk !== undefined, 'busy is owed, and not counted at first');
  writeFileSync(p, JSON.stringify({ lastOk, failures: 0, pending: true, busySince: new Date(Date.now() - 11 * 60000).toISOString() }));
  snapshotHealth('busy');
  ok(health().failures === 1 && /^busy since .*: another git holds the repository's lock$/.test(health().error), 'busy for longer than ten minutes is counted as a failure');

  writeFileSync(p, '{ not json');
  ok(owed() === false, 'a broken health file owes nothing');
  snapshotHealth('snapshot failed: again');
  ok(health().failures === 1, 'a broken health file starts the counts again');
  writeFileSync(p, 'null');
  snapshotHealth('snapshot failed: again');
  ok(health().failures === 1, 'a null health file reads as empty');
}

// What the git settings are, and how a failure is worded.
{
  const a = gitArgs('status');
  ok(a[0] === '-C' && a[1] === root && a.at(-1) === 'status' && a.includes('commit.gpgsign=false'), 'gitArgs points git at the projects root with the plugin\'s settings');
  process.env.GIT_DIR = '/elsewhere'; gitArgs('status');
  ok(!('GIT_DIR' in process.env), 'a caller\'s GIT_DIR never reaches git');
  ok(gitWhy({ code: 'ENOENT', syscall: 'spawnSync git' }) === 'git is not installed', 'gitWhy says no git in words');
}

// The git half of the CLI (history, restore, forget --purge, rescan, doctor), moved here from memory.mjs with the arguments and
// options it had. The expected values are what memory.mjs ran before the move. The history rewrite itself keeps real git (memory-switch.test.mjs).
{
  const { git, gitBytes, unsnapped, missing, tracked, ever, rewrite, gitInstalled, fastExport, fastExportOf, fastImportTo, hashObject, readHealth, MISSED, HELD, FAST } = S;
  let seen = [];
  const stand = (answer) => { seen = []; useGit((cmd, args, opts) => { seen.push({ cmd, args, opts }); return typeof answer === 'function' ? answer(args, opts) : answer; }); };

  // The 60 s readers: paths literal, text or bytes, git's stderr kept.
  stand('out');
  ok(git('log', '-1') === 'out', 'git answers what the runner answered');
  ok(seen[0].cmd === 'git' && seen[0].args.slice(0, 2).join() === `-C,${root}` && seen[0].args.slice(-3).join() === '--literal-pathspecs,log,-1', 'git runs in the projects root with literal pathspecs');
  ok(seen[0].opts.encoding === 'utf8' && seen[0].opts.timeout === 60_000 && seen[0].opts.maxBuffer === 64 << 20 && seen[0].opts.stdio.join() === 'ignore,pipe,pipe', 'git: text, 60 s, 64 MiB, stderr kept');
  gitBytes('cat-file', '-p', 'x');
  ok(seen[1].opts.encoding === 'buffer' && seen[1].opts.timeout === 60_000, 'gitBytes asks for the bytes');

  // The fixed commands of a history rewrite: 300 s and 1 GiB, the copy named with -C and no repository settings.
  stand('');
  fastExport(); fastExportOf('/c.git'); fastImportTo('/c.git', 'IN'); hashObject('B', { encoding: 'utf8' });
  ok(seen[0].args.slice(0, 2).join() === `-C,${root}` && seen[0].args.slice(-3).join() === 'fast-export,--all,--signed-tags=strip' && seen[0].opts.timeout === 300_000 && seen[0].opts.maxBuffer === 1 << 30 && seen[0].opts.stdio.join() === 'ignore,pipe,ignore', 'fastExport: the root, 300 s, 1 GiB, git\'s warnings dropped');
  ok(seen[1].args.join() === '-C,/c.git,fast-export,--all,--signed-tags=strip' && seen[1].opts.stdio.join() === 'ignore,pipe,ignore', 'fastExportOf: a copy, named with -C alone');
  ok(seen[2].args.join() === '-C,/c.git,fast-import,--force,--quiet' && seen[2].opts.input === 'IN' && seen[2].opts.timeout === 300_000 && !('stdio' in seen[2].opts), 'fastImportTo: the stream on stdin');
  ok(seen[3].args.slice(-3).join() === 'hash-object,-w,--stdin' && seen[3].opts.input === 'B' && seen[3].opts.encoding === 'utf8', 'hashObject writes a blob from stdin');
  ok(FAST.timeout === 300_000 && FAST.maxBuffer === 1 << 30, 'FAST is 300 s and 1 GiB');

  // doctor and unsnapped: git on the PATH, then a first commit.
  stand('git version 2');
  ok(gitInstalled() === 'git version 2' && seen[0].args.join() === '--version' && seen[0].opts.stdio === 'ignore', 'gitInstalled runs git --version');
  scripted(() => { throw fail('spawnSync git ENOENT', { code: 'ENOENT' }); });
  ok(unsnapped().startsWith('git is not installed, so there are no snapshots: everything else works. Installing Git (git-scm.com) turns them on'), 'no git: said in words');
  stand('');
  rmSync(g, { recursive: true, force: true });
  ok(unsnapped() === 'no snapshots yet: project-memory takes the first at the end of a reply' && seen.length === 1, 'no repository: no commit yet, and nothing but --version was run');
  ours();
  stand((a) => { if (a.includes('rev-parse')) throw fail('fatal: Needed a single revision', { status: 128 }); return ''; });
  ok(unsnapped().startsWith('no snapshots yet'), 'a repository with no commit has no snapshots yet');
  stand((a) => (a.includes('rev-parse') ? 'abc1234\n' : ''));
  ok(unsnapped() === '', 'a repository with a commit has snapshots');
  ok(seen.at(-1).args.slice(-4).join() === 'rev-parse,--verify,-q,HEAD', 'the commit is looked for with rev-parse --verify -q HEAD');
  stand((a) => (a.includes('rev-parse') ? '' : 'x'));
  ok(unsnapped().startsWith('no snapshots yet'), 'an empty answer is no commit');

  // What git says when a snapshot lacks a path.
  for (const m of ['fatal: path x does not exist in HEAD', 'fatal: path x exists on disk, but not in HEAD', 'fatal: invalid object name', 'fatal: Not a valid object name y', 'fatal: unknown revision or path', 'fatal: bad revision z']) ok(missing({ stderr: m }), `"${m}" is a missing path or commit`);
  ok(!missing({ stderr: 'fatal: not a git repository' }) && !missing({}) && !missing(undefined), 'anything else is a fault');

  // The paths a store is held by.
  const dir = store('proj-t');
  ok(tracked(dir, 'a.md').join() === 'proj-t/memory/a.md' && tracked(dir, '').join() === 'proj-t/memory', 'a store in the root is tracked by its own path');
  stand((a) => (a.includes('log') ? 'proj-t/memory/a.md\nproj-t/memory/b.md\n' : ''));
  ok(ever(dir).join() === 'a.md,b.md,' && seen[0].args.includes('--diff-filter=A') && seen[0].args.at(-1) === 'proj-t/memory', 'ever lists the names a store ever had');
  stand(() => { throw fail('boom'); });
  ok(ever(dir).length === 0, 'a log that fails lists none');

  // A rewrite waits for a snapshot in flight: nothing runs, and no lock is left.
  stand('');
  mkdirSync(g, { recursive: true });
  for (const f of ['index.lock', 'HEAD.lock']) {
    writeFileSync(join(g, f), '');
    let msg = ''; try { rewrite(() => {}); } catch (e) { msg = e.message; }
    ok(msg === 'the git of the memory store is busy (a snapshot or clean-up); try again in a moment' && seen.length === 0 && !existsSync(join(g, 'config.lock')), `${f}: the purge gives way, runs no git, takes no lock`);
    rmSync(join(g, f));
  }
  writeFileSync(join(g, 'config.lock'), '');
  let msg = ''; try { rewrite(() => {}); } catch (e) { msg = e.message; }
  ok(msg === 'the git of the memory store is busy (a snapshot or clean-up); try again in a moment' && existsSync(join(g, 'config.lock')) && seen.length === 0, 'a config.lock that is there: busy, and not taken away');
  rmSync(join(g, 'config.lock'));

  // The health record, as every reader sees it.
  const hp = join(root, '.snapshot-health');
  rmSync(hp, { force: true });
  ok(JSON.stringify(readHealth()) === '{"read":false,"health":null}', 'no health file: not read');
  writeFileSync(hp, '{ not json');
  ok(readHealth().read === false && readHealth().health === null, 'a broken health file: not read');
  writeFileSync(hp, 'null');
  ok(readHealth().read === true && readHealth().health === null, 'a null health file: read, and empty');
  writeFileSync(hp, JSON.stringify({ lastOk: 'x', failures: 2, held: ['a'], missed: ['b'], pending: true }));
  ok(readHealth().read && readHealth().health.failures === 2 && readHealth().health.held[0] === 'a' && owed() === true, 'a health file: parsed as written');
  rmSync(hp);
  ok(MISSED.startsWith('it is reached through a link to a folder outside ~/.claude/projects') && HELD.startsWith('it holds what looks like a key, token or password'), 'the reasons a store is left out are said here');
}

// PR C of step 16: one busy rule for every git write (the snapshot, restore, purge, rescan), and the plugin runs git's clean-up itself.
{
  const { busy, rewrite } = S, { restore } = await import('../src/memory.mjs');
  const old = new Date(Date.now() - 11 * 60000), ahead = new Date(Date.now() + 11 * 60000);
  mkdirSync(join(g, 'refs', 'heads'), { recursive: true });
  const files = ['index.lock', 'HEAD.lock', 'config.lock', 'packed-refs.lock', join('refs', 'heads', 'main.lock')];
  ok(busy() === false, 'no lock: not busy');
  for (const f of files) {
    const p = join(g, f);
    writeFileSync(p, '');
    ok(busy() === true && existsSync(p), `a fresh ${f} is busy, and left alone`);
    utimesSync(p, old, old);
    ok(busy() === false && !existsSync(p), `a ${f} older than ten minutes is swept, not busy`);
    writeFileSync(p, ''); utimesSync(p, ahead, ahead);
    ok(busy() === false && !existsSync(p), `a ${f} dated ahead of the clock is as old`);
  }
  // gc.pid: "<pid> <host>", as git writes it. Stale when its owner here is dead; else git's own 12 hours.
  {
    const { hostname } = await import('node:os'), { spawnSync } = await import('node:child_process');
    const dead = spawnSync(process.execPath, ['-e', '']).pid, gp = join(g, 'gc.pid'), ago = (ms) => { const d = new Date(Date.now() - ms); utimesSync(gp, d, d); };
    const put = (text, ms = 0) => { writeFileSync(gp, text); if (ms) ago(ms); };
    put(`${dead} ${hostname()}`);
    ok(busy() === false && !existsSync(gp), 'a gc.pid whose gc died on this machine is not busy, fresh as it is');
    put(`${process.pid} ${hostname()}`, 11 * 60000);
    ok(busy() === true && existsSync(gp), 'a gc.pid of a live gc here is busy past ten minutes');
    put(`${process.pid} ${hostname()}`, 13 * 3600000);
    ok(busy() === false && !existsSync(gp), 'and stale after git\'s own twelve hours');
    put(`${dead} some-other-host`, 11 * 60000);
    ok(busy() === true, 'a gc.pid from another machine is busy past ten minutes (a pid there means nothing here)');
    put(`${dead} some-other-host`, 13 * 3600000);
    ok(busy() === false && !existsSync(gp), 'and stale after twelve hours');
    put('', 11 * 60000);
    ok(busy() === true, 'an unreadable or malformed gc.pid is busy');
    put('garbage', 13 * 3600000);
    ok(busy() === false && !existsSync(gp), 'unless older than twelve hours');
  }
  // A lock that cannot be removed (held open on Windows: EPERM or EBUSY) is busy, not a crash.
  {
    const lk = join(g, 'index.lock'); mkdirSync(lk); utimesSync(lk, old, old);
    let r; try { r = busy(); } catch (e) { r = e.code; }
    ok(r instanceof Error, 'an old lock that cannot be removed is busy (an Error to say why), not a throw (got ' + r + ')');
    rmSync(lk, { recursive: true });
  }
  // A purge keeps its config.lock young through every git it runs, however long they take.
  {
    const lk = join(g, 'config.lock'), old9 = () => { const d = new Date(Date.now() - 9 * 60000); utimesSync(lk, d, d); }, ages = [];
    useGit((cmd, args) => { ages.push(Date.now() - statSync(lk).mtimeMs); old9(); return ''; });
    rewrite(() => { S.fastExportOf('/c.git'); S.fastImportTo('/c.git', 'x'); });
    ok(ages.length >= 5 && ages.every((a) => a < 60000), 'each git of a purge finds its config.lock fresh, though the clock says nine minutes passed between (ages ' + ages.map((a) => Math.round(a / 1000)).join() + ')');
    ok(!existsSync(lk), 'and the purge frees it');
  }

  // restore refuses while busy, and runs no git write.
  const dir = store('proj-busy');
  scripted((sub, a) => (a.includes('rev-parse') ? 'abc1234' : ''));
  writeFileSync(join(g, 'gc.pid'), '');
  const r = restore(dir, 'a.md', { force: true });
  ok(r.ok === false && r.lines.join(' ').includes('git of the memory store is busy') && !calls.some((c) => /hash-object|update-ref|cat-file/.test(c)), 'restore says busy while git is busy, and writes nothing');
  rmSync(join(g, 'gc.pid'));

  // doctor's pack check: an index with no pack, not a pair, not a lone pack.
  mkdirSync(join(g, 'objects', 'pack'), { recursive: true });
  for (const f of ['a.idx', 'a.pack', 'b.idx', 'c.pack']) writeFileSync(join(g, 'objects', 'pack', f), '');
  ok(S.packOrphans().orphans.join() === 'b.idx' && S.packOrphans().pack === join(g, 'objects', 'pack'), 'packOrphans names an index that has no pack, and only that');

  // git's own clean-up is the plugin's: never on its own after a command, once after a commit.
  ok(gitArgs('log').join(' ').includes('-c gc.auto=0'), 'gitArgs turns git\'s own automatic gc off');
  ours(); writeFileSync(join(g, 'index'), '');
  scripted(() => '');
  ok(snapshot() === 'committed', 'fixture: a commit');
  const at = calls.findIndex((c) => c.includes('gc ')); ok(calls[at] === '-c gc.auto=6700 gc --auto --no-detach' && calls[at - 1].includes('commit') && calls.filter((c) => c.includes('gc ')).length === 1, 'after a commit: gc --auto --no-detach with git\'s own 6700');
  scripted((sub, a, opts) => { if (a.includes('commit')) throw fail('x', { stdout: 'nothing to commit' }); return ''; });
  ok(snapshot() === null && !calls.some((c) => c.includes('gc ')), 'nothing to commit: no gc');
  writeFileSync(join(g, 'index.lock'), '');
  scripted(() => ''); ok(snapshot() === 'busy' && calls.length === 0, 'busy: no git at all, no gc'); rmSync(join(g, 'index.lock'));
  scripted((sub, a) => { if (a.includes('gc')) throw fail('gc died', { status: 1, stderr: 'fatal: gc died' }); return ''; });
  ok(snapshot() === 'committed', 'a gc that fails does not fail the snapshot');
  scripted((sub, a) => { if (a.includes('gc')) throw fail('t', { code: 'ETIMEDOUT' }); return ''; });
  ok(snapshot() === 'committed' && !existsSync(join(g, 'project-memory-parts')), 'a gc that times out does not fail it, nor start the history in parts');
}

useGit();
console.log(`snapshot.test.mjs: ${checks} checks passed`);
