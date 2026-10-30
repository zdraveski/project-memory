#!/usr/bin/env node
// What the suites and the fuzz reach, from Node's own coverage (V8's, no
// dependency): per plugin file the approximate share of its bytes that ran, the functions
// that never ran and the first lines of the larger blocks that never ran. The
// fuzz hunts bugs only in code it reaches; this shows the code it does not.
// Run: node coverage.mjs [--suites] [--fuzz <seconds>]   (no flag: --suites)
// Nothing runs it automatically.
import assert from 'node:assert';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tempDir } from './harness.mjs';

const repo = dirname(fileURLToPath(import.meta.url));
const FILES = ['store.mjs', 'handoff-log.mjs', 'memory-tier.mjs', 'compact-gate.mjs', 'journal.mjs', 'memory.mjs'];
const SUITES = ['store', 'compact-gate', 'handoff-log', 'memory-tier', 'memory', 'journal'].map((s) => `${s}.test.mjs`);

// The lines to print for `files` of `repoDir`, from the V8 coverage files in covDir.
// One file is one process. V8 leaves out a block range whose count is its
// parent's, so processes are not merged range by range: each gives a count per
// byte (inner ranges override outer ones) and a byte ran if any process ran it.
export function report(covDir, repoDir, files) {
  const ran = new Map();   // file -> {byte: Uint8Array, fns: Map(name:start:end -> count), blocks: [[start, end]]}
  for (const f of readdirSync(covDir).filter((x) => x.endsWith('.json'))) {
    for (const s of JSON.parse(readFileSync(join(covDir, f), 'utf8')).result) {
      if (!s.url.startsWith('file:')) continue;
      const p = fileURLToPath(s.url), b = basename(p);
      if (!files.includes(b) || !p.toLowerCase().startsWith(repoDir.toLowerCase())) continue;
      const len = readFileSync(join(repoDir, b), 'utf8').length;
      const m = ran.get(b) ?? ran.set(b, { byte: new Uint8Array(len), fns: new Map(), blocks: [] }).get(b);
      const all = [];
      for (const fn of s.functions) fn.ranges.forEach((r, i) => {
        all.push(r);
        if (i === 0) { const k = `${fn.functionName}:${r.startOffset}:${r.endOffset}`; m.fns.set(k, (m.fns.get(k) ?? 0) + r.count); } else m.blocks.push([r.startOffset, r.endOffset]);
      });
      // Outer first, so an inner range's count replaces its parent's for its bytes.
      const here = new Int32Array(len).fill(-1);
      for (const r of all.sort((x, y) => x.startOffset - y.startOffset || y.endOffset - x.endOffset)) here.fill(r.count, r.startOffset, r.endOffset);
      here.forEach((c, i) => { if (c > 0) m.byte[i] = 1; });
    }
  }
  const out = [];
  for (const b of files) {
    const src = readFileSync(join(repoDir, b), 'utf8'), m = ran.get(b);
    if (!m) { out.push(`${b}: never loaded`); continue; }
    const line = (o) => src.slice(0, o).split(String.fromCharCode(10)).length;
    const share = m.byte.reduce((a, x) => a + x, 0) / src.length;
    const fns = [...m.fns].filter(([, c]) => c === 0).map(([k]) => { const [name, start] = k.split(':'); return `${name || '(anonymous)'}@${line(Number(start))}`; });
    // A block is listed when its first byte ran in no process.
    const blocks = [...new Set(m.blocks.filter(([s, e]) => e - s > 40 && !m.byte[s]).map(([s]) => line(s)))].sort((x, y) => x - y);
    out.push(`${b}: ~${Math.round(share * 100)}% of the code ran; ${fns.length} function(s) never ran${fns.length ? ': ' + fns.slice(0, 25).join(', ') + (fns.length > 25 ? ` and ${fns.length - 25} more` : '') : ''}`);
    out.push(`  blocks never run (>40 chars), first lines: ${blocks.slice(0, 60).join(' ')}${blocks.length > 60 ? ` and ${blocks.length - 60} more` : ''}`);
  }
  return out;
}

// Self-check: one coverage file per process, as NODE_V8_COVERAGE writes them.
const tmp = tempDir('cov-');
const src = ('123456789' + String.fromCharCode(10)).repeat(10);   // 100 bytes, line 3 starts at 20
writeFileSync(join(tmp, 'x.mjs'), src);
const proc = (dir, n, ...fns) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `p${n}.json`), JSON.stringify({ result: [{ url: pathToFileURL(join(tmp, 'x.mjs')).href, functions: [{ functionName: '', ranges: [{ startOffset: 0, endOffset: 100, count: 1 }] }, ...fns] }] })); };
const block = (count) => ({ functionName: '', ranges: [{ startOffset: 0, endOffset: 100, count: 1 }, { startOffset: 20, endOffset: 70, count }] });
const never = { functionName: 'never', ranges: [{ startOffset: 20, endOffset: 37, count: 0 }] };
proc(join(tmp, 'a'), 1, never);
assert.ok(report(join(tmp, 'a'), tmp, ['x.mjs']).some((l) => /^x\.mjs: ~83% of the code ran; 1 function\(s\) never ran: never@3$/.test(l)));
// A block one process never ran and another ran (V8 leaves out the block range
// whose count is its parent's): it ran.
proc(join(tmp, 'b'), 1);
proc(join(tmp, 'b'), 2, block(0));
assert.match(report(join(tmp, 'b'), tmp, ['x.mjs']).join(String.fromCharCode(10)), /^x\.mjs: ~100% of the code ran; 0 function\(s\) never ran\s+blocks never run \(>40 chars\), first lines: $/);
// Run by neither (0 in both, or absent from one and 0 in the other loaded alone): not run.
proc(join(tmp, 'c'), 1, block(0));
proc(join(tmp, 'c'), 2, block(0));
assert.match(report(join(tmp, 'c'), tmp, ['x.mjs']).join(String.fromCharCode(10)), /^x\.mjs: ~50% of the code ran; 0 function\(s\) never ran\s+blocks never run \(>40 chars\), first lines: 3$/);

const args = process.argv.slice(2);
const doFuzz = args.includes('--fuzz'), seconds = Number(args[args.indexOf('--fuzz') + 1]);
if (doFuzz && !(seconds > 0)) { console.error('usage: node coverage.mjs [--suites] [--fuzz <seconds>]'); process.exit(2); }
const cov = tempDir('cov-run-');
// Each child writes its coverage into the one folder.
const run = (name, ...a) => {
  const r = spawnSync(process.execPath, [join(repo, name), ...a], { cwd: repo, env: { ...process.env, NODE_V8_COVERAGE: cov }, stdio: 'ignore' });
  if (r.status !== 0) console.error(`${name} failed (${r.status === null ? r.error?.message ?? `signal ${r.signal}` : `exit ${r.status}`}); its coverage is partial`);
};
if (args.includes('--suites') || !doFuzz) for (const t of SUITES) run(t);
if (doFuzz) run('fuzz.mjs', String(seconds));
console.log(report(cov, repo, FILES).join(String.fromCharCode(10)));
