// Self-check for memory.mjs, the memory CLI, part 1 of 3: ranked search, status, history and restore from real snapshots, promote, and the start of doctor. Split from the old memory.test.mjs so the three run side by side.
import fs, { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, utimesSync, rmSync, symlinkSync, readdirSync, chmodSync, renameSync, statSync, appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';
import { tool, tempHome, quick, capture } from './harness.mjs';

const CLI = tool('src/memory.mjs'), TIER = tool('src/memory-tier.mjs');
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
const { main, parseArgs, OPTIONS } = await import(pathToFileURL(CLI).href);
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
ok(order(r.stdout).indexOf('a-long-log') < order(r.stdout).indexOf('deploy-notes'), 'and a log that mentions both terms outranks a note named for only the common one: the rarer term (steps) counts for more');
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
// Item 5: a handoff.md past 64 KB is named in status, with how to trim it.
{
  const hp = join(dir, 'handoff.md'), keep = existsSync(hp) ? readFileSync(hp) : null;
  writeFileSync(hp, 'x'.repeat(70 * 1024));
  const big = await cli('status');
  if (keep === null) rmSync(hp); else writeFileSync(hp, keep);
  ok(/needs attention: handoff\.md is 70 KB \(over 64 KB\)\. To trim it: delete the finished topics/.test(big.stdout), `status warns of a big handoff.md (got ${big.stdout})`);
  ok(!/handoff\.md is \d+ KB/.test((await cli('status')).stdout), 'a handoff.md under the size gets no warning');
}
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
ok(r.status === 0 && /  \S+ \S+ \S+  deleted\n    by: [^\n]*\n  \S+ \S+ \S+  in the first snapshot\n    by: /m.test(r.stdout), `history lists the snapshots that changed it, newest first; the first snapshot is not called its writing (got ${r.stdout})`);
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
// A blob nothing refers to is dangling: gc deletes it. Kept under a ref, it survives (defect hunt 1.3.2, C7).
ok(kept && spawnSync('git', ['-C', kept[1], 'for-each-ref', '--format=%(objectname)', 'refs/project-memory/replaced/'], { encoding: 'utf8' }).stdout.trim() === kept[2], 'and under a ref, so a git gc keeps it');
r = await cli('restore', 'deploy-notes', '--force');
ok(r.status === 1 && /already matches/.test(r.stdout), `a restore that would change nothing says so, not "restored" (got ${r.stdout.trim()})`);
// The copy of what --force replaces cannot be kept (its object folder is a file here): nothing is replaced (1.3.1 audit D-8).
{
  const hashOf = (t) => spawnSync('git', ['hash-object', '--stdin'], { input: t, encoding: 'utf8' }).stdout.trim();
  let again = 'scribbled again';
  while (existsSync(join(kept[1], '.git', 'objects', hashOf(again).slice(0, 2)))) again += '!';   // a folder not there yet, so a file can take its place
  writeFileSync(join(dir, 'deploy-notes.md'), again);
  const sha = hashOf(again), slot = join(kept[1], '.git', 'objects', sha.slice(0, 2));
  writeFileSync(slot, '');
  r = await cli('restore', 'deploy-notes', '--force');
  ok(r.status === 1 && readFileSync(join(dir, 'deploy-notes.md'), 'utf8') === again && /could not be copied into the snapshots first; nothing restored/.test(r.stdout), `--force replaces nothing when it cannot keep a copy, and says so (got ${r.stdout.trim()})`);
  // Other text, whose copy goes to another object folder: on Windows the one just removed can stay unusable a moment
  // while a scanner holds it (1.3.1 mutant run).
  let other = 'scribbled thrice';
  while (spawnSync('git', ['hash-object', '--stdin'], { input: other, encoding: 'utf8' }).stdout.slice(0, 2) === sha.slice(0, 2)) other += '!';
  writeFileSync(join(dir, 'deploy-notes.md'), other);
  r = await cli('restore', 'deploy-notes', '--force');
  ok(r.status === 0, `and once it can, --force restores (got ${r.stdout.trim()})`);
  unlinkSync(slot);
}
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
// An option the command does not take is refused, not ignored (audit 5).
const given = [['show', 'k', '--key', 'k'], ['search', 'x', '--rev', 'abc'], ['status', '--yes']];
for (const g of given) {
  const o = g.find((a, i) => a.startsWith('--') && i > 0 && g[0] !== a);
  r = await cli(...g);
  ok(r.status === 1 && r.stdout === `${g[0]} does not take ${o}; help lists the options\n`, `${g[0]} refuses ${o} (got ${r.stdout})`);
}
// 1.5.2 review: a command named like a built-in object (constructor, toString) is an unknown command, not a crash.
for (const g of [['constructor', '--all'], ['toString', '--session', 'abc']]) {
  r = await cli(...g);
  ok(r.status === 1 && r.stdout.startsWith(`no command "${g[0]}"`), `${g[0]} is an unknown command (got ${r.stdout}${r.stderr})`);
}
// --since after --until matches no day: refused, not "nothing matches" (audit 17).
r = await cli('search', '--since', '2026-11-12', '--until', '2026-11-01');
ok(r.status === 1 && r.stdout === '--since 2026-11-12 is after --until 2026-11-01\n', `--since after --until is refused (got ${r.stdout})`);
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
// A note that is not UTF-8 comes back as the bytes the snapshot has, not with U+FFFD (C3); a wrapped index line comes back whole (C2).
{
  const bytes = Buffer.concat([Buffer.from('---\nname: latin-back\ndescription: "l"\n---\ncaf'), Buffer.from([0xe9]), Buffer.from('\n')]);
  writeFileSync(join(dir, 'latin-back.md'), bytes);
  const wrapped = '- [Back](latin-back.md) — a hook that is long and\n  wrapped onto a second line\n', idxNow = readFileSync(join(dir, 'MEMORY.md'), 'utf8');
  writeFileSync(join(dir, 'MEMORY.md'), idxNow.replace(/\n*$/, '\n') + wrapped);
  tier();
  unlinkSync(join(dir, 'latin-back.md'));
  writeFileSync(join(dir, 'MEMORY.md'), idxNow);
  r = await cli('restore', 'latin-back');
  ok(r.status === 0 && readFileSync(join(dir, 'latin-back.md')).equals(bytes), `restore writes the snapshot's bytes (got ${r.stdout.trim()})`);
  ok(readFileSync(join(dir, 'MEMORY.md'), 'utf8').includes(wrapped), `and the wrapped index line whole (got ${readFileSync(join(dir, 'MEMORY.md'), 'utf8')})`);
  // A current note that really holds U+FFFD is not "already that version" of a snapshot with a latin-1 byte.
  writeFileSync(join(dir, 'latin-back.md'), Buffer.concat([Buffer.from('---\nname: latin-back\ndescription: "l"\n---\ncaf'), Buffer.from('�'), Buffer.from('\n')]));
  r = await cli('restore', 'latin-back', '--force');
  ok(r.status === 0 && !/already matches/.test(r.stdout) && readFileSync(join(dir, 'latin-back.md')).equals(bytes), `a note with U+FFFD is not taken for the snapshot's latin-1 byte (got ${r.stdout.trim()})`);
  unlinkSync(join(dir, 'latin-back.md'));
  writeFileSync(join(dir, 'MEMORY.md'), idxNow);
}
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
// A project memory named with --shared was "in the shared store already", a store it never reached (defect hunt 1.4.3, L5-3).
memory(dir, 'xylophone-only', 'a xylophone lesson');
r = await cli('promote', 'xylophone-only', '--shared');
ok(r.status === 1 && /drop --shared/.test(r.stdout) && !/already/.test(r.stdout) && existsSync(join(dir, 'xylophone-only.md')), `promote --shared of a project memory says to drop --shared (got: ${r.stdout.trim()})`);
rmSync(join(dir, 'xylophone-only.md'));
// A name with brackets and no index line: the line made for it reads back.
// Words no later search uses: a hit they added changed its count.
memory(dir, '[draft] okapi', 'an okapi still in draft');
r = await cli('promote', '[draft] okapi');
ok(r.status === 0 && /^- \[draft okapi\]\(\[draft\] okapi\.md\) — an okapi still in draft$/m.test(readFileSync(join(shared, 'MEMORY.md'), 'utf8')),
  `a promoted name with brackets gets a line POINTER reads (got ${r.stdout})`);
// A note that is not UTF-8 text is not copied through a string, and its original not deleted (defect hunt 1.3.2, C1).
{
  const bytes = Buffer.concat([Buffer.from('---\nname: latin-note\ndescription: "l"\n---\ncaf'), Buffer.from([0xe9]), Buffer.from('\n')]);
  writeFileSync(join(dir, 'latin-note.md'), bytes);
  r = await cli('promote', 'latin-note');
  ok(r.status === 1 && /not UTF-8/.test(r.stdout) && readFileSync(join(dir, 'latin-note.md')).equals(bytes) && !existsSync(join(shared, 'latin-note.md')), `promote refuses a note that is not UTF-8 and keeps it (got ${r.stdout.trim()})`);
  unlinkSync(join(dir, 'latin-note.md'));
}
// A hook wrapped onto a second line moves with its pointer, to the shared index, and the project index keeps none of it (C2).
{
  memory(dir, 'wrap-note', 'w');
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace(/\n*$/, '\n') + '- [Wrap](wrap-note.md) — a hook that is long and\n  wrapped onto a second line\n- [After](after-wrap.md) — next\n');
  r = await cli('promote', 'wrap-note');
  ok(r.status === 0 && !/wrapped onto|wrap-note/.test(readFileSync(join(dir, 'MEMORY.md'), 'utf8')) && readFileSync(join(dir, 'MEMORY.md'), 'utf8').includes('- [After](after-wrap.md) — next'), `promote leaves no part of a wrapped line behind (got ${readFileSync(join(dir, 'MEMORY.md'), 'utf8')})`);
  ok(readFileSync(join(shared, 'MEMORY.md'), 'utf8').includes('- [Wrap](wrap-note.md) — a hook that is long and\n  wrapped onto a second line\n'), `and the shared index gets all of it (got ${readFileSync(join(shared, 'MEMORY.md'), 'utf8')})`);
  writeFileSync(join(dir, 'MEMORY.md'), readFileSync(join(dir, 'MEMORY.md'), 'utf8').replace('- [After](after-wrap.md) — next\n', ''));
}
// Promote keeps each index in its own line endings: a CRLF one was written back LF, and tiering then kept it LF (audit I-F4).
{
  const dirIdx = join(dir, 'MEMORY.md'), sharedIdx = join(shared, 'MEMORY.md');
  const dirWas = readFileSync(dirIdx, 'utf8'), sharedWas = existsSync(sharedIdx) ? readFileSync(sharedIdx, 'utf8') : null;
  const crlf = (t) => t.replace(/\r?\n/g, '\r\n'), allCrlf = (t) => !/(^|[^\r])\n/.test(t) && t.endsWith('\r\n');
  memory(dir, 'eol-note', 'c');
  writeFileSync(dirIdx, crlf(dirWas.replace(/\n*$/, '\n') + '- [Eol](eol-note.md) — a hook that is long and\n  wrapped onto a second line\n'));
  writeFileSync(sharedIdx, crlf(sharedWas ?? '# Shared memory\n'));
  r = await cli('promote', 'eol-note');
  const home = readFileSync(dirIdx, 'utf8'), there = readFileSync(sharedIdx, 'utf8');
  ok(r.status === 0 && !home.includes('eol-note') && allCrlf(home), `promote writes a CRLF project index back CRLF (got ${JSON.stringify(home)})`);
  ok(there.includes('- [Eol](eol-note.md) — a hook that is long and\r\n  wrapped onto a second line\r\n') && allCrlf(there), `and adds its line to a CRLF shared index in CRLF, wrap and all (got ${JSON.stringify(there)})`);
  writeFileSync(dirIdx, dirWas);
  if (sharedWas === null) rmSync(sharedIdx, { force: true }); else writeFileSync(sharedIdx, sharedWas);
  rmSync(join(shared, 'eol-note.md'), { force: true });
}
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
r = await cli('search', 'a ? I');
ok(r.status === 0 && /^nothing to search for: "a \? I" has no word that says which memory$/m.test(r.stdout), `a query with no word at all says so, not "nothing matches" (got ${r.stdout})`);

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
// matcher and its flag, run by node from the plugin's folder. PreToolUse has two handlers, one per `if` rule.
const hookFile = JSON.parse(readFileSync(tool('hooks/hooks.json'), 'utf8'));
const wiring = Object.entries(hookFile.hooks).flatMap(([ev, es]) => es.flatMap((e) => e.hooks.map((x) =>
  `${ev} | ${e.matcher || ''} | ${x.command} ${(x.args || []).join(' ')}`))).sort();
ok(JSON.stringify(wiring) === JSON.stringify(['PostToolUse | Edit|Write|NotebookEdit | node ${CLAUDE_PLUGIN_ROOT}/src/recall-hook.mjs', 'PreCompact | auto | node ${CLAUDE_PLUGIN_ROOT}/src/compact-gate.mjs', 'PreCompact | manual | node ${CLAUDE_PLUGIN_ROOT}/src/memory-tier.mjs --stop',
  'PreToolUse | Bash|PowerShell | node ${CLAUDE_PLUGIN_ROOT}/src/enforce-hook.mjs', 'PreToolUse | Bash|PowerShell | node ${CLAUDE_PLUGIN_ROOT}/src/enforce-hook.mjs',
  'SessionEnd |  | node ${CLAUDE_PLUGIN_ROOT}/src/recall-hook.mjs', 'SessionStart | startup|resume|clear|compact | node ${CLAUDE_PLUGIN_ROOT}/src/brief.mjs --print', 'Stop |  | node ${CLAUDE_PLUGIN_ROOT}/src/memory-tier.mjs --stop', 'StopFailure |  | node ${CLAUDE_PLUGIN_ROOT}/src/memory-tier.mjs --stop', 'SubagentStop |  | node ${CLAUDE_PLUGIN_ROOT}/src/memory-tier.mjs --stop',
  'UserPromptSubmit |  | node ${CLAUDE_PLUGIN_ROOT}/src/recall-hook.mjs']),
  `the plugin wires its hooks, each with its matcher and flag (got ${wiring.join('; ')})`);
{
  const { HOOKS } = await import('../tools/deploy.mjs');
  const named = wiring.map((w) => w.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+)/)[1]);
  ok(named.every((f) => HOOKS.includes(f)), `every script hooks.json runs is deployed (HOOKS lacks ${named.filter((f) => !HOOKS.includes(f))})`);
}
// A hook with no timeout gets Claude Code's 10 minutes; a real Stop took 45.7 s. A timed-out hook's output is discarded.
const hooksOf = Object.entries(hookFile.hooks).flatMap(([ev, es]) => es.flatMap((e) => e.hooks.map((x) => ({ ev, matcher: e.matcher || '', ...x }))));
const timeouts = Object.fromEntries(hooksOf.map((h) => [`${h.ev}|${h.matcher}`, h.timeout]));
ok(JSON.stringify(timeouts) === JSON.stringify({ 'Stop|': 120, 'StopFailure|': 120, 'SubagentStop|': 30, 'SessionStart|startup|resume|clear|compact': 30, 'PreToolUse|Bash|PowerShell': 5, 'PostToolUse|Edit|Write|NotebookEdit': 5, 'UserPromptSubmit|': 5, 'SessionEnd|': 3, 'PreCompact|manual': 120, 'PreCompact|auto': 60 }),
  `each hook has its timeout in seconds (got ${JSON.stringify(timeouts)})`);
// The PreToolUse, PostToolUse and UserPromptSubmit hooks have none: a status line on every git call, change or prompt is noise, and the eval harness
// (tools/recall-eval.mjs) knows the recall hook by its command, which a statusMessage replaces in Claude Code's record.
ok(hooksOf.filter((h) => !/^(P(re|ost)ToolUse|UserPromptSubmit|SessionEnd)$/.test(h.ev)).every((h) => typeof h.statusMessage === 'string' && h.statusMessage), 'each hook has a statusMessage');
ok(hooksOf.filter((h) => /ToolUse$|^UserPromptSubmit$|^SessionEnd$/.test(h.ev)).every((h) => h.statusMessage === undefined), 'the tool, prompt and end hooks have none');
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
// A moved auto-memory folder is not followed: doctor says so, and names no other setting.
{
  const sf = join(home, '.claude', 'settings.json');
  ok(!/autoMemoryDirectory/.test((await cli('doctor')).stdout), 'doctor: no autoMemoryDirectory, no warning');
  writeFileSync(sf, JSON.stringify({ autoMemoryDirectory: join(home, 'moved'), apiKeyHelper: 'secret-helper' }));
  const d = (await cli('doctor')).stdout;
  ok(/^PROBLEM the autoMemoryDirectory setting is set/m.test(d) && !/secret-helper/.test(d), `doctor warns that autoMemoryDirectory is not followed (got ${d})`);
  rmSync(sf, { force: true });
}

// The command line read before any store is touched: each word as given -> the command, its words and
// options, or the refusal main() prints. The exceptions here are each a bug once.
{
  const parsed = (...w) => { const p = parseArgs(w); return typeof p === 'string' ? p : { cmd: p.cmd, rest: p.rest, args: p.args }; };
  const table = [
    [['--store=x', 'search', 'a'], { cmd: 'search', rest: ['--store', 'x', 'a'], args: ['a'] }],
    [['--store', 'x', 'search', 'a'], { cmd: 'search', rest: ['--store', 'x', 'a'], args: ['a'] }],
    [['forget', '--key', 'a', '--key=b'], { cmd: 'forget', rest: ['--key', 'a', '--key', 'b'], args: [] }],
    [['search', '--', '--no-verify', 'x'], { cmd: 'search', rest: [], args: ['--no-verify', 'x'] }],
    [[], { cmd: 'status', rest: [], args: [] }],
    [['--session', 'abc'], { cmd: 'status', rest: ['--session', 'abc'], args: [] }],
    [['--session'], { cmd: 'status', rest: ['--session'], args: [] }],
    [['restore', 'f', '--rev'], { cmd: 'restore', rest: ['f', '--rev'], args: ['f'] }],
    [['search', 'x', '-h'], { cmd: 'help', rest: ['x', '-h'], args: ['x', '-h'] }],
    [['search', '--file', '-h'], { cmd: 'search', rest: ['--file', '-h'], args: [] }],
    [['constructor'], { cmd: 'constructor', rest: [], args: [] }],
    [['search', 'x', '--limit', '-3'], { cmd: 'search', rest: ['x', '--limit', '-3'], args: ['x'] }],
    [['forget', '--conversation', 'abc'], { cmd: 'forget', rest: ['--conversation', 'abc'], args: [] }],
    [['--from', '2026-10-27'], 'unknown option --from; help lists the options'],
    [['--after=2026-10-28'], 'unknown option --after=2026-10-28; help lists the options'],
    [['--constructor'], 'unknown option --constructor; help lists the options'],
    [['forget', '--key', '--store', 'x'], '--key needs a value after it'],
    [['forget', '--key'], '--key needs a value after it'],
    [['search', 'x', '--file', ''], '--file needs a value after it'],
    [['page', '--project='], '--project needs a value after it'],
    [['search', 'x', '--rev', 'R'], 'search does not take --rev; help lists the options'],
    [['search', 'x', '--conversation', 'abc'], '--conversation needs at least 4 characters of the id'],
    [['search', 'x', '--limit', 'ten'], '--limit takes a number, not ten'],
    [['page', '--days', '0'], '--days takes a number of days or all, not 0'],
  ];
  for (const [w, want] of table) { assert.deepEqual(parsed(...w), want, JSON.stringify(w)); checks++; }
  ok(parseArgs(['search', 'x', '--limit', '2', '--limit', '3']).opt('--limit') === '2', 'the first of a repeated option wins');
  const help = (await run(['help'])).stdout;
  for (const o of Object.keys(OPTIONS)) ok(help.includes(o), `help names ${o}`);
}

console.log(`memory-cli: ${checks} checks passed`);
