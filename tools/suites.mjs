#!/usr/bin/env node
// Every suite in test/*.test.mjs, side by side, each in its own throwaway HOME:
// one after another they were minutes of every CI run and of the gate. Prints each
// suite's seconds, and the last lines of each one that fails. CI's test workflow and
// deploy.mjs --local-tests both run it.
// Run: node tools/suites.mjs
import { readdirSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
export const suiteFiles = () => readdirSync(join(repo, 'test')).filter((f) => f.endsWith('.test.mjs')).sort();

// Resolves to [{ file, seconds, failure }], failure being the end of a failing suite's output.
export const runSuites = () => Promise.all(suiteFiles().map((file) => new Promise((done) => {
  const t0 = Date.now();
  execFile(process.execPath, [`test/${file}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 }, (e, out, err) =>
    done({ file, seconds: (Date.now() - t0) / 1000, failure: e && (err + out).trim().split('\n').slice(-20).join('\n') }));
})));

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const results = await runSuites();
  for (const { file, seconds, failure } of results.sort((a, b) => b.seconds - a.seconds)) {
    console.log(`${failure ? 'FAIL' : 'ok  '} ${file.padEnd(28)} ${seconds.toFixed(1)} s`);
    if (failure) console.log(failure.replace(/^/gm, '    '));
  }
  process.exit(results.some((r) => r.failure) ? 1 : 0);
}
