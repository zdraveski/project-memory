// Self-check for memory.mjs, the memory CLI: ranked search, status, history
// and restore from real snapshots, promote, doctor. A throwaway HOME holds a
// project store and the shared store. Run: node memory.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, utimesSync, rmSync, symlinkSync, readdirSync, chmodSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const show = r.stdout.match(/^  a change: git -C "([^"]+)" --literal-pathspecs show <commit> -- "([^"]+)"$/m), first = r.stdout.match(/^  (\w+) .*in the first snapshot$/m);
ok(show && first && /deploy notes/.test(spawnSync('git', ['-C', show[1], '--literal-pathspecs', 'show', first[1], '--', show[2]], { encoding: 'utf8' }).stdout), `history ends with the command that shows a change (got ${show && show[0]})`);
r = cli('restore', 'deploy-notes');
ok(r.status === 0 && existsSync(join(dir, 'deploy-notes.md')) && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy'), 'restore brings a deleted memory back from before its deletion');
// Status names what the snapshots saw change this week, in this store only.
r = cli('status');
ok(/changed in the last 7 days: [^\n]*deleted deploy-notes/.test(r.stdout) && !/added [^·\n]*deploy-notes/.test(r.stdout), `status names the week's changes (got ${r.stdout})`);
ok(!/changed in the last 7 days:[^\n]*secret/.test(r.stdout), "another project's memory is not listed");
// Added this week and deleted again: deleted, not added.
memory(dir, 'brief-note', 'here and gone');
tier();
unlinkSync(join(dir, 'brief-note.md'));
tier();
r = cli('status');
ok(/deleted [^·\n]*brief-note/.test(r.stdout) && !/added [^·\n]*brief-note/.test(r.stdout), `a memory added and deleted this week is listed as deleted (got ${r.stdout})`);
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
// A note edited every reply has thousands of snapshots (2,000 were 72 KB of
// output): history shows the newest 30 and says how many it left out.
{
  const g = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' }).stdout.trim();
  const branch = g('symbolic-ref', 'HEAD'), from = g('rev-parse', 'HEAD');
  let stream = '';
  for (let i = 0; i < 35; i++) {
    const body = `version ${i}\n`, msg = `memory: edit ${i}\n`;
    stream += `commit ${branch}\ncommitter memory <memory@localhost> ${1600000000 + i * 60} +0000\ndata ${Buffer.byteLength(msg)}\n${msg}${i ? '' : `from ${from}\n`}` +
      `M 100644 inline C--mem-cli/memory/busy-note.md\ndata ${Buffer.byteLength(body)}\n${body}\n`;
  }
  const made = spawnSync('git', ['-C', root, 'fast-import', '--quiet'], { input: stream, encoding: 'utf8' });
  writeFileSync(join(dir, 'busy-note.md'), 'version 34\n');
  const rows = (out) => out.split('\n').filter((l) => /^  \w+ \d{4}-\d\d-\d\d \d\d:\d\d  (added|changed)$/.test(l)).length;
  r = cli('history', 'busy-note');
  ok(made.status === 0 && r.status === 0 && rows(r.stdout) === 30 && /^  and 5 older; --limit N shows more$/m.test(r.stdout) && /^  a change: git -C /.test(r.stdout.trim().split('\n').pop()),
    `history shows the newest 30 and how many are older, its command still last (got ${made.stderr}${r.stdout})`);
  r = cli('history', 'busy-note', '--limit', '40');
  ok(rows(r.stdout) === 35 && !/older/.test(r.stdout), `--limit shows more (got ${rows(r.stdout)})`);
  unlinkSync(join(dir, 'busy-note.md'));
}
// The commit history calls "deleted" no longer has the memory: --rev with it
// failed. It brings back the version that commit deleted.
const deletedAt = cli('history', 'deploy-notes').stdout.match(/^  (\w+) .*deleted$/m)?.[1];
writeFileSync(join(dir, 'deploy-notes.md'), 'scribbled again');
r = cli('restore', 'deploy-notes', '--rev', deletedAt, '--force');
ok(deletedAt && r.status === 0 && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy'), `restore --rev with a "deleted" row brings back what it deleted (got ${r.stdout.trim()})`);
// --rev is a commit, never an option: `--format=...` wrote git's output into the note.
r = cli('restore', 'deploy-notes', '--force', '--rev', '--format=INJECTED %H');
ok(r.status === 1 && /--rev takes a commit/.test(r.stdout) && !/INJECTED/.test(readFileSync(join(dir, 'deploy-notes.md'), 'utf8')), '--rev that is no commit is refused');
r = cli('restore', 'deploy-notes', '--force', '--rev', 'HEAD~1..HEAD');
ok(r.status === 1 && /--rev takes a commit/.test(r.stdout) && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy'), 'a range is no commit: refused, never an empty note');
r = cli('restore', 'deploy-notes', '--force', '--rev', 'HEAD~999');
ok(r.status === 1 && /at HEAD~999: /.test(r.stdout), `an unknown commit is named as given (got ${r.stdout.trim()})`);
// The command is the first word that is no option: an option before it worked.
r = spawnSync(process.execPath, [CLI, '--store', dir, 'search', 'deploy'], { env, encoding: 'utf8' });
ok(r.status === 0 && /match\(es\) in/.test(r.stdout), `an option before the command still runs it (got ${r.stdout.slice(0, 200)})`);
// An option it does not know is refused: dropped, `--from 2026-10-27` searched for "2026", and `--after=` ignored the date.
r = cli('search', 'deploy', '--from', '2026-10-27');
const after = cli('search', 'deploy', '--after=2026-10-28');
ok(r.status === 1 && r.stdout === 'unknown option --from\n' && after.status === 1 && after.stdout === 'unknown option --after=2026-10-28\n', `an unknown option is refused (got ${r.stdout}${after.stdout})`);
// After `--` every word is a search word, one that looks like an option too.
memory(dir, 'hook-rule', 'never commit with --no-verify');
r = spawnSync(process.execPath, [CLI, 'search', '--store', dir, '--', '--no-verify', '--all'], { env, encoding: 'utf8' });
ok(r.status === 0 && /[\\/]hook-rule\.md$/m.test(r.stdout) && /; --all searches every project$/m.test(r.stdout), `words after -- are searched, never read as options (got ${r.stdout})`);
unlinkSync(join(dir, 'hook-rule.md'));
// Without git, history says so, not "spawnSync git ENOENT".
r = spawnSync(process.execPath, [CLI, 'history', 'deploy-notes', '--store', dir], { env: { HOME: home, USERPROFILE: home, PATH: '' }, encoding: 'utf8' });
ok(r.status === 1 && /git is not installed/.test(r.stdout), `history without git says git is not installed (got ${r.stdout.trim()})`);
// The first snapshot took in what was there: none of it was "added" this week.
ok(!/added [^·\n]*(release-checklist|mentions)/.test(cli('status').stdout), 'status does not call what the first snapshot found "added"');
// No command (the skill run with no arguments) is status.
r = cli('--session', 'nobody');
ok(r.status === 0 && /index \d+ \/ 7000 B/.test(r.stdout), `no command, only --session: status (got ${r.stdout.slice(0, 200)})`);
// Another store is a memory folder under the projects root: promote deleted a
// note from any folder it was pointed at.
const outside = join(home, 'elsewhere', 'memory');
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, 'o.md'), '---\nname: o\ndescription: "o"\n---\nkeep me\n');
writeFileSync(join(outside, 'MEMORY.md'), '- [o](o.md) — o\n');
r = spawnSync(process.execPath, [CLI, 'promote', 'o', '--store', outside], { env, encoding: 'utf8' });
ok(r.status === 1 && /--store takes a memory folder/.test(r.stdout) && existsSync(join(outside, 'o.md')) && !existsSync(join(shared, 'o.md')), '--store outside the projects folder is refused, and nothing there is touched');
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
r = cli('search', 'what did I do');
ok(r.status === 0 && /^nothing to search for: "what did I do" has no word that says which memory$/m.test(r.stdout), `a query of short and stop words says so, not "nothing matches" (got ${r.stdout})`);

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
const fromElsewhere = spawnSync(process.execPath, [CLI, 'status', '--session', 'sess-cli-1'], { env, cwd: home, encoding: 'utf8' });
ok(fromElsewhere.stdout.split('\n')[0] === dir, `inside a session, the CLI uses the session's store wherever the cwd is (got ${fromElsewhere.stdout.split('\n')[0]})`);
// The session comes from --session only: an environment variable is not read,
// and an id that is no id (a path) is ignored.
process.env.CLAUDE_CODE_SESSION_ID = 'sess-cli-1';
let viaEnv; try { viaEnv = spawnSync(process.execPath, [CLI, 'status'], { cwd: home, encoding: 'utf8' }); } finally { delete process.env.CLAUDE_CODE_SESSION_ID; }
ok(viaEnv.stdout.split('\n')[0] !== dir, `the session is not read from the environment (got ${viaEnv.stdout.split('\n')[0]})`);
const viaPath = spawnSync(process.execPath, [CLI, 'status', '--session', '../C--mem-cli/sess-cli-1'], { env, cwd: home, encoding: 'utf8' });
ok(viaPath.stdout.split('\n')[0] !== dir, `a --session that is a path is ignored (got ${viaPath.stdout.split('\n')[0]})`);
const proj = join(home, 'proj'), deeper = join(proj, 'sub', 'deeper');
mkdirSync(deeper, { recursive: true });
// The cwd as the OS reports it, which is what a process sees: on macOS the
// temp folder's /var is /private/var.
const physical = spawnSync(process.execPath, ['-p', 'process.cwd()'], { cwd: proj, encoding: 'utf8' }).stdout.trim();
const projStore = join(root, physical.replace(/[^A-Za-z0-9]/g, '-'), 'memory');
mkdirSync(projStore, { recursive: true });
// No session: the CLI reads none from the environment, so the inherited one is moot.
const noSession = env;
const fromBelow = spawnSync(process.execPath, [CLI, 'status'], { env: noSession, cwd: deeper, encoding: 'utf8' });
ok(fromBelow.stdout.split('\n')[0] === projStore, `outside a session, a subdirectory finds its project's store (got ${fromBelow.stdout.split('\n')[0]})`);

// The CLI through a symlinked folder: Node names it by its real path.
symlinkSync(dirname(CLI), join(home, 'linked-cli'), 'junction');
r = spawnSync(process.execPath, [join(home, 'linked-cli', 'memory.mjs'), 'status', '--store', dir], { env, encoding: 'utf8' });
ok(r.stdout.includes(dir), `the CLI run through a symlinked folder still runs (got ${JSON.stringify(r.stdout + r.stderr)})`);

// The plugin's own wiring, hooks/hooks.json: the four hooks, each with its
// matcher and its flag, run by node from the plugin's folder.
const hookFile = JSON.parse(readFileSync(tool('hooks/hooks.json'), 'utf8'));
const wiring = Object.entries(hookFile.hooks).flatMap(([ev, es]) => es.flatMap((e) => e.hooks.map((x) =>
  `${ev} | ${e.matcher || ''} | ${x.command} ${(x.args || []).join(' ')}`))).sort();
ok(JSON.stringify(wiring) === JSON.stringify(['PreCompact | auto | node ${CLAUDE_PLUGIN_ROOT}/compact-gate.mjs', 'PreCompact | manual | node ${CLAUDE_PLUGIN_ROOT}/memory-tier.mjs --stop',
  'SessionStart | startup|clear|compact | node ${CLAUDE_PLUGIN_ROOT}/handoff-log.mjs --print', 'Stop |  | node ${CLAUDE_PLUGIN_ROOT}/memory-tier.mjs --stop']),
  `the plugin wires the four hooks, each with its matcher and flag (got ${wiring.join('; ')})`);

// 5. Doctor: what is installed and what ran, never settings.json (it can
// hold the user's keys). A settings.json that does not even parse goes unsaid.
writeFileSync(join(home, '.claude', 'settings.json'), '{ not json: doctor never reads this');
const ranLog = (...runs) => writeFileSync(join(root, '.stop-ran'), runs.map((x) => JSON.stringify(x)).join('\n') + '\n');
const ago = (ms) => new Date(Date.now() - ms).toISOString();
rmSync(join(root, '.stop-ran'), { force: true });
r = cli('doctor');
ok(r.status === 1 && /^PROBLEM not installed[^\n]*claude plugin install project-memory@project-memory/m.test(r.stdout) && !/settings\.json (does not parse|wires)/.test(r.stdout),
  `doctor: not installed and never run is a problem, with the install; settings.json is not read (got ${r.stdout})`);
ranLog({ at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' });
ok(/^ok +the hooks run from C:\/x \(no install record: added from claude\.ai, or wired by hand\)/m.test(cli('doctor').stdout), 'doctor: hooks that run with no install record (a claude.ai install, @synced) are fine');
ranLog({ at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' }, { at: ago(59_000), s: 'aaaaaaaa', from: 'C:/y' });
r = cli('doctor');
ok(r.status === 1 && /^PROBLEM the Stop hook ran twice for one reply[^\n]*The user's fix: remove the project-memory hooks added to settings.json by hand/m.test(r.stdout), 'doctor: two runs for one reply, seconds apart, are hooks wired twice');
ranLog({ at: ago(120_000), s: 'aaaaaaaa', from: 'C:/x' }, { at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' }, { at: ago(59_000), s: 'bbbbbbbb', from: 'C:/x' });
ok(!/ran twice/.test(cli('doctor').stdout), 'doctor: replies a minute apart, and two conversations at once, are not');
// A /compact typed right after a reply runs the same --stop as PreCompact, and
// a reply to a blocked stop runs the Stop hook again: neither is a second wiring.
ranLog({ at: ago(60_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' }, { at: ago(59_000), s: 'aaaaaaaa', e: 'PreCompact', from: 'C:/x' });
ok(!/ran twice/.test(cli('doctor').stdout), 'doctor: a /compact right after a reply is not a second wiring');
ranLog({ at: ago(60_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' }, { at: ago(59_000), s: 'aaaaaaaa', e: 'Stop', h: 1, from: 'C:/x' });
ok(!/ran twice/.test(cli('doctor').stdout), 'doctor: the reply to a blocked stop is not a second wiring');
ranLog({ at: ago(60_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' }, { at: ago(56_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' });
ok(!/ran twice/.test(cli('doctor').stdout), 'doctor: two replies four seconds apart are two replies');
rmSync(join(root, '.stop-ran'), { force: true });
// Before Claude's first reply nothing has saved: waiting, not a problem. A reply
// this conversation finished over a minute ago, with nothing saved, is one.
{
  const stopRan = join(root, '.stop-ran'), had = existsSync(stopRan) ? readFileSync(stopRan, 'utf8') : null;
  rmSync(stopRan, { force: true });
  const doc = (id) => spawnSync(process.execPath, [CLI, 'doctor', ...(id ? ['--session', id] : [])], { env: noSession, encoding: 'utf8' }).stdout;
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
  // with none to read, dead hooks said "waiting" forever. The project is the
  // cwd as the CLI sees it: on macOS, /var/... resolves to /private/var/...
  const seen = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: home, encoding: 'utf8' }).stdout;
  const hs = storeFor(home, seen);
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
const packDir = join(root, '.git', 'objects', 'pack');
mkdirSync(packDir, { recursive: true });
writeFileSync(join(packDir, 'pack-dead.idx'), 'x');
ok(/^ok +1 pack index file\(s\) [^\n]*have no pack[^\n]*pack-dead\.idx$/m.test(cli('doctor').stdout), 'doctor: an index a repack left with no pack is named');
// No git is a setup the README allows: said, not a problem. Snapshots off say
// what is lost; failing ones come with what to do.
r = spawnSync(process.execPath, [CLI, 'doctor'], { env: { HOME: home, USERPROFILE: home, PATH: '' }, encoding: 'utf8' });
ok(/^ok +git is not installed: everything works except/m.test(r.stdout), `doctor: no git is said, not a problem (got ${r.stdout})`);
writeFileSync(join(root, '.snapshot-health'), JSON.stringify({ lastOk: null, failures: 0, off: 'git is not installed' }));
ok(/^ok +snapshots: off, git is not installed: everything else works/m.test(cli('doctor').stdout), 'doctor: snapshots off are said, not a problem');
writeFileSync(join(root, '.snapshot-health'), JSON.stringify({ lastOk: null, failures: 4, error: 'fatal: bad object HEAD' }));
ok(/^PROBLEM snapshots: failing, 4 in a row[^\n]*The user's fix: run git -C/m.test(cli('doctor').stdout), 'doctor: failing snapshots come with what to do');
// Hooks that look stopped are said; doctor, which is the check, does not tell
// the user to run itself.
{
  const minsAgo = (m) => new Date(Date.now() - m * 60000);
  writeFileSync(join(dirname(dir), 'stall-1.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: minsAgo(6).toISOString(), message: { content: 'q' } }),
    JSON.stringify({ type: 'assistant', timestamp: minsAgo(5).toISOString(), message: { content: [{ type: 'text', text: 'a' }], stop_reason: 'end_turn', usage: { input_tokens: 1 } } }),
  ].join('\n') + '\n');
  writeFileSync(join(root, '.stop-ran'), JSON.stringify({ at: minsAgo(20).toISOString(), s: 'zzzzzzzz', from: 'C:/x' }) + '\n');
  utimesSync(join(root, '.stop-ran'), minsAgo(20), minsAgo(20));
  r = spawnSync(process.execPath, [CLI, 'doctor', '--session', 'stall-1'], { env, encoding: 'utf8' });
  ok(/^PROBLEM Memory hooks look stopped: [^\n]*clears after the next reply\.$/m.test(r.stdout), `doctor: hooks that look stopped are said, with no "run doctor" (got ${r.stdout})`);
  // The briefing judges the newest other window; doctor, judging only the
  // newest, said all ok from the window that saved while another did not.
  const said = (name, endMin) => writeFileSync(join(dirname(dir), `${name}.jsonl`), [
    JSON.stringify({ type: 'user', timestamp: minsAgo(endMin + 1).toISOString(), message: { content: 'q' } }),
    JSON.stringify({ type: 'assistant', timestamp: minsAgo(endMin).toISOString(), message: { content: [{ type: 'text', text: 'a' }], stop_reason: 'end_turn', usage: { input_tokens: 1 } } }),
  ].join('\n') + '\n');
  said('other-22', 4);
  said('mine-2222', 25);
  r = spawnSync(process.execPath, [CLI, 'doctor', '--session', 'mine-2222'], { env, encoding: 'utf8' });
  ok(/^PROBLEM Memory hooks look stopped: \[other-22\]/m.test(r.stdout), `doctor: another window that stopped saving is said, as the briefing says it (got ${r.stdout})`);
}
// A promoted line goes in before the shared index's archive line, which
// tiering keeps last.
memory(dir, 'late-lesson', 'a lesson learned late');
const sharedIdx = join(shared, 'MEMORY.md');
if (!/\]\(MEMORY-archive\.md\)/.test(readFileSync(sharedIdx, 'utf8'))) writeFileSync(sharedIdx, readFileSync(sharedIdx, 'utf8').replace(/\n*$/, '\n') + '- [Archive](MEMORY-archive.md) — 0 older pointers\n');
r = cli('promote', 'late-lesson');
ok(r.status === 0 && /late-lesson\.md[^\n]*\n[\s\S]*\]\(MEMORY-archive\.md\)/.test(readFileSync(sharedIdx, 'utf8')), `a promoted line goes in before the archive line (got ${readFileSync(sharedIdx, 'utf8')})`);

// Round 3 (2026-10-27).
{
  // A lesson promoted into a full shared index is archived at the next reply,
  // and no session start prints it: promote says so, and how to keep it.
  const sharedIdx3 = join(shared, 'MEMORY.md');
  writeFileSync(sharedIdx3, readFileSync(sharedIdx3, 'utf8').replace(/\n*$/, '\n') + Array.from({ length: 40 }, (_, i) => `- [Filler ${i}](filler-${i}.md) — ${'f'.repeat(80)}`).join('\n') + '\n');
  writeFileSync(join(dir, 'old-lesson.md'), '---\nname: old-lesson\ndescription: "an old lesson"\nmetadata:\n  type: feedback\n  modified: 2026-01-01\n---\nbody\n');
  const full = cli('promote', 'old-lesson');
  ok(full.status === 0 && /of its 3000 bytes/.test(full.stdout) && /tier: hot/.test(full.stdout) && !/every project's sessions see its line/.test(full.stdout),
    `promote into a full shared index says the line may be archived, and how to keep it (got ${full.stdout.trim()})`);
  // Auto memory turned off: doctor says so, and judges nothing that needs the hooks.
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  let offDoc; try { offDoc = cli('doctor'); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  ok(/auto memory is off/.test(offDoc.stdout) && !/Stop hook is not running|ran twice/.test(offDoc.stdout), `doctor says auto memory is off, and stops there (got ${offDoc.stdout.trim()})`);
}

// Round 4 (2026-10-28). A name git reads as a pattern (* ? [) is read as it
// is written; the name on disk wins over the one typed; a file the disk
// refuses is said, not a stack trace.
{
  const stack = (x) => /\n\s+at \S.*:\d+:\d+/.test(x.stdout + x.stderr);
  memory(dir, 'notes[1]', 'a bracket note', 'the bracket body');
  memory(dir, 'notes1', 'a plain note', 'the plain body');
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Bracket](notes[1].md) — b\n- [Plain](notes1.md) — p\n');
  tier();
  writeFileSync(join(dir, 'notes1.md'), readFileSync(join(dir, 'notes1.md'), 'utf8') + 'changed\n');
  tier();
  r = cli('history', 'notes[1]');
  ok(r.status === 0 && (r.stdout.match(/^  [0-9a-f]{4,} \d{4}-/gm) || []).length === 1, `history of notes[1] lists its own change, not notes1's (got ${r.stdout.trim()})`);
  unlinkSync(join(dir, 'notes[1].md'));
  r = cli('restore', 'notes[1]');
  ok(r.status === 0 && readFileSync(join(dir, 'notes[1].md'), 'utf8').includes('the bracket body'), `a name with [ ] comes back with its own text, not an empty note (got ${r.stdout.trim()})`);
  r = cli('restore', 'star*');
  ok(r.status === 1 && /^no snapshot of /m.test(r.stdout) && !stack(r) && !(process.platform !== 'win32' && existsSync(join(dir, 'star*.md'))), `a name with * that no snapshot holds: no empty note, no stack trace (got ${r.stdout.trim()} ${r.stderr.trim()})`);
  // Typed in another case: where the disk opens casey.md by that name, the note
  // on disk is moved, and its own line with it; where it does not (Linux), it
  // is no note, and nothing moves.
  memory(dir, 'casey', 'a lesson about case');
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Casey](casey.md) — c\n');
  const caseBlind = existsSync(join(dir, 'CASEY.md'));
  r = cli('promote', 'CASEY');
  ok(caseBlind ? r.status === 0 && readdirSync(shared).includes('casey.md') && !/\(casey\.md\)/i.test(readFileSync(join(dir, 'MEMORY.md'), 'utf8')) && /\]\(casey\.md\)/.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8'))
    : r.status === 1 && existsSync(join(dir, 'casey.md')) && !existsSync(join(shared, 'casey.md')),
    `promote CASEY moves casey.md under its own name, and its line (got ${r.stdout.trim()})`);
  // A note the disk will not replace (read-only on Windows): said, not thrown.
  memory(dir, 'locked', 'a locked note', 'v1');
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Locked](locked.md) — l\n');
  tier();
  writeFileSync(join(dir, 'locked.md'), 'v2\n');
  chmodSync(join(dir, 'locked.md'), 0o444);
  try { r = cli('restore', 'locked', '--force'); } finally { chmodSync(join(dir, 'locked.md'), 0o666); }
  ok(!stack(r) && (process.platform !== 'win32' || (r.status === 1 && /could not be written/.test(r.stdout))), `a note that cannot be replaced is said, not a stack trace (got ${r.stdout.trim()} ${r.stderr.trim().slice(0, 200)})`);
}

// Round 4, second pass: the disk names the file, never folded case; every
// write that fails is said; a line in another case moves with its note; line
// endings come back as written.
{
  const stack = (x) => /\n\s+at \S.*:\d+:\d+/.test(x.stdout + x.stderr);
  const win = process.platform === 'win32';
  writeFileSync(join(dir, 'cs-probe.md'), 'x');
  const folds = existsSync(join(dir, 'CS-PROBE.md'));
  rmSync(join(dir, 'cs-probe.md'));
  // A version that never had the note: an error, not an empty note.
  const first = spawnSync('git', ['-C', root, 'rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  r = cli('restore', 'notes[1]', '--rev', first, '--force');
  ok(r.status === 1 && /^no snapshot of /m.test(r.stdout) && readFileSync(join(dir, 'notes[1].md'), 'utf8').includes('the bracket body'),
    `a version without notes[1] is an error, and the note is left as it was (got ${r.stdout.trim()})`);
  if (!folds) {
    // Two notes whose names differ by case: each is itself.
    memory(dir, 'Alpha', 'upper alpha', 'the upper body'); memory(dir, 'alpha', 'lower alpha', 'the lower body');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Upper](Alpha.md) — u\n- [Lower](alpha.md) — l\n');
    tier();
    rmSync(join(dir, 'Alpha.md'));
    writeFileSync(join(dir, 'alpha.md'), 'an edit not yet snapshotted\n');
    r = cli('restore', 'Alpha');
    ok(r.status === 0 && readFileSync(join(dir, 'Alpha.md'), 'utf8').includes('the upper body') && readFileSync(join(dir, 'alpha.md'), 'utf8') === 'an edit not yet snapshotted\n',
      `on a case-sensitive disk, restore Alpha brings back Alpha.md and leaves alpha.md alone (got ${r.stdout.trim()})`);
  }
  // A short 8.3 name of an index is still an index.
  for (const short of ['MEMORY~1.MD', 'MEMORY~2.MD']) {
    if (!existsSync(join(dir, short))) continue;
    r = cli('promote', short);
    ok(r.status === 1 && /only a memory is shared/.test(r.stdout) && existsSync(join(dir, 'MEMORY-archive.md')), `promote ${short} is refused: it names an index (got ${r.stdout.trim()})`);
  }
  if (win) {
    // The index cannot be written: the note is back, and the reply says the line is not.
    memory(dir, 'ro-index', 'a note whose line goes', 'ro body');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [RO](ro-index.md) — r\n');
    tier();
    rmSync(join(dir, 'ro-index.md'));
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').filter((l) => !l.includes('(ro-index.md)')).join('\n'));
    chmodSync(join(dir, 'MEMORY.md'), 0o444);
    try { r = cli('restore', 'ro-index'); } finally { chmodSync(join(dir, 'MEMORY.md'), 0o666); }
    ok(!stack(r) && existsSync(join(dir, 'ro-index.md')) && /index line could not be written/.test(r.stdout), `a read-only index: the note is restored and the reply says its line is not (got ${r.stdout.trim()} ${r.stderr.trim().slice(0, 200)})`);
    // The shared index cannot be written: the note is in both stores, and the reply says so.
    memory(dir, 'ro-share', 'a lesson to share');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [RS](ro-share.md) — s\n');
    chmodSync(join(shared, 'MEMORY.md'), 0o444);
    try { r = cli('promote', 'ro-share'); } finally { chmodSync(join(shared, 'MEMORY.md'), 0o666); }
    ok(!stack(r) && r.status === 1 && /shared index could not be written/.test(r.stdout) && existsSync(join(dir, 'ro-share.md')), `a read-only shared index: said, and the note stays in its project (got ${r.stdout.trim()} ${r.stderr.trim().slice(0, 200)})`);
    rmSync(join(shared, 'ro-share.md'), { force: true });
    // A hand-written line in another case is the note's own: it moves with it.
    memory(dir, 'casey2', 'a second case lesson');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Casey two](Casey2.md) — the hand-written hook\n');
    r = cli('promote', 'casey2');
    ok(r.status === 0 && !/casey2\.md/i.test(readFileSync(join(dir, 'MEMORY.md'), 'utf8')) && /the hand-written hook/.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8')),
      `a line written (Casey2.md) moves with casey2.md, hook and all (got ${r.stdout.trim()})`);
    // And restore finds a note's line written in another case: no second line.
    memory(dir, 'kase', 'a note with a line in another case');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Kase](Kase.md) — k\n');
    tier();
    rmSync(join(dir, 'kase.md'));
    r = cli('restore', 'kase');
    ok(r.status === 0 && /its index line is still there/.test(r.stdout) && (readFileSync(join(dir, 'MEMORY.md'), 'utf8').match(/\(kase\.md\)/gi) || []).length === 1, `restore finds the line written (Kase.md) (got ${r.stdout.trim()})`);
  }
  // CRLF as written, whatever git is told elsewhere (Git for Windows: autocrlf).
  spawnSync('git', ['-C', root, 'config', 'core.autocrlf', 'true']);
  writeFileSync(join(dir, 'crlf-kept.md'), '---\r\nname: crlf-kept\r\ndescription: "crlf"\r\nmetadata:\r\n  type: project\r\n---\r\n\r\nline one\r\nline two\r\n');
  utimesSync(join(dir, 'crlf-kept.md'), tenMin, tenMin);
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [CRLF kept](crlf-kept.md) — c\n');
  tier();
  rmSync(join(dir, 'crlf-kept.md'));
  r = cli('restore', 'crlf-kept');
  ok(r.status === 0 && readFileSync(join(dir, 'crlf-kept.md'), 'utf8').includes('line one\r\nline two\r\n'), `a CRLF note comes back with CRLF, autocrlf or not (got ${r.stdout.trim()})`);
  spawnSync('git', ['-C', root, 'config', '--unset', 'core.autocrlf']);
}

// Round 6. status and search count a line by the file it opens; a link
// named with .md, or inside code, is no link to nothing; --store=<dir> works.
{
  const d10 = join(root, 'C--r6-status', 'memory'); mkdirSync(d10, { recursive: true });
  memory(d10, 'kase', 'a lesson in a case');
  memory(d10, 'linker', 'links to others', 'see [[kase.md]] and `grid[[0]]`\n```\nx = y[[1]]\n```\n');
  writeFileSync(join(d10, 'MEMORY.md'), `- [Kase](${process.platform === 'win32' ? 'Kase' : 'kase'}.md) — k\n- [Linker](linker.md) — l\n`);
  const st10 = spawnSync(process.execPath, [CLI, 'status', `--store=${d10}`], { env, encoding: 'utf8', cwd: home });
  ok(st10.stdout.includes(d10), `--store=<dir> is the store (got ${st10.stdout.split('\n')[0]})`);
  ok(!/with no pointer yet/.test(st10.stdout) && !/links to no memory/.test(st10.stdout), `a line in another case counts, and [[x.md]] or a link in code is no dangling link (got ${st10.stdout.trim()})`);
}

// Round 6. A store whose memory folder links to a folder outside the root:
// its notes come back by the link's path (resolved, git said the path was
// outside the repository), and doctor names a store the snapshots leave out.
{
  const out14 = join(home, 'Synced14', 'memory'), at14 = join(root, 'C--ext14', 'memory');
  mkdirSync(out14, { recursive: true }); mkdirSync(dirname(at14), { recursive: true });
  memory(out14, 'price', 'our price');
  writeFileSync(join(out14, 'MEMORY.md'), '- [Price](price.md) — p\n');
  symlinkSync(out14, at14, process.platform === 'win32' ? 'junction' : 'dir');
  tier();
  const run14 = (...a) => spawnSync(process.execPath, [CLI, ...a, '--store', at14], { env, encoding: 'utf8' });
  if (/C--ext14\/memory\/price\.md/.test(spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).stdout)) {
    unlinkSync(join(out14, 'price.md'));
    const r14 = run14('restore', 'price');
    ok(r14.status === 0 && existsSync(join(out14, 'price.md')), `a note in a store linked outside the root comes back (got ${r14.stdout}${r14.stderr})`);
  }
  const sh14 = join(root, '.snapshot-health'), was14 = readFileSync(sh14, 'utf8');
  writeFileSync(sh14, JSON.stringify({ lastOk: new Date().toISOString(), failures: 0, missed: ['/x/C--y/memory'] }));
  const d14 = run14('doctor');
  writeFileSync(sh14, was14);
  ok(d14.status === 1 && /PROBLEM\s+snapshots: ok, last [^\n]*but they leave out \/x\/C--y\/memory: it is reached through a link/.test(d14.stdout), `doctor names a store the snapshots leave out (got ${d14.stdout})`);
}

// Round 6. A huge index (300,000 lines naming no note) takes status a second
// or so: read the folder once a line, it hung past a minute.
{
  const big = join(root, 'C--big16', 'memory'); mkdirSync(big, { recursive: true });
  writeFileSync(join(big, 'MEMORY.md'), Array.from({ length: 300000 }, (_, i) => `- [n](n${i}.md) — h`).join('\n') + '\n');
  const t16 = Date.now(), s16 = spawnSync(process.execPath, [CLI, 'status', '--store', big], { env, encoding: 'utf8', timeout: 25000 });
  ok(s16.status === 0 && Date.now() - t16 < 20000, `status on a 300,000-line index finishes (exit ${s16.status} in ${Date.now() - t16} ms)`);
  rmSync(join(root, 'C--big16'), { recursive: true, force: true });
}

// Round 6. The project folder, not its memory folder, linked outside the
// root: its notes come back by their path in here. And an inline ``` in
// prose is no fence: the links after it are read.
{
  const out17 = join(home, 'Synced17', 'C--p17'), at17 = join(root, 'C--p17');
  mkdirSync(join(out17, 'memory'), { recursive: true });
  memory(join(out17, 'memory'), 'cost', 'our cost', 'Wrap a block in ``` fences.\nSee [[ghost17]].\n```\nx = 1\n```\n');
  writeFileSync(join(out17, 'memory', 'MEMORY.md'), '- [Cost](cost.md) — c\n');
  symlinkSync(out17, at17, process.platform === 'win32' ? 'junction' : 'dir');
  tier();
  const run17 = (...a) => spawnSync(process.execPath, [CLI, ...a, '--store', join(at17, 'memory')], { env, encoding: 'utf8' });
  ok(/links to no memory: cost\.md → \[\[ghost17\]\]/.test(run17('status').stdout), 'a link after an inline ``` in prose is read');
  if (/C--p17\/memory\/cost\.md/.test(spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).stdout)) {
    unlinkSync(join(out17, 'memory', 'cost.md'));
    const r17 = run17('restore', 'cost');
    ok(r17.status === 0 && existsSync(join(out17, 'memory', 'cost.md')), `a note under a project folder linked outside the root comes back (got ${r17.stdout}${r17.stderr})`);
  }
}

// Round 6. Two links to one folder elsewhere: a note restored through the
// second comes back as the last snapshot holds it, not from a path the
// snapshot no longer updates. And fences in a quote, a list or with ~~~ hide
// their links; one in prose does not.
{
  const out20 = join(home, 'Synced20', 'memory'); mkdirSync(out20, { recursive: true });
  memory(out20, 'rate', 'our rate', 'VERSION-ONE');
  writeFileSync(join(out20, 'MEMORY.md'), '- [Rate](rate.md) — r\n');
  for (const p of ['C--a20', 'C--b20']) { mkdirSync(join(root, p), { recursive: true }); symlinkSync(out20, join(root, p, 'memory'), process.platform === 'win32' ? 'junction' : 'dir'); }
  tier();
  memory(out20, 'rate', 'our rate', 'VERSION-TWO'); utimesSync(join(out20, 'rate.md'), new Date(), new Date());
  tier();
  if (/C--a20\/memory\/rate\.md/.test(spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).stdout)) {
    unlinkSync(join(out20, 'rate.md'));
    const r20 = spawnSync(process.execPath, [CLI, 'restore', 'rate', '--store', join(root, 'C--b20', 'memory')], { env, encoding: 'utf8' });
    ok(r20.status === 0 && /VERSION-TWO/.test(readFileSync(join(out20, 'rate.md'), 'utf8')), `a note restored through a second link is the last snapshot's (got ${r20.stdout}${r20.stderr})`);
  }
  const d21 = join(root, 'C--fence21', 'memory'); mkdirSync(d21, { recursive: true });
  memory(d21, 'fenced', 'fences', '> ```\n> [[ghostq]]\n> ```\n- ```\n  [[ghostl]]\n  ```\n~~~\n[[ghostt]]\n~~~\n```x[[0]]``` is code, see [[ghostp]].\n```\ny = 2\n```\n');
  writeFileSync(join(d21, 'MEMORY.md'), '- [Fenced](fenced.md) — f\n');
  const s21 = spawnSync(process.execPath, [CLI, 'status', '--store', d21], { env, encoding: 'utf8' }).stdout;
  ok(/links to no memory: fenced\.md → \[\[ghostp\]\]\s*$/m.test(s21), `fences in a quote, a list or with ~~~ hide their links; a code span in prose does not hide the next (got ${s21})`);
}

// Review of round 6's second review. A link that sorts first, added after the
// history was made, still lets the older versions come back through the
// first link; a deleted index comes back through the second link; a ````
// fence holding a ``` one hides its links.
{
  const out22 = join(home, 'Synced22', 'memory'); mkdirSync(out22, { recursive: true });
  memory(out22, 'gone', 'gone', 'GONE-V1');
  writeFileSync(join(out22, 'MEMORY.md'), '- [Gone](gone.md) — g\n');
  const link22 = (p) => { mkdirSync(join(root, p), { recursive: true }); symlinkSync(out22, join(root, p, 'memory'), process.platform === 'win32' ? 'junction' : 'dir'); };
  link22('C--b22'); tier();
  if (/C--b22\/memory\/gone\.md/.test(spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).stdout)) {
    unlinkSync(join(out22, 'gone.md')); memory(out22, 'other', 'other'); writeFileSync(join(out22, 'MEMORY.md'), '- [Other](other.md) — o\n');
    tier();
    link22('C--a22'); tier();
    const r22 = spawnSync(process.execPath, [CLI, 'restore', 'gone', '--store', join(root, 'C--b22', 'memory')], { env, encoding: 'utf8' });
    ok(r22.status === 0 && /GONE-V1/.test(readFileSync(join(out22, 'gone.md'), 'utf8')), `a note deleted before a link that sorts first was added comes back (got ${r22.stdout}${r22.stderr})`);
    const h22 = spawnSync(process.execPath, [CLI, 'history', 'other', '--store', join(root, 'C--b22', 'memory')], { env, encoding: 'utf8' }).stdout;
    ok((h22.match(/^  [0-9a-f]{7,} \d{4}-/gm) || []).length === 2, `history lists the snapshot that moved a note to a link that sorts first (got ${h22})`);
    // The index the restore gave a line, snapshotted under the first link only.
    tier(); unlinkSync(join(out22, 'MEMORY.md'));
    const m22 = spawnSync(process.execPath, [CLI, 'restore', 'MEMORY', '--store', join(root, 'C--b22', 'memory')], { env, encoding: 'utf8' });
    ok(m22.status === 0 && /\(gone\.md\)/.test(readFileSync(join(out22, 'MEMORY.md'), 'utf8')), `a deleted index comes back through the second link as last snapshotted (got ${m22.stdout}${m22.stderr})`);
    // Both links tracked while the index was gone: the week's changes read
    // the kept path alone, or the second's untracking was every note deleted.
    const out24 = join(home, 'Synced24', 'memory'); mkdirSync(out24, { recursive: true });
    memory(out24, 'x24', 'x'); writeFileSync(join(out24, 'MEMORY.md'), '- [X](x24.md) — x\n');
    for (const p of ['C--a24', 'C--b24']) { mkdirSync(join(root, p), { recursive: true }); symlinkSync(out24, join(root, p, 'memory'), process.platform === 'win32' ? 'junction' : 'dir'); }
    tier(); unlinkSync(join(out24, 'MEMORY.md')); tier();
    writeFileSync(join(out24, 'MEMORY.md'), '- [X](x24.md) — x\n'); tier();
    const s24 = spawnSync(process.execPath, [CLI, 'status', '--store', join(root, 'C--a24', 'memory')], { env, encoding: 'utf8' }).stdout;
    ok(/last 7 days: added x24/.test(s24), `a note on disk is not listed as deleted after a snapshot without the index (got ${s24})`);
  }
  // A fence never closed hides nothing; a long tilde run is read once.
  const d23 = join(root, 'C--fence23', 'memory'); mkdirSync(d23, { recursive: true });
  memory(d23, 'four', 'fences', '````md\n```js\nx\n```\n[[ghostf]]\n````\nsee [[ghosto]]\n```\n[[ghostu]]\n');
  memory(d23, 'tilde', 'tildes', '~'.repeat(120000) + '`\n' + '~~~\r'.repeat(50000));
  writeFileSync(join(d23, 'MEMORY.md'), '- [Four](four.md) — f\n- [Tilde](tilde.md) — t\n');
  const t23 = Date.now();
  const s23 = spawnSync(process.execPath, [CLI, 'status', '--store', d23], { env, encoding: 'utf8' }).stdout;
  ok(/four\.md → \[\[ghosto\]\]/.test(s23) && /four\.md → \[\[ghostu\]\]/.test(s23) && !/ghostf/.test(s23), `a \`\`\`\` fence holding a \`\`\` one hides its links, one never closed hides none (got ${s23})`);
  ok(Date.now() - t23 < 3000, `a long run of tildes does not slow status down (${Date.now() - t23} ms)`);
  // The shared store has its own index: this one's, deleted, was not promoted.
  tier();
  const h23 = spawnSync(process.execPath, [CLI, 'history', 'MEMORY', '--store', d23], { env, encoding: 'utf8' });
  ok(h23.status === 0 && !/promoted/.test(h23.stdout), `history does not call an index promoted (got ${h23.stdout}${h23.stderr})`);
  unlinkSync(join(d23, 'MEMORY.md'));
  const m23 = spawnSync(process.execPath, [CLI, 'restore', 'MEMORY', '--store', d23], { env, encoding: 'utf8' });
  ok(existsSync(join(shared, 'MEMORY.md')) && m23.status === 0 && existsSync(join(d23, 'MEMORY.md')), `a deleted index comes back while the shared store has one (got ${m23.stdout}${m23.stderr})`);
}

// The journal, searched: Claude asks in the user's words for past work, by
// what was asked, or by the days it was done.
{
  const { render } = await import('./journal.mjs');
  const jd = join(root, 'C--jr', 'memory'), other = join(root, 'C--jr2', 'memory');
  const jcli = (...a) => spawnSync(process.execPath, [CLI, ...a, '--store', jd], { env, encoding: 'utf8' });
  let n = 0;
  const entry = (at, asked, over = {}) => ({ key: `k${n++}`, at, s: 'c0ffee12', t: 'C--jr/c0ffee12-full', branch: 'main', asked, answered: 'done', changed: [], ran: [], ...over });
  const day = (store, d, es) => { mkdirSync(join(store, 'journal'), { recursive: true }); writeFileSync(join(store, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`); };
  day(jd, '2026-10-01', [entry('2026-10-01 10:00', 'deploy on the first')]);
  day(jd, '2026-10-02', [entry('2026-10-02 10:00', 'tidy the scripts', { changed: ['memory-tier.mjs'], ran: ['node bench.mjs --runs 5'] })]);
  // Written unredacted, as a hand edit or an entry from before a redaction rule could be.
  const key = ['sk', 'live', '51Habcdefghijklmnopqrstuv'].join('_') + 'WX';
  const pasted = entry('2026-10-03 10:00', `paste the token ${key} into the config`, { answered: `stored ${key} as the config token` });
  day(jd, '2026-10-03', [pasted]);
  // One request asked on three days, in other cases and spacing, and one like it.
  day(jd, '2026-10-04', [entry('2026-10-04 10:00', 'Feed the  Wombat')]);
  day(jd, '2026-10-05', [entry('2026-10-05 10:00', 'feed the wombat')]);
  day(jd, '2026-10-06', [entry('2026-10-06 09:00', 'wombat feed schedule'), entry('2026-10-06 10:00', 'feed the wombat')]);
  // An entry at every cap, its word all through it.
  const huge = entry('2026-10-07 10:00', 'zeppelin plan '.repeat(150).slice(0, 2000), {
    answered: 'the hangar crew waited all morning in the cold for the wind over the field to drop at last, and then the zeppelin landed. '.repeat(25).slice(0, 3000).trim(),
    changed: Array.from({ length: 20 }, (_, i) => `src/zeppelin/part${i}.mjs`), ran: Array.from({ length: 10 }, (_, i) => `npm run zeppelin -- --part ${i} ${'x'.repeat(170)}`) });
  day(jd, '2026-10-07', [huge]);
  // Two letters are a word (CI, PR, DB), but only standing alone; a branch is searched too.
  day(jd, '2026-10-08', [entry('2026-10-08 10:00', 'set up CI on GitHub Actions'), entry('2026-10-08 11:00', 'a decision about the logo'),
    entry('2026-10-08 12:00', 'tidy the imports', { branch: 'payments-v2' })]);
  // A reply that says the words three times and files named for them: still below the request.
  const fix = entry('2026-10-15 14:30', 'fix the deploy error');
  day(jd, '2026-10-15', [entry('2026-10-15 09:00', 'tidy the readme', { answered: 'the deploy error, the deploy error again, and the deploy error once more', changed: ['deploy-error.md'] }), fix]);
  day(jd, '2026-10-22', [entry('2026-10-22 09:00', 'plan the release')]);
  writeFileSync(join(jd, 'journal', '2026-10-23.md'), '# Journal 2026-10-23\n');   // a day a sweep emptied
  day(jd, '2026-10-25', [entry('2026-10-25 08:00', 'review the pull request'), entry('2026-10-25 16:10', 'write the changelog')]);
  day(jd, '2026-10-28', [entry('2026-10-28 11:00', 'deploy on the last day')]);
  memory(jd, 'deploy', 'how we ship the site', 'if it shows an error, deploy again');
  memory(jd, 'journal', 'Every exchange in this project, one file per day in journal/');

  let r = jcli('search', 'deploy', 'error');
  ok(r.status === 0 && new RegExp(`^ *\\d+  journal   2026-10-15 14:30  conversation c0ffee12 · branch main\\n     key: ${fix.key}\\n     Asked: fix the deploy error\\n`).test(r.stdout),
    `search finds a journal entry by its request: first, labelled journal, with its date and key (got ${r.stdout})`);
  ok(/^ *\d+ +\w+ +\d{4}-\d\d-\d\d +.*[\\/]deploy\.md$/m.test(r.stdout) && /^ *\d+  journal   2026-10-15 09:00 /m.test(r.stdout), `a note and an entry rank together (got ${r.stdout})`);
  // A hit is its request, cut, and of the rest only what holds a search word.
  const blocks = (out) => out.split(/\n(?= *\d+  )/), of = (out, asked) => blocks(out).find((b) => b.includes(`\n     Asked: ${asked}`)) ?? '';
  ok(!/Answered/.test(of(r.stdout, 'fix the deploy error')) && /^     Answered: the deploy error, the deploy error again, and the deploy error once more$/m.test(of(r.stdout, 'tidy the readme')),
    `a reply is printed only when it holds a search word (got ${r.stdout})`);
  r = jcli('search', 'zeppelin');
  const z = blocks(r.stdout)[0].replace(/\n\d+ of \d+ match\(es\) in .*\n$/, ''), zask = z.match(/^     Asked: (.*)$/m)?.[1] ?? '';
  ok(z.length < 1500 && zask.length === 400 && zask.startsWith('zeppelin plan') && /^     Answered: …[^\n]*zeppelin[^\n]*…$/m.test(z) && /^     Changed: [^\n]*zeppelin/m.test(z) && /^     Ran: [^\n]*zeppelin/m.test(z),
    `an entry at every cap: its request cut to 400, the rest the stretches around the word, under 1.5 KB in all (got ${z.length}: ${z})`);
  // show: the whole entry, by the key its hit printed, and its day file.
  const zkey = z.match(/^     key: (.*)$/m)?.[1];
  r = jcli('show', zkey);
  ok(zkey === huge.key && r.status === 0 && r.stdout.includes(`\n     Asked: ${huge.asked}\n     Answered: ${huge.answered}\n     Changed: ${huge.changed.join(', ')}\n     Ran: ${huge.ran.join(' · ')}\n`) &&
    r.stdout.includes(`\n     Day file: ${join(jd, 'journal', '2026-10-07.md')}`), `show prints an entry whole, by the key search printed, with its day file (got ${r.stdout})`);
  r = jcli('show', fix.key, pasted.key);
  ok(r.status === 0 && /^     Asked: fix the deploy error$/m.test(r.stdout) && /^     Answered: stored \[redacted\] as the config token$/m.test(r.stdout) && !r.stdout.includes(key), `show takes several keys, and redacts (got ${r.stdout})`);
  r = jcli('show', 'no-such-key');
  ok(r.status === 1 && /^no journal entry has the key no-such-key in .+; --all looks in every project$/m.test(r.stdout), `a key that is no entry's says so, and fails (got ${r.stdout})`);
  // One request asked again and again is one hit, with its count and days.
  r = jcli('search', 'wombat', 'feed');
  ok((r.stdout.match(/^     Asked: feed the wombat$/gim) || []).length === 1 && /^     2 more like this, 2026-10-04\.\.2026-10-06$/m.test(r.stdout) && /^     Asked: wombat feed schedule$/m.test(r.stdout) && /^2 of 2 match\(es\)/m.test(r.stdout),
    `identical requests, in any case and spacing, print once with how many more and their days (got ${r.stdout})`);
  r = jcli('search', 'wombat', 'feed', '--limit', '1');
  ok(/^     2 more like this/m.test(r.stdout) && !/schedule/.test(r.stdout) && /^1 of 2 match\(es\) in .+; --limit N shows more/m.test(r.stdout), `--limit counts the requests, not their repeats (got ${r.stdout})`);
  ok(!/[\\/]journal\.md$/m.test(jcli('search', 'every', 'exchange').stdout), "journal.md is the journal's pointer, not a search hit");
  ok(/^     Asked: tidy the scripts$/m.test(jcli('search', 'memory-tier.mjs').stdout) && /^     Asked: tidy the scripts$/m.test(jcli('search', 'bench').stdout),
    'an entry is found by a file it changed, and by a command it ran, alone');
  r = jcli('search', 'CI', '--since', '2026-10-08', '--until', '2026-10-08');
  ok(/^     Asked: set up CI on GitHub Actions$/m.test(r.stdout) && !/decision/.test(r.stdout), `a two-letter word is searched, as a word of its own (got ${r.stdout})`);
  ok(/^     Asked: tidy the imports$/m.test(jcli('search', 'payments').stdout), 'an entry is found by its branch');
  r = jcli('search', 'token', 'config');
  ok(/^     Asked: paste the token \[redacted\] into the config$/m.test(r.stdout) && /^     Answered: stored \[redacted\] as the config token$/m.test(r.stdout) && !r.stdout.includes(key), `a hit is redacted, its reply too (got ${r.stdout})`);
  r = jcli('search', 'zzzqqq', '--since', '2026-10-10', '--until', '2026-10-20');
  ok(/^nothing matches "zzzqqq" in .+ since 2026-10-10 until 2026-10-20; --all searches every project$/m.test(r.stdout), `a ranged miss names its range (got ${r.stdout})`);
  // A note's day is its modified: date; both bounds are inclusive for notes too.
  for (const [name, at] of [['quokka-before', '2026-10-09'], ['quokka-since', '2026-10-10'], ['quokka-until', '2026-10-20'], ['quokka-after', '2026-10-21']]) memory(jd, name, 'a quokka note', 'body', `  modified: ${at}\n`);
  r = jcli('search', 'quokka', '--since', '2026-10-10', '--until', '2026-10-20');
  const quokkas = [...r.stdout.matchAll(/[\\/](quokka-\w+)\.md$/gm)].map((m) => m[1]).sort().join();
  ok(quokkas === 'quokka-since,quokka-until', `a note dated on either bound is found, one a day outside is not (got ${quokkas})`);
  // A note's date is its last change: one written in the range and edited since is out of it, and said.
  const outside = (k) => `${k} notes match outside the range (a note's date is its last change); search without --since/--until`;
  ok(r.stdout.includes(`\n${outside(2)}\n`) && /^2 of 2 match\(es\)/m.test(r.stdout.trim().split('\n').pop()), `a ranged search says how many notes match outside it, before the count (got ${r.stdout})`);
  r = jcli('search', 'quokka', '--since', '2026-11-01');
  ok(r.stdout.startsWith(`${outside(4)}\nnothing matches "quokka" in `), `a ranged miss says so too (got ${r.stdout})`);
  // A journal.mjs that will not load costs search the journal, said, never the rest of the CLI.
  const nj = join(home, 'cli-nojournal');
  mkdirSync(nj, { recursive: true });
  for (const f of ['memory.mjs', 'store.mjs', 'handoff-log.mjs']) writeFileSync(join(nj, f), readFileSync(tool(f)));
  writeFileSync(join(nj, 'journal.mjs'), 'this is not javascript (');
  const njs = spawnSync(process.execPath, [join(nj, 'memory.mjs'), 'status', '--store', jd], { env, encoding: 'utf8' });
  r = spawnSync(process.execPath, [join(nj, 'memory.mjs'), 'search', 'deploy', '--store', jd], { env, encoding: 'utf8' });
  ok(njs.status === 0 && /^  journal: could not read journal\.mjs: /m.test(njs.stdout) && r.status === 0 && /[\\/]deploy\.md$/m.test(r.stdout) && /^could not read journal\.mjs: /m.test(r.stdout),
    `a journal.mjs that will not load: status runs and says so, search finds notes and says the journal was not read (got ${njs.stdout}${njs.stderr}${r.stdout}${r.stderr})`);
  r = spawnSync(process.execPath, [join(nj, 'memory.mjs'), 'forget', 'deploy', '--store', jd], { env, encoding: 'utf8' });
  ok(r.status === 1 && /^could not read journal\.mjs: /m.test(r.stdout), `nor can forget: it says so, and fails (got ${r.stdout}${r.stderr})`);
  r = jcli('search', 'deploy', 'error', '--since=2026-10-10', '--until', '2026-10-20');
  const dates = [...r.stdout.matchAll(/^ *\d+  journal   (\d{4}-\d\d-\d\d)/gm)].map((m) => m[1]);
  ok(r.status === 0 && dates.join() === '2026-10-15,2026-10-15' && !/deploy\.md$/m.test(r.stdout), `--since/--until narrow by day, notes by their date too (got ${r.stdout})`);
  r = jcli('search', '--since', '2026-10-21', '--until', '2026-10-27');
  const asked = [...r.stdout.matchAll(/^\d{4}-\d\d-\d\d \d\d:\d\d  conversation c0ffee12 · branch main  (.*)$/gm)].map((m) => m[1]);
  ok(r.status === 0 && asked.join('|') === 'write the changelog|review the pull request|plan the release', `a date range alone lists the work of those days, newest first (got ${r.stdout})`);
  // Words that say nothing of which memory ("what did I do") with a range: the range alone.
  ok(jcli('search', 'what', 'did', 'I', 'do', '--since', '2026-10-21', '--until', '2026-10-27').stdout === r.stdout, 'stop words with a range list the range');
  r = jcli('search', 'deploy', '--since', 'yesterday');
  const r2 = jcli('search', 'deploy', '--until=2026-10');
  ok(r.status === 1 && r.stdout.trim() === '--since takes a date like 2026-10-01' && r2.status === 1 && r2.stdout.trim() === '--until takes a date like 2026-10-01', `a bad date is refused (got ${r.stdout}${r2.stdout})`);
  const conv = join(root, 'C--jr', 'c0ffee12-full.jsonl'), named = () => /^     Full conversation: .*[\\/]C--jr[\\/]c0ffee12-full\.jsonl$/m.test(jcli('search', 'fix', 'deploy', 'error').stdout);
  writeFileSync(conv, '{}\n');
  const was = named(); unlinkSync(conv);
  ok(was && !named(), 'the full conversation is named while it exists');
  mkdirSync(other, { recursive: true }); writeFileSync(join(other, 'MEMORY.md'), '# Index\n');
  day(other, '2026-10-20', [entry('2026-10-20 10:00', 'rotate the signing key', { t: 'C--jr2/feed' })]);
  r = jcli('search', 'rotate', 'signing', '--all');
  ok(!/signing key/.test(jcli('search', 'rotate', 'signing').stdout) && /^     Asked: rotate the signing key$/m.test(r.stdout) && /^ *\d+  journal   2026-10-20 10:00  conversation c0ffee12 · branch main · project C--jr2$/m.test(r.stdout),
    `--all searches every project's journal, and a hit names its project (got ${r.stdout})`);
  // A project whose only memory is its journal has no MEMORY.md: --all passed
  // it over. Reached by a second link too, it is searched once.
  const lone = join(root, 'C--jr3', 'memory');
  day(lone, '2026-10-21', [entry('2026-10-21 10:00', 'calibrate the lone telescope', { t: 'C--jr3/beef' })]);
  mkdirSync(join(root, 'C--jr3-link'), { recursive: true });
  symlinkSync(lone, join(root, 'C--jr3-link', 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
  r = jcli('search', 'lone', 'telescope', '--all');
  ok(/^     Asked: calibrate the lone telescope$/m.test(r.stdout) && /^1 of 1 match\(es\)/m.test(r.stdout), `--all searches a journal with no MEMORY.md beside it, once (got ${r.stdout})`);
  r = jcli('search', '--since', '2026-10-20', '--until', '2026-10-21', '--all');
  ok(/^2026-10-21 10:00  conversation c0ffee12 · branch main · project C--jr3  calibrate the lone telescope$/m.test(r.stdout) && /· project C--jr2  rotate the signing key$/m.test(r.stdout),
    `a date range under --all names each entry's project (got ${r.stdout})`);

  // A year of journal, ~30 MB: one entry rendered once, each day written in one call.
  const big = join(root, 'C--big', 'memory'), bcli = (...a) => spawnSync(process.execPath, [CLI, ...a, '--store', big], { env, encoding: 'utf8' });
  const tpl = render(entry('2025-01-01 12:00', 'plan the lorem rollout '.repeat(90).slice(0, 2000), { answered: 'the lorem build passed '.repeat(131).slice(0, 3000),
    changed: Array.from({ length: 20 }, (_, i) => `src/lorem/module${i}.mjs`), ran: Array.from({ length: 10 }, (_, i) => `npm run build -- --filter lorem${i}`) }));
  const year = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)), last = year.at(-1);
  mkdirSync(join(big, 'journal'), { recursive: true });
  for (const d of year) writeFileSync(join(big, 'journal', `${d}.md`), `# Journal ${d}\n\n${[...Array(14).fill(tpl.replaceAll('2025-01-01', d)),
    ...(d === last ? [render(entry(`${d} 18:00`, 'find the needle: the lorem rollout plan, its module filter, and the build passed'))] : [])].join('\n\n')}\n`);
  // Eight terms: 1.0 s here alone, 1.3 s beside two other suites (2026-10-28,
  // Windows); read once a term, 5.4 s.
  const t0 = Date.now();
  r = bcli('search', 'needle', 'lorem', 'rollout', 'build', 'passed', 'plan', 'module', 'filter');
  const took = Date.now() - t0;
  ok(took < 3000, `search over 30 MB of journal is fast (${took} ms)`);
  ok(r.status === 0 && new RegExp(`^ *\\d+  journal   ${last} 18:00 `).test(r.stdout), `the one entry asking for every term is first (got ${r.stdout.slice(0, 200)})`);
  ok(/^     5109 more like this, 2025-01-01\.\.2025-12-31$/m.test(r.stdout) && /^2 of 2 match\(es\)/m.test(r.stdout) && r.stdout.length < 4000,
    `a request asked 5,110 times is one hit, and the output stays small (got ${r.stdout.length} chars: ${r.stdout.slice(-400)})`);
  r = bcli('search', '--since', year[0]);
  ok((r.stdout.match(/^\d{4}-\d\d-\d\d \d\d:\d\d  conversation /gm) || []).length === 30 && /^30 of 5111 journal entries in .+; --limit N shows more$/m.test(r.stdout),
    `a date range alone lists 30 by default, and says how many it left out (got ${r.stdout.split('\n').length} lines, ending ${r.stdout.trim().split('\n').pop()})`);
  rmSync(join(big, 'journal', `${year[0]}.md`)); mkdirSync(join(big, 'journal', `${year[0]}.md`));
  r = bcli('search', 'needle');
  ok(r.status === 0 && new RegExp(`journal   ${last} 18:00`).test(r.stdout) && new RegExp(`^could not read .*[\\\\/]${year[0]}\\.md: \\w+$`, 'm').test(r.stdout) && /^1 of 1 match\(es\)/.test(r.stdout.trim().split('\n').pop()),
    `a day that cannot be read is named, the rest still found, and the count is still the last line (got ${r.stdout.slice(-300)})`);
  r = bcli('search', 'needle', '--since', year.at(-7));
  ok(r.status === 0 && !r.stderr && new RegExp(`journal   ${last} 18:00`).test(r.stdout) && !/could not read/.test(r.stdout), `with --since the last week, a day outside it is never opened (got ${r.stdout}${r.stderr})`);
}

// forget: the user's say over the journal. Claude lists what would go, the
// user confirms, and only --yes removes it.
{
  const { render } = await import('./journal.mjs'), { local } = await import('./store.mjs');
  const fd = join(root, 'C--fg', 'memory'), fj = join(fd, 'journal'), today = local().slice(0, 10);
  const fcli = (...a) => spawnSync(process.execPath, [CLI, ...a, '--store', fd], { env, encoding: 'utf8' });
  let n = 0;
  const entry = (at, asked, s = 'aaaa1111') => ({ key: `f${n++}`, at, s, t: `C--fg/${s}`, branch: '', asked, answered: 'done', changed: [], ran: [] });
  const es = [entry('2025-10-20 09:00', 'the zebra eats mango'), entry('2025-10-20 10:00', 'the zebra policy'), entry('2025-10-21 09:00', 'mango, the zebra again'),
    entry(`${today} 09:00`, 'a zebra in another conversation', 'bbbb2222'), entry(`${today} 10:00`, 'unrelated', 'bbbb2222')];
  const page = (d, xs) => `# Journal ${d}\n\n${xs.map(render).join('\n\n')}\n`;
  const want = { '2025-10-20': page('2025-10-20', es.slice(0, 2)), '2025-10-21': page('2025-10-21', es.slice(2, 3)), [today]: page(today, es.slice(3)) };
  const reset = () => { rmSync(fj, { recursive: true, force: true }); mkdirSync(fj, { recursive: true }); for (const [d, t] of Object.entries(want)) writeFileSync(join(fj, `${d}.md`), t); };
  const file = (d) => readFileSync(join(fj, `${d}.md`), 'utf8'), kept = (...ds) => ds.every((d) => file(d) === want[d]);

  reset();
  const zm = '2025-10-20 09:00  conversation aaaa1111  the zebra eats mango\n2025-10-21 09:00  conversation aaaa1111  mango, the zebra again\n';
  let r = fcli('forget', 'Zebra', 'mango');
  ok(r.status === 0 && kept('2025-10-20', '2025-10-21', today) && r.stdout === `${zm}2 entries in ${fd} would go; run again with --yes to remove them\n`, `forget lists and keeps without --yes, and names the store (got ${r.stdout}${r.stderr})`);
  r = fcli('forget', 'Zebra', 'mango', '--yes');
  ok(r.status === 0 && file('2025-10-20') === page('2025-10-20', [es[1]]) && file('2025-10-21') === page('2025-10-21', []) && kept(today),
    `forget --yes removes only the matches, the rest byte for byte (got ${r.stdout}${r.stderr})`);
  ok(r.stdout.startsWith(zm) && r.stdout.endsWith(`\nremoved 2 from ${fd}\n`) && /^the snapshots still hold the journal of 2025-10-20, 2025-10-21: deleting .*[\\/]\.git removes /m.test(r.stdout),
    `and lists what went, says the snapshots still hold the days before today, and ends with the count (got ${r.stdout})`);
  reset();
  // A blank word is in every entry: taken as a filter, it removed the whole journal.
  const refused = 'forget needs words, a date range, --conversation or --key; to forget the whole journal, use --since 1970-01-01 --yes (deleting the journal folder rebuilds it from the conversations still on disk)';
  for (const blank of [[], [''], ['   ']]) {
    r = fcli('forget', ...blank, '--yes');
    ok(r.status === 1 && r.stdout.trim() === refused && kept('2025-10-20', '2025-10-21', today), `forget with nothing to match is refused, a blank word too (${JSON.stringify(blank)}: got ${r.stdout}${r.stderr})`);
  }
  const bb = `${today} 09:00  conversation bbbb2222  a zebra in another conversation\n${today} 10:00  conversation bbbb2222  unrelated\n`;
  r = fcli('forget', '--conversation=bbbb2222');
  ok(r.stdout === `${bb}2 entries in ${fd} would go; run again with --yes to remove them\n`, `--conversation=TAG lists that conversation (got ${r.stdout}${r.stderr})`);
  ok(fcli('forget', '--conversation', 'bbbb2222-0000-4000-8000-00000000abcd').stdout === r.stdout, 'the full session id is that conversation too');
  // The entries a search showed, by their keys, and nothing else.
  r = fcli('forget', '--key', es[0].key, `--key=${es[3].key}`);
  ok(r.stdout === `2025-10-20 09:00  conversation aaaa1111  the zebra eats mango\n${today} 09:00  conversation bbbb2222  a zebra in another conversation\n2 entries in ${fd} would go; run again with --yes to remove them\n`,
    `--key lists the entries with those keys (got ${r.stdout}${r.stderr})`);
  r = fcli('forget', 'zebra', '--key', es[0].key, '--key', es[4].key, '--yes');
  ok(r.status === 0 && file('2025-10-20') === page('2025-10-20', [es[1]]) && kept('2025-10-21', today) && r.stdout.endsWith(`\nremoved 1 from ${fd}\n`),
    `forget --key --yes removes exactly those that also hold the words (got ${r.stdout}${r.stderr})`);
  reset();
  // A plain-words forget that matches nothing says which words no entry holds.
  r = fcli('forget', 'the', 'zebra', 'pasted', 'yesterday');
  ok(r.status === 0 && r.stdout === `nothing in ${fd} matches: no entry holds "pasted", "yesterday"\n`, `a forget that matches nothing names the words no entry holds (got ${r.stdout})`);
  ok(fcli('forget', 'mango', 'policy').stdout === `nothing in ${fd} matches: no entry holds every word\n`, 'and when each word is somewhere, says no one entry holds them all');
  // One store at a time: under --all it removed nothing, and said "removed 0" of an entry search had shown.
  r = fcli('forget', 'zebra', '--all', '--yes');
  ok(r.status === 1 && /^forget works on one store: --store <folder>/.test(r.stdout) && kept('2025-10-20', '2025-10-21', today), `forget refuses --all (got ${r.stdout})`);
  // A turn of it recorded after the look goes too, and is listed with the rest.
  writeFileSync(join(fj, `${today}.md`), page(today, [...es.slice(3), entry(`${today} 11:00`, 'a late turn', 'bbbb2222')]));
  r = fcli('forget', '--conversation', 'bbbb2222', '--yes');
  ok(r.status === 0 && r.stdout === `${bb}${today} 11:00  conversation bbbb2222  a late turn\nremoved 3 from ${fd}\n` && file(today) === page(today, []) && kept('2025-10-20', '2025-10-21'),
    `forget --conversation removes one conversation, a turn since the look too; today's day, not yet in the snapshots, needs no word on them (got ${r.stdout}${r.stderr})`);
  // What the refusal advises does forget the whole journal, every key listed so no backfill brings it back.
  reset();
  r = fcli('forget', '--since', '1970-01-01', '--yes');
  const listed = readFileSync(join(fj, '.forgotten'), 'utf8').split('\n').filter(Boolean).sort().join();
  ok(r.status === 0 && r.stdout.endsWith(`\nremoved 5 from ${fd}\n`) && Object.keys(want).every((d) => file(d) === page(d, [])) && listed === es.map((e) => e.key).sort().join(),
    `--since 1970-01-01 --yes forgets the whole journal (got ${r.stdout}; ${listed})`);
  // With no history there is no old copy to delete: the snapshots go unmentioned.
  reset();
  renameSync(join(root, '.git'), join(root, '.git-away'));
  try { r = fcli('forget', 'Zebra', 'mango', '--yes'); } finally { renameSync(join(root, '.git-away'), join(root, '.git')); }
  ok(r.status === 0 && r.stdout === `${zm}removed 2 from ${fd}\n`, `with no snapshots, forget --yes says nothing of them (got ${r.stdout}${r.stderr})`);
  // Nor in a repository the user made there: the plugin commits nothing to it, and it is theirs to keep.
  reset();
  const cfg = join(root, '.git', 'config'), had = readFileSync(cfg, 'utf8');
  writeFileSync(cfg, had.replace(/^\[project-memory\][^[]*/m, ''));
  try { r = fcli('forget', 'Zebra', 'mango', '--yes'); } finally { writeFileSync(cfg, had); }
  ok(had.includes('[project-memory]') && r.status === 0 && r.stdout === `${zm}removed 2 from ${fd}\n`, `nor in a repository the user made (got ${r.stdout}${r.stderr})`);
  // A day the disk refuses keeps its entries and is named before the count, which says so; exit 1, never a stack trace.
  reset();
  const refuse = join(home, 'refuse-day.mjs'), refusing = (end) => {
    writeFileSync(refuse, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst rename = fs.renameSync;\n" +
      `fs.renameSync = (a, b) => { if (String(b).endsWith(${JSON.stringify(end)})) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM', syscall: 'rename', path: a, dest: b }); return rename(a, b); };\nsyncBuiltinESMExports();\n`);
    return spawnSync(process.execPath, ['--import', pathToFileURL(refuse).href, CLI, 'forget', 'Zebra', 'mango', '--yes', '--store', fd], { env, encoding: 'utf8' });
  };
  r = refusing('2025-10-21.md');
  ok(r.status === 1 && !r.stderr && r.stdout.endsWith(`could not write ${join(fj, '2025-10-21.md')}: EPERM\nremoved 1 of 2 from ${fd}\n`) && file('2025-10-21').includes('mango, the zebra again'),
    `a day that cannot be written is named, counted as not removed, and fails the forget (got ${r.stdout}${r.stderr})`);
  // A day that cannot be read is named once (the look and the removal both read it), and fails the forget.
  reset();
  mkdirSync(join(fj, '2025-10-19.md'));
  r = fcli('forget', 'Zebra', 'mango', '--yes');
  ok(r.status === 1 && r.stdout.split('could not read').length === 2 && r.stdout.endsWith(`\nremoved 2 from ${fd}\n`), `an unreadable day is said once, and the forget fails (got ${r.stdout})`);
  // The list of forgotten keys refused: nothing goes, since a backfill would bring it back.
  reset();
  r = refusing('.forgotten');
  ok(r.status === 1 && !r.stderr && r.stdout === `could not write ${join(fj, '.forgotten')}: EPERM\nremoved 0 of 2 from ${fd}\n` && kept('2025-10-20', '2025-10-21', today),
    `a forget whose list cannot be written removes nothing, and says so (got ${r.stdout}${r.stderr})`);
  // A turn recorded between the look and the removal stays: --yes removes only what a look lists.
  reset();
  const late = join(home, 'late-turn.mjs');
  writeFileSync(late, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst read = fs.readFileSync; let n = 0;\n" +
    `fs.readFileSync = (p, ...a) => { if (String(p).endsWith('2025-10-21.md') && ++n === 2) fs.appendFileSync(p, ${JSON.stringify('\n' + render(entry('2025-10-21 11:00', 'mango, a late zebra')) + '\n')}); return read(p, ...a); };\nsyncBuiltinESMExports();\n`);
  r = spawnSync(process.execPath, ['--import', pathToFileURL(late).href, CLI, 'forget', 'Zebra', 'mango', '--yes', '--store', fd], { env, encoding: 'utf8' });
  ok(r.status === 0 && r.stdout.endsWith(`\nremoved 2 from ${fd}\n`) && file('2025-10-21').includes('mango, a late zebra') && !file('2025-10-21').includes('mango, the zebra again'),
    `a turn recorded after the look is not removed (got ${r.stdout}${r.stderr})`);
  // A look lists every match up to 200; past that it asks for a narrower one, and --yes removes nothing it could not list.
  reset();
  writeFileSync(join(fj, '2025-10-22.md'), page('2025-10-22', Array.from({ length: 201 }, (_, i) => entry(`2025-10-22 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, i ? `gnu herd ${i}` : 'gnu alone'))));
  r = fcli('forget', 'gnu', 'herd');
  ok(r.stdout.split('\n').filter((l) => / gnu herd \d+$/.test(l)).length === 200 && r.stdout.endsWith(`\n200 entries in ${fd} would go; run again with --yes to remove them\n`), `a look lists 200 matches (got ${r.stdout.slice(-300)})`);
  r = fcli('forget', 'gnu');
  const r2 = fcli('forget', 'gnu', '--yes');
  ok(r.status === 0 && r.stdout === `201 entries in ${fd} match; narrow it: a look lists 200 at most\n` && r2.status === 1 &&
    r2.stdout === `201 entries in ${fd} match; narrow it: a look lists 200 at most, and --yes removes only what a look can list: nothing removed\n` && file('2025-10-22').split('gnu').length === 202,
    `past 200, a look asks for a narrower one, and --yes removes nothing (got ${r.stdout}${r2.stdout})`);
  // A day that changed under each of its three writes keeps its entries: what
  // is listed and counted is what went, out of what matched. The other writer
  // is simulated in the CLI's own process, just before each write lands.
  reset();
  const busy = join(home, 'busy-day.mjs');
  writeFileSync(busy, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst read = fs.readFileSync;\n" +
    "fs.readFileSync = (p, ...a) => { if (String(p).endsWith('2025-10-21.md') && fs.existsSync(`${p}.tmp${process.pid}`)) fs.appendFileSync(p, '\\nanother writer'); return read(p, ...a); };\nsyncBuiltinESMExports();\n");
  r = spawnSync(process.execPath, ['--import', pathToFileURL(busy).href, CLI, 'forget', 'Zebra', 'mango', '--yes', '--store', fd], { env, encoding: 'utf8' });
  ok(/^2025-10-20 09:00  conversation aaaa1111  the zebra eats mango\nthe snapshots still hold the journal of 2025-10-20: [^\n]*\nremoved 1 of 2 from /.test(r.stdout) && file('2025-10-21').includes('mango, the zebra again'),
    `a day the write never landed in keeps its entry, neither listed nor counted as removed (got ${r.stdout}${r.stderr})`);
}

// status and the journal: a line for a store that has one, what is left to
// import, and a write that failed.
{
  const st = join(root, 'C--jst', 'memory');
  const cli = () => spawnSync(process.execPath, [CLI, 'status', '--store', st], { env, encoding: 'utf8' }).stdout;
  const day = (d, body = '') => { mkdirSync(join(st, 'journal'), { recursive: true }); writeFileSync(join(st, 'journal', `${d}.md`), `# Journal ${d}\n${body}`); };
  const one = (d, k) => `\n<!-- j:${k} t:C--jst/aaaaaaaa-1 d:${d} -->\n## 09:00 · conversation aaaaaaaa\n**Asked:** ${k}\n`;
  mkdirSync(st, { recursive: true });
  writeFileSync(join(st, 'MEMORY.md'), '# Memory\n');
  ok(!/journal:/.test(cli()), 'status says nothing of a store with no journal');
  day('2026-10-01');   // a day a sweep emptied is no day
  ok(!/journal:/.test(cli()), 'status says nothing of a journal holding only an emptied day');
  day('2026-10-05', one('2026-10-05', 'k1'));
  day('2026-10-06', one('2026-10-06', 'k2'));
  let out = cli();
  ok(/^  journal: 2 days since 2026-10-05, \d\.\d MB$/m.test(out), `status reports the journal (got ${out})`);
  const tp = join(root, 'C--jst', 'bbbbbbbb-2.jsonl');
  writeFileSync(tp, '{"type":"user"}\n');
  const old = new Date(Date.now() - 2 * 86400000); utimesSync(tp, old, old);
  out = cli();
  ok(/^  journal: 2 days since 2026-10-05, \d\.\d MB; importing 1 older conversations$/m.test(out), `status says an import is pending (got ${out})`);
  writeFileSync(join(st, 'journal', '.failed'), JSON.stringify({ at: '2026-10-06T09:00:00Z', error: 'disk full' }));
  out = cli();
  ok(/; last write failed: disk full$/m.test(out), `status says the last write failed (got ${out})`);
  for (const d of ['2026-10-05', '2026-10-06']) unlinkSync(join(st, 'journal', `${d}.md`));
  ok(/^  journal: no days yet; importing 1 older conversations; last write failed: disk full$/m.test(cli()), 'a journal that failed from its first write still says so');
  // A store whose only memory is its journal (no index, no journal.md yet) is a store.
  const lone = join(root, 'C--jonly', 'memory');
  mkdirSync(join(lone, 'journal'), { recursive: true });
  writeFileSync(join(lone, 'journal', '2026-10-05.md'), `# Journal 2026-10-05\n${one('2026-10-05', 'k9')}`);
  out = spawnSync(process.execPath, [CLI, 'status', '--store', lone], { env, encoding: 'utf8' }).stdout;
  ok(!/no store here yet/.test(out) && /^  journal: 1 days? since 2026-10-05, /m.test(out), `a store whose only memory is its journal shows it (got ${out})`);
}

console.log(`memory: ${checks} checks passed`);
