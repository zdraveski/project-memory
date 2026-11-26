#!/usr/bin/env node
// Every suite in test/*.test.mjs, side by side, each in its own throwaway HOME:
// one after another they were minutes of every CI run and of the gate. Prints each
// suite's seconds, and the last lines of each one that fails. CI's test workflow and
// deploy.mjs --local-tests both run it.
// Run: node tools/suites.mjs
import { readdirSync, realpathSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
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

// Resolves to [{ file, seconds, failure }], failure being the end of a failing suite's output.
export const runSuites = () => Promise.all(suiteFiles().map((file) => new Promise((done) => {
  const t0 = Date.now();
  execFile(process.execPath, [`test/${file}`], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 }, (e, out, err) =>
    done({ file, seconds: (Date.now() - t0) / 1000, failure: e && ((err + out).trim().split('\n').slice(-20).join('\n') || e.message) }));
})));

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const results = await runSuites();
  for (const { file, seconds, failure } of results.sort((a, b) => b.seconds - a.seconds)) {
    console.log(`${failure ? 'FAIL' : 'ok  '} ${file.padEnd(28)} ${seconds.toFixed(1)} s`);
    if (failure) console.log(failure.replace(/^/gm, '    '));
  }
  process.exit(results.some((r) => r.failure) ? 1 : 0);
}
