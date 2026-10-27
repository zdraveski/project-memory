// Break a real copy of the memory store one thing at a time and report what the
// tool does. Pass = it survives AND loses no pointer. Not a unit test: the
// subject is a real store, copied.
import { cpSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tool, tempDir, pointers, largestStore } from './harness.mjs';

// Subject: this machine's largest store, copied. Override with argv[2].
const SRC = process.argv[2] || largestStore();
if (!SRC) { console.error('no memory store on this machine to copy: pass one, node memory-tier.break.mjs <store dir>'); process.exit(1); }
const TOOL = tool('memory-tier.mjs');

const targets = (dir) => new Set(['MEMORY.md', 'MEMORY-archive.md'].flatMap((f) => existsSync(join(dir, f)) ? pointers(readFileSync(join(dir, f), 'utf8')) : []));

// The memory each case breaks: the index's first, so it has a pointer to lose.
const ONE = [...targets(SRC)][0];
if (!ONE) { console.error(`${SRC}/MEMORY.md points at no memory: nothing to break`); process.exit(1); }

const cases = {
  'MEMORY.md is empty': (d) => writeFileSync(join(d, 'MEMORY.md'), ''),
  'MEMORY.md is only prose': (d) => writeFileSync(join(d, 'MEMORY.md'), '# Index\n\nnothing yet\n'),
  'MEMORY.md is CRLF': (d) => writeFileSync(join(d, 'MEMORY.md'), readFileSync(join(d, 'MEMORY.md'), 'utf8').replace(/\n/g, '\r\n')),
  'MEMORY.md has a BOM': (d) => writeFileSync(join(d, 'MEMORY.md'), '\uFEFF' + readFileSync(join(d, 'MEMORY.md'), 'utf8')),
  'archive file deleted': (d) => rmSync(join(d, 'MEMORY-archive.md'), { force: true }),
  'a memory has no frontmatter': (d) => writeFileSync(join(d, ONE), 'just a body\n'),
  'a memory is empty': (d) => writeFileSync(join(d, ONE), ''),
  'modified: is garbage': (d) => writeFileSync(join(d, ONE),
    readFileSync(join(d, ONE), 'utf8').replace(/modified:.*/, 'modified: yesterday-ish')),
  'a pointer names a URL': (d) => writeFileSync(join(d, 'MEMORY.md'),
    '- [Docs](https://example.com/x.md) — external\n' + readFileSync(join(d, 'MEMORY.md'), 'utf8')),
  'a pointer target is missing': (d) => rmSync(join(d, ONE)),
  'a pointer target is a directory': (d) => { rmSync(join(d, ONE)); mkdirSync(join(d, ONE)); },
  'a memory file is read-only': (d) => chmodSync(join(d, ONE), 0o444),
  'every line is prose, no pointers': (d) => writeFileSync(join(d, 'MEMORY.md'), 'a\nb\nc\n'),
  'nothing broken (control)': () => {},
};

for (const [name, brk] of Object.entries(cases)) {
  const dir = tempDir('brk-');
  cpSync(SRC, dir, { recursive: true, preserveTimestamps: true });
  const before = targets(dir);
  let verdict;
  try {
    brk(dir);
    const out = execFileSync(process.execPath, [TOOL, '--dir', dir], { encoding: 'utf8' });
    const after = targets(dir);
    const lost = [...before].filter((t) => !after.has(t) && existsSync(join(dir, t)));
    // Second run must not differ: an unstable store rewrites itself every session.
    const snap = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
    execFileSync(process.execPath, [TOOL, '--dir', dir], { encoding: 'utf8' });
    const stable = snap === readFileSync(join(dir, 'MEMORY.md'), 'utf8');
    verdict = lost.length ? `LOST ${lost.length}: ${lost.slice(0, 3)}`
      : !stable ? 'UNSTABLE on rerun'
      : `ok (${out.trim().split('\n').length} line(s) reported)`;
  } catch (e) {
    verdict = `THREW: ${String(e.message).split('\n').find((l) => /Error|error/.test(l)) || e.message.slice(0, 80)}`;
  }
  console.log(`${name.padEnd(32)} ${verdict}`);
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
