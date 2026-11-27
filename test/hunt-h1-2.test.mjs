// h1-2: `restore <note> --force --rev` with the value missing (--rev last) restored the newest snapshot instead of refusing.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert';
import { tool, tempHome, capture } from './harness.mjs';

const CLI = tool('src/memory.mjs'), TIER = tool('src/memory-tier.mjs');
const { home, env } = tempHome('hunt-h12-');
const root = join(home, '.claude', 'projects'), dir = join(root, 'C--hunt', 'memory');
mkdirSync(dir, { recursive: true });
const { main } = await import(pathToFileURL(CLI).href);
const cli = async (...args) => { const { out, value } = await capture(() => main(['--store', dir, ...args])); return { status: value, stdout: out }; };

test('restore --rev with no value is refused, not "the newest"', async () => {
  writeFileSync(join(dir, 'seed.md'), '---\nname: seed\ndescription: "s"\nmetadata:\n  type: project\n---\n\nseed\n');
  writeFileSync(join(dir, 'MEMORY.md'), '- [Seed](seed.md) — s\n');
  spawnSync(process.execPath, [TIER], { env, encoding: 'utf8' });   // makes the snapshot repo
  const g = (a, input) => spawnSync('git', ['-C', root, ...a], { input, encoding: 'utf8' });
  const branch = g(['symbolic-ref', 'HEAD']).stdout.trim(), from = g(['rev-parse', 'HEAD']).stdout.trim();
  let stream = '';
  ['OLD version the user wanted\n', 'NEWEST version\n'].forEach((body, i) => {
    const msg = `memory: edit ${i}\n`;
    stream += `commit ${branch}\ncommitter memory <memory@localhost> ${1600000000 + i * 60} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}${i ? '' : `from ${from}\n`}M 100644 inline C--hunt/memory/vnote.md\ndata ${Buffer.byteLength(body)}\n${body}\n`;
  });
  assert.equal(g(['fast-import', '--quiet'], stream).status, 0);
  // the note is gone from disk; the user means to pick a revision but the value is missing (e.g. an empty unquoted $REV)
  const r = await cli('restore', 'vnote', '--force', '--rev');
  let written = null;
  try { written = readFileSync(join(dir, 'vnote.md'), 'utf8'); } catch {}
  assert.ok(r.status === 1 && written === null, `--rev without a value must be refused and write nothing (status ${r.status}, wrote ${JSON.stringify(written)}, said ${r.stdout.trim()})`);
});
