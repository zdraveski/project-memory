#!/usr/bin/env node
// May a push to master publish before its own test run? Yes only when the merge's tree is a tree a pull request run
// already passed whole (4 systems, New York, the lints): HEAD is a merge, master before it (HEAD^1) is inside the
// branch (HEAD^2), so the PR's test merge was that branch's tree, the tree is HEAD^2's, and the latest pull_request
// test run on HEAD^2, from this repository (not a fork), completed with success in the last 24 h. Anything else, or any error: no,
// and test.yml's publish after the master run is the path, as before.
// Run: node tools/pretested.mjs [sha]   (CI: writes ok=true|false to $GITHUB_OUTPUT; by hand: prints the verdict for a merge)
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// A pull request run older than this is not trusted: the date, the runner image and the Node patches have moved since.
export const FRESH_MS = 24 * 3600 * 1000;
// The verdict from the facts: { ok, why }. runs: the GitHub API's workflow_runs for HEAD^2's pull_request test runs.
// inside(sha): is that commit inside HEAD^2? The run tested merge(base, HEAD^2), which is HEAD^2's tree only when its
// base was inside HEAD^2 (a stacked PR moved onto master gets no new run, and its old base may hold commits HEAD^2 lacks).
export const decide = ({ parents, ancestor, sameTree, runs, repo, inside, now = Date.now() }) => {
  if (parents.length !== 2) return { ok: false, why: `not a merge (${parents.length} parent(s))` };
  if (!ancestor) return { ok: false, why: 'master moved: HEAD^1 is not inside the merged branch' };
  if (!sameTree) return { ok: false, why: "the merge's tree is not the branch's" };
  const own = runs.filter((r) => r.head_repository?.full_name === repo).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!own.length) return { ok: false, why: `no pull_request test run of ${repo} on the branch's last commit` };
  const [last] = own;
  if (last.status !== 'completed' || last.conclusion !== 'success') return { ok: false, why: `its last test run is ${last.status}/${last.conclusion}` };
  if (!(now - Date.parse(last.updated_at) < FRESH_MS)) return { ok: false, why: `its last test run ${last.id} finished over 24 h ago (${last.updated_at})` };
  if (!last.pull_requests?.some((pr) => pr.base?.ref === 'master' && inside(pr.base.sha))) return { ok: false, why: `its last test run ${last.id} was not against a master inside the branch` };
  return { ok: true, why: `test run ${last.id} passed on the same tree` };
};

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const sha = process.argv[2] ?? 'HEAD';
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
  let verdict;
  try {
    const parents = git('rev-list', '--parents', '-n', '1', sha).split(' ').slice(1);
    const two = parents.length === 2;
    const repo = process.env.GITHUB_REPOSITORY || execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim();
    verdict = decide({
      parents, repo,
      inside: (base) => spawnSync('git', ['merge-base', '--is-ancestor', base, parents[1]]).status === 0,
      ancestor: two && spawnSync('git', ['merge-base', '--is-ancestor', parents[0], parents[1]]).status === 0,
      sameTree: two && git('rev-parse', `${sha}^{tree}`) === git('rev-parse', `${parents[1]}^{tree}`),
      runs: two ? JSON.parse(execFileSync('gh', ['api', '-X', 'GET', `repos/${repo}/actions/workflows/test.yml/runs`, '-f', `head_sha=${parents[1]}`, '-f', 'event=pull_request', '--jq', '.workflow_runs'], { encoding: 'utf8' }) || '[]') : [],
    });
  } catch (e) { verdict = { ok: false, why: `could not tell: ${String(e.message ?? e).split('\n')[0]}` }; }
  console.log(`${verdict.ok ? 'pretested' : 'not pretested'}: ${verdict.why}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${verdict.ok}\n`);
}
