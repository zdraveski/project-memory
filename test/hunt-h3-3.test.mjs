// h3-3: a commit that succeeds while a tracked note changed after `git add` is recorded as "the first snapshot is being taken in parts",
// on a repository with a history. Real git; the edit lands between the add and the commit through the git stand-in.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome } from './harness.mjs';

tempHome('hunt-h3-3-');
const { projectsRoot } = await import('../src/store.mjs');
const S = await import('../src/snapshot.mjs');
const { snapshot, useGit, verdict } = S;

const root = projectsRoot(), d = join(root, 'pa', 'memory');
mkdirSync(d, { recursive: true });
writeFileSync(join(d, 'MEMORY.md'), '- [a](a.md) - a\n');
writeFileSync(join(d, 'a.md'), 'one\n');
const health = () => JSON.parse(readFileSync(join(root, '.snapshot-health'), 'utf8'));

assert.strictEqual(snapshot(), 'initialised');
assert.strictEqual(snapshot(), null);   // a history exists now, and nothing is owed

writeFileSync(join(d, 'a.md'), 'two\n');   // staged by this run's add
let edited = false;
useGit((cmd, args, opts) => {
  // another session writes the note again after our add, before our commit
  if (!edited && args.includes('commit')) { edited = true; writeFileSync(join(d, 'a.md'), 'three\n'); }
  return execFileSync(cmd, args, opts);
});
const out = snapshot();
useGit(null);
assert(edited && out !== 'busy' && !out.startsWith('snapshot failed'), `the commit succeeded (got ${out})`);
assert(execFileSync('git', ['-C', root, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim() === '2', 'a second commit exists: not a first snapshot');

const h = health(), say = verdict().say;
assert(!/first is being taken in parts/.test(say) && !h.partial,
  `a repository with a history must not be called a first snapshot in parts (got ${JSON.stringify(h)}; ${say}; stop line "${out}")`);
