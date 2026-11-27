// hunt h1-1: rescan --apply --yes must not die on one non-UTF-8 note and leave the later notes' secrets in place.
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert';
import { tool, tempHome } from './harness.mjs';

test('rescan --apply --yes: a non-UTF-8 note does not stop the later notes being redacted', () => {
  const { home, env } = tempHome('hunt-h1-1-');
  const dir = join(home, '.claude', 'projects', 'C--hunt', 'memory');
  mkdirSync(dir, { recursive: true });
  const key = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
  writeFileSync(join(dir, 'MEMORY.md'), '# Memory Index\n');
  // a.md: a Windows-code-page byte (0xE9) and a token; b.md: a token only.
  writeFileSync(join(dir, 'a.md'), Buffer.concat([Buffer.from('---\nname: a\n---\ncaf'), Buffer.from([0xe9]), Buffer.from(` token ${key}\n`)]));
  writeFileSync(join(dir, 'b.md'), `---\nname: b\n---\ntoken ${key}\n`);
  const r = spawnSync(process.execPath, [tool('src/memory.mjs'), 'rescan', '--apply', '--yes'], { env, encoding: 'utf8' });
  const b = readFileSync(join(dir, 'b.md'), 'utf8');
  const backups = readdirSync(join(home, '.claude')).filter((n) => n.startsWith('project-memory-rescan-backup'));
  assert(!/at .*\.mjs:\d+/.test(r.stderr), `rescan crashed with an uncaught error (exit ${r.status}):\n${r.stderr.slice(0, 400)}`);
  assert(!b.includes(key), `b.md, after the non-UTF-8 a.md, still holds its secret (exit ${r.status}, backups left: ${backups.length})`);
});
