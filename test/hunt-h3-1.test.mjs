// Two overlapping snapshot runs: run B has staged and checked a note (clean) and is about to commit; run A (another Stop's
// detached tidy-up) meanwhile writes a key into the note and stages it. B's commit takes the index as it is then, so the key
// reached the permanent history before A could unstage it. The cross-process lock over take() keeps A out until B is done.
// Exact interleaving through the git stand-in: real git, but at B's commit it starts run A, and at A's secret check (after
// its add) it lets B's commit through.
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tempHome } from './harness.mjs';

tempHome('hunt-h3-1-');
const { projectsRoot } = await import('../src/store.mjs');
const S = await import('../src/snapshot.mjs');
const { holdsSecret } = await import('../src/secrets.mjs');

const root = projectsRoot(), d = join(root, 'proj', 'memory'), note = join(d, 'a.md');
mkdirSync(d, { recursive: true });
writeFileSync(join(d, 'MEMORY.md'), '- [a](a.md) — a\n');
writeFileSync(note, 'clean note\n');
S.useGit(undefined);
assert.equal(S.snapshot(), 'initialised', 'the history starts');

test('a key staged by an overlapping run is not committed by a run that already checked', () => {
  const KEY = `sk-${'a1B2c3D4'.repeat(4)}`, dirty = `clean note, edited\napi key: ${KEY}\n`;
  assert.ok(holdsSecret(dirty), 'the detector knows this text for a secret');
  writeFileSync(note, 'clean note, edited\n');   // what run B sees: a clean edit

  let b = null, a = null, passed = false;
  S.useGit((cmd, args, opts) => {
    if (!b && args.includes('commit')) {   // B is past its check: run A starts now, on a note the model just wrote the key into
      b = { cmd, args, opts };
      writeFileSync(note, dirty);
      a = S.snapshot({ record: false });
    } else if (b && !passed && args.includes('diff') && args.includes('--cached')) {   // A has added the note and not yet checked it
      passed = true;
      execFileSync(b.cmd, b.args, b.opts);   // B's commit lands in that gap
    }
    return execFileSync(cmd, args, opts);
  });
  try { S.snapshot(); } finally { S.useGit(undefined); }
  assert.ok(b, 'run B reached its commit');

  assert.equal(a, 'busy', 'run A waits for the next Stop while B holds the lock');
  assert.ok(!passed, 'run A staged nothing while B was still to commit');
  const log = execFileSync('git', S.gitArgs('log', '-p', '--all'), { encoding: 'utf8' });
  assert.ok(!log.includes(KEY), 'the key must not be in the permanent history');
});

test('the lock of a killed run does not stop the next snapshot', () => {
  const dead = spawnSync(process.execPath, ['-e', '0']).pid, lock = join(root, '.snapshot-lock', '.lock');
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, 'owner'), `${dead}.x`);
  writeFileSync(note, 'clean note, edited again\n');
  assert.equal(S.snapshot(), 'committed');
  assert.ok(!existsSync(lock), 'the lock is released after the run');
});
