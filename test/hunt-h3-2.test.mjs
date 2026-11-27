// A note whose file name is not valid UTF-8 (Linux only: Windows and macOS refuse such names) skipped the snapshot's secret check:
// the staged name is decoded as utf8, the bad byte becomes U+FFFD, `cat-file :<that path>` says missing, the fallback reads a
// file of that name from disk (none), and `t !== null && holdsSecret(t)` was false -> the key was committed. And a reset of that
// string names nothing git has, so a held note stayed staged: such a name is unstaged by its bytes, through stdin.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tempHome } from './harness.mjs';

tempHome('hunt-h3-2-');
const { projectsRoot } = await import('../src/store.mjs');
const S = await import('../src/snapshot.mjs');
const { snapshot } = S;

const SECRET = 'password: hunter2hunter2\n';
const inHead = (root) => spawnSync('git', ['-C', root, 'grep', '-q', 'hunter2hunter2', 'HEAD']).status === 0;

test('a note with a non-UTF-8 name and a secret is held, not committed (real file)', { skip: process.platform === 'win32' || process.platform === 'darwin' }, () => {
  const root = projectsRoot(), mem = join(root, 'C--proj', 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'MEMORY.md'), '- [a](a.md) — a\n');
  writeFileSync(join(mem, 'a.md'), 'plain\n');
  // name "b\xff.md": a lone 0xff byte is never valid UTF-8
  const odd = Buffer.concat([Buffer.from(mem + '/b'), Buffer.from([0xff]), Buffer.from('.md')]);
  writeFileSync(odd, SECRET);
  try {
    assert.strictEqual(snapshot(), 'committed');
    assert.ok(!inHead(root), 'the secret is in the snapshot commit (git grep found it in HEAD)');
  } finally { unlinkSync(odd); }   // else the later tests, in the same store, see it held again
});

// The same on every platform: git is made to stage the odd name (update-index takes its bytes from stdin) just before the check.
test('a staged non-UTF-8 note name is unstaged by its bytes, and nothing of it is committed', () => {
  const root = projectsRoot(), mem = join(root, 'C--proj2', 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'MEMORY.md'), '- [a](a.md) — a\n');
  writeFileSync(join(mem, 'a.md'), 'plain\n');
  S.useGit(undefined);
  snapshot();   // the first, or one more
  writeFileSync(join(mem, 'a.md'), 'plain, edited\n');   // so that the commit has something to take

  let injected = false;
  S.useGit((cmd, args, opts) => {
    if (!injected && args.includes('diff') && args.includes('--cached')) {   // after the add, before the check
      injected = true;
      const oid = execFileSync(cmd, S.gitArgs('hash-object', '-w', '--stdin'), { input: SECRET, encoding: 'utf8' }).trim();
      execFileSync(cmd, S.gitArgs('update-index', '--add', '--index-info'), { input: Buffer.concat([Buffer.from(`100644 ${oid} 0\tC--proj2/memory/b`), Buffer.from([0xff]), Buffer.from('.md\n')]) });
    }
    return execFileSync(cmd, args, opts);
  });
  let out; try { out = snapshot(); } finally { S.useGit(undefined); }
  assert.ok(injected);
  assert.strictEqual(out, 'committed');
  assert.ok(!inHead(root), 'the secret is in the snapshot commit');
  assert.ok(!execFileSync('git', S.gitArgs('ls-files', '-s'), { encoding: 'latin1' }).includes('bÿ'), 'the odd name is out of the index too');
  assert.match(S.verdict().say, /held|key|secret/i, 'the held note is told');
});

// Fail closed: a staged note whose blob and file are both unreadable is held. A staged deletion is not one: it is not listed.
test('a staged deletion is committed, not held', () => {
  const root = projectsRoot(), mem = join(root, 'C--proj3', 'memory');
  mkdirSync(mem, { recursive: true });
  writeFileSync(join(mem, 'MEMORY.md'), '- [a](a.md) — a\n');
  writeFileSync(join(mem, 'a.md'), 'plain\n');
  writeFileSync(join(mem, 'gone.md'), 'bye\n');
  S.useGit(undefined);
  snapshot();
  unlinkSync(join(mem, 'gone.md'));
  assert.strictEqual(snapshot(), 'committed');
  assert.ok(!(S.readHealth().health?.held ?? []).length, 'nothing is held');
  assert.strictEqual(execFileSync('git', S.gitArgs('ls-files', '--', 'C--proj3/memory/gone.md'), { encoding: 'utf8' }), '', 'the deletion is in the snapshot');
});
