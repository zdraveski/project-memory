// Self-check for memory.mjs, the memory CLI: ranked search, status, history
// and restore from real snapshots, promote, doctor. A throwaway HOME holds a
// project store and the shared store. Run: node memory.test.mjs
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, utimesSync, rmSync, symlinkSync, readdirSync, chmodSync, renameSync, statSync, appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { tool, tempHome, tempDir, storeFor, quick, capture, fastClock } from './harness.mjs';

const CLI = tool('memory.mjs'), TIER = tool('memory-tier.mjs');
const { home, env } = tempHome('memcli-');
const root = join(home, '.claude', 'projects');
const dir = join(root, 'C--mem-cli', 'memory'), shared = join(root, '_shared', 'memory');
mkdirSync(dir, { recursive: true });
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
// Another session acts at one exact moment of a call: after the first time `kind` (an fs function) is called with
// a path `match` accepts, `act` runs, and the call goes on. This is how the "meanwhile" branches are reached.
const meanwhile = (kind, match, act) => {
  const real = fs[kind]; let done = false;
  fs[kind] = function (p, ...a) { const r = real.call(this, p, ...a); if (!done && match(String(p))) { done = true; act(); } return r; };
  syncBuiltinESMExports();
  return () => { fs[kind] = real; syncBuiltinESMExports(); };
};
// The CLI in this process: a process a call cost 0.2 s, and 256 calls were
// nearly all of the suite's 50 s (2026-10-30). What needs a process of its
// own (another cwd or PATH, a run through a symlink, a journal.mjs that will
// not load) still spawns one. Imported after tempHome: it names the live copy
// from HOME as it loads. Its output through harness.mjs's capture(), which
// sends it through UTF-8 as a process's reaches the reader.
const { main } = await import(pathToFileURL(CLI).href);
const run = async (args) => {
  try { const { out, value } = await capture(() => main(args)); return { status: value, stdout: out, stderr: '' }; }
  catch (e) { return { status: 1, stdout: '', stderr: String(e?.stack ?? e) }; }
};
const cli = (...args) => run([...args, ...(args.includes('--shared') ? [] : ['--store', dir])]);
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
let r = await cli('search', 'deploy');
ok(r.status === 0 && order(r.stdout)[0] === 'deploy-notes' && order(r.stdout).indexOf('deploy-notes') < order(r.stdout).indexOf('mentions'),
  `a memory named for the term outranks a passing mention (got ${order(r.stdout).join(', ')})`);
ok(order(r.stdout).indexOf('spam-log') > order(r.stdout).indexOf('release-checklist'), 'and saying it twenty times in the body earns no more than twice');
r = await cli('search', 'deploy', 'steps');
ok(order(r.stdout)[0] === 'release-checklist', `every term in the description is the strong match (got ${order(r.stdout).join(', ')})`);
ok(order(r.stdout).indexOf('deploy-notes') < order(r.stdout).indexOf('a-long-log'), 'and a log that mentions every term in passing does not outrank a named one');
ok(/^ *\d+ +archived +\d{4}-\d\d-\d\d +\S*old-thing\.md$/m.test((await cli('search', 'archived')).stdout), 'an archived memory is found, and labelled with its date');
{ // A note that opens with a ---- rule has no frontmatter: its first lines are searched, as front() reads it (a ---x line closes nothing).
  const fm = join(root, 'C--fm-probe', 'memory'); mkdirSync(fm, { recursive: true });
  writeFileSync(join(fm, 'rule-note.md'), '----\naxolotl care steps\n---x\nwater changes\n');
  const f = await run(['search', 'axolotl', '--store', fm]);
  ok(/rule-note\.md/.test(f.stdout), `the lines above a ---x line are searched (got ${f.stdout})`);
}
ok(/^ *\d+ +shared hot +\d{4}-\d\d-\d\d +\S*shared-rule\.md$/m.test((await cli('search', 'stage')).stdout), 'the shared store is searched too, and labelled');
r = await cli('search', 'deploy', '--limit', '2');
ok(order(r.stdout).length === 2 && /^2 of [3-9] match\(es\) in [^\n]*; --limit N shows more; --all searches every project$/m.test(r.stdout), `--limit caps the results, and the count says how many it left out (got ${r.stdout.trim().split('\n').pop()})`);
// A hit's date is its modified:, and a hint that would add nothing is not given.
memory(dir, 'dated-quirk', 'a dated quirk', 'body', '  modified: 2026-01-02T12:00:00.000Z\n');
r = await cli('search', 'quirk');
ok(/^ *\d+ +unindexed +2026-01-02 +\S*dated-quirk\.md$/m.test(r.stdout) && /^1 of 1 match\(es\) in [^;\n]+; --all searches every project$/m.test(r.stdout), `a hit carries its modified: date; all shown, no --limit hint (got ${r.stdout})`);
r = await cli('search', 'quirk', '--all');
ok(/^1 of 1 match\(es\) in [^;\n]+$/m.test(r.stdout), `with --all, no --all hint (got ${r.stdout.trim().split('\n').pop()})`);
ok(order((await cli('search', 'deploy', '--limit', '-1')).stdout).join() === order((await cli('search', 'deploy')).stdout).join() && order((await cli('search', 'deploy')).stdout).length > 2, 'a negative --limit is the default, not "nothing matches"');
rmSync(join(dir, 'dated-quirk.md'));
r = await cli('search', 'windows');
ok(order(r.stdout)[0] === 'crlf-note' && /^ +windows line ends$/m.test(r.stdout), 'a BOM and CRLF file is parsed: found, description read');
// Its body starts after the frontmatter: behind the BOM, the whole file was the
// body, and every key in the frontmatter matched a search.
ok(!order((await cli('search', 'metadata')).stdout).includes('crlf-note'), 'the frontmatter of a BOM file is not searched as its body');
r = await cli('search', 'zzzqqq');
ok(r.status === 0 && /nothing matches/.test(r.stdout), 'no hit says so');
ok((await cli('search')).status === 1, 'search with no terms is a usage error');

// 2. Status: sizes against the right budget, problems, dangling links.
r = await cli('status');
ok(r.status === 0 && /index \d+ \/ 7000 B · 7 hot · 1 archived/.test(r.stdout), `status counts the store against its budget (got ${r.stdout.split('\n')[1]})`);
ok(/links to no memory: crlf-note\.md → \[\[ghost\]\]$/m.test(r.stdout), 'a link to no memory is named; one the shared store resolves is not');
ok(/frontmatter without a description or type: bare\.md/.test(r.stdout), 'a memory with no description is named');
ok(/_shared[\\/]memory  \(shared by every project\)\n  index \d+ \/ 3000 B/.test(r.stdout), 'and the shared store is reported against its 3000 B budget');

// A memory a newer one replaced says so where it is found.
memory(dir, 'old-way', 'the old way to ship', 'ship it', '  superseded-by: new-way.md\n');
r = await cli('search', 'old way ship');
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
mkdirSync(join(dir, 'journal'), { recursive: true });
writeFileSync(join(dir, 'journal', '2026-10-27.md'), '# Journal 2026-10-27\n');
tier();
r = await cli('history', 'deploy-notes');
ok(r.status === 0 && /  \S+ \S+ \S+  deleted\n  \S+ \S+ \S+  in the first snapshot$/m.test(r.stdout), `history lists the snapshots that changed it, newest first; the first snapshot is not called its writing (got ${r.stdout})`);
// Its last line is a command that works as printed: the path git tracks, no `~`.
const show = r.stdout.match(/^  a change: git -C "([^"]+)" --literal-pathspecs show <commit> -- "([^"]+)"$/m), first = r.stdout.match(/^  (\w+) .*in the first snapshot$/m);
ok(show && first && /deploy notes/.test(spawnSync('git', ['-C', show[1], '--literal-pathspecs', 'show', first[1], '--', show[2]], { encoding: 'utf8' }).stdout), `history ends with the command that shows a change (got ${show && show[0]})`);
r = await cli('restore', 'deploy-notes');
ok(r.status === 0 && existsSync(join(dir, 'deploy-notes.md')) && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy'), 'restore brings a deleted memory back from before its deletion');
// Status names what the snapshots saw change this week, in this store only.
r = await cli('status');
ok(/changed in the last 7 days: [^\n]*deleted deploy-notes/.test(r.stdout) && !/added [^·\n]*deploy-notes/.test(r.stdout), `status names the week's changes (got ${r.stdout})`);
ok(!/changed in the last 7 days:[^\n]*secret/.test(r.stdout), "another project's memory is not listed");
ok(!/changed in the last 7 days:[^\n]*2026-10-27/.test(r.stdout), `a journal day is no memory to list (got ${r.stdout})`);
// Added this week and deleted again: deleted, not added.
memory(dir, 'brief-note', 'here and gone');
tier();
unlinkSync(join(dir, 'brief-note.md'));
tier();
r = await cli('status');
ok(/deleted [^·\n]*brief-note/.test(r.stdout) && !/added [^·\n]*brief-note/.test(r.stdout), `a memory added and deleted this week is listed as deleted (got ${r.stdout})`);
// The first snapshot took in what was there: none of it was "added" this week.
// Asked here: the snapshots of 2020 made below end the week's log for the rest.
ok(!/added [^·\n]*(a-long-log|release-checklist|mentions)/.test(r.stdout), `status does not call what the first snapshot found "added" (got ${r.stdout})`);
// A name git would quote (not ASCII) is listed as it is.
memory(dir, 'café-notes', 'notes from the café');
tier();
ok(/changed in the last 7 days: [^\n]*café-notes/.test((await cli('status')).stdout), 'a memory with an accented name is listed');
unlinkSync(join(dir, 'café-notes.md'));
ok(readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').includes(handLine), 'with its hand-written index line');
r = await cli('restore', 'deploy-notes');
ok(r.status === 1 && /exists/.test(r.stdout), 'restore refuses to replace a memory that exists');
writeFileSync(join(dir, 'deploy-notes.md'), 'scribbled over');
r = await cli('restore', 'deploy-notes', '--force');
ok(r.status === 0 && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy') && /still there/.test(r.stdout), '--force replaces it, and the line it has is kept');
ok(readFileSync(join(dir, 'MEMORY.md'), 'utf8').split('\n').filter((l) => l === handLine).length === 1, 'and no second line is added');
const kept = r.stdout.match(/what it replaced is kept: git -C "([^"]+)" cat-file -p (\w+)/);
ok(kept && spawnSync('git', ['-C', kept[1], 'cat-file', '-p', kept[2]], { encoding: 'utf8' }).stdout === 'scribbled over', `what --force replaced is kept in the repo, and said where (got ${r.stdout.trim()})`);
r = await cli('restore', 'deploy-notes', '--force');
ok(r.status === 1 && /already matches/.test(r.stdout), `a restore that would change nothing says so, not "restored" (got ${r.stdout.trim()})`);
ok(!/--all looks/.test((await cli('history', 'never-was', '--all')).stdout), 'history --all does not suggest --all');
r = await cli('history', 'never-was');
ok((await cli('restore', 'never-was')).status === 1 && r.status === 1 && /search <words> finds a memory's name; --all looks in every project/.test(r.stdout), 'a memory no snapshot holds: restore and history fail, and history says how to find the name');
ok((await cli('restore', 'mentions', '--force', '--rev', 'nosuchrev')).status === 1, 'an unknown revision fails');
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
  r = await cli('history', 'busy-note');
  ok(made.status === 0 && r.status === 0 && rows(r.stdout) === 30 && /^  and 5 older; --limit N shows more$/m.test(r.stdout) && /^  a change: git -C /.test(r.stdout.trim().split('\n').pop()),
    `history shows the newest 30 and how many are older, its command still last (got ${made.stderr}${r.stdout})`);
  r = await cli('history', 'busy-note', '--limit', '40');
  ok(rows(r.stdout) === 35 && !/^  and \d+ older/m.test(r.stdout), `--limit shows more (got ${rows(r.stdout)}: ${r.stdout})`);
  unlinkSync(join(dir, 'busy-note.md'));
}
// The commit history calls "deleted" no longer has the memory: --rev with it
// failed. It brings back the version that commit deleted.
const deletedAt = (await cli('history', 'deploy-notes')).stdout.match(/^  (\w+) .*deleted$/m)?.[1];
writeFileSync(join(dir, 'deploy-notes.md'), 'scribbled again');
r = await cli('restore', 'deploy-notes', '--rev', deletedAt, '--force');
ok(deletedAt && r.status === 0 && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy'), `restore --rev with a "deleted" row brings back what it deleted (got ${r.stdout.trim()})`);
// --rev is a commit, never an option: `--format=...` wrote git's output into the note.
r = await cli('restore', 'deploy-notes', '--force', '--rev', '--format=INJECTED %H');
ok(r.status === 1 && /--rev takes a commit/.test(r.stdout) && !/INJECTED/.test(readFileSync(join(dir, 'deploy-notes.md'), 'utf8')), '--rev that is no commit is refused');
r = await cli('restore', 'deploy-notes', '--force', '--rev', 'HEAD~1..HEAD');
ok(r.status === 1 && /--rev takes a commit/.test(r.stdout) && readFileSync(join(dir, 'deploy-notes.md'), 'utf8').includes('deploy deploy'), 'a range is no commit: refused, never an empty note');
r = await cli('restore', 'deploy-notes', '--force', '--rev', 'HEAD~999');
ok(r.status === 1 && /at HEAD~999: /.test(r.stdout), `an unknown commit is named as given (got ${r.stdout.trim()})`);
// A snapshot git has but cannot read (a damaged object), at the commit that added it: the error is that commit's,
// in git's words. The commit before has no such note, and its "does not exist" took the error's place.
{
  const g = (a, input) => spawnSync('git', ['-C', root, ...a], { input, encoding: 'utf8' });
  const blob = g(['hash-object', '-w', '--stdin'], 'a note whose snapshot is damaged\n').stdout.trim(), obj = join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
  const msg = 'memory: rotten\n', head = g(['symbolic-ref', 'HEAD']).stdout.trim();
  g(['fast-import', '--quiet'], `commit ${head}\ncommitter memory <memory@localhost> 1700000000 +0000\ndata ${msg.length}\n${msg}from ${g(['rev-parse', 'HEAD']).stdout.trim()}\nM 100644 ${blob} C--mem-cli/memory/rotten-note.md\n\n`);
  const added = g(['rev-parse', '--short', 'HEAD']).stdout.trim(), good = readFileSync(obj);
  chmodSync(obj, 0o644);
  writeFileSync(obj, Buffer.concat([good.subarray(0, -4), Buffer.from(good.subarray(-4).map((x) => x ^ 0xff))]));  // its zlib checksum broken
  r = await cli('restore', 'rotten-note', '--force', '--rev', added);
  writeFileSync(obj, good);
  // Any reason but the missing one: git's words for the damage differ between versions.
  ok(r.status === 1 && r.stdout.includes(`at ${added}: `) && !/lists the ones that hold it/.test(r.stdout), `a damaged snapshot fails with its own commit and git's reason (got ${r.stdout.trim()})`);
}
// The command is the first word that is no option: an option before it worked.
r = await run(['--store', dir, 'search', 'deploy']);
ok(r.status === 0 && /match\(es\) in/.test(r.stdout), `an option before the command still runs it (got ${r.stdout.slice(0, 200)})`);
// An option it does not know is refused: dropped, `--from 2026-10-27` searched for "2026", and `--after=` ignored the date.
r = await cli('search', 'deploy', '--from', '2026-10-27');
const after = await cli('search', 'deploy', '--after=2026-10-28');
ok(r.status === 1 && r.stdout === 'unknown option --from; help lists the options\n' && after.status === 1 && after.stdout === 'unknown option --after=2026-10-28; help lists the options\n', `an unknown option is refused (got ${r.stdout}${after.stdout})`);
const helped = [];
for (const h of ['--help', '-h', 'help']) helped.push(await cli(h));
ok(helped.every((u) => u.status === 0 && u.stdout.startsWith('node memory.mjs <command>')), '--help and -h print the usage, as help does');
// A count that is no number is refused, not dropped; the usage names --session.
const ten = await cli('search', 'deploy', '--limit', 'ten');
ok(ten.status === 1 && ten.stdout === '--limit takes a number, not ten\n' && (await cli('search', 'deploy', '--limit', '3')).status === 0 && /\[--session <id>\]/.test((await cli('help')).stdout),
  `--limit ten is refused and the usage names --session (got ${ten.stdout})`);
// The usage after why, not alone: a misspelt command, one with nothing after it.
const typo = await cli('serach', 'logo'), bare = await cli('restore');
ok(typo.status === 1 && typo.stdout.startsWith('no command "serach"\nnode memory.mjs <command>') && bare.status === 1 && bare.stdout.startsWith('restore needs a word after it\nnode memory.mjs <command>'),
  `a usage error says what was wrong first (got ${typo.stdout.slice(0, 60)} / ${bare.stdout.slice(0, 60)})`);
// After `--` every word is a search word, one that looks like an option too.
memory(dir, 'hook-rule', 'never commit with --no-verify');
r = await run(['search', '--store', dir, '--', '--no-verify', '--all']);
ok(r.status === 0 && /[\\/]hook-rule\.md$/m.test(r.stdout) && /; --all searches every project$/m.test(r.stdout), `words after -- are searched, never read as options (got ${r.stdout})`);
unlinkSync(join(dir, 'hook-rule.md'));
// Without git, history says so, not "spawnSync git ENOENT".
r = spawnSync(process.execPath, [CLI, 'history', 'deploy-notes', '--store', dir], { env: { HOME: home, USERPROFILE: home, PATH: '', ...(process.env.NODE_V8_COVERAGE && { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }) }, encoding: 'utf8' });
ok(r.status === 1 && /git is not installed/.test(r.stdout), `history without git says git is not installed (got ${r.stdout.trim()})`);
// No command (the skill run with no arguments) is status.
r = await cli('--session', 'nobody');
ok(r.status === 0 && /index \d+ \/ 7000 B/.test(r.stdout), `no command, only --session: status (got ${r.stdout.slice(0, 200)})`);
// Another store is a memory folder under the projects root: promote deleted a
// note from any folder it was pointed at.
const outside = join(home, 'elsewhere', 'memory');
mkdirSync(outside, { recursive: true });
writeFileSync(join(outside, 'o.md'), '---\nname: o\ndescription: "o"\n---\nkeep me\n');
writeFileSync(join(outside, 'MEMORY.md'), '- [o](o.md) — o\n');
r = await run(['promote', 'o', '--store', outside]);
ok(r.status === 1 && /--store takes a memory folder/.test(r.stdout) && existsSync(join(outside, 'o.md')) && !existsSync(join(shared, 'o.md')), '--store outside the projects folder is refused, and nothing there is touched');
// Deleted, made again, changed, deleted again before any snapshot: the newest
// snapshot has the newest version, not the one before the first deletion.
memory(dir, 'cycle', 'v1', 'v1'); tier();
unlinkSync(join(dir, 'cycle.md')); tier();
memory(dir, 'cycle', 'v2', 'v2'); tier();
unlinkSync(join(dir, 'cycle.md'));
r = await cli('restore', 'cycle');
ok(r.status === 0 && readFileSync(join(dir, 'cycle.md'), 'utf8').includes('v2'), `restore takes the newest snapshot that has it (got ${readFileSync(join(dir, 'cycle.md'), 'utf8').trim().split('\n').pop()})`);
// git's paths are case-sensitive; on Windows a store named in another case is the same store.
if (process.platform === 'win32') {
  r = await run(['history', 'cycle', '--store', dir.toLowerCase()]);
  ok(r.status === 0 && /added/.test(r.stdout), 'a store path in another letter case still finds its snapshots');
}
ok((await cli('history', '../../C--other/memory/secret')).status === 1 && (await cli('restore', '../../C--other/memory/secret')).status === 1 && !existsSync(join(dir, 'secret.md')),
  "a path is not a memory name: it cannot reach another project's store");

// 4. Promote: into the shared store, line and all; never half-moved.
const line = '- [Release checklist](release-checklist.md) — steps';
r = await cli('promote', 'release-checklist');
ok(r.status === 0 && existsSync(join(shared, 'release-checklist.md')) && !existsSync(join(dir, 'release-checklist.md')), 'promote moves the file to the shared store');
ok(readFileSync(join(shared, 'MEMORY.md'), 'utf8').split('\n').includes(line) && !readFileSync(join(dir, 'MEMORY.md'), 'utf8').includes('release-checklist.md'),
  'and its own index line with it');
r = await cli('restore', 'release-checklist');
ok(r.status === 1 && /was promoted: it is in /.test(r.stdout) && !existsSync(join(dir, 'release-checklist.md')), 'a promoted memory is not restored into its old project unasked');
ok(/^  promoted: it is in /m.test((await cli('history', 'release-checklist')).stdout), 'and its history there says where it went');
// An index saved with a BOM: its first line is a pointer like any other.
memory(dir, 'bom-first', 'a lesson listed first');
writeFileSync(join(dir, 'MEMORY.md'), '\uFEFF- [Bom first](bom-first.md) — hand-written\n' + readFileSync(join(dir, 'MEMORY.md'), 'utf8'));
r = await cli('promote', 'bom-first');
ok(r.status === 0 && !readFileSync(join(dir, 'MEMORY.md'), 'utf8').includes('bom-first.md') && readFileSync(join(shared, 'MEMORY.md'), 'utf8').includes('- [Bom first](bom-first.md) — hand-written'),
  'promote finds a first index line behind a BOM, and moves that line');
memory(dir, 'shared-rule', 'a project copy');
const before = readFileSync(join(shared, 'shared-rule.md'), 'utf8');
r = await cli('promote', 'shared-rule');
ok(r.status === 1 && existsSync(join(dir, 'shared-rule.md')) && readFileSync(join(shared, 'shared-rule.md'), 'utf8') === before, 'a name the shared store has already: refused, both stores unchanged');
writeFileSync(join(dir, 'handoff.md'), '---\nname: handoff\ndescription: "The rolling handoff"\n---\n');
ok((await cli('promote', 'MEMORY')).status === 1 && (await cli('promote', 'handoff')).status === 1 && existsSync(join(dir, 'handoff.md')), 'an index or the handoff is not a memory to share');
r = await cli('promote', 'shared-rule', '--shared');
ok(r.status === 1 && /in the shared store already/.test(r.stdout), 'nor is a memory already shared');
// A name with brackets and no index line: the line made for it reads back.
// Words no later search uses: a hit they added changed its count.
memory(dir, '[draft] okapi', 'an okapi still in draft');
r = await cli('promote', '[draft] okapi');
ok(r.status === 0 && /^- \[draft okapi\]\(\[draft\] okapi\.md\) — an okapi still in draft$/m.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8')),
  `a promoted name with brackets gets a line POINTER reads (got ${r.stdout})`);
// A copy that cannot be written moves nothing: the note stays in its project.
{
  const { promote } = await import(pathToFileURL(CLI).href);
  memory(dir, 'stuck-note', 'cannot be copied');
  mkdirSync(join(shared, `stuck-note.md.tmp${process.pid}`));
  const stuck = promote(dir, 'stuck-note.md');
  ok(stuck.ok === false && existsSync(join(dir, 'stuck-note.md')) && !existsSync(join(shared, 'stuck-note.md')), `a copy that fails moves nothing (got ${JSON.stringify(stuck)})`);
  rmSync(join(shared, `stuck-note.md.tmp${process.pid}`), { recursive: true, force: true });
  rmSync(join(dir, 'stuck-note.md'));
}
// Another session acts while promote runs: each data-safety branch says so, and the memory is never in neither store.
{
  const { promote } = await import(pathToFileURL(CLI).href);
  const sharedIdx = join(shared, 'MEMORY.md'), dirIdx = join(dir, 'MEMORY.md'), tmp = (f) => `${f}.tmp${process.pid}`;
  const sharedWas = existsSync(sharedIdx) ? readFileSync(sharedIdx, 'utf8') : null, dirWas = readFileSync(dirIdx, 'utf8');
  const sharedLock = join(shared, '.lock');
  const attempt = (name, kind, match, act, { line = false } = {}) => {
    memory(dir, name, 'a memory to share');
    if (line) writeFileSync(dirIdx, dirWas + `- [${name}](${name}.md) — a memory to share\n`);
    const undo = meanwhile(kind, match, () => act(join(dir, `${name}.md`), join(shared, `${name}.md`)));
    try { return promote(dir, `${name}.md`); } finally { undo(); writeFileSync(dirIdx, dirWas); }
  };
  const copies = (name) => [join(dir, `${name}.md`), join(shared, `${name}.md`)].filter(existsSync).length;
  let q = attempt('mw-gone', 'mkdirSync', (p) => p === sharedLock, (src) => unlinkSync(src));
  ok(q.ok === false && /went away meanwhile; nothing moved/.test(q.lines[0]) && copies('mw-gone') === 0, `promote: a note that went away is not moved, nothing is made up (got ${JSON.stringify(q)})`);
  q = attempt('mw-there', 'mkdirSync', (p) => p === sharedLock, (src, dst) => writeFileSync(dst, 'theirs'));
  ok(q.ok === false && /shared store got a mw-there\.md meanwhile; nothing moved/.test(q.lines[0]) && readFileSync(join(shared, 'mw-there.md'), 'utf8') === 'theirs' && existsSync(join(dir, 'mw-there.md')), `promote: a shared file that appeared is kept, and the project's note stays (got ${JSON.stringify(q)})`);
  q = attempt('mw-idx', 'writeFileSync', (p) => p === tmp(sharedIdx), () => appendFileSync(sharedIdx, '# theirs\n'));
  ok(q.ok === false && /shared index changed meanwhile: mw-idx\.md is in both stores/.test(q.lines[0]) && copies('mw-idx') === 2 && /# theirs/.test(readFileSync(sharedIdx, 'utf8')), `promote: a shared index written meanwhile is kept, and the note stays in both stores for the user to settle (got ${JSON.stringify(q)})`);
  q = attempt('mw-edit', 'renameSync', (p) => p === tmp(sharedIdx), (src) => appendFileSync(src, 'edited\n'));
  ok(q.ok === false && /changed while it was copied/.test(q.lines[0]) && copies('mw-edit') === 2 && /edited/.test(readFileSync(join(dir, 'mw-edit.md'), 'utf8')), `promote: an edit that landed during the copy keeps the project copy (got ${JSON.stringify(q)})`);
  q = attempt('mw-home', 'writeFileSync', (p) => p === tmp(dirIdx), () => appendFileSync(dirIdx, '# theirs\n'), { line: true });
  ok(q.ok === false && /project index changed meanwhile: mw-home\.md is in both stores/.test(q.lines[0]) && copies('mw-home') === 2, `promote: a project index written meanwhile is said, the note stays in both stores (got ${JSON.stringify(q)})`);
  q = attempt('mw-late', 'renameSync', (p) => p === tmp(dirIdx), (src) => appendFileSync(src, 'edited\n'), { line: true });
  ok(q.ok === false && /changed while it was copied/.test(q.lines[0]) && copies('mw-late') === 2, `promote: an edit that landed after the index line went keeps the project copy (got ${JSON.stringify(q)})`);
  for (const f of ['mw-idx', 'mw-edit', 'mw-home', 'mw-late', 'mw-there']) for (const d of [dir, shared]) rmSync(join(d, `${f}.md`), { force: true });
  if (sharedWas === null) rmSync(sharedIdx, { force: true }); else writeFileSync(sharedIdx, sharedWas);
}
// Frontmatter never closed is all frontmatter, as tiering reads it.
writeFileSync(join(dir, 'pangolin-rule.md'), '---\nname: pangolin-rule\ndescription: pangolin rule text\nmetadata:\n  type: feedback\n');
r = await cli('search', 'pangolin');
ok(/^     pangolin rule text$/m.test(r.stdout), `a note whose frontmatter never closes keeps its description (got ${r.stdout})`);
rmSync(join(dir, 'pangolin-rule.md'));

// 4a. What a model types is a sentence: words that name no memory are skipped,
// the handoff (a log the startup line prints) is no hit, and a hit stays short.
memory(dir, 'the-plans-are-the-brand', 'unrelated');
memory(dir, 'linky', 'a memory with many links', [1, 2, 3, 4, 5, 6, 7].map((i) => `[[l${i}]]`).join(' '));
ok(!/the-plans-are-the-brand/.test((await cli('search', 'how', 'the', 'deploy')).stdout), '"the" and "how" score nothing, not even in a file name');
ok(!/handoff\.md/.test((await cli('search', 'rolling', 'handoff')).stdout), 'the handoff is not a search hit');
ok(/^ +links: l1, l2, l3, l4, l5, and 2 more$/m.test((await cli('search', 'linky')).stdout), 'a hit lists five links and counts the rest');
r = await cli('search', 'what did I do');
ok(r.status === 0 && /^nothing to search for: "what did I do" has no word that says which memory$/m.test(r.stdout), `a query of short and stop words says so, not "nothing matches" (got ${r.stdout})`);

// 4b. Promote and restore take the store's lock: one held by a hook is busy, and nothing moves.
if (!quick) {
  memory(dir, 'locked-out', 'a memory to move');
  mkdirSync(join(dir, '.lock'));
  r = await cli('promote', 'locked-out');
  const r2 = await cli('restore', 'mentions', '--force');
  rmSync(join(dir, '.lock'), { recursive: true });
  ok(r.status === 1 && /busy/.test(r.stdout) && existsSync(join(dir, 'locked-out.md')) && !existsSync(join(shared, 'locked-out.md')), 'promote waits out a held lock, then gives up with nothing moved');
  ok(r2.status === 1 && /busy/.test(r2.stdout), 'and so does restore');
}

// 4c. A line the ceiling evicted carries a mark in the archive: restored, the mark stays behind.
const git = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
const commit = (m) => { git('add', '-A'); git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', m); };
memory(dir, 'evicted', 'a line the ceiling moved');
const arcPath = join(dir, 'MEMORY-archive.md'), arcBefore = readFileSync(arcPath, 'utf8');
writeFileSync(arcPath, arcBefore + '- [Evicted](evicted.md) — hand-written <!-- overflow -->\n');
commit('evicted, in the archive');
unlinkSync(join(dir, 'evicted.md')); writeFileSync(arcPath, arcBefore);
commit('evicted, deleted');
r = await cli('restore', 'evicted');
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
// In one process, as this suite runs the CLI: a call's session is not the next one's.
await run(['status', '--session', 'sess-cli-1']);
const nextCall = (await run(['status'])).stdout.split('\n')[0];
ok(nextCall !== dir, `a call's --session is not carried into the next call (got ${nextCall})`);
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
  'SessionStart | startup|resume|clear|compact | node ${CLAUDE_PLUGIN_ROOT}/handoff-log.mjs --print', 'Stop |  | node ${CLAUDE_PLUGIN_ROOT}/memory-tier.mjs --stop']),
  `the plugin wires the four hooks, each with its matcher and flag (got ${wiring.join('; ')})`);
// A hook with no timeout gets Claude Code's 10 minutes; a real Stop took 45.7 s. A timed-out hook's output is discarded.
const hooksOf = Object.entries(hookFile.hooks).flatMap(([ev, es]) => es.map((e) => ({ ev, matcher: e.matcher || '', ...e.hooks[0] })));
const timeouts = Object.fromEntries(hooksOf.map((h) => [`${h.ev}|${h.matcher}`, h.timeout]));
ok(JSON.stringify(timeouts) === JSON.stringify({ 'Stop|': 120, 'SessionStart|startup|resume|clear|compact': 30, 'PreCompact|manual': 120, 'PreCompact|auto': 60 }),
  `each hook has its timeout in seconds (got ${JSON.stringify(timeouts)})`);
ok(hooksOf.every((h) => typeof h.statusMessage === 'string' && h.statusMessage), 'each hook has a statusMessage');
ok(new Set(hooksOf.filter((h) => h.ev === 'PreCompact').map((h) => h.statusMessage)).size === 2, 'the two PreCompact messages differ');
// A fork inherits its conversation, so it needs no briefing of its own.
ok(!/fork/.test(hookFile.hooks.SessionStart[0].matcher), 'the SessionStart matcher leaves fork out');

// 5. Doctor: what is installed and what ran, never settings.json (it can
// hold the user's keys). A settings.json that does not even parse goes unsaid.
writeFileSync(join(home, '.claude', 'settings.json'), '{ not json: doctor never reads this');
const ranLog = (...runs) => writeFileSync(join(root, '.stop-ran'), runs.map((x) => JSON.stringify(x)).join('\n') + '\n');
const ago = (ms) => new Date(Date.now() - ms).toISOString();
rmSync(join(root, '.stop-ran'), { force: true });
r = await cli('doctor');
ok(r.status === 1 && /^PROBLEM not installed[^\n]*claude plugin install project-memory@project-memory/m.test(r.stdout) && !/settings\.json (does not parse|wires)/.test(r.stdout),
  `doctor: not installed and never run is a problem, with the install; settings.json is not read (got ${r.stdout})`);
ranLog({ at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' });
ok(/^ok +the hooks run from C:\/x \(no install record: added from claude\.ai, or wired by hand\)/m.test((await cli('doctor')).stdout), 'doctor: hooks that run with no install record (a claude.ai install, @synced) are fine');
ranLog({ at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' }, { at: ago(59_000), s: 'aaaaaaaa', from: 'C:/y' });
r = await cli('doctor');
ok(r.status === 1 && /^PROBLEM the Stop hook ran twice for one reply[^\n]*The user's fix: remove the project-memory hooks added to settings.json by hand/m.test(r.stdout), 'doctor: two runs for one reply, seconds apart, are hooks wired twice');
ranLog({ at: ago(120_000), s: 'aaaaaaaa', from: 'C:/x' }, { at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' }, { at: ago(59_000), s: 'bbbbbbbb', from: 'C:/x' });
ok(!/ran twice/.test((await cli('doctor')).stdout), 'doctor: replies a minute apart, and two conversations at once, are not');
// A /compact typed right after a reply runs the same --stop as PreCompact, and
// a reply to a blocked stop runs the Stop hook again: neither is a second wiring.
ranLog({ at: ago(60_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' }, { at: ago(59_000), s: 'aaaaaaaa', e: 'PreCompact', from: 'C:/x' });
ok(!/ran twice/.test((await cli('doctor')).stdout), 'doctor: a /compact right after a reply is not a second wiring');
ranLog({ at: ago(60_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' }, { at: ago(59_000), s: 'aaaaaaaa', e: 'Stop', h: 1, from: 'C:/x' });
ok(!/ran twice/.test((await cli('doctor')).stdout), 'doctor: the reply to a blocked stop is not a second wiring');
ranLog({ at: ago(60_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' }, { at: ago(56_000), s: 'aaaaaaaa', e: 'Stop', from: 'C:/x' });
ok(!/ran twice/.test((await cli('doctor')).stdout), 'doctor: two replies four seconds apart are two replies');
ranLog({ at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' }, { at: ago(59_000), s: 'aaaaaaaa', m: 'ab12cd34', from: 'C:/y' });
ok(/ran twice/.test((await cli('doctor')).stdout), 'doctor: an old wiring that logs no fingerprint, next to the plugin, is hooks wired twice');
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
  ok(/a disableAllHooks setting, --bare, --settings or CLAUDE_CODE_SKIP_PROMPT_HISTORY would cause this too/.test(dead), 'doctor names the settings that stop hooks as other causes');
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
r = await cli('doctor');
ok(/^ok +the plugin runs version 1\.0\.0 from [^\n]*1\.0\.0$/m.test(r.stdout) && !/PROBLEM[^\n]*plugin/.test(r.stdout), `doctor: a GitHub install runs its cached copy, and that is fine (got ${r.stdout})`);
// From another marketplace, or a local clone: the same, by whatever name it was added under.
installed('project-memory@my-plugins', join(home, 'clone'), { source: 'directory', path: join(home, 'clone') });
ok(/^ok +the plugin runs version \(none\) from [^\n]*clone$/m.test((await cli('doctor')).stdout), 'doctor: a plugin from a local clone is found under any marketplace name');
// An installed plugin read from a cached copy reaches a deploy only by an update.
const live = join(home, '.claude', 'hooks-live'), cache = join(home, '.claude', 'plugins', 'cache', 'pm', '1.0.1');
for (const [d, commit] of [[live, 'bbb'], [cache, 'aaa']]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, '.deployed.json'), JSON.stringify({ commit, files: {} })); }
writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'project-memory@project-memory': [{ installPath: cache }] } }));
writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), '{}');
ok(/^PROBLEM the plugin runs aaa from [^\n]*, the last deploy is bbb\. The user's fix: claude plugin update/m.test((await cli('doctor')).stdout), 'doctor: a plugin copy older than the last deploy is named');
writeFileSync(join(cache, '.deployed.json'), JSON.stringify({ commit: 'bbb', files: {} }));
ok(/^ok +the plugin runs the last deploy, bbb/m.test((await cli('doctor')).stdout), 'doctor: and one that matches is fine');
// A copy at the last deploy's commit with a file changed since is named by the file.
writeFileSync(join(cache, '.deployed.json'), JSON.stringify({ commit: 'bbb', files: { 'gone.mjs': '0' } }));
r = await cli('doctor');
ok(r.status === 1 && /^PROBLEM Memory hooks changed outside deploy\.mjs, live and untested: gone\.mjs in [^\n]*1\.0\.1\./m.test(r.stdout), `doctor: a plugin copy edited since its deploy is named by the file (got ${r.stdout})`);
// Installed from a local folder (the live copy), Claude Code reads it in place:
// a stale cache copy beside it is not what runs.
writeFileSync(join(cache, '.deployed.json'), JSON.stringify({ commit: 'aaa', files: {} }));
writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'project-memory': { source: { source: 'directory', path: live } } }));
r = await cli('doctor');
ok(/^ok +the plugin runs the last deploy, bbb, from [^\n]*hooks-live$/m.test(r.stdout), `doctor: a plugin read in place from the live copy runs the last deploy, whatever its cache holds (got ${r.stdout.split('\n').find((l) => /plugin runs/.test(l))})`);
// Added from the repo instead, it runs untested edits: no update fixes that.
writeFileSync(join(home, '.claude', 'plugins', 'known_marketplaces.json'), JSON.stringify({ 'project-memory': { source: { source: 'directory', path: join(home, 'repo') } } }));
ok(/^PROBLEM the plugin is read from [^\n]*repo, not the live copy\. The user's fix: claude plugin marketplace remove project-memory,/m.test((await cli('doctor')).stdout), 'doctor: a plugin read from anywhere but the live copy is named, with the way back');
const packDir = join(root, '.git', 'objects', 'pack');
mkdirSync(packDir, { recursive: true });
writeFileSync(join(packDir, 'pack-dead.idx'), 'x');
ok(/^ok +1 pack index file\(s\) [^\n]*have no pack[^\n]*pack-dead\.idx$/m.test((await cli('doctor')).stdout), 'doctor: an index a repack left with no pack is named');
// No git is a setup the README allows: said, not a problem. Snapshots off say
// what is lost; failing ones come with what to do.
r = spawnSync(process.execPath, [CLI, 'doctor'], { env: { HOME: home, USERPROFILE: home, PATH: '', ...(process.env.NODE_V8_COVERAGE && { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }) }, encoding: 'utf8' });
ok(/^ok +git is not installed: everything works except/m.test(r.stdout), `doctor: no git is said, not a problem (got ${r.stdout})`);
writeFileSync(join(root, '.snapshot-health'), JSON.stringify({ lastOk: null, failures: 0, off: 'git is not installed' }));
ok(/^ok +snapshots: off, git is not installed: everything else works/m.test((await cli('doctor')).stdout), 'doctor: snapshots off are said, not a problem');
writeFileSync(join(root, '.snapshot-health'), JSON.stringify({ lastOk: null, failures: 4, error: 'fatal: bad object HEAD' }));
ok(/^PROBLEM snapshots: failing, 4 in a row[^\n]*The user's fix: run git -C/m.test((await cli('doctor')).stdout), 'doctor: failing snapshots come with what to do');
// A first snapshot taken in parts, or one waiting on another git, is said as it is: doctor said "none recorded yet" while a
// history never started, and "ok, last <now>" of one that had none (audit H-F1).
writeFileSync(join(root, '.snapshot-health'), JSON.stringify({ lastOk: null, failures: 0, partial: 120, pending: true }));
ok(/^ok +snapshots: the first is being taken in parts, 120 file\(s\) still to add/m.test((await cli('doctor')).stdout), 'doctor: a first snapshot in parts is said, with what is left');
writeFileSync(join(root, '.snapshot-health'), JSON.stringify({ lastOk: null, failures: 0, busySince: '2026-10-30T08:00:00.000Z', pending: true }));
ok(/^ok +snapshots: none taken yet; waiting since [^\n]* for another git to let go of the repository/m.test((await cli('doctor')).stdout), 'doctor: no snapshot yet, waiting on another git, is said as that');
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
  r = await run(['doctor', '--session', 'stall-1']);
  ok(/^PROBLEM Memory hooks look stopped: [^\n]*clears after the next reply\.$/m.test(r.stdout), `doctor: hooks that look stopped are said, with no "run doctor" (got ${r.stdout})`);
  // The briefing judges the newest other window; doctor, judging only the
  // newest, said all ok from the window that saved while another did not.
  const said = (name, endMin) => writeFileSync(join(dirname(dir), `${name}.jsonl`), [
    JSON.stringify({ type: 'user', timestamp: minsAgo(endMin + 1).toISOString(), message: { content: 'q' } }),
    JSON.stringify({ type: 'assistant', timestamp: minsAgo(endMin).toISOString(), message: { content: [{ type: 'text', text: 'a' }], stop_reason: 'end_turn', usage: { input_tokens: 1 } } }),
  ].join('\n') + '\n');
  said('other-22', 4);
  said('mine-2222', 25);
  r = await run(['doctor', '--session', 'mine-2222']);
  ok(/^PROBLEM Memory hooks look stopped: \[other-22\]/m.test(r.stdout), `doctor: another window that stopped saving is said, as the briefing says it (got ${r.stdout})`);
}
// A promoted line goes in before the shared index's archive line, which
// tiering keeps last.
memory(dir, 'late-lesson', 'a lesson learned late');
const sharedIdx = join(shared, 'MEMORY.md');
if (!/\]\(MEMORY-archive\.md\)/.test(readFileSync(sharedIdx, 'utf8'))) writeFileSync(sharedIdx, readFileSync(sharedIdx, 'utf8').replace(/\n*$/, '\n') + '- [Archive](MEMORY-archive.md) — 0 older pointers\n');
r = await cli('promote', 'late-lesson');
ok(r.status === 0 && /late-lesson\.md[^\n]*\n[\s\S]*\]\(MEMORY-archive\.md\)/.test(readFileSync(sharedIdx, 'utf8')), `a promoted line goes in before the archive line (got ${readFileSync(sharedIdx, 'utf8')})`);

// Round 3 (2026-10-27).
{
  // A lesson promoted into a full shared index is archived at the next reply,
  // and no session start prints it: promote says so, and how to keep it.
  const sharedIdx3 = join(shared, 'MEMORY.md');
  writeFileSync(sharedIdx3, readFileSync(sharedIdx3, 'utf8').replace(/\n*$/, '\n') + Array.from({ length: 40 }, (_, i) => `- [Filler ${i}](filler-${i}.md) — ${'f'.repeat(80)}`).join('\n') + '\n');
  writeFileSync(join(dir, 'old-lesson.md'), '---\nname: old-lesson\ndescription: "an old lesson"\nmetadata:\n  type: feedback\n  modified: 2026-01-01\n---\nbody\n');
  const full = await cli('promote', 'old-lesson');
  ok(full.status === 0 && /of its 3000 bytes/.test(full.stdout) && /tier: hot/.test(full.stdout) && !/every project's sessions see its line/.test(full.stdout),
    `promote into a full shared index says the line may be archived, and how to keep it (got ${full.stdout.trim()})`);
  // Auto memory turned off: doctor says so, and judges nothing that needs the hooks.
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  let offDoc; try { offDoc = await cli('doctor'); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
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
  r = await cli('history', 'notes[1]');
  ok(r.status === 0 && (r.stdout.match(/^  [0-9a-f]{4,} \d{4}-/gm) || []).length === 1, `history of notes[1] lists its own change, not notes1's (got ${r.stdout.trim()})`);
  unlinkSync(join(dir, 'notes[1].md'));
  r = await cli('restore', 'notes[1]');
  ok(r.status === 0 && readFileSync(join(dir, 'notes[1].md'), 'utf8').includes('the bracket body'), `a name with [ ] comes back with its own text, not an empty note (got ${r.stdout.trim()})`);
  r = await cli('restore', 'star*');
  ok(r.status === 1 && /^no snapshot of /m.test(r.stdout) && !stack(r) && !(process.platform !== 'win32' && existsSync(join(dir, 'star*.md'))), `a name with * that no snapshot holds: no empty note, no stack trace (got ${r.stdout.trim()} ${r.stderr.trim()})`);
  // Typed in another case: where the disk opens casey.md by that name, the note
  // on disk is moved, and its own line with it; where it does not (Linux), it
  // is no note, and nothing moves.
  memory(dir, 'casey', 'a lesson about case');
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Casey](casey.md) — c\n');
  const caseBlind = existsSync(join(dir, 'CASEY.md'));
  r = await cli('promote', 'CASEY');
  ok(caseBlind ? r.status === 0 && readdirSync(shared).includes('casey.md') && !/\(casey\.md\)/i.test(readFileSync(join(dir, 'MEMORY.md'), 'utf8')) && /\]\(casey\.md\)/.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8'))
    : r.status === 1 && existsSync(join(dir, 'casey.md')) && !existsSync(join(shared, 'casey.md')),
    `promote CASEY moves casey.md under its own name, and its line (got ${r.stdout.trim()})`);
  // A note the disk will not replace (read-only on Windows): said, not thrown.
  memory(dir, 'locked', 'a locked note', 'v1');
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Locked](locked.md) — l\n');
  tier();
  writeFileSync(join(dir, 'locked.md'), 'v2\n');
  chmodSync(join(dir, 'locked.md'), 0o444);
  try { r = await cli('restore', 'locked', '--force'); } finally { chmodSync(join(dir, 'locked.md'), 0o666); }
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
  r = await cli('restore', 'notes[1]', '--rev', first, '--force');
  ok(r.status === 1 && /^no snapshot of /m.test(r.stdout) && readFileSync(join(dir, 'notes[1].md'), 'utf8').includes('the bracket body'),
    `a version without notes[1] is an error, and the note is left as it was (got ${r.stdout.trim()})`);
  if (!folds) {
    // Two notes whose names differ by case: each is itself.
    memory(dir, 'Alpha', 'upper alpha', 'the upper body'); memory(dir, 'alpha', 'lower alpha', 'the lower body');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Upper](Alpha.md) — u\n- [Lower](alpha.md) — l\n');
    tier();
    rmSync(join(dir, 'Alpha.md'));
    writeFileSync(join(dir, 'alpha.md'), 'an edit not yet snapshotted\n');
    r = await cli('restore', 'Alpha');
    ok(r.status === 0 && readFileSync(join(dir, 'Alpha.md'), 'utf8').includes('the upper body') && readFileSync(join(dir, 'alpha.md'), 'utf8') === 'an edit not yet snapshotted\n',
      `on a case-sensitive disk, restore Alpha brings back Alpha.md and leaves alpha.md alone (got ${r.stdout.trim()})`);
  }
  // A short 8.3 name of an index is still an index.
  for (const short of ['MEMORY~1.MD', 'MEMORY~2.MD']) {
    if (!existsSync(join(dir, short))) continue;
    r = await cli('promote', short);
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
    try { r = await cli('restore', 'ro-index'); } finally { chmodSync(join(dir, 'MEMORY.md'), 0o666); }
    ok(!stack(r) && existsSync(join(dir, 'ro-index.md')) && /index line could not be written/.test(r.stdout), `a read-only index: the note is restored and the reply says its line is not (got ${r.stdout.trim()} ${r.stderr.trim().slice(0, 200)})`);
    // The shared index cannot be written: the note is in both stores, and the reply says so.
    memory(dir, 'ro-share', 'a lesson to share');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [RS](ro-share.md) — s\n');
    chmodSync(join(shared, 'MEMORY.md'), 0o444);
    try { r = await cli('promote', 'ro-share'); } finally { chmodSync(join(shared, 'MEMORY.md'), 0o666); }
    ok(!stack(r) && r.status === 1 && /shared index could not be written/.test(r.stdout) && existsSync(join(dir, 'ro-share.md')), `a read-only shared index: said, and the note stays in its project (got ${r.stdout.trim()} ${r.stderr.trim().slice(0, 200)})`);
    rmSync(join(shared, 'ro-share.md'), { force: true });
    // A hand-written line in another case is the note's own: it moves with it.
    memory(dir, 'casey2', 'a second case lesson');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Casey two](Casey2.md) — the hand-written hook\n');
    r = await cli('promote', 'casey2');
    ok(r.status === 0 && !/casey2\.md/i.test(readFileSync(join(dir, 'MEMORY.md'), 'utf8')) && /the hand-written hook/.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8')),
      `a line written (Casey2.md) moves with casey2.md, hook and all (got ${r.stdout.trim()})`);
    // And restore finds a note's line written in another case: no second line.
    memory(dir, 'kase', 'a note with a line in another case');
    writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Kase](Kase.md) — k\n');
    tier();
    rmSync(join(dir, 'kase.md'));
    r = await cli('restore', 'kase');
    ok(r.status === 0 && /its index line is still there/.test(r.stdout) && (readFileSync(join(dir, 'MEMORY.md'), 'utf8').match(/\(kase\.md\)/gi) || []).length === 1, `restore finds the line written (Kase.md) (got ${r.stdout.trim()})`);
  }
  // CRLF as written, whatever git is told elsewhere (Git for Windows: autocrlf).
  spawnSync('git', ['-C', root, 'config', 'core.autocrlf', 'true']);
  writeFileSync(join(dir, 'crlf-kept.md'), '---\r\nname: crlf-kept\r\ndescription: "crlf"\r\nmetadata:\r\n  type: project\r\n---\r\n\r\nline one\r\nline two\r\n');
  utimesSync(join(dir, 'crlf-kept.md'), tenMin, tenMin);
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [CRLF kept](crlf-kept.md) — c\n');
  tier();
  rmSync(join(dir, 'crlf-kept.md'));
  r = await cli('restore', 'crlf-kept');
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
  const run14 = (...a) => run([...a, '--store', at14]);
  if (/C--ext14\/memory\/price\.md/.test(spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).stdout)) {
    unlinkSync(join(out14, 'price.md'));
    const r14 = await run14('restore', 'price');
    ok(r14.status === 0 && existsSync(join(out14, 'price.md')), `a note in a store linked outside the root comes back (got ${r14.stdout}${r14.stderr})`);
  }
  const sh14 = join(root, '.snapshot-health'), was14 = readFileSync(sh14, 'utf8');
  writeFileSync(sh14, JSON.stringify({ lastOk: new Date().toISOString(), failures: 0, missed: ['/x/C--y/memory'] }));
  const d14 = await run14('doctor');
  writeFileSync(sh14, was14);
  ok(d14.status === 1 && /PROBLEM\s+snapshots: ok, last [^\n]*but they leave out \/x\/C--y\/memory: it is reached through a link/.test(d14.stdout), `doctor names a store the snapshots leave out (got ${d14.stdout})`);
}

// Round 6. A huge index (300,000 lines naming no note) takes status a second
// or so: read the folder once a line, it hung past a minute.
if (!quick) {
  const big = join(root, 'C--big16', 'memory'); mkdirSync(big, { recursive: true });
  writeFileSync(join(big, 'MEMORY.md'), Array.from({ length: 300000 }, (_, i) => `- [n](n${i}.md) — h`).join('\n') + '\n');
  const t16 = Date.now(), s16 = spawnSync(process.execPath, [CLI, 'status', '--store', big], { env, encoding: 'utf8', timeout: 25000 });
  ok(s16.status === 0 && Date.now() - t16 < 20000, `status on a 300,000-line index finishes (exit ${s16.status} in ${Date.now() - t16} ms)`);
  rmSync(join(root, 'C--big16'), { recursive: true, force: true });
}
// The folder listed once, not once a line, counted on 50 lines: what the
// 300,000 time, a run under mutate.mjs (--mutant) sees too.
{
  const few = join(root, 'C--few16', 'memory'); mkdirSync(few, { recursive: true });
  writeFileSync(join(few, 'MEMORY.md'), Array.from({ length: 50 }, (_, i) => `- [n](n${i}.md) — h`).join('\n') + '\n');
  const lists = join(home, 'count-lists.mjs');
  writeFileSync(lists, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst list = fs.readdirSync; let n = 0;\n" +
    `fs.readdirSync = (p, ...a) => { if (String(p).endsWith(${JSON.stringify(join('C--few16', 'memory'))})) n++; return list(p, ...a); };\nsyncBuiltinESMExports();\nprocess.on('exit', () => process.stderr.write(String(n)));\n`);
  const s = spawnSync(process.execPath, ['--import', pathToFileURL(lists).href, CLI, 'status', '--store', few], { env, encoding: 'utf8' });
  ok(s.status === 0 && Number(s.stderr) > 0 && Number(s.stderr) < 5, `status lists the store's folder once, not once a line (got ${s.stderr} listings for 50 lines)`);
  rmSync(join(root, 'C--few16'), { recursive: true, force: true });
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
  const run17 = (...a) => run([...a, '--store', join(at17, 'memory')]);
  ok(/links to no memory: cost\.md → \[\[ghost17\]\]/.test((await run17('status')).stdout), 'a link after an inline ``` in prose is read');
  if (/C--p17\/memory\/cost\.md/.test(spawnSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).stdout)) {
    unlinkSync(join(out17, 'memory', 'cost.md'));
    const r17 = await run17('restore', 'cost');
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
    const r20 = await run(['restore', 'rate', '--store', join(root, 'C--b20', 'memory')]);
    ok(r20.status === 0 && /VERSION-TWO/.test(readFileSync(join(out20, 'rate.md'), 'utf8')), `a note restored through a second link is the last snapshot's (got ${r20.stdout}${r20.stderr})`);
  }
  const d21 = join(root, 'C--fence21', 'memory'); mkdirSync(d21, { recursive: true });
  memory(d21, 'fenced', 'fences', '> ```\n> [[ghostq]]\n> ```\n- ```\n  [[ghostl]]\n  ```\n~~~\n[[ghostt]]\n~~~\n```x[[0]]``` is code, see [[ghostp]].\n```\ny = 2\n```\n');
  writeFileSync(join(d21, 'MEMORY.md'), '- [Fenced](fenced.md) — f\n');
  const s21 = (await run(['status', '--store', d21])).stdout;
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
    const r22 = await run(['restore', 'gone', '--store', join(root, 'C--b22', 'memory')]);
    ok(r22.status === 0 && /GONE-V1/.test(readFileSync(join(out22, 'gone.md'), 'utf8')), `a note deleted before a link that sorts first was added comes back (got ${r22.stdout}${r22.stderr})`);
    const h22 = (await run(['history', 'other', '--store', join(root, 'C--b22', 'memory')])).stdout;
    ok((h22.match(/^  [0-9a-f]{7,} \d{4}-/gm) || []).length === 2, `history lists the snapshot that moved a note to a link that sorts first (got ${h22})`);
    // The index the restore gave a line, snapshotted under the first link only.
    tier(); unlinkSync(join(out22, 'MEMORY.md'));
    const m22 = await run(['restore', 'MEMORY', '--store', join(root, 'C--b22', 'memory')]);
    ok(m22.status === 0 && /\(gone\.md\)/.test(readFileSync(join(out22, 'MEMORY.md'), 'utf8')), `a deleted index comes back through the second link as last snapshotted (got ${m22.stdout}${m22.stderr})`);
    // Both links tracked while the index was gone: the week's changes read
    // the kept path alone, or the second's untracking was every note deleted.
    const out24 = join(home, 'Synced24', 'memory'); mkdirSync(out24, { recursive: true });
    memory(out24, 'x24', 'x'); writeFileSync(join(out24, 'MEMORY.md'), '- [X](x24.md) — x\n');
    for (const p of ['C--a24', 'C--b24']) { mkdirSync(join(root, p), { recursive: true }); symlinkSync(out24, join(root, p, 'memory'), process.platform === 'win32' ? 'junction' : 'dir'); }
    tier(); unlinkSync(join(out24, 'MEMORY.md')); tier();
    writeFileSync(join(out24, 'MEMORY.md'), '- [X](x24.md) — x\n'); tier();
    const s24 = (await run(['status', '--store', join(root, 'C--a24', 'memory')])).stdout;
    ok(/last 7 days: added x24/.test(s24), `a note on disk is not listed as deleted after a snapshot without the index (got ${s24})`);
  }
  // A fence never closed hides nothing; a long tilde run is read once.
  const d23 = join(root, 'C--fence23', 'memory'); mkdirSync(d23, { recursive: true });
  memory(d23, 'four', 'fences', '````md\n```js\nx\n```\n[[ghostf]]\n````\nsee [[ghosto]]\n```\n[[ghostu]]\n');
  memory(d23, 'tilde', 'tildes', '~'.repeat(120000) + '`\n' + '~~~\r'.repeat(50000));
  writeFileSync(join(d23, 'MEMORY.md'), '- [Four](four.md) — f\n- [Tilde](tilde.md) — t\n');
  const t23 = Date.now();
  const s23 = (await run(['status', '--store', d23])).stdout;
  ok(/four\.md → \[\[ghosto\]\]/.test(s23) && /four\.md → \[\[ghostu\]\]/.test(s23) && !/ghostf/.test(s23), `a \`\`\`\` fence holding a \`\`\` one hides its links, one never closed hides none (got ${s23})`);
  ok(quick || Date.now() - t23 < 3000, `a long run of tildes does not slow status down (${Date.now() - t23} ms)`);
  // The shared store has its own index: this one's, deleted, was not promoted.
  tier();
  const h23 = await run(['history', 'MEMORY', '--store', d23]);
  ok(h23.status === 0 && !/promoted/.test(h23.stdout), `history does not call an index promoted (got ${h23.stdout}${h23.stderr})`);
  unlinkSync(join(d23, 'MEMORY.md'));
  const m23 = await run(['restore', 'MEMORY', '--store', d23]);
  ok(existsSync(join(shared, 'MEMORY.md')) && m23.status === 0 && existsSync(join(d23, 'MEMORY.md')), `a deleted index comes back while the shared store has one (got ${m23.stdout}${m23.stderr})`);
}

// The journal, searched: Claude asks in the user's words for past work, by
// what was asked, or by the days it was done.
{
  const { render } = await import('./journal.mjs');
  const jd = join(root, 'C--jr', 'memory'), other = join(root, 'C--jr2', 'memory');
  const jcli = (...a) => run([...a, '--store', jd]);
  let n = 0;
  const entry = (at, asked, over = {}) => ({ key: `k${n++}`, at, s: 'c0ffee12', t: 'C--jr/c0ffee12-full', branch: 'main', asked, answered: 'done', changed: [], ran: [], ...over });
  const day = (store, d, es) => { mkdirSync(join(store, 'journal'), { recursive: true }); writeFileSync(join(store, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`); };
  day(jd, '2026-10-01', [entry('2026-10-01 10:00', 'deploy on the first')]);
  day(jd, '2026-10-02', [entry('2026-10-02 10:00', 'tidy the scripts', { changed: ['memory-tier.mjs'], ran: ['node bench.mjs --runs 5'] })]);
  // Written unredacted, as a hand edit or an entry from before a redaction rule could be.
  const key = ['sk', 'live', '51Habcdefghijklmnopqrstuv'].join('_') + 'WX';
  const pasted = entry('2026-10-03 10:00', `paste the token ${key} into the config`, { answered: `stored ${key} as the config token` });
  day(jd, '2026-10-03', [pasted]);
  // One long request asked on three days, in other cases and spacing, and one like it.
  const feed = 'feed the wombat its evening meal of carrots and hay, then refill the water bowl in the back pen';
  const w1 = entry('2026-10-04 10:00', feed.replace('feed the wombat', 'Feed the  Wombat')), w2 = entry('2026-10-05 10:00', feed), w3 = entry('2026-10-06 10:00', feed);
  day(jd, '2026-10-04', [w1]);
  day(jd, '2026-10-05', [w2]);
  day(jd, '2026-10-06', [entry('2026-10-06 09:00', 'wombat feed schedule'), w3]);
  // Short requests are different work each time; a short one retried shows each copy, with its key.
  day(jd, '2026-10-09', [entry('2026-10-09 09:00', 'continue', { answered: 'moved the kestrel cage to the barn' }), entry('2026-10-09 10:00', 'continue', { answered: 'the kestrel flew off' }),
    entry('2026-10-09 11:00', 'here is the zorbix login, use it', { answered: 'logged in' }), entry('2026-10-09 11:01', 'here is the zorbix login, use it', { answered: 'logged in again' })]);
  // A branch says less than a command: one named in each must not outrank it.
  day(jd, '2026-10-10', [entry('2026-10-10 09:00', 'tidy the docs', { ran: ['npm run ocelot'] }), entry('2026-10-10 10:00', 'tidy the tests', { branch: 'ocelot-v2' })]);
  // A secret in a header and one a stretch would cut in two, in a hand-edited day.
  const tagKey = ['sk', 'live', 'tagtagtagtagtagtagtagtag'].join('_'), brKey = ['sk', 'live', 'branchbranchbranchbranch'].join('_'), cutKey = ['sk', 'live', 'cutcutcutcutcutcutcutcut01'].join('_');
  day(jd, '2026-10-11', [entry('2026-10-11 09:00', 'stow the narwhal', { s: tagKey, branch: `feat-${brKey}`, answered: `${cutKey} ${'y'.repeat(60)} narwhal stowed` })]);
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

  let r = await jcli('search', 'deploy', 'error');
  ok(r.status === 0 && new RegExp(`^ *\\d+  journal   2026-10-15 14:30  conversation c0ffee12 · branch main\\n     key: ${fix.key}\\n     Asked: fix the deploy error\\n`).test(r.stdout),
    `search finds a journal entry by its request: first, labelled journal, with its date and key (got ${r.stdout})`);
  ok(/^ *\d+ +\w+ +\d{4}-\d\d-\d\d +.*[\\/]deploy\.md$/m.test(r.stdout) && /^ *\d+  journal   2026-10-15 09:00 /m.test(r.stdout), `a note and an entry rank together (got ${r.stdout})`);
  // A hit is its request, cut, and of the rest only what holds a search word.
  const blocks = (out) => out.split(/\n(?= *\d+  )/), of = (out, asked) => blocks(out).find((b) => b.includes(`\n     Asked: ${asked}`)) ?? '';
  ok(!/Answered/.test(of(r.stdout, 'fix the deploy error')) && /^     Answered: the deploy error, the deploy error again, and the deploy error once more$/m.test(of(r.stdout, 'tidy the readme')),
    `a reply is printed only when it holds a search word (got ${r.stdout})`);
  // Every hit says what came of it: the reply's first sentence, unless its stretch already starts there.
  ok(/^     Asked: fix the deploy error\n     Result: done$/m.test(of(r.stdout, 'fix the deploy error')) && !/Result:/.test(of(r.stdout, 'tidy the readme')),
    `a hit leads with its reply's start, not twice (got ${r.stdout})`);
  day(jd, '2026-10-12', [entry('2026-10-12 09:00', 'tune the tapir cache', { answered: 'Done. The cache now holds a day of pages, measured twice. Then the tapir rest, which a hit leaves out.' }),
    entry('2026-10-12 10:00', 'size the tapir pool', { answered: `the pool ${'grows and shrinks '.repeat(12)}and settles` }),
    // The word at exactly HIT_SPAN (30): its stretch starts at the reply's start, so no Result.
    entry('2026-10-12 11:00', 'count the tapir herd', { answered: `${'ab '.repeat(10)}tapir herd counted at noon, nine of them.` })]);
  r = await jcli('search', 'tapir');
  rmSync(join(jd, 'journal', '2026-10-12.md'));   // a day no other check uses
  const lead = (asked) => of(r.stdout, asked).match(/^     Result: (.*)$/m)?.[1];
  ok(lead('tune the tapir cache') === 'Done. The cache now holds a day of pages, measured twice.' && lead('size the tapir pool')?.length <= 140 && lead('size the tapir pool').length > 120 && lead('size the tapir pool').endsWith('…'),
    `a Result is the first sentence of 20 characters or more, else the reply cut at a word's end by 140 (got ${r.stdout})`);
  ok(lead('count the tapir herd') === undefined && /^     Answered: ab ab/m.test(of(r.stdout, 'count the tapir herd')), `a word 30 characters in: the stretch starts the reply, no Result (got ${r.stdout})`);
  // A Result is redacted before it is cut: a day an older version wrote keeps a
  // secret, and the 140 cut lands inside it here.
  const sk = ['sk', 'live', '51Habcdefghijklmnopqrstuv'].join('_') + 'WX';
  day(jd, '2026-10-14', [entry('2026-10-14 09:00', 'rotate the dugong key', { answered: `Stored ${sk} as the new deploy key of the dugong, then restarted.` }),
    entry('2026-10-14 10:00', 'rotate the dugong cert', { answered: `${'ab '.repeat(40)}then ${sk} went in for the dugong.` })]);
  r = await jcli('search', 'dugong');
  ok(lead('rotate the dugong key') === 'Stored [redacted] as the new deploy key of the dugong, then restarted.' &&/^ab ab .*\[redacted\]/.test(lead('rotate the dugong cert') ?? '') && !r.stdout.includes(sk.slice(8, 20)),
    `a Result shows no part of a secret (got ${r.stdout})`);
  // Nor is a hit, a day's listing or show ever an entry forget listed: one whose
  // day would not be written still holds it, until forget runs again.
  const fgList = join(jd, 'journal', '.forgotten'), fgHad = existsSync(fgList) ? readFileSync(fgList, 'utf8') : '';
  const fg = entry('2026-10-14 11:00', 'feed the ibex herd', { answered: 'The ibex herd was fed twice.' });
  day(jd, '2026-10-14', [fg, entry('2026-10-14 12:00', 'count the ibex herd')]);
  writeFileSync(fgList, `${fgHad}${fg.key}\tC--jr/c0ffee12-full\t2026-10-14 11:00\n`);
  r = await jcli('search', 'ibex');
  const fgShow = (await jcli('show', fg.key)).stdout, fgDay = (await jcli('search', '--since', '2026-10-14', '--until', '2026-10-14')).stdout;
  // A list that won't read could name any entry: none of that store's is shown, and the list is named.
  rmSync(fgList); mkdirSync(fgList);
  const shut = (await jcli('search', 'ibex')).stdout, shutShow = (await jcli('show', fg.key)).stdout;
  rmSync(fgList, { recursive: true });
  if (fgHad) writeFileSync(fgList, fgHad);
  rmSync(join(jd, 'journal', '2026-10-14.md'));   // a day no other check uses
  ok(/^     Asked: count the ibex herd$/m.test(r.stdout) && !/feed the ibex|fed twice/.test(r.stdout + fgShow + fgDay) && /^no journal entry has the key /m.test(fgShow) && /count the ibex herd/.test(fgDay),
    `an entry forget listed is no hit, no line of its day, and show has none (got ${r.stdout}${fgShow}${fgDay})`);
  ok(!/ibex herd|fed twice/.test(shut + shutShow) && /^could not read .*[\\/]journal[\\/]\.forgotten: E[A-Z]+$/m.test(shut) && /^could not read .*[\\/]journal[\\/]\.forgotten: E[A-Z]+$/m.test(shutShow),
    `with the list of forgotten keys unreadable, the journal shows nothing and says why (got ${shut}${shutShow})`);
  r = await jcli('search', 'zeppelin');
  const z = blocks(r.stdout)[0].replace(/\n\d+ of \d+ match\(es\) in .*\n$/, ''), zask = z.match(/^     Asked: (.*)$/m)?.[1] ?? '';
  ok(z.length < 800 && zask.length <= 200 && zask.length > 180 && zask.startsWith('zeppelin plan') && /^     Answered: …[^\n]*zeppelin[^\n]*…$/m.test(z) && /^     Changed: [^\n]*zeppelin/m.test(z) && /^     Ran: [^\n]*zeppelin/m.test(z),
    `an entry at every cap: a headline, its request cut by 200 at a word's end, its result, the rest the stretches around the word, under 800 characters in all (got ${z.length}: ${z})`);
  // A stretch never starts or ends on half an emoji, nor does the cap cut one:
  // printed, half of one is U+FFFD. Each of the three cuts lands mid-emoji here.
  const em = (n) => '\u{1F600}'.repeat(n);
  day(jd, '2026-10-13', [entry('2026-10-13 09:00', 'feed the quetzal', { answered: `${em(60)} quetzal ${em(60)}` }),
    entry('2026-10-13 10:00', 'weigh the quetzal', { answered: `quetzal ${em(20)}`.repeat(30) })]);
  r = await jcli('search', 'quetzal');
  rmSync(join(jd, 'journal', '2026-10-13.md'));   // a day no other check uses
  ok(r.status === 0 && (r.stdout.match(/^     Answered: /gm) ?? []).length === 2 && !r.stdout.includes('�'), `a stretch of a hit never cuts an emoji in half (got ${r.stdout})`);
  // show: the whole entry, by the key its hit printed, and its day file.
  const zkey = z.match(/^     key: (.*)$/m)?.[1];
  r = await jcli('show', zkey);
  ok(zkey === huge.key && r.status === 0 && r.stdout.includes(`\n     Asked: ${huge.asked}\n     Answered: ${huge.answered}\n     Changed: ${huge.changed.join(', ')}\n     Ran: ${huge.ran.join(' · ')}\n`) &&
    r.stdout.includes(`\n     Day file: ${join(jd, 'journal', '2026-10-07.md')}`), `show prints an entry whole, by the key search printed, with its day file (got ${r.stdout})`);
  r = await jcli('show', fix.key, pasted.key);
  ok(r.status === 0 && /^     Asked: fix the deploy error$/m.test(r.stdout) && /^     Answered: stored \[redacted\] as the config token$/m.test(r.stdout) && !r.stdout.includes(key), `show takes several keys, and redacts (got ${r.stdout})`);
  r = await jcli('show', 'no-such-key');
  ok(r.status === 1 && /^no journal entry has the key no-such-key in .+; --all looks in every project$/m.test(r.stdout), `a key that is no entry's says so, and fails (got ${r.stdout})`);
  // One long request asked again and again is one hit, with its count, days and the copies' keys.
  r = await jcli('search', 'wombat', 'feed');
  ok((r.stdout.match(/^     Asked: feed the wombat its evening/gim) || []).length === 1 && r.stdout.includes(`\n     2 more like this, 2026-10-04..2026-10-06: ${w2.key}, ${w1.key}; --same takes them all\n`) &&
    /^     Asked: wombat feed schedule$/m.test(r.stdout) && /^2 of 2 match\(es\)/m.test(r.stdout),
    `identical long requests, in any case and spacing, print once with how many more, their days and keys (got ${r.stdout})`);
  r = await jcli('search', 'wombat', 'feed', '--limit', '1');
  ok(/^     2 more like this/m.test(r.stdout) && !/schedule/.test(r.stdout) && /^1 of 2 match\(es\) in .+; --limit N shows more/m.test(r.stdout), `--limit counts the requests, not their repeats (got ${r.stdout})`);
  // --same: show and forget take every copy of a request by one key.
  r = await jcli('show', w3.key, '--same');
  ok(r.status === 0 && [w1, w2, w3].every((w) => r.stdout.includes(`\n     key: ${w.key}\n`)) && !/schedule/.test(r.stdout), `show --same prints every entry that asked the same (got ${r.stdout})`);
  ok(((await jcli('show', w3.key)).stdout.match(/^     key: /gm) || []).length === 1, 'show without --same prints the one entry');
  r = await jcli('forget', '--key', w3.key, '--same');
  ok([w1, w2, w3].every((w) => r.stdout.includes(`(key ${w.key})\n`)) && /^3 entries in .+ would go/m.test(r.stdout), `forget --key --same takes every copy (got ${r.stdout})`);
  // A short request ("continue", a short paste retried) is never collapsed: each copy and its key is shown.
  r = await jcli('search', 'kestrel');
  ok((r.stdout.match(/^     Asked: continue$/gm) || []).length === 2 && !/more like this/.test(r.stdout), `two short requests with different work stay two hits (got ${r.stdout})`);
  r = await jcli('search', 'zorbix');
  ok((r.stdout.match(/^     key: /gm) || []).length === 2 && !/more like this/.test(r.stdout), `a short request retried shows both copies and both keys (got ${r.stdout})`);
  // A word only the branch names ranks below one a command names.
  r = await jcli('search', 'ocelot');
  ok(r.stdout.indexOf('Asked: tidy the docs') !== -1 && r.stdout.indexOf('Asked: tidy the docs') < r.stdout.indexOf('Asked: tidy the tests'), `a branch weighs less than a command (got ${r.stdout})`);
  // Header fields and stretches are redacted, and a stretch is cut from the redacted text.
  r = await jcli('search', 'narwhal');
  ok(/conversation \[redacted\] · branch feat-\[redacted\]$/m.test(r.stdout) && !r.stdout.includes(tagKey) && !r.stdout.includes(brKey) && !r.stdout.includes(cutKey.slice(16)),
    `a secret in a tag, a branch or under a stretch's cut is never printed (got ${r.stdout})`);
  // Matches farther apart than two windows (here 121 characters) are separate
  // stretches; ones whose windows touch merge (the zeta check below).
  ok(/^     Answered: …[^\n]*zeppelin[^\n]* … /m.test(z), `distant matches are separate stretches (got ${z})`);
  ok(!/[\\/]journal\.md$/m.test((await jcli('search', 'every', 'exchange')).stdout), "journal.md is the journal's pointer, not a search hit");
  ok(/^     Asked: tidy the scripts$/m.test((await jcli('search', 'memory-tier.mjs')).stdout) && /^     Asked: tidy the scripts$/m.test((await jcli('search', 'bench')).stdout),
    'an entry is found by a file it changed, and by a command it ran, alone');
  r = await jcli('search', 'CI', '--since', '2026-10-08', '--until', '2026-10-08');
  ok(/^     Asked: set up CI on GitHub Actions$/m.test(r.stdout) && !/decision/.test(r.stdout), `a two-letter word is searched, as a word of its own (got ${r.stdout})`);
  ok(/^     Asked: tidy the imports$/m.test((await jcli('search', 'payments')).stdout), 'an entry is found by its branch');
  r = await jcli('search', 'token', 'config');
  ok(/^     Asked: paste the token \[redacted\] into the config$/m.test(r.stdout) && /^     Answered: stored \[redacted\] as the config token$/m.test(r.stdout) && !r.stdout.includes(key), `a hit is redacted, its reply too (got ${r.stdout})`);
  r = await jcli('search', 'zzzqqq', '--since', '2026-10-10', '--until', '2026-10-20');
  ok(/^nothing matches "zzzqqq" in .+ since 2026-10-10 until 2026-10-20; --all searches every project$/m.test(r.stdout), `a ranged miss names its range (got ${r.stdout})`);
  // A note's day is its modified: date; both bounds are inclusive for notes too.
  for (const [name, at] of [['quokka-before', '2026-10-09'], ['quokka-since', '2026-10-10'], ['quokka-until', '2026-10-20'], ['quokka-after', '2026-10-21']]) memory(jd, name, 'a quokka note', 'body', `  modified: ${at}\n`);
  r = await jcli('search', 'quokka', '--since', '2026-10-10', '--until', '2026-10-20');
  const quokkas = [...r.stdout.matchAll(/[\\/](quokka-\w+)\.md$/gm)].map((m) => m[1]).sort().join();
  ok(quokkas === 'quokka-since,quokka-until', `a note dated on either bound is found, one a day outside is not (got ${quokkas})`);
  // A note's date is its last change: one written in the range and edited since is out of it, and said.
  const outside = (k) => `${k} notes match outside the range (a note's date is its last change); search without --since/--until`;
  ok(r.stdout.includes(`\n${outside(2)}\n`) && /^2 of 2 match\(es\)/m.test(r.stdout.trim().split('\n').pop()), `a ranged search says how many notes match outside it, before the count (got ${r.stdout})`);
  r = await jcli('search', 'quokka', '--since', '2026-11-01');
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
  for (const how of [['deploy'], ['--key', 'k-any']]) {
    r = spawnSync(process.execPath, [join(nj, 'memory.mjs'), 'forget', ...how, '--store', jd], { env, encoding: 'utf8' });
    ok(r.status === 1 && /^could not read journal\.mjs: /m.test(r.stdout) && !r.stderr, `nor can forget: it says so, and fails (${how.join(' ')}: got ${r.stdout}${r.stderr})`);
  }
  r = await jcli('search', 'deploy', 'error', '--since=2026-10-10', '--until', '2026-10-20');
  const dates = [...r.stdout.matchAll(/^ *\d+  journal   (\d{4}-\d\d-\d\d)/gm)].map((m) => m[1]);
  ok(r.status === 0 && dates.join() === '2026-10-15,2026-10-15' && !/deploy\.md$/m.test(r.stdout), `--since/--until narrow by day, notes by their date too (got ${r.stdout})`);
  r = await jcli('search', '--since', '2026-10-21', '--until', '2026-10-27');
  const asked = [...r.stdout.matchAll(/^\d{4}-\d\d-\d\d \d\d:\d\d  conversation c0ffee12 · branch main  (.*)$/gm)].map((m) => m[1]);
  ok(r.status === 0 && asked.join('|') === 'write the changelog|review the pull request|plan the release', `a date range alone lists the work of those days, newest first (got ${r.stdout})`);
  // Words that say nothing of which memory ("what did I do") with a range: the range alone.
  ok((await jcli('search', 'what', 'did', 'I', 'do', '--since', '2026-10-21', '--until', '2026-10-27')).stdout === r.stdout, 'stop words with a range list the range');
  r = await jcli('search', 'deploy', '--since', 'yesterday');
  const r2 = await jcli('search', 'deploy', '--until=2026-10');
  ok(r.status === 1 && r.stdout.trim() === '--since takes a date like 2026-10-01' && r2.status === 1 && r2.stdout.trim() === '--until takes a date like 2026-10-01', `a bad date is refused (got ${r.stdout}${r2.stdout})`);
  // The transcript is show's to name; a hit is a headline, and says how to get the rest.
  const conv = join(root, 'C--jr', 'c0ffee12-full.jsonl'), named = async () => /^     Full conversation: .*[\\/]C--jr[\\/]c0ffee12-full\.jsonl$/m.test((await jcli('show', fix.key)).stdout);
  writeFileSync(conv, '{}\n');
  const was = await named(), hit = (await jcli('search', 'fix', 'deploy', 'error')).stdout; unlinkSync(conv);
  ok(was && !await named(), 'show names the full conversation while it exists');
  ok(!/Full conversation/.test(hit) && /; show '<key>' prints an entry whole$/m.test(hit), `a hit names no transcript, and its last line points at show (got ${hit})`);
  ok(!/show '<key>'/.test((await jcli('search', 'how', 'we', 'ship')).stdout), 'a search with no journal hit does not point at show');
  // A private turn's only detail is the private part, which its transcript
  // still holds: neither a hit nor show points at it (final review, 2026-10-29).
  const pin = entry('2026-09-30 10:00', 'my quokka pin is [private]', { answered: '[private]' }), pinDay = join(jd, 'journal', '2026-09-30.md');
  day(jd, '2026-09-30', [pin]); writeFileSync(conv, '{}\n');
  const pinHit = (await jcli('search', 'quokka', 'pin')).stdout, pinShow = (await jcli('show', pin.key)).stdout;
  unlinkSync(conv); rmSync(pinDay);
  ok(/^     Asked: my quokka pin is \[private\]$/m.test(pinHit) && /^     Day file: /m.test(pinShow) && !/Full conversation/.test(pinHit + pinShow),
    `a private entry's hit and show name no transcript (got ${pinHit}${pinShow})`);
  mkdirSync(other, { recursive: true }); writeFileSync(join(other, 'MEMORY.md'), '# Index\n');
  const rot = entry('2026-10-20 10:00', 'rotate the signing key', { t: 'C--jr2/feed' });
  day(other, '2026-10-20', [rot]);
  // show reaches another project's entry with --all, or with that project's --store.
  r = await run(['show', rot.key, '--store', other]);
  ok((await jcli('show', rot.key)).status === 1 && /^2026-10-20 10:00  conversation c0ffee12 · branch main · project C--jr2$/m.test((await jcli('show', rot.key, '--all')).stdout) && /^     Asked: rotate the signing key$/m.test(r.stdout),
    `show finds another project's entry under --all or its --store (got ${r.stdout})`);
  r = await jcli('search', 'rotate', 'signing', '--all');
  ok(!/signing key/.test((await jcli('search', 'rotate', 'signing')).stdout) && /^     Asked: rotate the signing key$/m.test(r.stdout) && /^ *\d+  journal   2026-10-20 10:00  conversation c0ffee12 · branch main · project C--jr2$/m.test(r.stdout),
    `--all searches every project's journal, and a hit names its project (got ${r.stdout})`);
  // A project whose only memory is its journal has no MEMORY.md: --all passed
  // it over. Reached by a second link too, it is searched once.
  const lone = join(root, 'C--jr3', 'memory');
  day(lone, '2026-10-21', [entry('2026-10-21 10:00', 'calibrate the lone telescope', { t: 'C--jr3/beef' })]);
  mkdirSync(join(root, 'C--jr3-link'), { recursive: true });
  symlinkSync(lone, join(root, 'C--jr3-link', 'memory'), process.platform === 'win32' ? 'junction' : 'dir');
  r = await jcli('search', 'lone', 'telescope', '--all');
  ok(/^     Asked: calibrate the lone telescope$/m.test(r.stdout) && /^1 of 1 match\(es\)/m.test(r.stdout), `--all searches a journal with no MEMORY.md beside it, once (got ${r.stdout})`);
  r = await jcli('search', '--since', '2026-10-20', '--until', '2026-10-21', '--all');
  ok(/^2026-10-21 10:00  conversation c0ffee12 · branch main · project C--jr3  calibrate the lone telescope$/m.test(r.stdout) && /· project C--jr2  rotate the signing key$/m.test(r.stdout),
    `a date range under --all names each entry's project (got ${r.stdout})`);

  // A year of journal, ~30 MB: one entry rendered once, each day written in one
  // call. Under --mutant the same 5,111 entries, short (an ask still long
  // enough to collapse): ~3 MB.
  const big = join(root, 'C--big', 'memory'), bcli = (...a) => run([...a, '--store', big]);
  const tpl = render(entry('2025-01-01 12:00', 'plan the lorem rollout '.repeat(quick ? 4 : 90).slice(0, 2000), { answered: 'the lorem build passed '.repeat(quick ? 1 : 131).slice(0, 3000),
    changed: Array.from({ length: quick ? 1 : 20 }, (_, i) => `src/lorem/module${i}.mjs`), ran: Array.from({ length: quick ? 1 : 10 }, (_, i) => `npm run build -- --filter lorem${i}`) }));
  const year = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10)), last = year.at(-1);
  mkdirSync(join(big, 'journal'), { recursive: true });
  for (const d of year) writeFileSync(join(big, 'journal', `${d}.md`), `# Journal ${d}\n\n${[...Array(14).fill(tpl.replaceAll('2025-01-01', d)),
    ...(d === last ? [render(entry(`${d} 18:00`, 'find the needle: the lorem rollout plan, its module filter, and the build passed'))] : [])].join('\n\n')}\n`);
  // Eight terms read each day once, counted: read once a term took 5.4 s where
  // 1.0 s was usual, and beside other suites the right search took 5.3 s too.
  const reads = join(home, 'count-reads.mjs');
  writeFileSync(reads, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst read = fs.readFileSync; let n = 0;\n" +
    `fs.readFileSync = (p, ...a) => { if (String(p).includes(${JSON.stringify(join('C--big', 'memory', 'journal'))}) && String(p).endsWith('.md')) n++; return read(p, ...a); };\nsyncBuiltinESMExports();\nprocess.on('exit', () => process.stderr.write(\`\${n} day reads\`));\n`);
  r = spawnSync(process.execPath, ['--import', pathToFileURL(reads).href, CLI, 'search', 'needle', 'lorem', 'rollout', 'build', 'passed', 'plan', 'module', 'filter', '--store', big], { env, encoding: 'utf8' });
  ok(r.stderr === '365 day reads', `eight terms read each of a year's days once (got ${r.stderr})`);
  ok(r.status === 0 && new RegExp(`^ *\\d+  journal   ${last} 18:00 `).test(r.stdout), `the one entry asking for every term is first (got ${r.stdout.slice(0, 200)})`);
  ok(/^     5109 more like this, 2025-01-01\.\.2025-12-31: (k\d+, ){5}and 5104 more; --same takes them all$/m.test(r.stdout) && /^2 of 2 match\(es\)/m.test(r.stdout) && r.stdout.length < 4000,
    `a request asked 5,110 times is one hit, and the output stays small (got ${r.stdout.length} chars: ${r.stdout.slice(-400)})`);
  r = await bcli('search', '--since', year[0]);
  ok((r.stdout.match(/^\d{4}-\d\d-\d\d \d\d:\d\d  conversation /gm) || []).length === 30 && /^30 of 5111 journal entries in .+; --limit N shows more$/m.test(r.stdout),
    `a date range alone lists 30 by default, and says how many it left out (got ${r.stdout.split('\n').length} lines, ending ${r.stdout.trim().split('\n').pop()})`);
  rmSync(join(big, 'journal', `${year[0]}.md`)); mkdirSync(join(big, 'journal', `${year[0]}.md`));
  r = await bcli('search', 'needle');
  ok(r.status === 0 && new RegExp(`journal   ${last} 18:00`).test(r.stdout) && new RegExp(`^could not read .*[\\\\/]${year[0]}\\.md: \\w+$`, 'm').test(r.stdout) && /^1 of 1 match\(es\)/.test(r.stdout.trim().split('\n').pop()),
    `a day that cannot be read is named, the rest still found, and the count is still the last line (got ${r.stdout.slice(-300)})`);
  r = await bcli('search', 'needle', '--since', year.at(-7));
  ok(r.status === 0 && !r.stderr && new RegExp(`journal   ${last} 18:00`).test(r.stdout) && !/could not read/.test(r.stdout), `with --since the last week, a day outside it is never opened (got ${r.stdout}${r.stderr})`);
  // A day saved as UTF-16 (PowerShell 5.1's Out-File) read as a day with no
  // entry, named by neither: search and status name it, and status the
  // unreadable day too (final review, 2026-10-29).
  writeFileSync(join(big, 'journal', '2024-12-31.md'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`# Journal 2024-12-31\n\n${render(entry('2024-12-31 18:00', 'the needle in a wide day'))}\n`, 'utf16le')]));
  r = await bcli('search', 'needle');
  const st = (await bcli('status')).stdout, wide = String.raw`^%s.*[\\/]2024-12-31\.md: not UTF-8$`;
  ok(new RegExp(wide.replace('%s', 'could not read '), 'm').test(r.stdout) && new RegExp(wide.replace('%s', '  journal: could not read '), 'm').test(st) &&
    new RegExp(`^  journal: could not read .*[\\\\/]${year[0]}\\.md: \\w+$`, 'm').test(st), `a day not in UTF-8 is named by search and status (got ${r.stdout.slice(-300)}; ${st})`);
}

// forget: the user's say over the journal. Claude lists what would go, the
// user confirms, and only --yes removes it.
{
  const { render } = await import('./journal.mjs'), { local } = await import('./store.mjs');
  const fd = join(root, 'C--fg', 'memory'), fj = join(fd, 'journal'), today = local().slice(0, 10);
  const fcli = (...a) => run([...a, '--store', fd]);
  const cc = `Claude Code still keeps these exchanges in its own conversation files (the .jsonl files in ${root}): forget does not change them\n`;
  let n = 0;
  const entry = (at, asked, s = 'aaaa1111') => ({ key: `f${n++}`, at, s, t: `C--fg/${s}`, branch: '', asked, answered: 'done', changed: [], ran: [] });
  const es = [entry('2025-10-20 09:00', 'the zebra eats mango'), entry('2025-10-20 10:00', 'the zebra policy'), entry('2025-10-21 09:00', 'mango, the zebra again'),
    entry(`${today} 09:00`, 'a zebra in another conversation', 'bbbb2222'), entry(`${today} 10:00`, 'unrelated', 'bbbb2222')], lateTurn = entry(`${today} 11:00`, 'a late turn', 'bbbb2222');
  const page = (d, xs) => `# Journal ${d}\n\n${xs.map(render).join('\n\n')}\n`;
  const want = { '2025-10-20': page('2025-10-20', es.slice(0, 2)), '2025-10-21': page('2025-10-21', es.slice(2, 3)), [today]: page(today, es.slice(3)) };
  const reset = () => { rmSync(fj, { recursive: true, force: true }); mkdirSync(fj, { recursive: true }); for (const [d, t] of Object.entries(want)) writeFileSync(join(fj, `${d}.md`), t); };
  // aaaa1111's transcript is on disk, bbbb2222's is gone: only a key that could come back is listed.
  mkdirSync(fj, { recursive: true }); writeFileSync(join(root, 'C--fg', 'aaaa1111.jsonl'), '');
  const listing = (xs) => xs.filter((e) => e.s === 'aaaa1111').map((e) => `${e.key}\t${e.t}\t${e.at}`).sort().join();
  const file = (d) => readFileSync(join(fj, `${d}.md`), 'utf8'), gone = (d) => !existsSync(join(fj, `${d}.md`)), kept = (...ds) => ds.every((d) => file(d) === want[d]);

  reset();
  // A look's line ends with the entry's key: the look is how the user's entries are found.
  const fl = (e) => `${e.at}  conversation ${e.s}  ${e.asked}  (key ${e.key})\n`, zm = fl(es[0]) + fl(es[2]);
  let r = await fcli('forget', 'Zebra', 'mango');
  ok(r.status === 0 && kept('2025-10-20', '2025-10-21', today) && r.stdout === `${zm}2 entries in ${fd} would go; run again with --yes to remove them\n`, `forget lists and keeps without --yes, and names the store (got ${r.stdout}${r.stderr})`);
  r = await fcli('forget', 'Zebra', 'mango', '--yes');
  ok(r.status === 0 && file('2025-10-20') === page('2025-10-20', [es[1]]) && gone('2025-10-21') && kept(today),
    `forget --yes removes only the matches, the rest byte for byte (got ${r.stdout}${r.stderr})`);
  ok(r.stdout.startsWith(zm) && r.stdout.endsWith(`\nremoved 2 from ${fd}\n`) && /^the snapshots still hold the journal of 2025-10-20, 2025-10-21: deleting .*[\\/]\.git removes /m.test(r.stdout),
    `and lists what went, says the snapshots still hold the days before today, and ends with the count (got ${r.stdout})`);
  // And that Claude Code's own conversation files still hold them, as PRIVACY.md says: unsaid, it read as gone everywhere (audit C-6).
  ok(r.stdout.endsWith(`\n${cc}removed 2 from ${fd}\n`), `forget --yes says Claude Code's conversation files still hold what it removed (got ${r.stdout})`);
  reset();
  // A blank word is in every entry: taken as a filter, it removed the whole journal.
  const refused = 'forget needs words, a date range, --conversation or --key; to forget the whole journal, use --since 1970-01-01 --yes (deleting the journal folder rebuilds it from the conversations still on disk)';
  for (const blank of [[], [''], ['   ']]) {
    r = await fcli('forget', ...blank, '--yes');
    ok(r.status === 1 && r.stdout.trim() === refused && kept('2025-10-20', '2025-10-21', today), `forget with nothing to match is refused, a blank word too (${JSON.stringify(blank)}: got ${r.stdout}${r.stderr})`);
  }
  const bb = fl(es[3]) + fl(es[4]);
  r = await fcli('forget', '--conversation=bbbb2222');
  ok(r.stdout === `${bb}2 entries in ${fd} would go; run again with --yes to remove them\n`, `--conversation=TAG lists that conversation (got ${r.stdout}${r.stderr})`);
  ok((await fcli('forget', '--conversation', 'bbbb2222-0000-4000-8000-00000000abcd')).stdout === r.stdout, 'the full session id is that conversation too');
  // The entries a search showed, by their keys, and nothing else.
  r = await fcli('forget', '--key', es[0].key, `--key=${es[3].key}`);
  ok(r.stdout === `${fl(es[0])}${fl(es[3])}2 entries in ${fd} would go; run again with --yes to remove them\n`,
    `--key lists the entries with those keys (got ${r.stdout}${r.stderr})`);
  r = await fcli('forget', 'zebra', '--key', es[0].key, '--key', es[4].key, '--yes');
  ok(r.status === 0 && file('2025-10-20') === page('2025-10-20', [es[1]]) && kept('2025-10-21', today) && r.stdout.endsWith(`\nremoved 1 from ${fd}\n`),
    `forget --key --yes removes exactly those that also hold the words (got ${r.stdout}${r.stderr})`);
  reset();
  // A key no entry here has (another project's) is named and fails the forget; the rest still go.
  const lost = `no entry in ${fd} has the key k-elsewhere; is it another project's? use --store with its memory folder\n`;
  r = await fcli('forget', '--key', 'k-elsewhere', '--key', es[0].key, '--yes');
  ok(r.status === 1 && r.stdout.endsWith(`${lost}removed 1 from ${fd}\n`) && file('2025-10-20') === page('2025-10-20', [es[1]]), `a key this store has no entry for is named, and fails the forget (got ${r.stdout})`);
  reset();
  // And the words are not blamed when the key left them nothing to match.
  r = await fcli('forget', 'zebra', '--key', 'k-elsewhere');
  ok(r.status === 1 && r.stdout === `${lost}nothing in ${fd} matches\n`, `a key of another store is why nothing matched, not the words (got ${r.stdout})`);
  // Keys that match nothing never widen to "every entry", --same or not.
  r = await fcli('forget', 'zebra', '--key', 'k-elsewhere', '--same', '--yes');
  ok(r.status === 1 && kept('2025-10-20', '2025-10-21', today), `a --same of a key no entry has removes nothing (got ${r.stdout})`);
  // A key no day holds yet, of a turn in this project's conversation (a Stop that met the store's lock writes it after the next
  // reply): named as another project's, it was kept by no key, and the next Stop wrote it back (fuzz seed 1729835215). Listed
  // without its words (its conversation may be private), kept out by --yes, and no snapshot is said to hold it.
  const lateT = join(root, 'C--fg', 'dddd4444.jsonl'), lateAt = local(Date.parse('2025-10-22T09:00:00Z'));
  writeFileSync(lateT, [{ type: 'user', uuid: 'f-late', sessionId: 'dddd4444', cwd: 'C:\\fg', timestamp: '2025-10-22T09:00:00Z', message: { role: 'user', content: 'the okapi plan' } },
    { type: 'assistant', uuid: 'f-late-a', sessionId: 'dddd4444', cwd: 'C:\\fg', timestamp: '2025-10-22T09:00:30Z', message: { role: 'assistant', content: [{ type: 'text', text: 'drafted the okapi plan' }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const unsaid = `${lateAt}  conversation dddd4444  [not in the journal yet]  (key f-late)\n`;
  r = await fcli('forget', '--key', 'f-late');
  ok(r.status === 0 && r.stdout === `${unsaid}1 entry in ${fd} would go; run again with --yes to remove them\n`, `a key of a turn no day holds yet is listed, without its words (got ${r.stdout})`);
  r = await fcli('forget', 'zebra', '--key', 'f-late');
  ok(r.status === 0 && r.stdout === `nothing in ${fd} matches: no entry holds "zebra"\n`, `and the words still filter it (got ${r.stdout})`);
  r = await fcli('forget', '--key', 'f-late-a');
  ok(r.status === 1 && r.stdout.startsWith(`no entry in ${fd} has the key f-late-a;`), `a reply's id is no exchange's key (got ${r.stdout})`);
  r = await fcli('forget', '--key', 'f-late', '--yes');
  ok(r.status === 0 && r.stdout === `${unsaid}${cc}removed 1 from ${fd}\n` && readFileSync(join(fj, '.forgotten'), 'utf8').includes(`f-late\tC--fg/dddd4444\t${lateAt}\n`) && kept('2025-10-20', '2025-10-21', today),
    `forget --key --yes keeps it out: its key listed, no day touched, no snapshot named (got ${r.stdout}${r.stderr})`);
  // Forgotten, it is in no day and still in its conversation: found there again, a second forget said it removed it (review).
  const listed1 = readFileSync(join(fj, '.forgotten'), 'utf8'), again = `key f-late is already forgotten; nothing to remove\nnothing in ${fd} matches\n`;
  for (const yes of [[], ['--yes']]) {
    r = await fcli('forget', '--key', 'f-late', ...yes);
    ok(r.status === 0 && r.stdout === again && readFileSync(join(fj, '.forgotten'), 'utf8') === listed1, `a key forgotten before is said to be, and nothing goes (${yes.join('') || 'a look'}: got ${r.stdout})`);
  }
  // Said before the count, the last line, as a failure is.
  r = await fcli('forget', '--key', 'f-late', '--key', es[0].key);
  ok(r.status === 0 && r.stdout === `${fl(es[0])}key f-late is already forgotten; nothing to remove\n1 entry in ${fd} would go; run again with --yes to remove them\n`,
    `with another key's entry, the line comes before the count (got ${r.stdout})`);
  // By its words too: a look by words found no turn a day did not hold yet, and the next reply wrote it (1.2.5). Listed as by
  // its key, kept out by --yes, and not found again once forgotten.
  reset();
  r = await fcli('forget', 'OKAPI', 'plan');
  ok(r.status === 0 && r.stdout === `${unsaid}1 entry in ${fd} would go; run again with --yes to remove them\n`, `a look by words lists a turn no day holds yet (got ${r.stdout})`);
  r = await fcli('forget', 'okapi', '--yes');
  ok(r.status === 0 && r.stdout.startsWith(unsaid) && r.stdout.endsWith(`removed 1 from ${fd}\n`) && /^f-late\t/m.test(readFileSync(join(fj, '.forgotten'), 'utf8')) && kept('2025-10-20', '2025-10-21', today),
    `and --yes by words keeps it out by its key (got ${r.stdout})`);
  r = await fcli('forget', 'okapi');
  ok(r.status === 0 && r.stdout === `nothing in ${fd} matches: no entry holds "okapi"\n`, `once forgotten, a look by words finds it no more (got ${r.stdout})`);
  // A key whose day won't read (a folder by its name here) is no turn "not in the journal yet": found in its conversation, it was
  // said removed while that day still held it (R73). Named as in no day that could be read, nothing removed, and the forget fails.
  // By words, it is not listed at all.
  reset();
  mkdirSync(join(fj, '2025-10-22.md'));
  for (const yes of [[], ['--yes']]) {
    r = await fcli('forget', '--key', 'f-late', ...yes);
    ok(r.status === 1 && new RegExp(`^no day of [^\\n]+ that could be read has the key f-late: it may be in one that could not, so nothing was removed for it\\ncould not read [^\\n]*2025-10-22\\.md: \\w+\\nnothing in [^\\n]+ matches\\n$`).test(r.stdout) &&
      !existsSync(join(fj, '.forgotten')), `a key whose day won't read is named so, never said removed (${yes.join('') || 'a look'}: got ${r.stdout})`);
    r = await fcli('forget', 'okapi', ...yes);
    ok(r.status === 1 && !/okapi|not in the journal yet|removed 1/.test(r.stdout.replace(/"okapi"/, '')) && !existsSync(join(fj, '.forgotten')), `nor is a turn found by its words (${yes.join('') || 'a look'}: got ${r.stdout})`);
  }
  rmSync(join(fj, '2025-10-22.md'), { recursive: true });
  rmSync(lateT);
  {
    // A store with no journal folder yet (a new project whose first Stop was busy) where it can't be made: the folder is named
    // as not written, nothing is said removed, and the forget fails; not "could not be listed", the look's failure (review).
    const md = join(root, 'C--mk', 'memory'), mj = join(md, 'journal'), refuseMk = join(home, 'refuse-mkdir.mjs');
    mkdirSync(md, { recursive: true });
    writeFileSync(join(root, 'C--mk', 'mmmmmmmm-1.jsonl'), [{ type: 'user', uuid: 'mk-1', cwd: 'C:\\mk', timestamp: '2025-10-22T09:00:00Z', message: { role: 'user', content: 'the tapir plan' } },
      { type: 'assistant', uuid: 'mk-1a', cwd: 'C:\\mk', timestamp: '2025-10-22T09:00:30Z', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
    writeFileSync(refuseMk, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst mk = fs.mkdirSync;\n" +
      `fs.mkdirSync = (p, ...a) => { if (String(p) === ${JSON.stringify(mj)}) throw Object.assign(new Error('EPERM: operation not permitted, mkdir'), { code: 'EPERM', syscall: 'mkdir', path: String(p) }); return mk(p, ...a); };\nsyncBuiltinESMExports();\n`);
    r = spawnSync(process.execPath, ['--import', pathToFileURL(refuseMk).href, CLI, 'forget', '--key', 'mk-1', '--yes', '--store', md], { env, encoding: 'utf8' });
    ok(r.status === 1 && !r.stderr && r.stdout === `could not write ${mj}: EPERM\nremoved 0 of 1 from ${md}\n` && !existsSync(mj),
      `a journal folder that can't be made is named, and nothing is said removed (got ${r.status}: ${r.stdout}${r.stderr})`);
  }
  // A plain-words forget that matches nothing says which words no entry holds.
  r = await fcli('forget', 'the', 'zebra', 'pasted', 'yesterday');
  ok(r.status === 0 && r.stdout === `nothing in ${fd} matches: no entry holds "pasted", "yesterday"\n`, `a forget that matches nothing names the words no entry holds (got ${r.stdout})`);
  ok((await fcli('forget', 'mango', 'policy')).stdout === `nothing in ${fd} matches: no entry holds every word\n`, 'and when each word is somewhere, says no one entry holds them all');
  // One store at a time: under --all it removed nothing, and said "removed 0" of an entry search had shown.
  r = await fcli('forget', 'zebra', '--all', '--yes');
  ok(r.status === 1 && /^forget works on one store: --store <folder>/.test(r.stdout) && kept('2025-10-20', '2025-10-21', today), `forget refuses --all (got ${r.stdout})`);
  // A turn of it recorded after the look goes too, and is listed with the rest.
  writeFileSync(join(fj, `${today}.md`), page(today, [...es.slice(3), lateTurn]));
  r = await fcli('forget', '--conversation', 'bbbb2222', '--yes');
  ok(r.status === 0 && r.stdout === `${bb}${fl(lateTurn)}${cc}removed 3 from ${fd}\n` && gone(today) && kept('2025-10-20', '2025-10-21'),
    `forget --conversation removes one conversation, a turn since the look too; today's day, not yet in the snapshots, needs no word on them (got ${r.stdout}${r.stderr})`);
  // What the refusal advises does forget the whole journal, every key listed so no backfill brings it back.
  reset();
  // And handoff.md loses those exchanges, by conversation and time: the next
  // startup's briefing printed what was forgotten (final review, R36).
  const said = (at, s, ask) => `- **asked** ${at} [${s}]: ${ask}\n  **did:** done`;
  writeFileSync(join(fd, 'handoff.md'), `---\nname: handoff\n---\n\n<!-- auto:start -->\n_Written._\n\n${said(es[0].at, 'aaaa1111', es[0].asked)}\n${said(es[0].at, 'cccc3333', 'the walrus budget')}\n<!-- auto:end -->\n`);
  r = await fcli('forget', '--since', '1970-01-01', '--yes');
  const listed = readFileSync(join(fj, '.forgotten'), 'utf8').split('\n').filter(Boolean).sort().join(), hd = readFileSync(join(fd, 'handoff.md'), 'utf8');
  ok(r.status === 0 && r.stdout.endsWith(`\nremoved 5 from ${fd}\n`) && Object.keys(want).every(gone) && listed === listing(es) && !hd.includes(es[0].asked) && hd.includes('[cccc3333]: the walrus budget'),
    `--since 1970-01-01 --yes forgets the whole journal and its exchanges in handoff.md, and lists the keys a transcript on disk could bring back (got ${r.stdout}; ${listed}; ${hd})`);
  // With no history there is no old copy to delete: the snapshots go unmentioned.
  reset();
  renameSync(join(root, '.git'), join(root, '.git-away'));
  try { r = await fcli('forget', 'Zebra', 'mango', '--yes'); } finally { renameSync(join(root, '.git-away'), join(root, '.git')); }
  ok(r.status === 0 && r.stdout === `${zm}${cc}removed 2 from ${fd}\n`, `with no snapshots, forget --yes says nothing of them (got ${r.stdout}${r.stderr})`);
  // Nor in a repository the user made there: the plugin commits nothing to it, and it is theirs to keep.
  reset();
  const cfg = join(root, '.git', 'config'), had = readFileSync(cfg, 'utf8');
  writeFileSync(cfg, had.replace(/^\[project-memory\][^[]*/m, ''));
  try { r = await fcli('forget', 'Zebra', 'mango', '--yes'); } finally { writeFileSync(cfg, had); }
  ok(had.includes('[project-memory]') && r.status === 0 && r.stdout === `${zm}${cc}removed 2 from ${fd}\n`, `nor in a repository the user made (got ${r.stdout}${r.stderr})`);
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
  r = await fcli('forget', 'Zebra', 'mango', '--yes');
  ok(r.status === 1 && r.stdout.split('could not read').length === 2 && r.stdout.endsWith(`\nremoved 2 from ${fd}\n`), `an unreadable day is said once, and the forget fails (got ${r.stdout})`);
  // The list of forgotten keys refused: nothing goes, since a backfill would bring it back.
  reset();
  r = refusing('.forgotten');
  ok(r.status === 1 && !r.stderr && r.stdout === `could not write ${join(fj, '.forgotten')}: EPERM\nremoved 0 of 2 from ${fd}\n` && kept('2025-10-20', '2025-10-21', today),
    `a forget whose list cannot be written removes nothing, and says so (got ${r.stdout}${r.stderr})`);
  // A retry after a handoff.md that would not be written: the keys were listed by then, so the journal had nothing left to
  // remove, and "already forgotten" left the exchange in handoff.md for the next briefing (R73). It goes, by the line's minute.
  reset();
  const hf = join(fd, 'handoff.md');
  writeFileSync(hf, `---\nname: handoff\n---\n\n<!-- auto:start -->\n_Written._\n\n${said(es[0].at, 'aaaa1111', es[0].asked)}\n${said(es[2].at, 'aaaa1111', es[2].asked)}\n${said(es[0].at, 'cccc3333', 'the walrus budget')}\n<!-- auto:end -->\n`);
  r = refusing('handoff.md');
  ok(r.status === 1 && r.stdout.includes(`could not write ${hf}: EPERM`) && readFileSync(hf, 'utf8').includes(es[0].asked), `a handoff.md that refuses the write keeps the exchange, and is named (got ${r.stdout}${r.stderr})`);
  r = await fcli('forget', '--key', es[0].key);
  ok(r.stdout === `key ${es[0].key} is already forgotten; nothing to remove\nnothing in ${fd} matches\n` && readFileSync(hf, 'utf8').includes(es[0].asked), `a look at it changes nothing (got ${r.stdout})`);
  // A retry the disk refuses again, or that finds the store's lock held, says so and fails.
  r = spawnSync(process.execPath, ['--import', pathToFileURL(refuse).href, CLI, 'forget', '--key', es[0].key, '--yes', '--store', fd], { env, encoding: 'utf8' });
  ok(r.status === 1 && r.stdout.includes(`could not write ${hf}: EPERM\n`) && readFileSync(hf, 'utf8').includes(es[0].asked), `a retry the disk refuses is named and fails (got ${r.stdout}${r.stderr})`);
  mkdirSync(join(fd, '.lock'));
  try { r = await capture(() => fastClock(() => main(['forget', '--key', es[0].key, '--yes', '--store', fd]))); } finally { rmSync(join(fd, '.lock'), { recursive: true, force: true }); }
  ok(r.value === 1 && r.out.includes(`could not write ${hf}: busy\n`) && readFileSync(hf, 'utf8').includes(es[0].asked), `a retry that meets the lock is named and fails (got ${r.out})`);
  r = await fcli('forget', '--key', es[0].key, '--yes');
  const hd2 = readFileSync(hf, 'utf8');
  ok(r.status === 0 && r.stdout === `key ${es[0].key} is already forgotten; nothing to remove from the journal\nhandoff.md holds none of these exchanges now\nnothing in ${fd} matches\n` && !hd2.includes(es[0].asked) && hd2.includes('the walrus budget') && hd2.includes(es[2].asked),
    `the retry takes it out of handoff.md, and only it: not another conversation's of that minute, nor another forgotten key's (got ${r.stdout}; ${hd2})`);
  // A journal folder the disk will not list is no empty journal: forget said "nothing matches" with exit 0 (by --key, that the key was
  // another project's), and the entries stayed. It names the code, removes nothing and fails, as a refused restore does (F20, R45).
  reset();
  const unlist = join(home, 'unlist-journal.mjs');
  writeFileSync(unlist, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst readdir = fs.readdirSync;\n" +
    `fs.readdirSync = (p, ...a) => { if (String(p) === ${JSON.stringify(fj)}) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM', syscall: 'scandir', path: p }); return readdir(p, ...a); };\nsyncBuiltinESMExports();\n`);
  for (const how of [['Zebra', 'mango'], ['--key', es[0].key]]) {
    r = spawnSync(process.execPath, ['--import', pathToFileURL(unlist).href, CLI, 'forget', ...how, '--yes', '--store', fd], { env, encoding: 'utf8' });
    ok(r.status === 1 && !r.stderr && r.stdout === `${fj} could not be listed (EPERM); nothing removed\n` && kept('2025-10-20', '2025-10-21', today),
      `a forget over a journal that will not list names the code, removes nothing and fails: ${how.join(' ')} (got ${r.status}: ${r.stdout}${r.stderr})`);
  }
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
  r = await fcli('forget', 'gnu', 'herd');
  ok(r.stdout.split('\n').filter((l) => / gnu herd \d+  \(key f\d+\)$/.test(l)).length === 200 && r.stdout.endsWith(`\n200 entries in ${fd} would go; run again with --yes to remove them\n`), `a look lists 200 matches (got ${r.stdout.slice(-300)})`);
  r = await fcli('forget', 'gnu');
  const r2 = await fcli('forget', 'gnu', '--yes');
  ok(r.status === 0 && r.stdout === `201 entries in ${fd} match; narrow it: a look lists 200 at most\n` && r2.status === 1 &&
    r2.stdout === `201 entries in ${fd} match; narrow it: a look lists 200 at most, and --yes removes only what a look can list: nothing removed\n` && file('2025-10-22').split('gnu').length === 202,
    `past 200, a look asks for a narrower one, and --yes removes nothing (got ${r.stdout}${r2.stdout})`);
  // A date range alone is confirmed by its range: past 200 entries, "forget the
  // whole journal" (the refusal's own advice) removed nothing.
  reset();
  const herd = Array.from({ length: 245 }, (_, i) => entry(`2025-10-23 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, `wildebeest ${i}`));
  writeFileSync(join(fj, '2025-10-23.md'), page('2025-10-23', herd));
  r = await fcli('forget', '--since', '1970-01-01');
  ok(r.status === 0 && r.stdout === `${es.slice(0, 3).map(fl).join('')}${herd.slice(0, 17).map(fl).join('')}and 230 more\n250 entries in ${fd} from 2025-10-20 to ${today} would go; run again with --yes to remove them\n` && kept('2025-10-20', '2025-10-21', today),
    `a range alone shows its first 20 entries, the count, and its first and last day (got ${r.stdout.slice(-400)})`);
  r = await fcli('forget', '--since', '1970-01-01', '--yes');
  const all250 = readFileSync(join(fj, '.forgotten'), 'utf8').split('\n').filter(Boolean).sort().join();
  ok(r.status === 0 && r.stdout.endsWith(`\nremoved 250 from ${fd}\n`) && !/\(key /.test(r.stdout) && [...Object.keys(want), '2025-10-23'].every(gone) && all250 === listing([...es, ...herd]),
    `--yes removes every entry of a range past 200, says the count, not each line, and lists every key a transcript on disk could bring back (got ${r.stdout.slice(-400)})`);
  // A day that changed under each of its three writes keeps its entries: what
  // is listed and counted is what went, out of what matched. The other writer
  // is simulated in the CLI's own process, just before each write lands.
  reset();
  const busy = join(home, 'busy-day.mjs');
  writeFileSync(busy, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst read = fs.readFileSync;\n" +
    "fs.readFileSync = (p, ...a) => { if (String(p).endsWith('2025-10-21.md') && fs.existsSync(`${p}.tmp${process.pid}`)) fs.appendFileSync(p, '\\nanother writer'); return read(p, ...a); };\nsyncBuiltinESMExports();\n");
  r = spawnSync(process.execPath, ['--import', pathToFileURL(busy).href, CLI, 'forget', 'Zebra', 'mango', '--yes', '--store', fd], { env, encoding: 'utf8' });
  ok(/^2025-10-20 09:00  conversation aaaa1111  the zebra eats mango  \(key f0\)\nthe snapshots still hold the journal of 2025-10-20: [^\n]*\nClaude Code still keeps these exchanges in [^\n]*\nremoved 1 of 2 from /.test(r.stdout) && file('2025-10-21').includes('mango, the zebra again'),
    `a day the write never landed in keeps its entry, neither listed nor counted as removed (got ${r.stdout}${r.stderr})`);
}

// status and the journal: a line for a store that has one, what is left to
// import, and a write that failed.
{
  const st = join(root, 'C--jst', 'memory');
  const cli = async () => (await run(['status', '--store', st])).stdout;
  const day = (d, body = '') => { mkdirSync(join(st, 'journal'), { recursive: true }); writeFileSync(join(st, 'journal', `${d}.md`), `# Journal ${d}\n${body}`); };
  const one = (d, k) => `\n<!-- j:${k} t:C--jst/aaaaaaaa-1 d:${d} -->\n## 09:00 · conversation aaaaaaaa\n**Asked:** ${k}\n`;
  mkdirSync(st, { recursive: true });
  writeFileSync(join(st, 'MEMORY.md'), '# Memory\n');
  ok(!/journal:/.test(await cli()), 'status says nothing of a store with no journal');
  day('2026-10-01');   // a day a sweep emptied is no day
  ok(!/journal:/.test(await cli()), 'status says nothing of a journal holding only an emptied day');
  day('2026-10-05', one('2026-10-05', 'k1'));
  day('2026-10-06', one('2026-10-06', 'k2'));
  let out = await cli();
  ok(/^  journal: 2 days since 2026-10-05, \d\.\d MB$/m.test(out), `status reports the journal (got ${out})`);
  const tp = join(root, 'C--jst', 'bbbbbbbb-2.jsonl');
  writeFileSync(tp, '{"type":"user"}\n');
  const old = new Date(Date.now() - 2 * 86400000); utimesSync(tp, old, old);
  out = await cli();
  ok(/^  journal: 2 days since 2026-10-05, \d\.\d MB; importing 1 older conversations$/m.test(out), `status says an import is pending (got ${out})`);
  writeFileSync(join(st, 'journal', '.failed'), JSON.stringify({ at: '2026-10-06T09:00:00Z', error: 'disk full' }));
  out = await cli();
  ok(/; last write failed: disk full$/m.test(out), `status says the last write failed (got ${out})`);
  for (const d of ['2026-10-05', '2026-10-06']) unlinkSync(join(st, 'journal', `${d}.md`));
  ok(/^  journal: no days yet; importing 1 older conversations; last write failed: disk full$/m.test(await cli()), 'a journal that failed from its first write still says so');
  // A store whose only memory is its journal (no index, no journal.md yet) is a store.
  const lone = join(root, 'C--jonly', 'memory');
  mkdirSync(join(lone, 'journal'), { recursive: true });
  writeFileSync(join(lone, 'journal', '2026-10-05.md'), `# Journal 2026-10-05\n${one('2026-10-05', 'k9')}`);
  out = (await run(['status', '--store', lone])).stdout;
  ok(!/no store here yet/.test(out) && /^  journal: 1 days? since 2026-10-05, /m.test(out), `a store whose only memory is its journal shows it (got ${out})`);
}

// The edges the blocks above pass over (the automatic mutants of memory.mjs,
// Task 8): scores, a stretch's exact length, the week's changes, restore and
// promote at their limits, doctor's limits, forget's failures.
{
  const { history, restore, promote } = await import(pathToFileURL(CLI).href);
  const { render } = await import('./journal.mjs');
  const { budgetOf, LOCK_STALE, gitArgs } = await import('./store.mjs');
  const { GRACE } = await import('./handoff-log.mjs');
  const { default: fsm } = await import('node:fs'), { syncBuiltinESMExports } = await import('node:module');
  const mdir = (name) => { const d = join(root, name, 'memory'); mkdirSync(d, { recursive: true }); return d; };
  const bytes = (s) => Buffer.byteLength(s);
  const iso = (ms) => new Date(ms).toISOString();
  const link = process.platform === 'win32' ? 'junction' : 'dir';
  const jm = mdir('C--mutA');
  let n = 0;
  const entry = (at, asked, over = {}) => ({ key: `ma${String(n++).padStart(3, '0')}`, at, s: 'c0ffee12', t: 'C--mutA/c0ffee12-full', branch: '', asked, answered: 'done', changed: [], ran: [], ...over });
  const day = (store, d, es) => { mkdirSync(join(store, 'journal'), { recursive: true }); writeFileSync(join(store, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`); };
  const jcli = (...a) => run([...a, '--store', jm]);
  const blocks = (out) => out.split(/\n(?= *\d+  )/);
  const scoreOf = (out, marker) => Number(blocks(out).find((b) => b.includes(marker))?.match(/^ *(\d+)/)?.[1]);

  // A score is exact: the +5 for every term in the name or request, the +2 for
  // every term somewhere, and none of either for a note or entry that lacks one.
  memory(jm, 'mn-alpha', 'zork', 'quux');
  memory(jm, 'mn-gamma', 'zork quux');
  memory(jm, 'mn-beta', 'plain', 'decision decision');
  memory(jm, 'mn-links', 'fivelinks note', [1, 2, 3, 4, 5].map((i) => `[[l${i}]]`).join(' '));
  day(jm, '2026-10-20', [entry('2026-10-20 10:00', 'zork alone', { answered: 'quux once' }), entry('2026-10-20 10:01', 'zork again', { answered: 'zork too' }), entry('2026-10-20 10:02', 'zork quux both')]);
  r = await jcli('search', 'zork', 'quux');
  ok([scoreOf(r.stdout, 'mn-alpha.md'), scoreOf(r.stdout, 'mn-gamma.md'), scoreOf(r.stdout, 'Asked: zork alone'), scoreOf(r.stdout, 'Asked: zork again'), scoreOf(r.stdout, 'Asked: zork quux both')].join() === '5,9,6,4,11',
    `a term in the description and one in the body is every term (+2), both in the description is strong (+5), a missing term earns neither, for notes and for entries (got ${r.stdout})`);
  // Two letters are a word of their own: `ci` is in "decision", whose body count and whose reply must not count.
  day(jm, '2026-10-22', [entry('2026-10-22 10:00', 'set up CI on the cluster', { answered: 'a decision on logos' })]);
  r = await jcli('search', 'ci');
  ok(!/mn-beta/.test(r.stdout) && scoreOf(r.stdout, 'Asked: set up CI') === 8 && !/Answered:/.test(r.stdout), `a two-letter term is counted and shown only standing alone (got ${r.stdout})`);
  ok(/^ +links: l1, l2, l3, l4, l5$/m.test((await jcli('search', 'fivelinks')).stdout), 'exactly five links are listed with no "and 0 more"');
  // Combining marks are part of a word: Hindi is found, and a decomposed accent in a note matches the typed one.
  day(jm, '2026-10-23', [entry('2026-10-23 10:00', 'हिन्दी भाषा सीखना'), entry('2026-10-23 11:00', 'the cafe\u0301 menu'), entry('2026-10-23 12:00', 'a caf\u00e9 bill')]);
  r = await jcli('search', 'हिन्दी');
  ok(/हिन्दी भाषा/.test(r.stdout) && !/nothing to search for/.test(r.stdout), `a Hindi word is searched (got ${r.stdout})`);
  r = await jcli('search', 'caf\u00e9');
  ok(/Asked: the cafe\u0301 menu/.test(r.stdout), `a typed café finds a decomposed one (got ${r.stdout})`);
  r = await jcli('search', 'cafe\u0301');
  ok(/Asked: a caf\u00e9 bill/.test(r.stdout), `a decomposed query finds a typed café (got ${r.stdout})`);
  // 1.2.6 release review: the reply's stretch that holds a decomposed café is shown, not a Result line in its place.
  day(jm, '2026-10-24', [entry('2026-10-24 10:00', 'lunch plans', { answered: 'we met at the cafe\u0301 near the station' })]);
  r = await jcli('search', 'caf\u00e9');
  const lunch = blocks(r.stdout).find((b) => b.includes('Asked: lunch plans')) ?? '';
  ok(/Answered: we met at the caf\u00e9 near/.test(lunch) && !/Result:/.test(lunch), `a decomposed match in the reply shows its stretch (got ${lunch})`);

  // 1.3.0 (D1): a two-character Chinese or Japanese word is a word, as it has no spaces round it.
  memory(jm, 'cjk-zh', 'zh-note', '\u6211\u4eec\u51b3\u5b9a\u4fee\u6539\u8bb0\u5fc6\u7cfb\u7edf\u7684\u90e8\u7f72\u65b9\u5f0f');
  memory(jm, 'cjk-ja', 'ja-note', '\u30c7\u30fc\u30bf\u30d9\u30fc\u30b9\u306e\u8a2d\u8a08\u3092\u5909\u66f4\u3057\u307e\u3057\u305f');
  // The third note: the long-vowel mark in \u30ad\u30fc ("key") is in no Japanese script by sc=, only by scx=.
  memory(jm, 'cjk-ka', 'ka-note', '\u30ad\u30fc\u30dc\u30fc\u30c9\u306e\u8a2d\u5b9a');
  for (const [q, f] of [['\u8bb0\u5fc6', 'cjk-zh.md'], ['\u90e8\u7f72', 'cjk-zh.md'], ['\u8a2d\u8a08', 'cjk-ja.md'], ['\u30ad\u30fc', 'cjk-ka.md']]) {
    r = await jcli('search', q);
    ok(r.stdout.includes(f) && !/nothing matches/.test(r.stdout), `${q}, two characters, is found (got ${r.stdout})`);
  }
  r = await jcli('search', 'volcano', 'penguin', 'saxophone');
  ok(/^nothing matches /m.test(r.stdout) && !/\.md/.test(r.stdout), `a query of words nothing holds finds nothing, as on 1.2.7 (got ${r.stdout})`);
  // Idea 4: the words no note or entry holds are named after the hits.
  memory(jm, 'hz-deploy', 'deployqq notes');
  r = await jcli('search', 'deployqq', 'hetznerqq');
  ok(/hz-deploy\.md/.test(r.stdout) && /^no note or entry holds: hetznerqq$/m.test(r.stdout), `a word nothing holds is named (got ${r.stdout})`);
  memory(jm, 'hz-old', 'oldwordqq notes'); utimesSync(join(jm, 'hz-old.md'), new Date('2020-01-01'), new Date('2020-01-01'));
  r = await jcli('search', 'deployqq', 'oldwordqq', '--since', '2021-01-01');
  ok(/^no note or entry holds: oldwordqq$/m.test(r.stdout) && /1 note matches outside the range/.test(r.stdout), `a word held only outside the range is named (got ${r.stdout})`);
  r = await jcli('search', 'deployqq', 'hetznerqq', 'vultrqq');
  ok(/^no note or entry holds: hetznerqq, vultrqq$/m.test(r.stdout), `several are listed with commas (got ${r.stdout})`);
  r = await jcli('search', 'deployqq', 'notes');
  ok(!/no note or entry holds/.test(r.stdout), `no line when every word is held (got ${r.stdout})`);
  r = await jcli('search', 'hetznerqq', 'vultrqq');
  ok(/^nothing matches /m.test(r.stdout) && !/no note or entry holds/.test(r.stdout), `no word held still prints only "nothing matches" (got ${r.stdout})`);

  // A stretch: matches 60 apart are one stretch (the 30-character windows
  // touch): no " … " where the second window starts, and it is cut at the room (240).
  const fill = (k) => 'ab '.repeat(Math.ceil(k / 3)).slice(0, k);
  const text = fill(100) + 'zeta' + [1, 2, 3, 4].map(() => fill(60) + 'zeta').join('') + fill(5) + 'zeta' + fill(50);
  ok(text.length === 419, `the text is built to 419 characters (got ${text.length})`);
  // And a stretch of exactly the room is not cut. The last match is 9
  // characters from the end, so the stretch ends there and the cap would replace its last letter.
  const exact = fill(100) + ['kappa', 'kappa', 'kappa', 'kappa'].join(fill(60)) + fill(8) + 'z';   // a stored reply loses a trailing space
  day(jm, '2026-10-22', [entry('2026-10-22 10:00', 'set up CI on the cluster', { answered: 'a decision on logos' }), entry('2026-10-22 11:00', 'zeta hunt', { answered: text }),
    entry('2026-10-22 12:00', 'kappa hunt', { answered: exact })]);
  r = await jcli('search', 'zeta');
  const stretch = r.stdout.split('\n').find((l) => l.startsWith('     Answered: '));
  ok(stretch === `     Answered: …${text.slice(70, 308)}…` && stretch.length - '     Answered: '.length === 240, `matches 60 apart merge, cut at 240 (got ${stretch})`);
  const whole = (await jcli('search', 'kappa')).stdout.split('\n').find((l) => l.startsWith('     Answered: '));
  ok(whole === `     Answered: …${exact.slice(70)}` && whole.length - '     Answered: '.length === 240, `a stretch of exactly 240 characters is kept whole (got ${whole})`);

  // A range with no terms lists those days, newest first; equal minutes keep their order.
  day(jm, '2026-10-21', [entry('2026-10-21 10:00', 'tie alpha'), entry('2026-10-21 10:00', 'tie beta'), entry('2026-10-21 09:00', 'tie gamma')]);
  r = await jcli('search', '--since', '2026-10-21', '--until', '2026-10-21', '--limit', '0');
  ok(r.stdout.indexOf('tie alpha') !== -1 && r.stdout.indexOf('tie alpha') < r.stdout.indexOf('tie beta') && r.stdout.indexOf('tie beta') < r.stdout.indexOf('tie gamma') && /^3 of 3 journal entries in [^;\n]+$/m.test(r.stdout),
    `--limit 0 is the default, all three are listed in order with no "shows more" (got ${r.stdout})`);
  ok(/journal entries in/.test((await jcli('search', 'what', 'did', 'I', 'do', '--since', '2026-10-21')).stdout) && /^3 of 3 journal entries in/m.test((await jcli('search', 'what', 'did', 'I', 'do', '--until', '2026-10-20')).stdout),
    'words that name nothing, with only --since or only --until, list the range');
  ok(/^3 of 3 match\(es\)/m.test((await jcli('search', 'zork', '--since', '2026-10-20', '--until', '2026-10-20')).stdout), 'terms with a range search the range, ranked');
  r = await jcli('search', 'zzqqxx');
  ok(/^nothing matches "zzqqxx" in [^\n]+ and [^\n]+; --all searches every project$/m.test(r.stdout) && !/2 stores/.test(r.stdout), `two stores are named, not counted (got ${r.stdout})`);
  // A request of exactly SAME_MIN characters asked again is one hit; --limit 0 is the default.
  const gnus = 'gnu '.repeat(19) + 'gnus';
  ok(gnus.length === 80, 'the repeated request is 80 characters');
  day(jm, '2026-10-23', [entry('2026-10-23 10:00', gnus)]);
  day(jm, '2026-10-24', [entry('2026-10-24 10:00', gnus)]);
  r = await jcli('search', 'gnus', '--limit', '0');
  ok(/^     1 more like this, 2026-10-23\.\.2026-10-24:/m.test(r.stdout) && /^1 of 1 match\(es\)/m.test(r.stdout), `an 80-character request asked twice is one hit; --limit 0 lists as the default (got ${r.stdout})`);
  // show names an entry once however many times its key is given.
  const k0 = r.stdout.match(/^     key: (\S+)$/m)[1];
  ok(((await jcli('show', k0, k0)).stdout.match(/^     key: /gm) || []).length === 1, 'show prints an entry once for a key given twice');
  // forget: --key with no value is no key, and is refused (audit C-7); the words of a sentence are blamed when the journal is empty.
  r = await run(['forget', '--store', jm, '--key']);
  ok(r.status === 1 && r.stdout === '--key needs a value after it\n', `--key with nothing after it is no key (got ${r.stdout})`);
  const empty = join(root, 'C--mutA-empty', 'memory');
  r = await run(['forget', 'nosuchword', '--store', empty]);
  ok(r.stdout.trim() === `nothing in ${empty} matches: no entry holds "nosuchword"`, `a miss in an empty journal blames the word (got ${r.stdout})`);
  // A range forget removing exactly LOOK (200) entries lists them all.
  const big = mdir('C--mutA-200');
  day(big, '2026-09-05', Array.from({ length: 200 }, (_, i) => ({ ...entry('2026-09-05 10:00', `bulk ${i}`), key: `bk${i}` })));
  r = await run(['forget', '--since', '2026-09-05', '--until', '2026-09-05', '--yes', '--store', big]);
  ok(r.status === 0 && (r.stdout.match(/\(key bk\d+\)/g) || []).length === 200 && /^removed 200 from /m.test(r.stdout), `a forget of 200 entries lists them (got ${r.stdout.length} bytes)`);
  // A forget the disk refuses says where and why: the error's own path and code.
  const ft = mdir('C--mutA-fail');
  day(ft, '2026-09-06', [entry('2026-09-06 10:00', 'fragile secret')]);
  const write = fsm.writeFileSync;
  fsm.writeFileSync = (p, ...a) => { if (String(p).includes('.forgotten.tmp')) throw Object.assign(new Error('EPERM: operation not permitted, open'), { code: 'EPERM', path: String(p) }); return write(p, ...a); };
  syncBuiltinESMExports();
  try { r = await run(['forget', 'fragile', '--yes', '--store', ft]); } finally { fsm.writeFileSync = write; syncBuiltinESMExports(); }
  ok(r.status === 1 && r.stdout.includes(`could not write ${join(ft, 'journal', '.forgotten')}: EPERM\n`), `a forget that throws names the file and the error code (got ${r.stdout})`);

  // Status: a store with nothing is said so; one with notes and no index is not; .health is shown only when it holds something.
  const none = join(root, 'C--mutA-none', 'memory');
  ok((await run(['status', '--store', none])).stdout.startsWith(`${none}\n  no store here yet\n`), 'a store with nothing says so');
  const noidx = mdir('C--mutA-noidx');
  memory(noidx, 'loose', 'a note with no index');
  r = await run(['status', '--store', noidx]);
  ok(!/no store here yet/.test(r.stdout) && /^  index 0 \/ 7000 B · 0 hot · 0 archived · 1 with no pointer yet$/m.test(r.stdout), `notes with no index are a store (got ${r.stdout})`);
  const hs = mdir('C--mutA-health');
  writeFileSync(join(hs, 'MEMORY.md'), '# Index\n');
  writeFileSync(join(hs, '.health'), 'disk is full\nlocks stuck\n');
  r = await run(['status', '--store', hs]);
  ok(/^  needs attention: disk is full\n  needs attention: locks stuck$/m.test(r.stdout) && (r.stdout.match(/needs attention/g) || []).length === 2 + ((await run(['status', '--store', none])).stdout.match(/needs attention/g) || []).length && ((await run(['status', '--store', jm])).stdout.match(/needs attention/g) || []).length === ((await run(['status', '--store', none])).stdout.match(/needs attention/g) || []).length,
    `a .health file is listed line by line, and no file lists nothing (got ${r.stdout})`);
  // A handoff the Stop could not save, as the briefing says it: only the briefing did, and a list that never read went unsaid (R64).
  writeFileSync(join(root, '.handoff-failed-C--mutA-health'), JSON.stringify({ at: '2026-10-01T10:00:00Z', error: 'the list could not be read' }));
  r = await run(['status', '--store', hs]);
  rmSync(join(root, '.handoff-failed-C--mutA-health'));
  ok(/^  needs attention: the record of where you left off could not be saved after the reply at \d{4}-\d\d-\d\d \d\d:\d\d: the list could not be read$/m.test(r.stdout),
    `a handoff the Stop could not save is said by status (got ${r.stdout})`);
  // With auto memory off nothing was to be saved: what failed is the tag that keeps the conversation out of the journal (release review).
  writeFileSync(join(root, '.handoff-failed-C--mutA-health'), JSON.stringify({ at: '2026-10-01T10:00:00Z', error: 'the list could not be read', off: true }));
  r = await run(['status', '--store', hs]);
  rmSync(join(root, '.handoff-failed-C--mutA-health'));
  ok(/^  needs attention: a conversation held with auto memory off could not be marked after the reply at \d{4}-\d\d-\d\d \d\d:\d\d, so the journal may take it in later: the list could not be read$/m.test(r.stdout),
    `a memory-off tag the Stop could not write is said by status in its own words (got ${r.stdout})`);

  // The week's changes: added, edited (in the first snapshot, changed since), deleted; never the index, the handoff or a journal day.
  // NOTE for a block appended after this one: this changes the shared `dir` fixture (mentions edited, spam-log deleted, zz-fresh added, handoff and index rewritten).
  mkdirSync(join(dir, 'journal'), { recursive: true });
  writeFileSync(join(dir, 'mentions.md'), readFileSync(join(dir, 'mentions.md'), 'utf8') + '\nedited this week\n');
  unlinkSync(join(dir, 'spam-log.md'));
  memory(dir, 'zz-fresh', 'a fresh note');
  writeFileSync(join(dir, 'handoff.md'), `---\nname: handoff\ndescription: "h"\n---\nweek ${Date.now()}\n`);
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8') + '- [Fresh](zz-fresh.md) — fresh\n');
  writeFileSync(join(dir, 'journal', '2026-10-27.md'), '# Journal 2026-10-27\nedited\n');
  tier();
  // The snapshots ignore the handoff, but a repository from before that rule holds it: forced in here.
  // On a crowded Windows runner the snapshot's git can pass its 30 s timeout: the kill reaches git's wrapper, and the
  // git under it still holds index.lock for a while. Wait it out (up to 60 s) before this test's own git writes.
  for (const t0 = Date.now(); existsSync(join(root, '.git', 'index.lock')) && Date.now() - t0 < 60_000;) await new Promise((r) => setTimeout(r, 200));
  const forced = [['add', '-f', 'C--mem-cli/memory/handoff.md'], ['commit', '-m', 'handoff from an older version', '--', 'C--mem-cli/memory/handoff.md']]
    .map((g) => spawnSync('git', gitArgs('-c', 'user.name=t', '-c', 'user.email=t@t', ...g), { encoding: 'utf8' }));
  ok(forced.every((f) => f.status === 0), `the handoff is forced into the history (got ${forced.map((f) => f.stderr).join('')})`);
  const week = (await cli('status')).stdout.match(/changed in the last 7 days: (.*)/)?.[1] ?? '';
  const part = (w) => week.split(' · ').find((p) => p.startsWith(`${w} `)) ?? '';
  ok(/zz-fresh/.test(part('added')) && !/mentions|spam-log/.test(part('added')) && /mentions/.test(part('edited')) && !/zz-fresh|spam-log/.test(part('edited')) &&
    /spam-log/.test(part('deleted')) && !/mentions|zz-fresh/.test(part('deleted')) && !/handoff|MEMORY|2026-10-27/.test(week), `the week is added, edited and deleted apart, and leaves out the index, the handoff and journal days (got ${week})`);

  // History: the newest N, exactly N leaves no "older" line; --limit 0 is the default; a linked store names one path.
  const rs = mdir('C--mutA-rs');
  memory(rs, 'kept', 'kept note', 'v1');
  memory(rs, 'hist-two', 'two snapshots', 'one');
  writeFileSync(join(rs, 'MEMORY.md'), '# Index\n\n- [Kept](kept.md) — kept note\n- [Hist two](hist-two.md) — two snapshots\n');
  tier();
  writeFileSync(join(rs, 'hist-two.md'), readFileSync(join(rs, 'hist-two.md'), 'utf8') + 'two\n');
  tier();
  const rows = (out) => (out.match(/^  \S+ \S+ \S+  (?:added|changed)$/gm) || []).length;
  const h2 = [];
  for (const l of ['2', '1', '0']) h2.push((await run(['history', 'hist-two', '--limit', l, '--store', rs])).stdout);
  ok(!/^  and \d+ older/m.test(h2[0]) && /^  and 1 older; --limit N shows more$/m.test(h2[1]) && rows(h2[2]) === 2,
    `history: exactly the limit leaves no "older" line, one under it says 1, --limit 0 is the default (got ${h2.join(' / ')})`);
  const lk = join(root, 'zz-mutA-link');
  symlinkSync(join(root, 'C--mutA-rs'), lk, link);
  try { r = await run(['history', 'hist-two', '--store', join(lk, 'memory')]); } finally { rmSync(lk, { recursive: true, force: true }); }
  ok(/^  a change: git -C "[^"]+" --literal-pathspecs show <commit> -- "C--mutA-rs\/memory\/hist-two\.md"$/m.test(r.stdout), `a store linked from another folder is tracked by its one real path (got ${r.stdout})`);
  ok(history([rs], 'ghost-xyz.md').lines[0].endsWith('; --all looks in every project') && !history([rs], 'ghost-xyz.md', true).lines[0].includes('--all looks'), 'history called alone hints --all');

  // Restore: never over a newer memory unless told; into a store whose folder is gone; the index line it brings back.
  writeFileSync(join(rs, 'kept.md'), 'a newer kept');
  const kept = restore(rs, 'kept.md');
  ok(kept.ok === false && /exists; restore --force replaces it/.test(kept.lines[0]) && readFileSync(join(rs, 'kept.md'), 'utf8') === 'a newer kept', `restore called alone does not replace a memory (got ${JSON.stringify(kept)})`);
  unlinkSync(join(rs, 'kept.md'));
  writeFileSync(join(rs, 'MEMORY.md'), '# Index\n');
  const idxRs = join(rs, 'MEMORY.md'), readFile = fsm.readFileSync;
  let fired = false;
  fsm.readFileSync = (p, ...a) => { if (!fired && String(p) === idxRs && fsm.existsSync(`${p}.tmp${process.pid}`)) { fired = true; fsm.appendFileSync(p, '# written meanwhile\n'); } return readFile(p, ...a); };
  syncBuiltinESMExports();
  try { r = await run(['restore', 'kept', '--store', rs]); } finally { fsm.readFileSync = readFile; syncBuiltinESMExports(); }
  ok(fired && r.status === 0 && /^restored [^\n]*kept\.md from \w+; the index changed meanwhile, so the next turn's tiering gives it a line$/m.test(r.stdout), `an index written while restore adds its line is kept (got ${r.stdout})`);
  rmSync(join(root, 'C--mutA-rs'), { recursive: true, force: true });
  r = await run(['restore', 'kept', '--store', rs]);
  ok(r.status === 0 && readFileSync(join(rs, 'kept.md'), 'utf8').includes('v1') && r.stdout.includes('with its line: - [Kept](kept.md) — kept note'), `restore remakes a store whose folder is gone, with its line (got ${r.stdout}${r.stderr})`);
  // Another session writes the note while restore runs: its version is kept, the snapshot's is not laid over it.
  for (const [what, kind, match, said] of [['appeared', 'mkdirSync', (p) => p === join(rs, '.lock'), /appeared meanwhile; nothing written/], ['changed', 'writeFileSync', (p) => p === join(rs, `kept.md.tmp${process.pid}`), /changed meanwhile; nothing written/]]) {
    unlinkSync(join(rs, 'kept.md'));
    const undo = meanwhile(kind, match, () => writeFileSync(join(rs, 'kept.md'), 'theirs'));
    try { r = restore(rs, 'kept.md'); } finally { undo(); }
    ok(r.ok === false && said.test(r.lines[0]) && readFileSync(join(rs, 'kept.md'), 'utf8') === 'theirs' && !existsSync(join(rs, `kept.md.tmp${process.pid}`)), `restore: a note that ${what} meanwhile is kept, and the snapshot is not written over it (got ${JSON.stringify(r)})`);
  }

  // The disk refuses a write: the reply gives the disk's own code (a directory
  // where the temp file goes, so the write fails the same way on every OS), the
  // index line goes last when the index has no archive line, and a restore that
  // fails writes nothing.
  const refuse = (target) => { const t = `${target}.tmp${process.pid}`; mkdirSync(t); return t; };
  const diskCode = (t) => { try { writeFileSync(t, 'x'); } catch (e) { return e.code; } return null; };
  const rf = mdir('C--mutB-rf'), wline = '- [Wnote](wnote.md) — restore write refused';
  memory(rf, 'wnote', 'restore write refused');
  writeFileSync(join(rf, 'MEMORY.md'), `# Index\n\n${wline}\n`);
  ok(tier().status === 0, 'the snapshot of the restore fixture is made');
  rmSync(join(rf, 'wnote.md'));
  let tmpDir = refuse(join(rf, 'wnote.md')), code = diskCode(tmpDir);
  try { r = await run(['restore', 'wnote', '--store', rf]); } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  ok(code && r.status === 1 && r.stdout.includes(`wnote.md could not be written (${code}); nothing restored`) && !existsSync(join(rf, 'wnote.md')), `a restore the disk refuses names the disk's code and writes nothing (got ${r.stdout})`);
  writeFileSync(join(rf, 'MEMORY.md'), '# Index\n');
  tmpDir = refuse(join(rf, 'MEMORY.md'));
  try { r = await run(['restore', 'wnote', '--store', rf]); } finally { rmSync(tmpDir, { recursive: true, force: true }); }
  ok(code && r.status === 0 && r.stdout.includes(`; its index line could not be written (${code}): the next turn's tiering gives it one`) && existsSync(join(rf, 'wnote.md')), `a restore whose index line the disk refuses says the disk's code, and keeps the note (got ${r.stdout})`);
  rmSync(join(rf, 'wnote.md'));
  writeFileSync(join(rf, 'MEMORY.md'), '# Index\n\n- [Other](other.md) — o\n');
  r = await run(['restore', 'wnote', '--store', rf]);
  ok(r.status === 0 && readFileSync(join(rf, 'MEMORY.md'), 'utf8').trimEnd().split('\n').at(-1) === wline, `an index line with no archive line to go before goes last (got ${r.stdout}${readFileSync(join(rf, 'MEMORY.md'), 'utf8')})`);

  // Promote: the line goes before the archive's; a shared index exactly at its ceiling is not over it; a missing shared store is made.
  const sharedWas = readFileSync(join(shared, 'MEMORY.md'), 'utf8');
  const ps = mdir('C--mutA-ps'), cap = budgetOf(shared), arch ='- [Archive](MEMORY-archive.md) — 3 older pointers';
  try {
    const capped = async (name, over) => {
      const l = `- [${name}](${name}.md) — cap note`;
      memory(ps, name, 'cap note');
      writeFileSync(join(ps, 'MEMORY.md'), l + '\n');
      writeFileSync(sharedIdx, `# Shared memory\n${'x'.repeat(cap + over - 2 - bytes(l) - bytes('# Shared memory\n') - 1 - bytes(arch))}\n${arch}\n`);
      return [l, await run(['promote', name, '--store', ps])];
    };
    const sharedIdx = join(shared, 'MEMORY.md');
    let [l, p] = await capped('capnote', 0);
    let ls = readFileSync(sharedIdx, 'utf8').split('\n');
    ok(p.status === 0 && bytes(readFileSync(sharedIdx, 'utf8')) === cap && /every project's sessions see its line/.test(p.stdout) && ls.indexOf(l) > 0 && ls.indexOf(l) === ls.indexOf(arch) - 1, `a promoted line goes before the archive's, and an index exactly at its ceiling is not over it (got ${p.stdout})`);
    [l, p] = await capped('capnote2', 1);
    ok(p.status === 0 && /The shared index is now \d+ of its \d+ bytes/.test(p.stdout), `one byte over the ceiling is said (got ${p.stdout})`);
    // A copy the disk refuses names the error's code, not its message.
    memory(ps, 'stuck2', 'cannot be copied');
    mkdirSync(join(shared, `stuck2.md.tmp${process.pid}`));
    const stuck = promote(ps, 'stuck2.md');
    rmSync(join(shared, `stuck2.md.tmp${process.pid}`), { recursive: true, force: true });
    ok(stuck.ok === false && /could not be written \(E[A-Z]+\); nothing moved$/.test(stuck.lines[0]), `a refused copy says its code (got ${JSON.stringify(stuck)})`);
    // The shared index, then the project's, refuse their write: each says the disk's code, and the note is in both stores.
    memory(ps, 'sh1', 'shared index refuses');
    tmpDir = refuse(join(shared, 'MEMORY.md')); code = diskCode(tmpDir);
    try { p = await run(['promote', 'sh1', '--store', ps]); } finally { rmSync(tmpDir, { recursive: true, force: true }); rmSync(join(shared, 'sh1.md'), { force: true }); }
    ok(code && p.status === 1 && p.stdout.includes(`the shared index could not be written (${code}): sh1.md is in both stores, not yet in the shared index`), `a shared index the disk refuses says the disk's code (got ${p.stdout})`);
    memory(ps, 'sh2', 'project index refuses');
    writeFileSync(join(ps, 'MEMORY.md'), '- [Sh2](sh2.md) — project index refuses\n');
    tmpDir = refuse(join(ps, 'MEMORY.md'));
    try { p = await run(['promote', 'sh2', '--store', ps]); } finally { rmSync(tmpDir, { recursive: true, force: true }); rmSync(join(shared, 'sh2.md'), { force: true }); }
    ok(code && p.status === 1 && p.stdout.includes(`the project index could not be written (${code}): sh2.md is in both stores; delete `), `a project index the disk refuses says the disk's code (got ${p.stdout})`);
    // With no shared store yet, promote makes it.
    renameSync(join(root, '_shared'), join(root, '_shared.away'));
    try {
      memory(ps, 'capnote3', 'cap note');
      p = await run(['promote', 'capnote3', '--store', ps]);
      ok(p.status === 0 && existsSync(join(shared, 'capnote3.md')), `promote makes the shared store when there is none (got ${p.stdout}${p.stderr})`);
    } finally { rmSync(join(root, '_shared'), { recursive: true, force: true }); renameSync(join(root, '_shared.away'), join(root, '_shared')); }
    // A name that opens a file by another spelling (case, on Windows and macOS) is that file, even past an entry stat cannot read.
    const od = mdir('C--mutA-od'), gone = join(root, 'od-gone');
    memory(od, 'alpha', 'cased');
    // On a case-sensitive disk the other-case name opens nothing, so there is nothing to test; windows-latest (the gate) runs it.
    if (existsSync(join(od, 'ALPHA.md'))) {
      mkdirSync(gone);
      symlinkSync(gone, join(od, 'aaa-dangling'), link);
      rmSync(gone, { recursive: true });
      p = await run(['promote', 'ALPHA', '--store', od]);
      ok(p.status === 0 && existsSync(join(shared, 'alpha.md')), `a name in other case moves the note it opens, past an unreadable entry (got ${p.stdout})`);
    }
  } finally {
    writeFileSync(join(shared, 'MEMORY.md'), sharedWas);
    for (const f of ['capnote', 'capnote2', 'capnote3', 'alpha']) rmSync(join(shared, `${f}.md`), { force: true });
  }

  // Part B: the numbers. A note's body starts where its frontmatter ends, and a note with none is all body.
  memory(jm, 'mn-aa', 'concatenated', 'x');
  memory(jm, 'mn-bb', 'plain', 'concatenated');
  writeFileSync(join(jm, 'mn-nofront.md'), 'quokka lives here\nsecond line\n');
  writeFileSync(join(jm, 'mn-tight.md'), '---\nname: mn-tight\ndescription: "tight"\n---\nzebu starts the body\n');
  r = await jcli('search', 'cat');
  ok(scoreOf(r.stdout, 'mn-aa.md') === 7 && scoreOf(r.stdout, 'mn-bb.md') === 3, `a three-letter term is found inside a longer word, in a description (+2, strong) and in a body (got ${r.stdout})`);
  ok(/mn-nofront\.md/.test((await jcli('search', 'quokka')).stdout), 'a note with no frontmatter is searched from its first line');
  ok(/mn-tight\.md/.test((await jcli('search', 'zebu')).stdout), 'a body that starts right after the closing --- is searched from its first character');
  // The closing --- is the file's last bytes: the body is empty, not the whole file with its frontmatter.
  writeFileSync(join(jm, 'mn-endfm.md'), '---\nname: mn-endfm\ndescription: "end"\nextra: okapi\n---');
  ok(!/mn-endfm\.md/.test((await jcli('search', 'okapi')).stdout), 'a note whose closing --- ends the file has an empty body, its frontmatter is not searched');
  // An empty frontmatter followed by a rule: the body is what follows the first fence, not what follows the rule.
  writeFileSync(join(jm, 'mn-hr.md'), '---\n---\nlemur is in the first part\n\n---\n\nthe second part\n');
  ok(/mn-hr\.md/.test((await jcli('search', 'lemur')).stdout), 'a note with an empty frontmatter and a later rule is searched from after its frontmatter');
  // A note whose stat fails has no date: it ranks below one stamped a millisecond after the epoch, whatever order the stores are read in.
  memory(jm, 'mn-nostat', 'pangolin');
  memory(shared, 'mn-stamped', 'pangolin', 'body', '  modified: 1970-01-01T00:00:00.001Z\n');
  const stat = fsm.statSync;
  fsm.statSync = (p, o) => { if (o === undefined && String(p).endsWith('mn-nostat.md')) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); return stat(p, o); };
  syncBuiltinESMExports();
  try { r = await jcli('search', 'pangolin'); } finally { fsm.statSync = stat; syncBuiltinESMExports(); rmSync(join(shared, 'mn-stamped.md'), { force: true }); }
  ok(r.stdout.indexOf('mn-stamped.md') !== -1 && r.stdout.indexOf('mn-stamped.md') < r.stdout.indexOf('mn-nostat.md'), `a note whose stat fails ranks below one stamped 1 ms after the epoch (got ${r.stdout})`);
  // A term in a file name counts 3 (and the +5 for every term), and a body's count is capped at 2 (+2 for every term).
  memory(jm, 'mn-ostrich', 'plain', 'x');
  memory(jm, 'mn-capped', 'plain', 'ostrich '.repeat(4));
  r = await jcli('search', 'ostrich');
  ok(scoreOf(r.stdout, 'mn-ostrich.md') === 8 && scoreOf(r.stdout, 'mn-capped.md') === 4, `a term in the name scores 3, one repeated in the body at most 2 (got ${r.stdout})`);
  // A term the note lacks earns nothing, and no bonus: the bonus is for every term.
  r = await jcli('search', 'ostrich', 'emu');
  ok(scoreOf(r.stdout, 'mn-ostrich.md') === 3 && scoreOf(r.stdout, 'mn-capped.md') === 2, `a note with one of two terms scores only what that term earns (got ${r.stdout})`);

  // A stretch that ends before the text does ends with an ellipsis; one past the room is cut to the room exactly; a three-letter term shows its stretch.
  const tail = fill(100) + 'omega' + fill(300), cutme = fill(100) + 'omega' + [1, 2, 3, 4, 5].map(() => fill(400) + 'omega').join('');
  day(jm, '2026-10-25', [entry('2026-10-25 10:00', 'omega tail', { answered: tail }), entry('2026-10-25 10:01', 'omega cut', { answered: cutme }), entry('2026-10-25 10:02', 'plain request', { answered: 'a concatenated string' })]);
  r = await jcli('search', 'omega');
  const ans = (out, marker) => (blocks(out).find((b) => b.includes(marker))?.split('\n').find((l) => l.startsWith('     Answered: ')) ?? '').slice('     Answered: '.length);
  ok(ans(r.stdout, 'Asked: omega tail') === `…${tail.slice(70, 135)}…`, `a stretch that stops before the end of the text ends with an ellipsis (got ${ans(r.stdout, 'Asked: omega tail')})`);
  const cut = ans(r.stdout, 'Asked: omega cut');
  ok(cut.length === 240 && cut.startsWith('…') && cut.endsWith('…'), `stretches past the room are cut to 240 characters, ellipsis included (got ${cut.length})`);
  ok(ans((await jcli('search', 'cat')).stdout, 'Asked: plain request').includes('concatenated'), 'a three-letter term shows its stretch inside a longer word');

  // The first column: a score is right-aligned to 3, the kind padded to 9. A note no run has filed yet is the unindexed one.
  memory(jm, 'mn-unfiled', 'zork', 'quux');
  r = await jcli('search', 'zork', 'quux');
  ok(/^  6  journal   2026-10-20 10:00  conversation c0ffee12$/m.test(r.stdout) && /^  5  unindexed \d{4}-\d\d-\d\d  \S/m.test(r.stdout), `a hit's line is the score in 3 columns, the kind in 9 (got ${r.stdout})`);
  r = await cli('search', 'deploy');
  ok(/^ +\d+  hot {7}\d{4}-\d\d-\d\d  /m.test(r.stdout) && /^ +\d+  archived {2}\d{4}-\d\d-\d\d  /m.test(r.stdout), `hot and archived hits are padded to 9 (got ${r.stdout})`);

  // --limit 1 lists one; forget --key as the last word is a key; a key and a word that misses blame the word.
  r = await jcli('search', '--since', '2026-10-21', '--until', '2026-10-21', '--limit', '1');
  ok(/^1 of 3 journal entries in [^;\n]+; --limit N shows more$/m.test(r.stdout), `--limit 1 lists one of the range (got ${r.stdout})`);
  r = await run(['forget', '--store', jm, '--key', 'ma000']);
  ok(r.status === 0 && r.stdout.includes('(key ma000)') && /^1 entry in /m.test(r.stdout), `--key as the last word names its entry (got ${r.stdout})`);
  r = await run(['forget', 'zzzz', '--store', jm, '--key', 'ma000']);
  ok(r.stdout.trim() === `nothing in ${jm} matches: no entry holds "zzzz"`, `a word that misses, with a key that exists, is blamed (got ${r.stdout})`);
  // --help where an option's value goes is no request for the usage: an option is no value, and is refused (audit C-7).
  r = await run(['status', '--conversation', '--help', '--store', jm]);
  ok(r.status === 1 && r.stdout === '--conversation needs a value after it\n' && /node memory\.mjs <command>/.test((await run(['status', '--help'])).stdout), `--help after an option that takes a value is not a request for the usage (got ${r.stdout})`);
  r = await run(['status', '--store', jm, '--help']);
  ok(/node memory\.mjs <command>/.test(r.stdout), `--help after an option's value is a request for the usage (got ${r.stdout})`);

  // A range forget names its first and last day; the snapshots' days are listed six at a time.
  const old7 = mdir('C--mutB-old'), days7 = [1, 2, 3, 4, 5, 6, 7].map((d) => `2025-02-0${d}`);
  for (const d of days7) day(old7, d, [{ ...entry(`${d} 10:00`, `old ${d}`), key: `ob${d.slice(-1)}` }]);
  r = await run(['forget', '--since', days7[0], '--until', days7[6], '--store', old7]);
  ok(r.status === 0 && r.stdout.includes(`7 entries in ${old7} from 2025-02-01 to 2025-02-07 would go; run again with --yes to remove them`), `a range forget says from which day to which (got ${r.stdout})`);
  r = await run(['forget', '--since', days7[0], '--until', days7[6], '--yes', '--store', old7]);
  ok(r.status === 0 && r.stdout.includes('the snapshots still hold the journal of 2025-02-01, 2025-02-02, 2025-02-03, 2025-02-04, 2025-02-05, 2025-02-06, and 1 more: ') && r.stdout.includes(`removed 7 from ${old7}`), `seven days in the snapshots: six listed, and 1 more (got ${r.stdout})`);

  // status: the handoff's exchanges, sessions and newest; the week's changes six at a time.
  const ho = mdir('C--mutB-ho');
  writeFileSync(join(ho, 'handoff.md'), '---\nname: handoff\n---\n\n<!-- auto:start -->\n_Written._\n\n- **asked** 2025-10-20 09:00 [aaaa1111]: first\n  **did:** done\n- **asked** 2025-10-21 09:00 [bbbb2222]: second\n  **did:** done\n<!-- auto:end -->\n');
  r = await run(['status', '--store', ho]);
  ok(/^  handoff: 2 exchanges from 2 session\(s\), newest 2025-10-21 09:00$/m.test(r.stdout), `status names the newest exchange, the last one (got ${r.stdout})`);
  const wk = mdir('C--mutB-wk');
  for (const c of 'abcdefg') memory(wk, `wk-${c}`, `week note ${c}`);
  writeFileSync(join(wk, 'MEMORY.md'), '# Index\n\n' + [...'abcdefg'].map((c) => `- [Wk ${c}](wk-${c}.md) — week note ${c}`).join('\n') + '\n');
  ok(tier().status === 0, 'the snapshot of the week fixture is made');
  r = await run(['status', '--store', wk]);
  ok(/changed in the last 7 days: added wk-a, wk-b, wk-c, wk-d, wk-e, wk-f, and 1 more$/m.test(r.stdout), `seven notes added this week: six named, and 1 more (got ${r.stdout})`);

  // Spawned: no word at all is the status; three stores are counted, not named.
  const bare = spawnSync(process.execPath, [CLI], { cwd: home, encoding: 'utf8' });
  ok(bare.status === 0 && /no store here yet/.test(bare.stdout), `the CLI run with no arguments prints the status (got ${bare.stdout}${bare.stderr})`);
  const h3 = { home: tempDir('mem3-') }, p3 = join(h3.home, '.claude', 'projects');
  const was = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  try {
    process.env.HOME = h3.home; process.env.USERPROFILE = h3.home;
    for (const p of ['C--one', 'C--two']) { mkdirSync(join(p3, p, 'memory'), { recursive: true }); writeFileSync(join(p3, p, 'memory', 'MEMORY.md'), '# Index\n'); }
    mkdirSync(join(p3, '_shared', 'memory'), { recursive: true });
    r = spawnSync(process.execPath, [CLI, 'search', 'zzqqxx', '--all'], { cwd: h3.home, encoding: 'utf8' });
  } finally { process.env.HOME = was.HOME; process.env.USERPROFILE = was.USERPROFILE; }
  ok(r.stdout.trim() === 'nothing matches "zzqqxx" in 3 stores', `three stores are counted (got ${r.stdout}${r.stderr})`);

  // Doctor, healthy: every line ok and exit 0; each check's own line; its limits.
  installed('project-memory@project-memory', gh, { source: 'github', repo: 'zdraveski/project-memory' });
  rmSync(join(live, '.deployed.json'), { force: true });
  writeFileSync(join(root, '.snapshot-health'), JSON.stringify({ lastOk: new Date().toISOString(), failures: 0 }));
  ranLog({ at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' });
  r = await cli('doctor');
  ok(r.status === 0 && !/^PROBLEM/m.test(r.stdout) && /^ok +installed as project-memory@project-memory$/m.test(r.stdout) && /^ok +git on PATH$/m.test(r.stdout) && !/locks a killed hook left/.test(r.stdout), `a healthy doctor says ok and exits 0 (got ${r.stdout})`);
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  try { r = await cli('doctor'); } finally { delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; }
  ok(r.status === 0 && /^ok +auto memory is off \(CLAUDE_CODE_DISABLE_AUTO_MEMORY\)/m.test(r.stdout), `auto memory off is said, and is no problem (got ${r.stdout})`);
  writeFileSync(join(live, '.deployed.json'), JSON.stringify({ commit: 'bbb', files: {} }));
  r = await cli('doctor');
  ok(r.status === 0 && r.stdout.includes(`ok      ${live} matches what deploy.mjs checked\n`), `a live copy that matches its deploy says so (got ${r.stdout})`);
  writeFileSync(join(live, '.deployed.json'), JSON.stringify({ commit: 'bbb', files: { 'gone.mjs': '0' } }));
  r = await cli('doctor');
  ok(r.status === 1 && /^PROBLEM Memory hooks changed outside deploy\.mjs, live and untested: gone\.mjs in /m.test(r.stdout), `a live copy edited since its deploy is a problem (got ${r.stdout})`);
  rmSync(join(live, '.deployed.json'));
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'project-memory@project-memory': [{}] } }));
  r = await cli('doctor');
  ok(r.status === 1 && /^PROBLEM project-memory@project-memory is listed as installed, but with no folder/m.test(r.stdout), `an install with no folder is a problem (got ${r.stdout})`);
  installed('project-memory@project-memory', gh, { source: 'github', repo: 'zdraveski/project-memory' });
  // Two runs exactly TWICE (2000 ms) apart are two replies; 1999 ms is one answered twice.
  const base = Date.now() - 60_000;
  ranLog({ at: iso(base), s: 'aaaaaaaa', from: 'C:/x' }, { at: iso(base + 2000), s: 'aaaaaaaa', from: 'C:/x' });
  ok(!/ran twice/.test((await cli('doctor')).stdout), 'two runs 2000 ms apart are not hooks wired twice');
  ranLog({ at: iso(base), s: 'aaaaaaaa', from: 'C:/x' }, { at: iso(base + 1999), s: 'aaaaaaaa', from: 'C:/x' });
  ok(/ran twice/.test((await cli('doctor')).stdout), 'two runs 1999 ms apart are');
  // Two quick replies of one conversation (a task's end answered in a line) are two runs for two replies, told apart by the
  // reply's fingerprint; one reply answered twice is still the hooks wired twice (audit H-F10).
  ranLog({ at: iso(base), s: 'aaaaaaaa', m: '11111111', from: 'C:/x' }, { at: iso(base + 500), s: 'aaaaaaaa', m: '22222222', from: 'C:/x' });
  ok(!/ran twice/.test((await cli('doctor')).stdout), 'two replies 500 ms apart are not hooks wired twice');
  ranLog({ at: iso(base), s: 'aaaaaaaa', m: '11111111', from: 'C:/x' }, { at: iso(base + 500), s: 'aaaaaaaa', m: '11111111', from: 'C:/x' });
  ok(/ran twice/.test((await cli('doctor')).stdout), 'one reply answered twice 500 ms apart is');
  // A .stop-ran that exists but won't stat (held by a scan, refused): doctor said nothing, a stack trace instead (audit H-F7).
  {
    const refuseStat = join(home, 'refuse-stat.mjs'), ranPath = join(root, '.stop-ran');
    writeFileSync(refuseStat, "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\nconst stat = fs.statSync;\n" +
      `fs.statSync = (p, ...a) => { if (String(p) === ${JSON.stringify(ranPath)}) throw Object.assign(new Error('EBUSY: resource busy or locked, stat'), { code: 'EBUSY', syscall: 'stat', path: String(p) }); return stat(p, ...a); };\nsyncBuiltinESMExports();\n`);
    r = spawnSync(process.execPath, ['--import', pathToFileURL(refuseStat).href, CLI, 'doctor', '--store', dir], { env, encoding: 'utf8' });
    ok(!/\n\s+at \S.*:\d+:\d+/.test(r.stderr) && new RegExp(`^ok +the Stop hook has run, but ${ranPath.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')} could not be read \\(EBUSY\\), so not when`, 'm').test(r.stdout),
      `a .stop-ran that won't stat is said, never a stack trace (got ${r.status}: ${r.stdout}${r.stderr.slice(0, 300)})`);
  }
  ranLog({ at: ago(60_000), s: 'aaaaaaaa', from: 'C:/x' });
  // A lock is a killed hook's only past LOCK_STALE; a store with none is not listed.
  const lock = join(dir, '.lock'), realNow = Date.now;
  mkdirSync(lock);
  try {
    const old = new Date(realNow() - 3600_000);
    utimesSync(lock, old, old);
    const mt = statSync(lock).mtimeMs;
    Date.now = () => mt + LOCK_STALE;
    const edge = await cli('doctor');
    Date.now = () => mt + LOCK_STALE + 1;
    const past = await cli('doctor');
    ok(!/locks a killed hook left/.test(edge.stdout) && past.status === 0 && new RegExp(`^ok +locks a killed hook left, taken over at the next write: ${lock.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}$`, 'm').test(past.stdout), `a lock exactly LOCK_STALE old is not stale, one ms more is (got ${edge.stdout} / ${past.stdout})`);
  } finally { Date.now = realNow; rmSync(lock, { recursive: true, force: true }); }
  // The reply that ended exactly GRACE ago is still waited for.
  rmSync(join(root, '.stop-ran'), { force: true });
  const T0 = realNow(), turn = (ms) => JSON.stringify({ type: 'assistant', timestamp: iso(ms), message: { usage: { input_tokens: 1 }, stop_reason: 'end_turn', content: [] } }) + '\n';
  writeFileSync(join(dirname(dir), 'sess-g.jsonl'), turn(T0 - GRACE));
  try {
    Date.now = () => T0;
    const waiting = await run(['doctor', '--session', 'sess-g']);
    Date.now = () => T0 + 1;
    const dead = await run(['doctor', '--session', 'sess-g']);
    ok(/^ok +waiting for Claude's first reply/m.test(waiting.stdout) && /^PROBLEM Claude finished a reply at /m.test(dead.stdout), `a reply GRACE old is waited for, one ms more is a dead hook (got ${waiting.stdout} / ${dead.stdout})`);
  } finally { Date.now = realNow; rmSync(join(dirname(dir), 'sess-g.jsonl')); }
  // The session's own transcript decides which folder is read, not the folder doctor runs in.
  const w1 = join(root, 'C--mutA-w1'), w2 = join(root, 'C--mutA-w2');
  mkdirSync(w1, { recursive: true });
  mkdirSync(w2, { recursive: true });
  writeFileSync(join(w1, 'sess-w.jsonl'), turn(T0 - 11 * 60_000));
  writeFileSync(join(w2, 'other-w.jsonl'), turn(T0 - 5 * 60_000));
  ranLog({ at: ago(10 * 60_000), s: 'aaaaaaaa', from: 'C:/x' });
  const longAgo = new Date(T0 - 10 * 60_000);
  utimesSync(join(root, '.stop-ran'), longAgo, longAgo);
  utimesSync(join(w1, 'sess-w.jsonl'), new Date(T0 - 12 * 60_000), new Date(T0 - 12 * 60_000));
  const cwdRun = spawnSync(process.execPath, [CLI, 'doctor', '--session', 'sess-w'], { env: noSession, cwd: w2, encoding: 'utf8' });
  ok(!/looks? stopped/.test(cwdRun.stdout) && /the Stop hook last ran/.test(cwdRun.stdout), `doctor reads the session's own project, whatever folder it runs in (got ${cwdRun.stdout}${cwdRun.stderr})`);
  // The newest conversation is judged itself, not only the newest other one: this session's reply is 11 minutes old and nothing saved since.
  const mine = join(dirname(dir), 'aaaaaaaa-s.jsonl'), theirs = join(dirname(dir), 'bbbbbbbb-s.jsonl');
  writeFileSync(mine, turn(T0 - 11 * 60_000));
  writeFileSync(theirs, turn(T0 - 30 * 60_000));
  ranLog({ at: ago(20 * 60_000), s: 'aaaaaaaa', from: 'C:/x' });
  utimesSync(join(root, '.stop-ran'), new Date(T0 - 20 * 60_000), new Date(T0 - 20 * 60_000));
  utimesSync(theirs, new Date(T0 - 5 * 60_000), new Date(T0 - 5 * 60_000));
  try { r = await run(['doctor', '--session', 'aaaaaaaa-s']); } finally { rmSync(mine, { force: true }); rmSync(theirs, { force: true }); }
  ok(r.status === 1 && /^PROBLEM Memory hooks look stopped: \[aaaaaaaa\] finished a reply at /m.test(r.stdout), `doctor judges the newest conversation, this session's own, as well as the newest other (got ${r.stdout})`);
}

// The end-to-end audit of 1.2.4's commands (C-1 to C-10).
{
  // C-1. journal.md is the plugin's pointer to the journal, as handoff.md is its record: promoted, the next Stop wrote it
  // again, it was in both stores, and every project's startup listed "Every exchange in this project".
  const had = existsSync(join(dir, 'journal.md'));
  if (!had) writeFileSync(join(dir, 'journal.md'), '---\nname: journal\ndescription: "Every exchange in this project"\n---\n\nbody\n');
  r = await cli('promote', 'journal');
  ok(r.status === 1 && /^only a memory is shared, not an index, the handoff or the journal$/m.test(r.stdout) && existsSync(join(dir, 'journal.md')) && !existsSync(join(shared, 'journal.md')),
    `promote journal is refused, as promote handoff is (got ${r.stdout})`);
  if (!had) rmSync(join(dir, 'journal.md'));
  // C-2. A name of several words, typed without quotes, was cut to its first: `restore my note` answered about my.md.
  memory(dir, 'two words', 'a note named in two words', 'the two words body');
  tier();
  r = await cli('history', 'two', 'words');
  ok(r.status === 0 && r.stdout.startsWith(join(dir, 'two words.md')), `history takes every word of a name (got ${r.stdout})`);
  rmSync(join(dir, 'two words.md'));
  r = await cli('restore', 'two', 'words');
  ok(r.status === 0 && readFileSync(join(dir, 'two words.md'), 'utf8').includes('the two words body'), `and so does restore (got ${r.stdout})`);
  // C-3. git's own words reached the user: "fatal: not a git repository" before the first snapshot, and "fatal: path '…' does
  // not exist in 'HEAD'" for a note no snapshot holds.
  memory(dir, 'c4-note', 'a note that exists', 'c4 body');
  renameSync(join(root, '.git'), join(root, '.git-away'));
  let h, s; try { h = await cli('history', 'c4-note'); s = await cli('restore', 'c4-note'); } finally { renameSync(join(root, '.git-away'), join(root, '.git')); }
  ok(h.status === 1 && s.status === 1 && h.stdout === s.stdout && /^no snapshots yet: project-memory takes the first at the end of a reply\n$/.test(h.stdout),
    `before the first snapshot, history and restore say so plainly (got ${h.stdout}${s.stdout})`);
  // Nor while the first is still being taken (a repository with no commit yet), nor from a repository in a folder above the
  // projects folder (a dotfiles ~/.claude): git found that one, and its history was read as the snapshots'.
  {
    const above = join(home, '.claude'), g = (...a) => spawnSync('git', a, { encoding: 'utf8' });
    renameSync(join(root, '.git'), join(root, '.git-away'));
    try {
      g('init', '-q', root);
      h = await cli('history', 'c4-note');
      rmSync(join(root, '.git'), { recursive: true, force: true });
      g('init', '-q', above); g('-C', above, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'dotfiles');
      s = await cli('history', 'c4-note');
    } finally { rmSync(join(above, '.git'), { recursive: true, force: true }); rmSync(join(root, '.git'), { recursive: true, force: true }); renameSync(join(root, '.git-away'), join(root, '.git')); }
    ok(/^no snapshots yet: /.test(h.stdout) && /^no snapshots yet: /.test(s.stdout), `a repository with no commit, or one above the projects folder, is no snapshot yet (got ${h.stdout}${s.stdout})`);
  }
  r = await cli('restore', 'never-was');
  ok(r.status === 1 && r.stdout === `no snapshot of never-was.md (looked in ${dir}): search <words> finds a memory's name\n`, `a note no snapshot holds is said plainly (got ${r.stdout})`);
  r = await cli('restore', 'c4-note', '--force', '--rev', 'deadbeef');
  ok(r.status === 1 && r.stdout === 'no snapshot of c4-note.md at deadbeef: history c4-note lists the ones that hold it\n', `and a commit that doesn't hold it (got ${r.stdout})`);
  // Any other failure of git is still git's own line, named at the commit it read (HEAD when none was given).
  {
    const failLog = join(home, 'fail-log.mjs');
    writeFileSync(failLog, "import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';\nconst run = cp.execFileSync;\n" +
      "cp.execFileSync = (f, a, ...o) => { if (Array.isArray(a) && a.includes('--diff-filter=D')) throw Object.assign(new Error('Command failed'), { stderr: 'fatal: a simulated failure\\n' }); return run(f, a, ...o); };\nsyncBuiltinESMExports();\n");
    r = spawnSync(process.execPath, ['--import', pathToFileURL(failLog).href, CLI, 'restore', 'never-was', '--store', dir], { env, encoding: 'utf8' });
    ok(r.status === 1 && r.stdout === 'no snapshot of C--mem-cli/memory/never-was.md at HEAD: fatal: a simulated failure\n', `another git failure is git's line, at HEAD (got ${r.stdout}${r.stderr})`);
  }
  // C-4. Without git, restore of a note that exists offered to replace it "with the snapshot", as though there were one.
  r = spawnSync(process.execPath, [CLI, 'restore', 'c4-note', '--store', dir], { env: { HOME: home, USERPROFILE: home, PATH: '', ...(process.env.NODE_V8_COVERAGE && { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }) }, encoding: 'utf8' });
  ok(r.status === 1 && /^git is not installed, so there are no snapshots/.test(r.stdout) && !/restore --force replaces it/.test(r.stdout), `without git, restore says there are no snapshots (got ${r.stdout}${r.stderr})`);
  rmSync(join(dir, 'c4-note.md'));
  // C-5. A date no calendar has was taken: --since 2026-02-30 searched, and forget --since 2026-13-45 said "nothing matches".
  for (const [o, bad] of [['--since', '2026-02-30'], ['--until', '2026-10-45'], ['--since', '2026-13-45'], ['--until', '2025-02-29'], ['--since', '2026-00-10']]) {
    r = await cli('forget', o, bad);
    ok(r.status === 1 && r.stdout === `${o} takes a date like 2026-10-01\n`, `${o} ${bad} is refused (got ${r.stdout})`);
  }
  ok((await cli('search', 'deploy', '--since', '2024-02-29')).status === 0 && (await cli('search', 'deploy', '--until', '2026-12-31')).status === 0, 'a leap day in a leap year, and the year\'s last day, are dates');
  // C-7. A valued option's value is never another option, nor missing: `forget --key --store X` took "--store" for the key, and a
  // last --key was dropped, so the words alone said what went.
  for (const args of [['forget', '--key', '--store', dir], ['forget', 'zebra', '--store', dir, '--key'], ['forget', '--key=--yes', '--store', dir]]) {
    r = await run(args);
    ok(r.status === 1 && r.stdout === '--key needs a value after it\n', `${args.join(' ')} is refused (got ${r.stdout})`);
  }
  r = await run(['search', 'zebra', '--store', dir, '--session']);
  ok(r.status === 0, `a last --session with nothing after it is no session, as when the skill's session id comes through empty (got ${r.status} ${r.stdout})`);
  r = await run(['forget', '--conversation', '--yes', '--store', dir]);
  ok(r.status === 1 && r.stdout === '--conversation needs a value after it\n', `so is --conversation with an option for its value (got ${r.stdout})`);
  // C-8. A name as the user's disk reads it: `history Pricing`, `history PRICING.MD` and a café typed composed, of a file named
  // decomposed, found nothing. In any letter case where the disk is so (Windows, macOS), in either Unicode form everywhere.
  const nfd = 'café-menu', nfc = nfd.normalize('NFC');
  memory(dir, 'pricing', 'the pricing tiers', 'pricing body');
  // What this folder does, not the platform: a macOS volume can be case-sensitive (and Windows can mark a folder so).
  const folds = existsSync(join(dir, 'PRICING.MD'));
  memory(dir, nfd, 'the café menu', 'café body');
  tier();
  const at = (out, f) => out.startsWith(`${join(dir, f)}\n`);
  for (const typed of ['Pricing', 'PRICING.MD']) {
    r = await cli('history', typed);
    ok(folds ? r.status === 0 && at(r.stdout, 'pricing.md') : r.status === 1, `history ${typed} finds pricing.md where the disk folds case, and only there (got ${r.stdout})`);
  }
  r = await cli('history', nfc);
  ok(r.status === 0 && at(r.stdout, `${nfd}.md`), `a name typed composed finds the note named decomposed (got ${r.stdout})`);
  // Deleted, by the names the snapshots had.
  rmSync(join(dir, 'pricing.md')); rmSync(join(dir, `${nfd}.md`));
  tier();
  r = await cli('history', nfc);
  ok(r.status === 0 && at(r.stdout, `${nfd}.md`) && /deleted$/m.test(r.stdout), `and once deleted, by the name the snapshots had (got ${r.stdout})`);
  r = await cli('restore', 'Pricing');
  ok(folds ? r.status === 0 && existsSync(join(dir, 'pricing.md')) && readdirSync(dir).includes('pricing.md') && !readdirSync(dir).includes('Pricing.md') : r.status === 1 && !existsSync(join(dir, 'pricing.md')),
    `restore Pricing brings back pricing.md under its own name where the disk folds case, and only there (got ${r.stdout})`);
  r = await cli('restore', nfc);
  ok(r.status === 0 && readdirSync(dir).includes(`${nfd}.md`) && !readdirSync(dir).includes(`${nfc}.md`), `restore of a name typed composed brings back the decomposed file (got ${r.stdout})`);
  // A note no snapshot holds yet, by the one name on disk that reads alike.
  memory(dir, 'promo-é', 'a lesson named decomposed', 'promo body');
  r = await cli('promote', 'promo-é');
  ok(r.status === 0 && readdirSync(shared).includes('promo-é.md') && !existsSync(join(dir, 'promo-é.md')), `promote of a name typed composed moves the decomposed file (got ${r.stdout})`);
  {
    // Two names the snapshots had that read alike are two notes: neither is taken for a third spelling. Nor is STRASSE taken
    // for straße, which NTFS keeps apart.
    const g = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' }).stdout.trim();
    const branch = g('symbolic-ref', 'HEAD'), from = g('rev-parse', 'HEAD'), msg = 'memory: alike\n';
    const alike = ['Twin', 'twin', 'dual-é-é', 'dual-é-é', 'straße', 'solo-é'];
    // Case kept: on Windows, git's core.ignorecase made the two one.
    const made = spawnSync('git', ['-C', root, '-c', 'core.ignorecase=false', 'fast-import', '--quiet'], { encoding: 'utf8', input: `commit ${branch}\ncommitter memory <memory@localhost> 1600000000 +0000\ndata ${Buffer.byteLength(msg)}\n${msg}from ${from}\n` +
      alike.map((n) => `M 100644 inline C--mem-cli/memory/${n}.md\ndata ${Buffer.byteLength(n) + 1}\n${n}\n`).join('') + '\n' });
    const miss = async (typed) => (await cli('history', typed)).stdout.startsWith(`no snapshot holds ${typed}.md `);
    ok(made.status === 0 && await miss('TWIN') && await miss('dual-é-é') && await miss('STRASSE') && !(await miss('Twin')),
      `a name two snapshot names read alike, or only a fold that NTFS does not make, is no name (got ${made.stderr}${(await cli('history', 'TWIN')).stdout})`);
    // A file on disk by the very name typed is that note, though no snapshot holds it yet: never the one the snapshots had
    // under the other Unicode form, a different file on Windows and Linux.
    writeFileSync(join(dir, 'solo-é.md'), 'a note not yet snapshotted\n');
    ok(await miss('solo-é'), `a name on disk as typed is not taken for another form the snapshots had (got ${(await cli('history', 'solo-é')).stdout})`);
    rmSync(join(dir, 'solo-é.md'));
  }
  {
    // A folder that is case-sensitive does not fold, whatever the platform: `promote alpha` took Alpha.md. Windows can mark a
    // folder so (fsutil, which may need a feature or admin rights); the others cannot be made here, and say so.
    const cs = join(root, 'C--mem-cs', 'memory');
    mkdirSync(cs, { recursive: true });
    const marked = process.platform === 'win32' && spawnSync('fsutil', ['file', 'setCaseSensitiveInfo', cs, 'enable'], { encoding: 'utf8' }).status === 0;
    if (!marked) console.log('skip: no case-sensitive folder can be made here, so a folder that does not fold is not tested');
    else {
      memory(cs, 'Alpha', 'a capital note');
      writeFileSync(join(cs, 'MEMORY.md'), '- [Alpha](Alpha.md) — a\n');
      r = await run(['promote', 'alpha', '--store', cs]);
      ok(r.status === 1 && existsSync(join(cs, 'Alpha.md')) && !existsSync(join(shared, 'Alpha.md')), `promote alpha does not take Alpha.md in a case-sensitive folder (got ${r.stdout})`);
      // Only lower-case names to ask with, then a name whose other case is another file, then a third name only the fold would match.
      const cs2 = join(root, 'C--mem-cs2', 'memory');
      mkdirSync(cs2, { recursive: true });
      spawnSync('fsutil', ['file', 'setCaseSensitiveInfo', cs2, 'enable'], { encoding: 'utf8' });
      memory(cs2, 'foxtrot', 'a lower-case note');
      r = await run(['promote', 'FOXTROT', '--store', cs2]);
      ok(r.status === 1 && existsSync(join(cs2, 'foxtrot.md')) && !existsSync(join(shared, 'foxtrot.md')), `promote FOXTROT does not take foxtrot.md in a case-sensitive folder of lower-case names (got ${r.stdout})`);
      memory(cs2, 'DELTA', 'a capital twin');
      memory(cs2, 'delta', 'a small twin');
      memory(cs2, 'Echo', 'a third note');
      r = await run(['promote', 'echo', '--store', cs2]);
      ok(r.status === 1 && existsSync(join(cs2, 'Echo.md')) && !existsSync(join(shared, 'Echo.md')), `a name whose other case is another file is no sign the folder folds (got ${r.stdout})`);
    }
  }
  {
    // A name whose other case is longer (aß, ASS on upper-casing) asks nothing: NTFS opens STRAßE for straße, not STRASSE, so
    // taking it for an answer made a folder that folds read as one that doesn't, and `history ZETA` missed a deleted zeta.md.
    const sz = join(root, 'C--mem-sz', 'memory');
    mkdirSync(sz, { recursive: true });
    memory(sz, 'aß', 'a sharp s first in the folder');
    memory(sz, 'zeta', 'the note asked for');
    tier();
    rmSync(join(sz, 'zeta.md'));
    tier();
    r = await run(['history', 'ZETA', '--store', sz]);
    ok((r.status === 0) === (process.platform === 'win32' || process.platform === 'darwin'), `a sharp s first in the folder does not hide that it folds (got ${r.status}: ${r.stdout})`);
  }
  {
    // A folder whose notes were all deleted still folds case as the platform does. Its MEMORY.md answers the probe, so the
    // platform fallback itself (a folder with no cased name at all) is not reached here.
    const em = join(root, 'C--mem-empty', 'memory');
    mkdirSync(em, { recursive: true });
    memory(em, 'pricing', 'the pricing tiers');
    tier();
    rmSync(join(em, 'pricing.md'));
    tier();
    r = await run(['history', 'PRICING', '--store', em]);
    ok((r.status === 0) === (process.platform === 'win32' || process.platform === 'darwin'), `a folder of deleted notes folds case as the platform does (got ${r.status}: ${r.stdout})`);
  }
  // C-9. Under --all, a hit named its project by its folder (`C--work-api-server`), no name a person reads: now by the folder its
  // conversations started in, then the folder --store needs. A project with no conversation on disk keeps the folder alone.
  const rp = join(root, 'C--work-readable'), rd = join(rp, 'memory');
  mkdirSync(join(rd, 'journal'), { recursive: true });
  writeFileSync(join(rp, 'rrrrrrrr-1.jsonl'), JSON.stringify({ type: 'user', uuid: 'rd-1', cwd: 'C:\\work\\readable', timestamp: '2026-10-20T10:00:00Z', message: { role: 'user', content: 'the narwhal plan' } }) + '\n');
  writeFileSync(join(rd, 'journal', '2026-10-20.md'), '# Journal 2026-10-20\n\n<!-- j:rd-1 t:C--work-readable/rrrrrrrr-1 d:2026-10-20 -->\n## 10:00 · conversation rrrrrrrr\n**Asked:** the narwhal plan\n**Answered:** drafted it\n');
  r = await run(['search', 'narwhal', '--all']);
  ok(/^ *\d+  journal   2026-10-20 10:00  conversation rrrrrrrr · project C:\\work\\readable \(C--work-readable\)$/m.test(r.stdout), `a hit under --all names its project by its folder on disk, and its store's folder (got ${r.stdout})`);
  r = await run(['show', 'rd-1', '--all']);
  ok(/^2026-10-20 10:00  conversation rrrrrrrr · project C:\\work\\readable \(C--work-readable\)$/m.test(r.stdout), `and so does show --all (got ${r.stdout})`);
  // C-10. status said "1 days", counted the plugin's own handoff.md and journal.md, before the index has their lines, as notes
  // with no pointer, and took a --session no transcript has for the folder it ran in, in silence.
  writeFileSync(join(rd, 'handoff.md'), '---\nname: handoff\ndescription: "where you left off"\nmetadata:\n  type: project\n---\n\n');
  writeFileSync(join(rd, 'journal.md'), '---\nname: journal\ndescription: "every exchange"\nmetadata:\n  type: reference\n---\n\n');
  r = await run(['status', '--store', rd]);
  ok(/^  journal: 1 day since 2026-10-20, /m.test(r.stdout) && /^  index 0 \/ 7000 B · 0 hot · 0 archived$/m.test(r.stdout), `one day is "1 day", and the plugin's own files are no notes without a pointer (got ${r.stdout})`);
  memory(rd, 'loose', 'a note with no line yet');
  ok(/^  index 0 \/ 7000 B · 0 hot · 0 archived · 1 with no pointer yet$/m.test((await run(['status', '--store', rd])).stdout), 'a note of the user\'s still is');
  r = await run(['status', '--session', 'no-such-conversation']);
  ok(r.status === 0 && /^no conversation no-such-conversation on this machine, so this is the store of the folder this runs in: /.test(r.stdout), `a --session no transcript has is said (got ${r.stdout})`);
  ok(!/^no conversation/m.test((await run(['status', '--session', 'rrrrrrrr-1'])).stdout) && !/^no conversation/m.test((await run(['status', '--session', 'no-such-conversation', '--store', rd])).stdout),
    'not for one that has, nor when --store names the store');
}

// 99. incognito, memory off and memory on.
{
  const proj = join(root, 'C--incog'), d = join(proj, 'memory'), cwd = 'C:\\incog';
  mkdirSync(d, { recursive: true });
  const SID = 'aaaaaaaa-1111', TID = 'bbbbbbbb-2222', UID = 'cccccccc-3333';
  const line = (type, text, c = cwd) => JSON.stringify({ type, cwd: c, timestamp: new Date().toISOString(), message: { content: [{ type: 'text', text }] } });
  const turn = (id, ask, answer) => appendFileSync(join(proj, `${id}.jsonl`), `${line('user', ask)}\n${line('assistant', answer)}\n`);
  const stopOf = (id, event = 'Stop') => spawnSync(process.execPath, [TIER, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ cwd, session_id: id, transcript_path: join(proj, `${id}.jsonl`), hook_event_name: event }) });
  const everything = () => { let t = ''; for (const f of readdirSync(d, { recursive: true })) { try { t += `\n#${f}\n` + readFileSync(join(d, f), 'utf8'); } catch {} } return t; };
  const listing = () => readdirSync(d, { recursive: true }).sort().map((f) => `${f}:${statSync(join(d, f)).mtimeMs}`).join('|');
  turn(SID, 'tell me about narwhal tusks', 'a narwhal tusk is a tooth');
  turn(TID, 'tell me about otters', 'otters hold hands');
  ok(stopOf(SID).status === 0 && stopOf(TID).status === 0 && /narwhal/.test(everything()), 'before: both conversations are recorded');
  // Refused, and nothing written.
  const frozen = listing();
  for (const a of [[], ['--session', '../x'], ['--session', '${CLAUDE_SESSION_ID}'], ['--session', 'dddddddd-9999']]) {
    r = await run(['incognito', '--store', d, ...a]);
    ok(r.status === 1 && /incognito/.test(r.stdout) && listing() === frozen && !existsSync(join(d, '.private-sessions')), `incognito ${a.join(' ')} is refused and writes nothing (got ${r.status} ${r.stdout.trim()})`);
  }
  // A held lock: not applied, said so.
  mkdirSync(join(d, '.lock'));
  r = await run(['incognito', '--session', SID]);
  rmSync(join(d, '.lock'), { recursive: true });
  ok(r.status === 1 && /^incognito NOT applied/m.test(r.stdout) && !existsSync(join(d, '.private-sessions')), `a held lock: incognito NOT applied, exit 1, nothing marked (got ${r.stdout.trim()})`);
  r = await run(['incognito', '--session', SID]);
  ok(r.status === 0 && /Claude Code by default still keeps its own transcript/.test(r.stdout) && /its own auto memory may still save notes/.test(r.stdout)
    && /snapshots of days already over keep a copy/.test(r.stdout) && /save no note unless the user asks/.test(r.stdout), `incognito says what it does not cover (got ${r.stdout.trim()})`);
  ok(readFileSync(join(d, '.private-sessions'), 'utf8').includes('aaaaaaaa') && !/narwhal/.test(everything()) && /otters/.test(everything()), 'the turns so far are swept at once, the other conversation stays');
  turn(SID, 'and what about pelican beaks', 'a pelican beak holds water');
  ok(stopOf(SID).status === 0 && stopOf(SID, 'PreCompact').stdout === '' && !/narwhal|pelican/.test(everything()), 'the next Stop and a manual PreCompact in it record nothing');
  turn(TID, 'tell me about seals', 'seals bark');
  stopOf(TID);
  ok(/seals/.test(everything()) && !/narwhal|pelican/.test(everything()), 'another conversation\'s Stop does not bring it back');
  // A Stop in it still tiers and repairs the index; a note written in it is kept and indexed (known limit).
  writeFileSync(join(d, 'kept.md'), '---\nname: kept\ndescription: "kept note"\nmetadata:\n  type: project\n---\nbody\n');
  utimesSync(join(d, 'kept.md'), tenMin, tenMin);
  rmSync(join(d, 'MEMORY.md'), { force: true });
  stopOf(SID);
  ok(existsSync(join(d, 'MEMORY.md')) && /kept\.md/.test(readFileSync(join(d, 'MEMORY.md'), 'utf8')), 'a Stop in it still repairs the index, and a note written during it is indexed');
  r = await run(['search', 'seals', '--store', d]);
  ok(/seals/.test(r.stdout), 'search still finds earlier work');
  const start = spawnSync(process.execPath, [tool('handoff-log.mjs'), '--print'], { env, encoding: 'utf8', input: JSON.stringify({ cwd, session_id: UID, source: 'startup' }) }).stdout;
  ok(/seals/.test(start) && !/narwhal|pelican/.test(start), 'a startup after it still briefs, without it');

  // memory off / on.
  const ofd = join(root, 'C--off-cli', 'memory');
  const go = (...a) => run([...a, '--store', ofd]);
  r = await go('off');
  ok(r.status === 0 && existsSync(join(ofd, '.project-off')) && /Off stops adding; it doesn't hide/.test(r.stdout) && /Claude Code by default still keeps its own transcript/.test(r.stdout), `memory off with no store folder makes it and the marker (got ${r.stdout.trim()})`);
  r = await go('status');
  ok(/memory is off in this project since \d{4}-\d\d-\d\d; next: run memory on if the user asks to turn it back on/.test(r.stdout), `status prints the off line (got ${r.stdout})`);
  memory(ofd, 'findable', 'a findable thing about axolotls');
  ok(/findable/.test((await go('search', 'axolotls')).stdout), 'search still answers in an off project');
  ok(/memory is off in this project since/.test((await run(['doctor', '--store', ofd])).stdout), 'doctor prints the off line');
  writeFileSync(join(ofd, '.project-off'), 'garbage');
  ok(/since an unknown date/.test((await go('status')).stdout), 'a marker that does not read is off since an unknown date');
  // A conversation that ran while it was off is not imported into the journal once memory is on.
  const OC = 'C:\\off-cli', oproj = dirname(ofd), OID = 'eeeeeeee-4444';
  appendFileSync(join(oproj, `${OID}.jsonl`), `${line('user', 'a secret axolotl plan', OC)}\n${line('assistant', 'noted', OC)}\n`);
  // Old enough that a backfill would take it (a live one is left alone), but after the off time.
  writeFileSync(join(ofd, '.project-off'), JSON.stringify({ t: Date.now() - 3 * 864e5 }));
  utimesSync(join(oproj, `${OID}.jsonl`), new Date(Date.now() - 864e5), new Date(Date.now() - 864e5));
  // Asked in the very millisecond memory goes on: still while it was off (macOS CI, 2026-11-09).
  const realNow = Date.now, askedAt = Date.parse(JSON.parse(readFileSync(join(oproj, `${OID}.jsonl`), 'utf8').split('\n')[0]).timestamp);
  Date.now = () => askedAt;
  try { r = await go('on'); } finally { Date.now = realNow; }
  ok(r.status === 0 && !existsSync(join(ofd, '.project-off')) && /memory is on/.test(r.stdout), `memory on removes the marker (got ${r.stdout.trim()})`);
  appendFileSync(join(oproj, 'ffffffff-5555.jsonl'), `${line('user', 'after on', OC)}\n${line('assistant', 'fine', OC)}\n`);
  spawnSync(process.execPath, [TIER, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ cwd: 'C:\\off-cli', session_id: 'ffffffff-5555', transcript_path: join(oproj, 'ffffffff-5555.jsonl'), hook_event_name: 'Stop' }) });
  ok(!/secret axolotl plan/.test(readdirSync(ofd, { recursive: true }).map((f) => { try { return readFileSync(join(ofd, f), 'utf8'); } catch { return ''; } }).join('\n')), 'a conversation from while it was off is not imported once it is on');
  r = await go('on');
  ok(r.status === 0 && /already on/.test(r.stdout), 'memory on when it is on says so');
  // One conversation across off and on: what it said before and after stays, what it said while off does not.
  {
    const sd = join(root, 'C--span', 'memory'), sproj = dirname(sd), SC = 'C:\\span', SPAN = '99999999-6666', t = join(sproj, `${SPAN}.jsonl`), now = Date.now();
    mkdirSync(sd, { recursive: true });
    const say = (ask, ago) => {
      const row = (type, text) => JSON.stringify({ type, cwd: SC, timestamp: new Date(now - ago).toISOString(), message: { content: [{ type: 'text', text }] } });
      appendFileSync(t, `${row('user', ask)}\n${row('assistant', 'noted')}\n`);
      return spawnSync(process.execPath, [TIER, '--stop'], { env, encoding: 'utf8', input: JSON.stringify({ cwd: SC, session_id: SPAN, transcript_path: t, hook_event_name: 'Stop' }) });
    };
    const saved = () => readdirSync(sd, { recursive: true }).map((f) => { try { return readFileSync(join(sd, f), 'utf8'); } catch { return ''; } }).join('\n');
    say('span walrus before', 3 * 36e5);
    ok(/span walrus before/.test(saved()), 'spanning: the turn before off is saved');
    r = await run(['off', '--store', sd]);
    writeFileSync(join(sd, '.project-off'), JSON.stringify({ t: now - 2 * 36e5 }));
    say('span secret during', 36e5);
    r = await run(['on', '--store', sd]);
    // A minute ahead of `now`: on a slow machine `on` ran more than a second after `now`, the off period closed after this
    // turn's time, and the turn was rightly dropped as asked while off (2026-11-13).
    say('span walrus after', -60_000);
    const text = saved(), day = readdirSync(join(sd, 'journal')).filter((f) => f.endsWith('.md')).map((f) => readFileSync(join(sd, 'journal', f), 'utf8')).join('\n');
    ok(/span walrus before/.test(day), `spanning: the turn before off stays in the journal (got ${day.slice(0, 200)})`);
    ok(/span walrus after/.test(day), `spanning: the turn after on is journaled (got ${day.slice(0, 200)})`);
    ok(/span walrus after/.test(readFileSync(join(sd, 'handoff.md'), 'utf8')), 'spanning: the turn after on reaches handoff.md');
    ok(!/span secret during/.test(text), 'spanning: the turn while off is saved nowhere');
  }
  // A marker that cannot be removed: not applied, exit 1.
  writeFileSync(join(ofd, '.project-off'), '{}');
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = (p, ...a) => { if (String(p).endsWith('.project-off')) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return realUnlink(p, ...a); };
  syncBuiltinESMExports();
  try { r = await go('on'); } finally { fs.unlinkSync = realUnlink; syncBuiltinESMExports(); }
  ok(r.status === 1 && /memory on NOT applied/.test(r.stdout) && existsSync(join(ofd, '.project-off')), `a marker that cannot be removed: NOT applied, exit 1 (got ${r.stdout.trim()})`);
}

console.log(`memory: ${checks} checks passed`);
