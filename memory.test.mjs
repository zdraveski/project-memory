// Self-check for memory.mjs, the memory CLI: ranked search, status, history
// and restore from real snapshots, promote, doctor. A throwaway HOME holds a
// project store and the shared store. Run: node memory.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, utimesSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import assert from 'node:assert';
import { tool, tempHome, storeFor } from './harness.mjs';

const CLI = tool('memory.mjs'), TIER = tool('memory-tier.mjs');
const { home, env } = tempHome('memcli-');
const root = join(home, '.claude', 'projects');
const dir = join(root, 'C--mem-cli', 'memory'), shared = join(root, '_shared', 'memory');
mkdirSync(dir, { recursive: true });
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args, ...(args.includes('--shared') ? [] : ['--store', dir])], { env, encoding: 'utf8' });
const tenMin = new Date(Date.now() - 10 * 60000);
const memory = (d, name, desc, body = 'body', extra = '') => {
  writeFileSync(join(d, `${name}.md`), `---\nname: ${name}\ndescription: "${desc}"\nmetadata:\n  type: project\n${extra}---\n\n${body}\n`);
  utimesSync(join(d, `${name}.md`), tenMin, tenMin);
};

// 1. Search: ranked, archive included, the shared store too.
memory(dir, 'deploy-notes', 'deploy notes', 'deploy '.repeat(5));
memory(dir, 'release-checklist', 'steps before a deploy');
memory(dir, 'a-long-log', 'everything that happened', 'we did a deploy, then more steps, then a deploy and more steps');
memory(dir, 'mentions', 'unrelated', 'deploy once');
memory(dir, 'spam-log', 'unrelated chatter', 'deploy '.repeat(20));
memory(dir, 'old-thing', 'an archived deploy memory');
writeFileSync(join(dir, 'crlf-note.md'), '\uFEFF---\r\nname: crlf-note\r\ndescription: "windows line ends"\r\nmetadata:\r\n  type: project\r\n---\r\n\r\nbody [[ghost]] [[shared-rule]]\r\n');
memory(dir, 'bare', '', 'no description here');
writeFileSync(join(dir, 'MEMORY.md'), ['# Index', '', '- [Deploy notes](deploy-notes.md) — deploy notes', '- [Release checklist](release-checklist.md) — steps',
  '- [Log](a-long-log.md) — log', '- [Mentions](mentions.md) — m', '- [Spam](spam-log.md) — s', '- [CRLF](crlf-note.md) — c', '- [Bare](bare.md) — b',
  '- [Archive](MEMORY-archive.md) — 1 older pointers'].join('\n') + '\n');
writeFileSync(join(dir, 'MEMORY-archive.md'), '# Archive\n\n- [Old](old-thing.md) — old\n');
mkdirSync(shared, { recursive: true });
memory(shared, 'shared-rule', 'stage files by name, never git add -A');
writeFileSync(join(shared, 'MEMORY.md'), '- [Shared rule](shared-rule.md) — stage files by name\n');

const order = (out) => [...out.matchAll(/^ *\d+ +(?:shared )?\w+ +\d{4}-\d\d-\d\d +\S*[\\/](\S+)\.md$/gm)].map((m) => m[1]);
let r = cli('search', 'deploy');
ok(r.status === 0 && order(r.stdout)[0] === 'deploy-notes' && order(r.stdout).indexOf('deploy-notes') < order(r.stdout).indexOf('mentions'),
  `a memory named for the term outranks a passing mention (got ${order(r.stdout).join(', ')})`);
ok(order(r.stdout).indexOf('spam-log') > order(r.stdout).indexOf('release-checklist'), 'and saying it twenty times in the body earns no more than twice');
r = cli('search', 'deploy', 'steps');
ok(order(r.stdout)[0] === 'release-checklist', `every term in the description is the strong match (got ${order(r.stdout).join(', ')})`);
ok(order(r.stdout).indexOf('deploy-notes') < order(r.stdout).indexOf('a-long-log'), 'and a log that mentions every term in passing does not outrank a named one');
ok(/^ *\d+ +archived +\d{4}-\d\d-\d\d +\S*old-thing\.md$/m.test(cli('search', 'archived').stdout), 'an archived memory is found, and labelled with its date');
ok(/^ *\d+ +shared hot +\d{4}-\d\d-\d\d +\S*shared-rule\.md$/m.test(cli('search', 'stage').stdout), 'the shared store is searched too, and labelled');
r = cli('search', 'deploy', '--limit', '2');
ok(order(r.stdout).length === 2 && /^2 of [3-9] match\(es\) in [^\n]*; --limit N shows more; --all searches every project$/m.test(r.stdout), `--limit caps the results, and the count says how many it left out (got ${r.stdout.trim().split('\n').pop()})`);
// A hit's date is its modified:, and a hint that would add nothing is not given.
memory(dir, 'dated-quirk', 'a dated quirk', 'body', '  modified: 2026-01-02T12:00:00.000Z\n');
r = cli('search', 'quirk');
ok(/^ *\d+ +unindexed +2026-01-02 +\S*dated-quirk\.md$/m.test(r.stdout) && /^1 of 1 match\(es\) in [^;\n]+; --all searches every project$/m.test(r.stdout), `a hit carries its modified: date; all shown, no --limit hint (got ${r.stdout})`);
r = cli('search', 'quirk', '--all');
ok(/^1 of 1 match\(es\) in [^;\n]+$/m.test(r.stdout), `with --all, no --all hint (got ${r.stdout.trim().split('\n').pop()})`);
ok(order(cli('search', 'deploy', '--limit', '-1').stdout).join() === order(cli('search', 'deploy').stdout).join() && order(cli('search', 'deploy').stdout).length > 2, 'a negative --limit is the default, not "nothing matches"');
rmSync(join(dir, 'dated-quirk.md'));
r = cli('search', 'windows');
ok(order(r.stdout)[0] === 'crlf-note' && /^ +windows line ends$/m.test(r.stdout), 'a BOM and CRLF file is parsed: found, description read');
r = cli('search', 'zzzqqq');
ok(r.status === 0 && /nothing matches/.test(r.stdout), 'no hit says so');
ok(cli('search').status === 1, 'search with no terms is a usage error');

// 2. Status: sizes against the right budget, problems, dangling links.
r = cli('status');
ok(r.status === 0 && /index \d+ \/ 7000 B · 7 hot · 1 archived/.test(r.stdout), `status counts the store against its budget (got ${r.stdout.split('\n')[1]})`);
ok(/links to no memory: crlf-note\.md → \[\[ghost\]\]$/m.test(r.stdout), 'a link to no memory is named; one the shared store resolves is not');
ok(/frontmatter without a description or type: bare\.md/.test(r.stdout), 'a memory with no description is named');
ok(/_shared[\\/]memory  \(shared by every project\)\n  index \d+ \/ 3000 B/.test(r.stdout), 'and the shared store is reported against its 3000 B budget');

// A memory a newer one replaced says so where it is found.
memory(dir, 'old-way', 'the old way to ship', 'ship it', '  superseded-by: new-way.md\n');
r = cli('search', 'old way ship');
ok(/old-way\.md\n     the old way to ship\n     replaced by new-way\.md: read that one/.test(r.stdout), `a replaced memory names its replacement (got ${r.stdout})`);
unlinkSync(join(dir, 'old-way.md'));

// 3. History and restore, from the snapshots memory-tier makes.
const tier = () => spawnSync(process.execPath, [TIER], { env, encoding: 'utf8' });
const other = join(root, 'C--other', 'memory');
mkdirSync(other, { recursive: true });
memory(other, 'secret', 'another project\'s memory');
tier();
const handLine = '- [Deploy notes](deploy-notes.md) — deploy notes';
unlinkSync(join(dir, 'deploy-notes.md'));
writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(handLine + '\n', ''));
tier();
r = cli('history', 'deploy-notes');
ok(r.status === 0 && /  \S+ \S+ \S+  deleted\n  \S+ \S+ \S+  in the first snapshot$/m.test(r.stdout), `history lists the snapshots that changed it, newest first; the first snapshot is not called its writing (got ${r.stdout})`);
// Its last line is a command that works as printed: the path git tracks, no `~`.
const show = r.stdout.match(/^  a change: git -C "([^"]+)" show <commit> -- (\S+)$/m), first = r.stdout.match(/^  (\w+) .*in the first snapshot$/m);
ok(show && first && /deploy notes/.test(spawnSync('git', ['-C', show[1], 'show', first[1], '--', show[2]], { encoding: 'utf8' }).stdout), `history ends with the command that shows a change (got ${show && show[0]})`);
r = cli('restore', 'deploy-notes');
ok(r.status === 0 && existsSync(join(dir, 'deploy-notes.md')) && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy'), 'restore brings a deleted memory back from before its deletion');
// Status names what the snapshots saw change this week, in this store only.
r = cli('status');
ok(/changed in the last 7 days: [^\n]*deleted deploy-notes/.test(r.stdout) && !/added [^·\n]*deploy-notes/.test(r.stdout), `status names the week's changes (got ${r.stdout})`);
ok(!/changed in the last 7 days:[^\n]*secret/.test(r.stdout), "another project's memory is not listed");
// A name git would quote (not ASCII) is listed as it is.
memory(dir, 'café-notes', 'notes from the café');
tier();
ok(/changed in the last 7 days: [^\n]*café-notes/.test(cli('status').stdout), 'a memory with an accented name is listed');
unlinkSync(join(dir, 'café-notes.md'));
ok(readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').includes(handLine), 'with its hand-written index line');
r = cli('restore', 'deploy-notes');
ok(r.status === 1 && /exists/.test(r.stdout), 'restore refuses to replace a memory that exists');
writeFileSync(join(dir, 'deploy-notes.md'), 'scribbled over');
r = cli('restore', 'deploy-notes', '--force');
ok(r.status === 0 && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy') && /still there/.test(r.stdout), '--force replaces it, and the line it has is kept');
ok(readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').filter((l) => l === handLine).length === 1, 'and no second line is added');
const kept = r.stdout.match(/what it replaced is kept: git -C "([^"]+)" cat-file -p (\w+)/);
ok(kept && spawnSync('git', ['-C', kept[1], 'cat-file', '-p', kept[2]], { encoding: 'utf8' }).stdout === 'scribbled over', `what --force replaced is kept in the repo, and said where (got ${r.stdout.trim()})`);
r = cli('restore', 'deploy-notes', '--force');
ok(r.status === 1 && /already matches/.test(r.stdout), `a restore that would change nothing says so, not "restored" (got ${r.stdout.trim()})`);
ok(!/--all looks/.test(cli('history', 'never-was', '--all').stdout), 'history --all does not suggest --all');
r = cli('history', 'never-was');
ok(cli('restore', 'never-was').status === 1 && r.status === 1 && /search <words> finds a memory's name; --all looks in every project/.test(r.stdout), 'a memory no snapshot holds: restore and history fail, and history says how to find the name');
ok(cli('restore', 'mentions', '--force', '--rev', 'nosuchrev').status === 1, 'an unknown revision fails');
// Deleted, made again, changed, deleted again before any snapshot: the newest
// snapshot has the newest version, not the one before the first deletion.
memory(dir, 'cycle', 'v1', 'v1'); tier();
unlinkSync(join(dir, 'cycle.md')); tier();
memory(dir, 'cycle', 'v2', 'v2'); tier();
unlinkSync(join(dir, 'cycle.md'));
r = cli('restore', 'cycle');
ok(r.status === 0 && readFileSync(join(dir, 'cycle.md'), 'utf8').includes('v2'), `restore takes the newest snapshot that has it (got ${readFileSync(join(dir, 'cycle.md'), 'utf8').trim().split('\n').pop()})`);
// git's paths are case-sensitive; on Windows a store named in another case is the same store.
if (process.platform === 'win32') {
  r = spawnSync(process.execPath, [CLI, 'history', 'cycle', '--store', dir.toLowerCase()], { env, encoding: 'utf8' });
  ok(r.status === 0 && /added/.test(r.stdout), 'a store path in another letter case still finds its snapshots');
}
ok(cli('history', '../../C--other/memory/secret').status === 1 && cli('restore', '../../C--other/memory/secret').status === 1 && !existsSync(join(dir, 'secret.md')),
  "a path is not a memory name: it cannot reach another project's store");

// 4. Promote: into the shared store, line and all; never half-moved.
const line = '- [Release checklist](release-checklist.md) — steps';
r = cli('promote', 'release-checklist');
ok(r.status === 0 && existsSync(join(shared, 'release-checklist.md')) && !existsSync(join(dir, 'release-checklist.md')), 'promote moves the file to the shared store');
ok(readFileSync(join(shared, 'MEMORY.md'), 'utf8').split('\n').includes(line) && !readFileSync(join(dir, 'MEMORY.md'), 'utf8').includes('release-checklist.md'),
  'and its own index line with it');
r = cli('restore', 'release-checklist');
ok(r.status === 1 && /was promoted: it is in /.test(r.stdout) && !existsSync(join(dir, 'release-checklist.md')), 'a promoted memory is not restored into its old project unasked');
ok(/^  promoted: it is in /m.test(cli('history', 'release-checklist').stdout), 'and its history there says where it went');
// An index saved with a BOM: its first line is a pointer like any other.
memory(dir, 'bom-first', 'a lesson listed first');
writeFileSync(join(dir, 'MEMORY.md'), '\uFEFF- [Bom first](bom-first.md) — hand-written\n' + readFileSync(join(dir, 'MEMORY.md'), 'utf8'));
r = cli('promote', 'bom-first');
ok(r.status === 0 && !readFileSync(join(dir, 'MEMORY.md'), 'utf8').includes('bom-first.md') && readFileSync(join(shared, 'MEMORY.md'), 'utf8').includes('- [Bom first](bom-first.md) — hand-written'),
  'promote finds a first index line behind a BOM, and moves that line');
memory(dir, 'shared-rule', 'a project copy');
const before = readFileSync(join(shared, 'shared-rule.md'), 'utf8');
r = cli('promote', 'shared-rule');
ok(r.status === 1 && existsSync(join(dir, 'shared-rule.md')) && readFileSync(join(shared, 'shared-rule.md'), 'utf8') === before, 'a name the shared store has already: refused, both stores unchanged');
writeFileSync(join(dir, 'handoff.md'), '---\nname: handoff\ndescription: "The rolling handoff"\n---\n');
ok(cli('promote', 'MEMORY').status === 1 && cli('promote', 'handoff').status === 1 && existsSync(join(dir, 'handoff.md')), 'an index or the handoff is not a memory to share');
r = cli('promote', 'shared-rule', '--shared');
ok(r.status === 1 && /in the shared store already/.test(r.stdout), 'nor is a memory already shared');

// 4a. What a model types is a sentence: words that name no memory are skipped,
// the handoff (a log the startup line prints) is no hit, and a hit stays short.
memory(dir, 'the-plans-are-the-brand', 'unrelated');
memory(dir, 'linky', 'a memory with many links', [1, 2, 3, 4, 5, 6, 7].map((i) => `[[l${i}]]`).join(' '));
ok(!/the-plans-are-the-brand/.test(cli('search', 'how', 'the', 'deploy').stdout), '"the" and "how" score nothing, not even in a file name');
ok(!/handoff\.md/.test(cli('search', 'rolling', 'handoff').stdout), 'the handoff is not a search hit');
ok(/^ +links: l1, l2, l3, l4, l5, and 2 more$/m.test(cli('search', 'linky').stdout), 'a hit lists five links and counts the rest');
r = cli('search', 'CI', 'a');
ok(r.status === 0 && /no word of 3\+ letters/.test(r.stdout), 'a query of short words says so, not "nothing matches"');

// 4b. Promote and restore take the store's lock: one held by a hook is busy, and nothing moves.
memory(dir, 'locked-out', 'a memory to move');
mkdirSync(join(dir, '.lock'));
r = cli('promote', 'locked-out');
const r2 = cli('restore', 'mentions', '--force');
rmSync(join(dir, '.lock'), { recursive: true });
ok(r.status === 1 && /busy/.test(r.stdout) && existsSync(join(dir, 'locked-out.md')) && !existsSync(join(shared, 'locked-out.md')), 'promote waits out a held lock, then gives up with nothing moved');
ok(r2.status === 1 && /busy/.test(r2.stdout), 'and so does restore');

// 4c. A line the ceiling evicted carries a mark in the archive: restored, the mark stays behind.
const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
const commit = (m) => { git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', m); };
memory(dir, 'evicted', 'a line the ceiling moved');
const arcPath = join(dir, 'MEMORY-archive.md'), arcBefore = readFileSync(arcPath, 'utf8');
writeFileSync(arcPath, arcBefore + '- [Evicted](evicted.md) — hand-written <!-- overflow -->\n');
commit('evicted, in the archive');
unlinkSync(join(dir, 'evicted.md')); writeFileSync(arcPath, arcBefore);
commit('evicted, deleted');
r = cli('restore', 'evicted');
ok(r.status === 0 && readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').includes('- [Evicted](evicted.md) — hand-written'), 'a line restored from the archive comes back without its overflow mark');

// 4d. The store is the session's, found as the hooks find it: by its transcript,
// not by the cwd. Outside a session, the nearest folder above the cwd with a store.
writeFileSync(join(root, 'C--mem-cli', 'sess-cli-1.jsonl'), '');
const fromElsewhere = spawnSync(process.execPath, [CLI, 'status'], { env: { ...env, CLAUDE_CODE_SESSION_ID: 'sess-cli-1' }, cwd: home, encoding: 'utf8' });
ok(fromElsewhere.stdout.split('\n')[0] === dir, `inside a session, the CLI uses the session's store wherever the cwd is (got ${fromElsewhere.stdout.split('\n')[0]})`);
const proj = join(home, 'proj'), deeper = join(proj, 'sub', 'deeper');
mkdirSync(deeper, { recursive: true });
// The cwd as the OS reports it, which is what a process sees: on macOS the
// temp folder's /var is /private/var.
const physical = spawnSync(process.execPath, ['-p', 'process.cwd()'], { cwd: proj, encoding: 'utf8' }).stdout.trim();
const projStore = join(root, physical.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
mkdirSync(projStore, { recursive: true });
const { CLAUDE_CODE_SESSION_ID: _, ...noSession } = env;
const fromBelow = spawnSync(process.execPath, [CLI, 'status'], { env: noSession, cwd: deeper, encoding: 'utf8' });
ok(fromBelow.stdout.split('\n')[0] === projStore, `outside a session, a subdirectory finds its project's store (got ${fromBelow.stdout.split('\n')[0]})`);

// The CLI through a symlinked folder: Node names it by its real path.
symlinkSync(dirname(CLI), join(home, 'linked-cli'), 'junction');
r = spawnSync(process.execPath, [join(home, 'linked-cli', 'memory.mjs'), 'status', '--store', dir], { env, encoding: 'utf8' });
ok(r.stdout.includes(dir), `the CLI run through a symlinked folder still runs (got ${JSON.stringify(r.stdout + r.stderr)})`);

// 5. Doctor: one wiring, not two, not none.
const settings = (s) => writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(s));
const hook = (cmd) => [{ hooks: [{ type: 'command', command: `node "C:/x/${cmd}"` }] }];
const wired = { hooks: { Stop: hook('memory-tier.mjs --stop'), SessionStart: hook('handoff-log.mjs --print'), PreCompact: hook('compact-gate.mjs') } };
settings(wired);
r = cli('doctor');
ok(/^ok +wired by settings\.json/m.test(r.stdout), 'doctor: wired by settings.json');
settings({ ...wired, enabledPlugins: { 'project-memory@local': true } });
r = cli('doctor');
ok(r.status === 1 && /^PROBLEM wired twice[^\n]*\. The user's fix: delete those entries/m.test(r.stdout), 'doctor: settings.json and the plugin both wired is every hook twice, and the fix is the user\'s');
settings({ enabledPlugins: { 'project-memory@local': true, 'other@x': true } });
ok(/^ok +wired by the project-memory plugin/m.test(cli('doctor').stdout), 'doctor: wired by the plugin');
settings({ hooks: { Stop: hook('memory-tier.mjs --stop') } });
ok(/^PROBLEM settings\.json wires Stop but not SessionStart, PreCompact/m.test(cli('doctor').stdout), 'doctor: a half-wired settings.json is named');
settings({});
ok(/^PROBLEM not wired[^\n]*claude plugin install project-memory@project-memory/m.test(cli('doctor').stdout), 'doctor: nothing wired is a problem, with the install');
// Before Claude's first reply nothing has saved: waiting, not a problem. A reply
// this conversation finished over a minute ago, with nothing saved, is one.
{
  const stopRan = join(root, '.stop-ran'), had = existsSync(stopRan) ? readFileSync(stopRan, 'utf8') : null;
  rmSync(stopRan, { force: true });
  const doc = (id) => spawnSync(process.execPath, [CLI, 'doctor'], { env: id ? { ...noSession, CLAUDE_CODE_SESSION_ID: id } : noSession, encoding: 'utf8' }).stdout;
  const replied = (id, ago) => writeFileSync(join(root, 'C--mem-cli', `${id}.jsonl`),
    JSON.stringify({ type: 'assistant', timestamp: new Date(Date.now() - ago).toISOString(), message: { usage: { input_tokens: 1 }, stop_reason: 'end_turn', content: [] } }) + '\n');
  ok(/^ok +waiting for Claude's first reply/m.test(doc()), 'doctor: before the first reply, waiting is no problem');
  replied('sess-fresh', 10_000);
  ok(/^ok +waiting for Claude's first reply/m.test(doc('sess-fresh')), 'doctor: a reply that ended seconds ago is still waiting');
  replied('sess-dead', 5 * 60_000);
  const dead = doc('sess-dead');
  ok(/^PROBLEM Claude finished a reply at [^\n]*its Stop hook is not running\. The user's fix: restart Claude Code/m.test(dead), `doctor: a reply long finished with nothing saved is a problem (got ${dead})`);
  for (const id of ['sess-fresh', 'sess-dead']) rmSync(join(root, 'C--mem-cli', `${id}.jsonl`));
  // From a terminal (no session), the project's newest conversation decides:
  // with none to read, dead hooks said "waiting" forever.
  const hs = storeFor(home, home);
  mkdirSync(hs, { recursive: true });
  writeFileSync(join(dirname(hs), 'sess-term.jsonl'), JSON.stringify({ type: 'assistant', timestamp: new Date(Date.now() - 5 * 60_000).toISOString(), message: { usage: { input_tokens: 1 }, stop_reason: 'end_turn', content: [] } }) + '\n');
  const term = spawnSync(process.execPath, [CLI, 'doctor'], { env: noSession, cwd: home, encoding: 'utf8' }).stdout;
  ok(/^PROBLEM Claude finished a reply at [^\n]*its Stop hook is not running/m.test(term), `doctor from a terminal reads the project's newest conversation (got ${term})`);
  rmSync(dirname(hs), { recursive: true, force: true });
  if (had !== null) writeFileSync(stopRan, had);
}
// Installed from GitHub, with nothing deployed here: it runs its own cached copy.
const gh = join(home, '.claude', 'plugins', 'cache', 'project-memory', 'project-memory', '1.0.0');
mkdirSync(join(gh, '.claude-plugin'), { recursive: true });
writeFileSync(join(gh, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'project-memory', version: '1.0.0' }));
const installed = (id, at, source) => {
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { [id]: [{ installPath: at }] } }));
  writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ [id.split('@')[1]]: { source } }));
  settings({ enabledPlugins: { [id]: true } });
};
installed('project-memory@project-memory', gh, { source: 'github', repo: 'zdraveski/project-memory' });
r = cli('doctor');
ok(/^ok +the plugin runs version 1\.0\.0 from [^\n]*1\.0\.0$/m.test(r.stdout) && !/PROBLEM[^\n]*plugin/.test(r.stdout), `doctor: a GitHub install runs its cached copy, and that is fine (got ${r.stdout})`);
// From another marketplace, or a local clone: the same, by whatever name it was added under.
installed('project-memory@my-plugins', join(home, 'clone'), { source: 'directory', path: join(home, 'clone') });
ok(/^ok +the plugin runs version \(none\) from [^\n]*clone$/m.test(cli('doctor').stdout), 'doctor: a plugin from a local clone is found under any marketplace name');
// An installed plugin read from a cached copy reaches a deploy only by an update.
const live = join(home, '.claude', 'hooks-live'), cache = join(home, '.claude', 'plugins', 'cache', 'pm', '1.0.1');
for (const [d, commit] of [[live, 'bbb'], [cache, 'aaa']]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, '.deployed.json'), JSON.stringify({ commit, files: {} })); }
writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'project-memory@project-memory': [{ installPath: cache }] } }));
writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), '{}');
settings({ enabledPlugins: { 'project-memory@project-memory': true } });
ok(/^PROBLEM the plugin runs aaa from [^\n]*, the last deploy is bbb\. The user's fix: claude plugin update/m.test(cli('doctor').stdout), 'doctor: a plugin copy older than the last deploy is named');
writeFileSync(join(cache, '.deployed.json'), JSON.stringify({ commit: 'bbb', files: {} }));
ok(/^ok +the plugin runs the last deploy, bbb/m.test(cli('doctor').stdout), 'doctor: and one that matches is fine');
// Installed from a local folder (the live copy), Claude Code reads it in place:
// a stale cache copy beside it is not what runs.
writeFileSync(join(cache, '.deployed.json'), JSON.stringify({ commit: 'aaa', files: {} }));
writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'project-memory': { source: { source: 'directory', path: live } } }));
r = cli('doctor');
ok(/^ok +the plugin runs the last deploy, bbb, from [^\n]*hooks-live$/m.test(r.stdout), `doctor: a plugin read in place from the live copy runs the last deploy, whatever its cache holds (got ${r.stdout.split('\n').find((l) => /plugin runs/.test(l))})`);
// Added from the repo instead, it runs untested edits: no update fixes that.
writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'project-memory': { source: { source: 'directory', path: join(home, 'repo') } } }));
ok(/^PROBLEM the plugin is read from [^\n]*repo, not the live copy\. The user's fix: claude plugin marketplace remove project-memory,/m.test(cli('doctor').stdout), 'doctor: a plugin read from anywhere but the live copy is named, with the way back');
settings({});
const packDir = join(root, '.git', 'objects', 'pack');
mkdirSync(packDir, { recursive: true });
writeFileSync(join(packDir, 'pack-dead.idx'), 'x');
ok(/^ok +1 pack index file\(s\) [^\n]*have no pack[^\n]*pack-dead\.idx$/m.test(cli('doctor').stdout), 'doctor: an index a repack left with no pack is named');

console.log(`memory: ${checks} checks passed`);
