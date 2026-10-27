#!/usr/bin/env node
// The only way the hooks go live. The plugin installed from ~/.claude/hooks-live
// runs them from there, never from this repo: run from here, an edit was live
// in every session before any test saw it (2026-10-26). This refuses hooks with
// uncommitted changes, runs the full check, then copies them over and writes a
// manifest of their hashes; handoff-log's startup line names any live file that
// no longer matches it.
//
// Run: node deploy.mjs [--tiering-change]   (from this repo; ~9 minutes)
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hash } from './handoff-log.mjs';
import { BUSY, sleep } from './store.mjs';
import { LIVE, installPath, pluginRoot, deployedCommit } from './memory.mjs';

// The hooks, the CLI, and the plugin around them: the live copy is also the
// project-memory plugin's root and its marketplace. Installed from there, the
// plugin is read in place, and Claude Code keeps a copy per version in
// ~/.claude/plugins/cache that only a new version refreshes (2026-10-27).
const HOOKS = ['store.mjs', 'handoff-log.mjs', 'compact-gate.mjs', 'memory-tier.mjs', 'memory.mjs',
  '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json', 'skills/memory/SKILL.md'];

// Each file by rename, so a hook starting mid-deploy reads a whole file. Every
// temp is written first, where a full disk or a scanner fails, then the renames
// run back to back: a failure no longer leaves new files beside the old manifest.
// shortcut: not all at once -- a hook starting in the milliseconds between
// renames can load one new file beside an old one; deploys are rare.
// `patch` stamps the plugin's version: the same version is never re-copied.
// `node` names the node that runs the live hooks, as the hook entries once
// did: a Claude Code started without node on its PATH (the desktop app,
// a service) would run none of them, and the startup line that says so is a
// hook too. The repo's hooks.json keeps plain `node`.
export function install(from, to, commit, patch, node) {
  const files = {};
  for (const f of HOOKS) {
    let buf = readFileSync(join(from, f));
    if (patch !== undefined && f === '.claude-plugin/plugin.json') {
      const m = JSON.parse(buf);
      m.version = m.version.split('.').slice(0, 2).concat(String(patch)).join('.');
      buf = Buffer.from(JSON.stringify(m, null, 2) + '\n');
    }
    if (node && f === 'hooks/hooks.json') {
      const h = JSON.parse(buf);
      for (const es of Object.values(h.hooks)) for (const e of es) for (const x of e.hooks) if (x.command === 'node') x.command = node.replace(/\\/g, '/');
      buf = Buffer.from(JSON.stringify(h, null, 2) + '\n');
    }
    mkdirSync(dirname(join(to, f)), { recursive: true });
    writeFileSync(join(to, `${f}.tmp`), buf);
    files[f] = hash(buf);
  }
  // A scanner holding a fresh file refuses the rename for a moment: retried, as replaceIfUnchanged does.
  for (const f of HOOKS) for (let i = 0; ; i++) {
    try { renameSync(join(to, `${f}.tmp`), join(to, f)); break; }
    catch (e) { if (i >= 3 || !BUSY.includes(e.code)) throw e; sleep(100); }
  }
  // Each file's size and mtime as written: the startup check reads only a file whose stat moved.
  const stat = Object.fromEntries(HOOKS.map((f) => { const s = statSync(join(to, f)); return [f, [s.size, s.mtimeMs]]; }));
  writeFileSync(join(to, '.deployed.json'), JSON.stringify({ commit, repo: from, at: new Date().toISOString(), files, stat }) + '\n');
  writeFileSync(join(to, 'README.md'), `Deployed by ${join(from, 'deploy.mjs')} after the full check. Edit there and deploy; an edit here is live and untested, and the startup line will say so.\n`);
}

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const repo = dirname(fileURLToPath(import.meta.url));
  const node = (...args) => execFileSync(process.execPath, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const fail = (why) => { console.error(`deploy: ${why}`); process.exit(1); };
  const step = (name, fn) => {
    process.stdout.write(`${name} ... `);
    try { fn(); console.log('ok'); }
    catch (e) { console.log('FAILED'); fail(`${name}: ${(String(e.stderr || '') + String(e.stdout || '') || e.message).trim().split('\n').slice(-3).join(' | ')}`); }
  };
  // The manifest names a commit: the hooks, and the check that passes them, must
  // be that commit. The plugin rewrites its own file here, so it is left out.
  const dirty = () => git('status', '--porcelain', '--', '.', ':!context-mode-cache-heal.mjs');
  if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'master') fail('deploy from master: the manifest names this folder as the place to edit');
  if (dirty()) fail('uncommitted changes: commit first');
  const commit = git('rev-parse', '--short', 'HEAD');
  // The six suites side by side, each in its own throwaway HOME: one after
  // another they were a minute of the gate.
  process.stdout.write('the six suites ... ');
  const suites = await Promise.all(['store', 'handoff-log', 'compact-gate', 'memory-tier', 'memory'].map((t) => new Promise((done) =>
    execFile(process.execPath, [`${t}.test.mjs`], { cwd: repo, encoding: 'utf8' }, (e, out, err) => done(e && `${t}.test: ${(err + out).trim().split('\n').slice(-3).join(' | ')}`)))));
  if (suites.some(Boolean)) { console.log('FAILED'); fail(suites.filter(Boolean).join('; ')); }
  console.log('ok');
  // The manifest is checked with `claude plugin validate . --strict` before a
  // release (CONTRIBUTING.md), not here: the plugin runs no signed-in claude CLI,
  // which the plugin directory's security scan holds.
  step('mutation check (~8 min)', () => node('mutate.mjs'));
  step('soak', () => node('memory-tier.soak.mjs'));
  step('break harness', () => {
    const bad = node('memory-tier.break.mjs').split('\n').filter((l) => l.trim() && !l.includes(' ok ('));
    if (bad.length) throw new Error(bad.join('\n'));
  });
  // Tiering the real stores comes out the same unless the change meant it to.
  if (existsSync(join(LIVE, 'memory-tier.mjs')) && !process.argv.includes('--tiering-change')) {
    step('dry run same as live', () => {
      const same = () => node(join(LIVE, 'memory-tier.mjs'), '--dry-run') === node('memory-tier.mjs', '--dry-run');
      // Twice before failing: a parallel session's Stop can tier a store between the two runs.
      if (!same() && !same()) throw new Error('the dry run differs from live; rerun with --tiering-change if the change meant it');
    });
  }
  // Another session can commit or edit here during the check: what is
  // copied has to be what was checked.
  if (git('rev-parse', '--short', 'HEAD') !== commit || dirty()) fail('the repo changed during the check: deploy again');
  // The commit count is the patch number: it only grows on master.
  install(repo, LIVE, commit, Number(git('rev-list', '--count', 'HEAD')), process.execPath);
  console.log(`deployed ${commit} to ${LIVE}`);
  // Installed as a plugin: it reads the live copy in place, so this deploy is
  // already what it runs. The cache copy beside it is not refreshed (that took
  // `claude plugin update`); nothing runs it.
  if (installPath()) {
    const ran = deployedCommit(pluginRoot());
    console.log(ran === commit ? `the plugin runs ${commit} from ${pluginRoot()}` : `warning: the plugin runs ${ran || 'an unknown copy'} from ${pluginRoot()}, not ${commit}: node memory.mjs doctor says why`);
  }
}
