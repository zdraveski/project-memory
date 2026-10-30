#!/usr/bin/env node
// What the suites and the fuzz reach, from Node's own coverage (V8's, no
// dependency): per plugin file the share of its bytes that ran, the functions
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

// The lines to print for `files` of `repo`, from the V8 coverage files in covDir.
export function report(covDir, repoDir, files) {
  const ran = new Map();   // file -> Map(range -> {name, start, end, count, block})
  for (const f of readdirSync(covDir).filter((x) => x.endsWith('.json'))) {
    for (const s of JSON.parse(readFileSync(join(covDir, f), 'utf8')).result) {
      if (!s.url.startsWith('file:')) continue;
      const p = fileURLToPath(s.url), b = basename(p);
      if (!files.includes(b) || !p.toLowerCase().startsWith(repoDir.toLowerCase())) continue;
      const m = ran.get(b) ?? ran.set(b, new Map()).get(b);
      for (const fn of s.functions) for (const r of fn.ranges) {
        const k = `${r.startOffset}:${r.endOffset}`;
        m.set(k, { name: fn.functionName, start: r.startOffset, end: r.endOffset, count: (m.get(k)?.count ?? 0) + r.count, block: r !== fn.ranges[0] });
      }
    }
  }
  const out = [];
  for (const b of files) {
    const src = readFileSync(join(repoDir, b), 'utf8'), m = ran.get(b);
    if (!m) { out.push(`${b}: never loaded`); continue; }
    const line = (o) => src.slice(0, o).split('\n').length;
    // Ranges never run; a whole-file range is skipped. The share is approximate.
    const dead = [...m.values()].filter((r) => r.count === 0 && r.end - r.start < src.length);
    const bytes = new Uint8Array(src.length);
    for (const r of dead) bytes.fill(1, r.start, r.end);
    const share = 1 - bytes.reduce((a, x) => a + x, 0) / src.length;
    const fns = dead.filter((r) => !r.block).map((r) => `${r.name || '(anonymous)'}@${line(r.start)}`);
    const blocks = dead.filter((r) => r.block && r.end - r.start > 40).map((r) => line(r.start));
    out.push(`${b}: ~${Math.round(share * 100)}% of the code ran; ${fns.length} function(s) never ran${fns.length ? ': ' + fns.slice(0, 25).join(', ') : ''}`);
    out.push(`  blocks never run (>40 chars), first lines: ${[...new Set(blocks)].sort((x, y) => x - y).slice(0, 60).join(' ')}`);
  }
  return out;
}

const tmp = tempDir('cov-');
const src = 'const a = 1;\nconst b = 2;\nfunction never() {}\nconst c = 3;\nconst d = 4;\n';
writeFileSync(join(tmp, 'x.mjs'), src);
const at = src.indexOf('function never');
mkdirSync(join(tmp, 'cov'));
writeFileSync(join(tmp, 'cov', 'a.json'), JSON.stringify({ result: [{ url: pathToFileURL(join(tmp, 'x.mjs')).href, functions: [
  { functionName: '', ranges: [{ startOffset: 0, endOffset: src.length, count: 1 }] },
  { functionName: 'never', ranges: [{ startOffset: at, endOffset: at + 17, count: 0 }] }] }] }));
assert.ok(report(join(tmp, 'cov'), tmp, ['x.mjs']).some((l) => /x\.mjs: ~\d+% of the code ran; 1 function\(s\) never ran: never@3/.test(l)));

const args = process.argv.slice(2);
const doFuzz = args.includes('--fuzz'), seconds = Number(args[args.indexOf('--fuzz') + 1]);
if (doFuzz && !(seconds > 0)) { console.error('usage: node coverage.mjs [--suites] [--fuzz <seconds>]'); process.exit(2); }
const cov = tempDir('cov-run-');
// Each child writes its coverage into the one folder.
const run = (...a) => spawnSync(process.execPath, a, { cwd: repo, env: { ...process.env, NODE_V8_COVERAGE: cov }, stdio: 'ignore' });
if (args.includes('--suites') || !doFuzz) for (const t of SUITES) { const r = run(join(repo, t)); if (r.status !== 0) console.error(`${t} failed (exit ${r.status}); its coverage is partial`); }
if (doFuzz) run(join(repo, 'fuzz.mjs'), String(seconds));
console.log(report(cov, repo, FILES).join('\n'));
