#!/usr/bin/env node
// Every suite in test/*.test.mjs, side by side (a core free), each in its own throwaway HOME,
// then the timed ones alone: one after another they were minutes of every CI run and of the gate. Prints each
// suite's seconds, and the last lines of each one that fails. CI's test workflow and
// deploy.mjs --local-tests both run it.
// Run: node tools/suites.mjs
import { readdirSync, realpathSync, existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
export const suiteFiles = () => readdirSync(join(repo, 'test')).filter((f) => f.endsWith('.test.mjs')).sort();
// The plugin as it ships: every src/*.mjs, read from the folder so a new module needs no list, and the files around it.
export const srcFiles = () => readdirSync(join(repo, 'src')).filter((f) => f.endsWith('.mjs')).sort().map((f) => `src/${f}`);
// Every file under the plugin's own folders, and LICENSE: read from disk, not git, so a copy (mutate.mjs's) works too.
// A hand list here left agents/recall.md and the icon out of the deploy while the release had them.
const PLUGIN_DIRS = ['.claude-plugin', 'hooks', 'commands', 'skills', 'agents'];
const filesUnder = (dir) => (existsSync(join(repo, dir)) ? readdirSync(join(repo, dir), { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(repo.length + 1).replace(/\\/g, '/')) : []);
export const pluginFiles = () => [...srcFiles(), ...PLUGIN_DIRS.flatMap(filesUnder).sort(), ...(existsSync(join(repo, 'LICENSE')) ? ['LICENSE'] : [])];

// The order the suites run in, from [{ file, size }]: a pool `width` wide (a core left free; all 31 at once
// broke the 90% CPU cap and starved the timing checks), biggest first so the longest do not start last; then the
// *-timed.test.mjs files, one at a time on a quiet machine: their wall-clock limits measure the code, not the load.
export const isTimed = (file) => file.endsWith('-timed.test.mjs');
export const plan = (files, cores) => ({
  width: Math.max(1, cores - 1),
  pool: files.filter((f) => !isTimed(f.file)).sort((a, b) => b.size - a.size).map((f) => f.file),
  timed: files.filter((f) => isTimed(f.file)).map((f) => f.file),
});
// Runs fn on each item, `width` at a time; the results in the items' order.
export const pool = async (items, width, fn) => {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
};

const runOne = (file) => new Promise((done) => {
  const t0 = Date.now();
  execFile(process.execPath, [`test/${file}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 }, (e, out, err) =>
    done({ file, seconds: (Date.now() - t0) / 1000, failure: e && ((err + out).trim().split('\n').slice(-20).join('\n') || e.message) }));
});
// Resolves to [{ file, seconds, failure }], failure being the end of a failing suite's output.
export const runSuites = async () => {
  const { width, pool: first, timed } = plan(suiteFiles().map((file) => ({ file, size: statSync(join(repo, 'test', file)).size })), availableParallelism());
  return [...await pool(first, width, runOne), ...await pool(timed, 1, runOne)];
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const results = await runSuites();
  for (const { file, seconds, failure } of results.sort((a, b) => b.seconds - a.seconds)) {
    console.log(`${failure ? 'FAIL' : 'ok  '} ${file.padEnd(28)} ${seconds.toFixed(1)} s`);
    if (failure) console.log(failure.replace(/^/gm, '    '));
  }
  process.exit(results.some((r) => r.failure) ? 1 : 0);
}
