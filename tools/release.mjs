#!/usr/bin/env node
// A patch release's steps (CONTRIBUTING "Releasing"), so none is done by hand or forgotten:
//   start X.Y.Z   the last fuzz, mutate and changed-lines results; then patch-X.Y.Z from origin/master with the version
//                 bumped and the changelog heading, signed off, pushed, and a draft pull request: CI runs under the build.
//   ready X.Y.Z --validated
//                 the version's changelog section has text; once every check of the pull request passed (not only the
//                 required ones), it leaves draft and merges. `claude plugin validate . --strict` is run by hand first (--validated says so):
//                 nothing in this repository runs the claude command (CONTRIBUTING).
//   after X.Y.Z   waits for master's test run; red: re-runs a failed publish or assets job, names a failed test or lint,
//                 and stops. Green: checks the release has its three files and prints the deploy command.
// Run: node tools/release.mjs start|ready|after X.Y.Z [--validated]
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
export const isPatch = (v) => /^\d+\.\d+\.[1-9]\d*$/.test(v);
// plugin.json with its version set, nothing else touched.
export const bump = (json, v) => {
  const out = json.replace(/("version"\s*:\s*")[^"]*(")/, `$1${v}$2`);
  if (out === json && !json.includes(`"version": "${v}"`)) throw new Error('plugin.json: no "version" to set');
  return out;
};
// The changelog with `## Unreleased` turned into `## X.Y.Z (date)`, or that heading added on top when there is none
// (the builders write under it). Twice is once.
export const heading = (text, v, day) => {
  if (new RegExp(`^## ${v.replace(/\./g, '\\.')}( |\\r?$)`, 'm').test(text)) return text;
  const open = /^## Unreleased[ \t]*(?=\r?$)/m;   // a CRLF checkout too
  if (open.test(text)) return text.replace(open, `## ${v} (${day})`);
  const at = text.search(/^## /m);
  return at === -1 ? `${text.trimEnd()}\n\n## ${v} (${day})\n` : `${text.slice(0, at)}## ${v} (${day})\n\n${text.slice(at)}`;
};
// The text under `## X.Y.Z`, as publish.yml's awk reads it: up to the next `## `.
export const section = (text, v) => {
  const lines = text.split(/\r?\n/), i = lines.findIndex((l) => l === `## ${v}` || l.startsWith(`## ${v} `));
  if (i === -1) return '';
  const end = lines.findIndex((l, k) => k > i && l.startsWith('## '));
  return lines.slice(i + 1, end === -1 ? undefined : end).join('\n').trim();
};
// What a section lacks to read as release notes, not the builders' raw lines (1.6.6 shipped 19 flat lines): an intro line,
// a bold lead on every fix, and ### groups once there are more than 3 fixes.
export const unedited = (sec) => {
  const lines = sec.split('\n').map((l) => l.trim()).filter(Boolean), fixes = lines.filter((l) => l.startsWith('- '));
  return [
    ...(lines[0] && !/^[-#]/.test(lines[0]) ? [] : ['an intro line before the first fix']),
    ...(fixes.every((l) => l.startsWith('- **')) ? [] : ['a **bold lead** on every fix']),
    ...(fixes.length <= 3 || lines.some((l) => l.startsWith('### ')) ? [] : ['### groups (more than 3 fixes)']),
  ];
};
// The files release.yml attaches that a release lacks.
export const missingAssets = (names, tag) => [`project-memory-${tag}.tar.gz`, `project-memory-${tag}.zip`, 'SHA256SUMS'].filter((n) => !names.includes(n));
// A red master run's failed jobs: the publish and assets ones may be re-run (re-running finds the tag and skips it);
// any other is a red test or lint, named and never re-run until a flake passes.
const FAILED = ['failure', 'cancelled', 'timed_out', 'startup_failure'];
export const toRerun = (jobs) => {
  const failed = jobs.filter((j) => FAILED.includes(j.conclusion));
  const ours = (j) => /^(publish|assets)/.test(j.name);
  return { rerun: failed.filter(ours), red: failed.filter((j) => !ours(j)).map((j) => j.name) };
};
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [cmd, v] = process.argv.slice(2);
  if (!['start', 'ready', 'after'].includes(cmd) || !isPatch(v ?? '')) { console.error('usage: node tools/release.mjs start|ready|after X.Y.Z [--validated]  (a patch: Z above 0)'); process.exit(2); }
  const run = (bin, ...a) => execFileSync(bin, a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  const show = (bin, ...a) => execFileSync(bin, a, { cwd: repo, stdio: 'inherit' });
  const branch = `patch-${v}`, tag = `v${v}`;
  if (cmd === 'start') {
    for (const wf of ['fuzz.yml', 'mutate.yml', 'changed-lines.yml']) {
      const [last] = JSON.parse(run('gh', 'run', 'list', '--workflow', wf, '--limit', '1', '--json', 'conclusion,status,createdAt,url') || '[]');
      console.log(`${wf.padEnd(18)} ${last ? `${last.conclusion || last.status} ${last.createdAt} ${last.url}` : 'no run'}`);
    }
    // git switch -c carries uncommitted changes along, into the release: commit.
    if (run('git', 'status', '--porcelain')) { console.error('the working tree has changes: commit or stash them first'); process.exit(1); }
    run('git', 'fetch', 'origin', 'master');
    run('git', 'switch', '-c', branch, 'origin/master');
    const pj = join(repo, '.claude-plugin', 'plugin.json'), cl = join(repo, 'CHANGELOG.md');
    writeFileSync(pj, bump(readFileSync(pj, 'utf8'), v));
    writeFileSync(cl, heading(readFileSync(cl, 'utf8'), v, today()));
    run('git', 'add', '.claude-plugin/plugin.json', 'CHANGELOG.md');
    run('git', 'commit', '-s', '-m', `release: ${v}`);
    show('git', 'push', '-u', 'origin', branch);
    show('gh', 'pr', 'create', '--draft', '--base', 'master', '--head', branch, '--title', `project-memory ${v} (bug fix)`, '--body', `Patch ${v}: the fixes are listed under ## ${v} in CHANGELOG.md.`);
  } else if (cmd === 'ready') {
    const notes = section(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8'), v);
    if (!notes) { console.error(`CHANGELOG.md has no text under ## ${v}`); process.exit(1); }
    const lacks = unedited(notes);
    if (lacks.length) { console.error(`CHANGELOG.md ## ${v} is not edited for users yet (see ## 1.6.5): it lacks ${lacks.join(', ')}`); process.exit(1); }
    if (!process.argv.includes('--validated')) { console.error('run `claude plugin validate . --strict` (it should exit 0), then: node tools/release.mjs ready ' + v + ' --validated'); process.exit(1); }
    // Every check, not only the required ones (auto-merge waits for those alone), before the PR leaves draft: a red one
    // stops here with nothing half done.
    try { show('gh', 'pr', 'checks', branch, '--watch', '--fail-fast'); } catch { console.error(`${branch}: a check failed or none ran yet: see above, fix and rerun`); process.exit(1); }
    show('gh', 'pr', 'ready', branch);
    show('gh', 'pr', 'merge', branch, '--merge');
  } else {
    const sha = run('gh', 'pr', 'view', branch, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid');
    if (!sha) { console.error(`${branch} is not merged yet`); process.exit(1); }
    const [r] = JSON.parse(run('gh', 'run', 'list', '--workflow', 'test', '--commit', sha, '--event', 'push', '--json', 'databaseId') || '[]');
    if (!r) { console.error(`no test run on master for ${sha} yet: try again in a minute`); process.exit(1); }
    try { show('gh', 'run', 'watch', String(r.databaseId), '--exit-status'); } catch {
      const { rerun, red } = toRerun(JSON.parse(run('gh', 'run', 'view', String(r.databaseId), '--json', 'jobs')).jobs);
      if (red.length) console.error(`the master run failed in ${red.join(', ')}: fix it in a new pull request (never re-run a red test)`);
      else for (const j of rerun) { console.error(`re-running ${j.name}`); show('gh', 'run', 'rerun', '--job', String(j.databaseId)); }
      console.error('no deploy while master is red'); process.exit(1);
    }
    let names = [];
    try { names = JSON.parse(run('gh', 'release', 'view', tag, '--json', 'assets')).assets.map((a) => a.name); } catch {}
    const missing = missingAssets(names, tag);
    if (missing.length) { console.error(`${tag} lacks ${missing.join(', ')}, though master is green`); process.exit(1); }
    console.log(`${tag} has its three files. Deploy: claude plugin update project-memory@project-memory, then check the installed commit is ${sha.slice(0, 7)}`);
  }
}
