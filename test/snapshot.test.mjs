// Self-check for snapshot.mjs, called in this process with a scripted git in place of the real one (useGit): how a failure of git is
// mapped (off, in parts, busy, failed), a damaged index rebuilt once, a note held back, the health record after a failure and after
// a success, and a missing or a broken health file. The expected values are what snapshot() answered before it moved out of
// memory-tier.mjs. Real git stays in memory-tier.test.mjs. Run: node snapshot.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync, utimesSync } from 'node:fs';
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

useGit();
console.log(`snapshot.test.mjs: ${checks} checks passed`);
