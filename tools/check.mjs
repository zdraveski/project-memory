#!/usr/bin/env node
// The quick check, for every edit: what CI would say about the files changed
// since the last commit (or since --base <ref>), in seconds to a minute or two. In order, each step
// stopping the check when it fails:
//   1. every .mjs and every .json parses;
//   2. no file imports a name it never uses;
//   3. the suites of the changed files, --mutant mode, in UTC and in New
//      York: GitHub's machines run in UTC, where a test of local midnight
//      once checked nothing;
//   4. every mutant's find-text is in its file exactly once, no label twice.
// With --full, by hand, also:
//   5. the hand-written mutants on the changed lines;
//   6. the automatic mutants on the changed lines (--no-auto skips them);
//   7. changed code lines no mutant covers: a reminder, not a failure;
//   8. after a change to a hook's code, 20 s of fuzz.mjs.
// Run: node tools/check.mjs [--full] [--no-auto] [--own] [--base <ref>]  (from this repo)
// --own: only the changed files' own suites, never all after a change to a shared file (a builder's check; CI runs all).
// --base <ref>: "changed" is everything since that ref (a tag, say; committed or not), a renamed file counting only its real edits.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { suites, settle, tableOf, testsOf } from './mutate.mjs';
import { SHARED } from './deploy.mjs';
import { srcFiles, pluginFiles, plan, pool, isTimed } from './suites.mjs';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
// What every suite stands on (SHARED): changed, every suite runs. The list is deploy.mjs's own, so the quick check and the deploy agree
// (audit #16); handoff-log.mjs is left out on purpose: store.mjs and memory-tier.mjs do not import it, so it is not under every suite.
const ALL = [...new Set(Object.values(suites).flatMap(([t]) => testsOf(t)))];

// The suites a set of changed files needs: a source's own, its mutants', a suite itself,
// or all of them after a change to what they share. own (--own, a builder's check): never all, CI and the lead's --full run those.
const suiteOf = Object.fromEntries(Object.entries(suites).flatMap(([f, [t]]) => [[f, testsOf(t)], [tableOf(f), testsOf(t)]]));
export const suitesFor = (changed, own = false) => (!own && changed.some((f) => SHARED.includes(f)) ? ALL
  : [...new Set(changed.flatMap((f) => (ALL.includes(f) ? [f] : suiteOf[f] ?? [])))]);
// The lines a unified diff with no context (-U0) adds or changes, in the new file.
export const changedLines = (diff) => {
  const at = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) for (let i = 0; i < (m[2] === undefined ? 1 : Number(m[2])); i++) at.add(Number(m[1]) + i);
  return at;
};
// The lines of a file the check treats as changed: a new file's every line (git diff HEAD says nothing of an untracked file, so a
// new source passed the mutant steps untested, audit #17), else the diff's.
export const touchedOf = (isNew, lines, diff) => (isNew ? new Set(lines.map((_, i) => i + 1)) : changedLines(diff));
// The --auto-lines value for mutate.mjs: file:n,n;file:n
export const autoArg = (byFile) => [...byFile].map(([f, ls]) => `${f}:${[...ls].join(',')}`).join(';');
// The 1-based lines a text's first occurrence of `find` spans.
const span = (text, find) => {
  const i = text.indexOf(find);
  if (i === -1) return [];
  const first = text.slice(0, i).split('\n').length;
  return Array.from({ length: find.split('\n').length }, (_, k) => first + k);
};
assert.deepEqual(suitesFor(['README.md']), []);
assert.deepEqual(suitesFor(['src/journal.mjs', 'test/memory-cli.test.mjs']), ['test/journal.test.mjs', 'test/memory-cli.test.mjs']);
assert.equal(suitesFor(['test/harness.mjs']).length, ALL.length);
assert.equal(suitesFor(['tools/mutate.mjs']).length, ALL.length);   // deploy.mjs's list: a change to the mutation tool runs everything
assert.equal(suitesFor(['src/store.mjs']).length, ALL.length);
assert.deepEqual(suitesFor(['src/store.mjs'], true), testsOf(suites['src/store.mjs'][0]));
assert.deepEqual(suitesFor(['test/memory-cli.test.mjs', 'test/harness.mjs'], true), ['test/memory-cli.test.mjs']);
// The one list kept by hand: a new src/ module needs its tests and mutants named in mutate.mjs's suites, or its changes run nothing.
assert.deepEqual(srcFiles().filter((f) => !suites[f]), [], 'src/ files with no entry in tools/mutate.mjs suites');
// A mutant that timed out is run once more: killed then it counts as killed, otherwise the second verdict stands, any other verdict is not rerun.
{
  let runs = 0;
  const again = (v) => () => { runs++; return Promise.resolve(v); };
  assert.equal(await settle('TIMED OUT', again('killed')), 'killed on retry');
  assert.equal(await settle('TIMED OUT', again('TIMED OUT')), 'TIMED OUT');
  assert.equal(await settle('TIMED OUT', again('SURVIVED')), 'SURVIVED');
  assert.equal(await settle('SURVIVED', again('killed')), 'SURVIVED');
  assert.equal(runs, 3);
}
// The suites' order: biggest first in a pool a core narrower than the machine, the timed files after, alone; never no pool at all.
assert.deepEqual(plan([{ file: 'a.test.mjs', size: 1 }, { file: 'b-timed.test.mjs', size: 9 }, { file: 'c.test.mjs', size: 5 }, { file: 'd-timed.test.mjs', size: 2 }], 4),
  { width: 3, pool: ['c.test.mjs', 'a.test.mjs'], timed: ['b-timed.test.mjs', 'd-timed.test.mjs'] });
assert.equal(plan([], 1).width, 1);
{
  let now = 0, most = 0;
  const seen = await pool([1, 2, 3, 4, 5], 2, async (x) => { most = Math.max(most, ++now); await new Promise((r) => setTimeout(r, 5)); now--; return x * 10; });
  assert.deepEqual(seen, [10, 20, 30, 40, 50]);
  assert.equal(most, 2);
  most = 0;
  await pool(['a', 'b'], 1, async () => { most = Math.max(most, ++now); await new Promise((r) => setTimeout(r, 5)); now--; });
  assert.equal(most, 1);
}
assert.deepEqual([...changedLines('@@ -3 +3,2 @@\n@@ -9,0 +11 @@\n')], [3, 4, 11]);
assert.deepEqual(span('a\nbb\nc', 'b\nc'), [2, 3]);
assert.deepEqual([...touchedOf(true, ['a', 'b', 'c'], '')], [1, 2, 3]);
assert.deepEqual([...touchedOf(false, ['a', 'b', 'c'], '@@ -2 +2 @@\n')], [2]);
// Why a mutate.mjs run failed: its known failure lines; failing that (a crash, a spawn error, a timeout) the error or the output's tail, so a non-zero exit never reads as ok.
export const failures = (r, known) => {
  if (r.status === 0 && !r.error) return [];
  const lines = ((r.stdout ?? '') + (r.stderr ?? '')).split('\n').filter((l) => l.trim());
  const hit = lines.filter((l) => known.test(l));
  return hit.length ? hit : [r.error ? String(r.error.message ?? r.error) : `exit ${r.status}`, ...lines.slice(-5)];
};
{
  const k = / SURVIVED\b/;
  assert.deepEqual(failures({ status: 0, stdout: 'x SURVIVED' }, k), []);
  assert.deepEqual(failures({ status: 1, stdout: 'a\nb SURVIVED\n' }, k), ['b SURVIVED']);
  assert.deepEqual(failures({ status: 1, stdout: '', stderr: 'boom\n' }, k), ['exit 1', 'boom']);
  assert.deepEqual(failures({ status: null, error: new Error('spawn failed'), stdout: '', stderr: '' }, k), ['spawn failed']);
}
// The src/ files a source imports, static or by a run-time import( with a literal path (new URL('./x.mjs', import.meta.url) too).
export const importsOf = (text) => [...new Set([...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*(?:new URL\(\s*)?|^import\s+)['"]\.\/([\w.-]+\.mjs)['"]/gm)].map((m) => m[1]))];
// Every import a → b that is part of a loop (b leads back to a), as 'a -> b'.
export const loopsOf = (graph) => {
  const reaches = (from, to, seen = new Set()) => from === to || (!seen.has(from) && (seen.add(from), (graph[from] ?? []).some((n) => reaches(n, to, seen))));
  return Object.entries(graph).flatMap(([a, bs]) => bs.filter((b) => reaches(b, a)).map((b) => `${a} -> ${b}`));
};
// Loops known and waiting to be undone: none since the briefing moved out of handoff-log.mjs (1.6.0 step 18).
const KNOWN_LOOPS = [];
assert.deepEqual(importsOf("import { a } from './a.mjs';\nimport * as B from \"./b.mjs\";\nimport './c.mjs';\nawait import('./d.mjs');\nimport(new URL('./e.mjs', import.meta.url));\nimport x from 'node:fs';"), ['a.mjs', 'b.mjs', 'c.mjs', 'd.mjs', 'e.mjs']);
assert.deepEqual(loopsOf({ 'a.mjs': ['b.mjs'], 'b.mjs': ['c.mjs'], 'c.mjs': ['a.mjs'], 'd.mjs': ['a.mjs'] }), ['a.mjs -> b.mjs', 'b.mjs -> c.mjs', 'c.mjs -> a.mjs']);
assert.deepEqual(loopsOf({ 'a.mjs': ['b.mjs'], 'b.mjs': [] }), []);
assert.equal(autoArg(new Map([['a.mjs', new Set([3, 4])], ['b.mjs', new Set([11])]])), 'a.mjs:3,4;b.mjs:11');
// Every mutant's find-text is in its file exactly once, no label twice. A label given twice is one key in an object literal:
// counted in the table's text, per file. read(path) gives a file's text.
export const tableProblems = (tables, read) => Object.entries(tables).flatMap(([file, [, mutants]]) => {
  const text = read(file);
  const keys = [...read(tableOf(file)).matchAll(/^ {2}(['"])((?:(?!\1)[^\\]|\\.)*)\1: ?\[/gm)].map((m) => m[2]);
  return [...Object.entries(mutants).flatMap(([label, [from]]) => { const n = text.split(from).length - 1; return n === 1 ? [] : [`${file} :: ${label}: find-text found ${n} times`]; }),
    ...[...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))].map((k) => `${file} :: ${k}: label given twice`)];
});
{
  const files = { 'src/a.mjs': 'x === y;\nz;\n', 'tools/mutants/a.mjs': "  'ok': [\n  'gone': [\n  'gone': [\n" };
  assert.deepEqual(tableProblems({ 'src/a.mjs': [null, { ok: ['==='], gone: ['!=='] }] }, (f) => files[f]),
    ['src/a.mjs :: gone: find-text found 0 times', 'src/a.mjs :: gone: label given twice']);
  assert.deepEqual(tableProblems({ 'src/a.mjs': [null, { ok: ['==='] }] }, (f) => (f.startsWith('tools') ? "  'ok': [\n" : files[f])), []);
}
// --base <ref>: the ref "changed" is measured from; HEAD (the last commit) when not given.
export const baseOf = (argv) => {
  const eq = argv.find((a) => a.startsWith('--base='));
  const i = argv.indexOf('--base');
  const ref = eq !== undefined ? eq.slice(7) : i === -1 ? 'HEAD' : argv[i + 1];
  if (!ref || ref.startsWith('-')) throw new Error('--base wants a ref (a tag, a branch or a commit), e.g. --base v1.5.5');
  return ref;
};
// What changed from `base` to the working tree, as a Map of new path -> the path it had at base. -M pairs a rename, so a moved file counts only its real edits.
export const changesOf = (git, base) => new Map(git('diff', '-M', '--name-status', base).split('\n').filter(Boolean).map((l) => { const [st, a, b] = l.split('\t'); return st[0] === 'R' ? [b, a] : [a, a]; }));
// The -U0 diff of one file, given the path it had at base: both paths, or git sees a rename as a new file.
export const lineDiff = (git, base, file, was) => git('diff', '-M', '-U0', base, '--', ...new Set([was, file]));
assert.equal(baseOf(['--full']), 'HEAD');
assert.equal(baseOf(['--base', 'v1.5.5', '--full']), 'v1.5.5');
assert.equal(baseOf(['--full', '--base=v1.5.5']), 'v1.5.5');
assert.throws(() => baseOf(['--base=']), /--base wants a ref/);
assert.throws(() => baseOf(['--full', '--base']), /--base wants a ref/);
assert.throws(() => baseOf(['--base', '--full']), /--base wants a ref/);
// A file moved to another folder with one line edited: one changed line, not a whole new file.
{
  const d = mkdtempSync(join(tmpdir(), 'check-base-')), g = (...a) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    g('init', '-q'); writeFileSync(join(d, 'a.mjs'), 'one\ntwo\nthree\nfour\nfive\nsix\n'); g('add', 'a.mjs'); g('commit', '-qm', 'a'); g('tag', 'base');
    mkdirSync(join(d, 'sub')); g('mv', 'a.mjs', 'sub/b.mjs'); writeFileSync(join(d, 'sub', 'b.mjs'), 'one\ntwo\nTHREE\nfour\nfive\nsix\n'); g('add', '-A'); g('commit', '-qm', 'b');
    assert.deepEqual([...changesOf(g, 'base')], [['sub/b.mjs', 'a.mjs']]);
    assert.deepEqual([...changedLines(lineDiff(g, 'base', 'sub/b.mjs', 'a.mjs'))], [3]);
  } finally { rmSync(d, { recursive: true, force: true }); }
}
// The release .tar.gz/.zip leave out what .gitattributes marks export-ignore; what the plugin runs must stay in:
// every ${CLAUDE_PLUGIN_ROOT}/ path the hooks, the skill, the commands and the agents name (in git, not ignored), everything those
// scripts import, and the plugin's own folders. archive.test.mjs runs the archive itself.
{
  const lines = (...a) => git(...a).split('\n').filter(Boolean);
  const named = ['hooks/hooks.json', 'skills/memory/SKILL.md', ...lines('ls-files', 'commands', 'agents')]
    .flatMap((f) => [...readFileSync(join(repo, f), 'utf8').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.\w+)/g)].map((m) => m[1]));
  const run = [...named], tracked = new Set(lines('ls-files'));
  const need = new Set(['LICENSE', ...lines('ls-files', 'hooks', 'commands', 'skills', 'agents', '.claude-plugin')]);
  for (const f of run) if (!need.has(f)) {
    need.add(f);
    if (tracked.has(f)) for (const m of readFileSync(join(repo, f), 'utf8').matchAll(/['"]\.\/([\w-]+\.mjs)['"]/g)) run.push(posix.join(posix.dirname(f), m[1]));
  }
  assert.deepEqual([...need].filter((f) => !tracked.has(f)), [], 'a path the plugin names is not in git');
  const left = lines('check-attr', 'export-ignore', '--', ...need).filter((l) => l.endsWith(': set'));
  assert.deepEqual(left, [], 'the release archive would leave out files the plugin needs');
  // The deploy copies pluginFiles(): the same set as the release, nothing missing and nothing untracked shipped.
  assert.deepEqual([...need].filter((f) => !pluginFiles().includes(f)), [], 'the deploy would leave out files the plugin needs');
  assert.deepEqual(pluginFiles().filter((f) => !tracked.has(f)), [], 'the deploy would ship files not in git');
}
// mutate.mjs --list --auto-lines names the automatic mutants of a line, each once, running nothing.
{
  const n = readFileSync(join(repo, 'src/store.mjs'), 'utf8').split('\n').findIndex((l) => l.includes(' === ')) + 1;
  const r = spawnSync(process.execPath, [join(repo, 'tools', 'mutate.mjs'), '--list', '--auto-lines', `src/store.mjs:${n}`], { encoding: 'utf8' }), listed = r.stdout.split('\n').filter(Boolean);
  assert.ok(listed.includes(`auto equality src/store.mjs:${n} === -> !==`), `exit ${r.status}\n${listed.join('\n')}\n${r.stderr}`);
  assert.equal(new Set(listed).size, listed.length);
}
// --list keeps every line for a slow reader: a busy GitHub machine got 193 of 218 and failed the check below. Windows writes a pipe at once.
if (process.platform !== 'win32') {
  const lines = (pipe) => spawnSync('sh', ['-c', `"$0" "$1" --list --auto${pipe}`, process.execPath, join(repo, 'tools', 'mutate.mjs')], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).length;
  assert.equal(lines(' | (sleep 2; cat)'), lines(''));
}
// A change that only adds a mutant runs that source's group: not every mutant (5 of the 17 PRs of 1.2.6 did), and not none.
{
  const listed = (f) => spawnSync(process.execPath, [join(repo, 'tools', 'mutate.mjs'), '--list', '--changed', f], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  assert.deepEqual(listed('tools/mutants/journal.mjs'), Object.keys(suites['src/journal.mjs'][1]));
  assert.deepEqual(listed('tools/mutants/hooks.mjs'), Object.keys(suites['hooks/hooks.json'][1]));
  assert.deepEqual(suitesFor(['tools/mutants/hooks.mjs']), testsOf(suites['hooks/hooks.json'][0]));
}

const t0 = Date.now(), problems = [];
const step = (name, found) => {
  console.log(`${found.length ? 'FAIL' : 'ok  '} ${name}${found.length ? '' : ` (${((Date.now() - t0) / 1000).toFixed(1)} s)`}`);
  for (const f of found) console.log(`       ${f}`);
  if (found.length) { problems.push(name); finish(); }
};
const finish = () => {
  console.log(problems.length ? `check failed: ${problems.join(', ')}` : `check passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(problems.length ? 1 : 0);
};
const WIDTH = plan([], availableParallelism()).width;

const files = git('ls-files', '-co', '--exclude-standard', '*.mjs').split('\n').filter(Boolean);
const untracked = git('ls-files', '-o', '--exclude-standard').split('\n').filter(Boolean);
let base;
try { base = baseOf(process.argv); } catch (e) { console.error(e.message); process.exit(2); }
if (base !== 'HEAD') { try { base = git('merge-base', base, 'HEAD').trim(); } catch { console.error(`--base ${base}: not a commit in this repo`); process.exit(2); } }
const changes = changesOf(git, base);
const changed = [...new Set([...changes.keys(), ...untracked].filter(Boolean))];
console.log(`changed since ${base === 'HEAD' ? 'the last commit' : base}: ${changed.length ? changed.join(', ') : 'nothing'}`);

// 1. Every file parses.
step('every .mjs parses', (await pool(files, WIDTH, (f) => new Promise((done) => execFile(process.execPath, ['--check', join(repo, f)], (e, _o, err) => done(e ? `${f}: ${String(err).trim().split('\n').slice(0, 4).join(' | ')}` : null))))).filter(Boolean));
// 1b. Every .json parses: a broken hooks.json turns the plugin off without a word.
step('every .json parses', git('ls-files', '-co', '--exclude-standard', '*.json').split('\n').filter(Boolean).flatMap((f) => {
  try { JSON.parse(readFileSync(join(repo, f), 'utf8')); return []; } catch (e) { return [`${f}: ${e.message}`]; }
}));

// 2. No name imported and never used.
const unused = [];
for (const f of files) {
  const s = readFileSync(join(repo, f), 'utf8');
  for (const m of s.matchAll(/^import \{([^}]+)\} from/gm)) for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)) {
    if ((s.match(new RegExp(`(?<![\\w$])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`, 'g')) ?? []).length < 2) unused.push(`${f}: ${n}`);
  }
}
step('no unused imports', unused);
// 2b. No import loop in src/, a run-time import( counted as an import (ADR 0003): one is allowed as a guard, never around a loop.
const graph = Object.fromEntries(srcFiles().map((f) => [f.slice(4), importsOf(readFileSync(join(repo, f), 'utf8'))]));
step('no import loops in src/', loopsOf(graph).filter((l) => !KNOWN_LOOPS.includes(l)));

const full = process.argv.includes('--full');

// 3. The changed files' suites, in two time zones.
const runs = suitesFor(changed, process.argv.includes('--own')).flatMap((t) => ['UTC', 'America/New_York'].map((tz) => [t, tz]));
// Why a suite failed: its error line, not the stack or Node's closing version line.
const why = (text) => { const ls = String(text).split('\n').map((l) => l.trim()).filter((l) => l && !/^at /.test(l) && !/^Node\.js v/.test(l)); return (ls.find((l) => /Error\b/.test(l)) ?? ls.at(-1) ?? '').slice(0, 300); };
// The zone is set on this process just before each spawn, which copies it, and the child inherits: no child is handed the whole
// environment as an object (R42, R66). Put back after, so the later steps' children run in the zone this one was given.
const tz0 = process.env.TZ;
const runSuite = ([t, tz]) => new Promise((done) => {
  process.env.TZ = tz;
  execFile(process.execPath, [join(repo, t), '--mutant'], { maxBuffer: 1 << 26 }, (e, out, err) => done(e ? `${t} (TZ=${tz}): ${why(err + out)}` : null));
});
// The timed suites after the rest, one at a time: their wall-clock limits measure the code, not the load.
step(`the changed files' suites (${runs.length ? [...new Set(runs.map(([t]) => t))].join(', ') : 'none'})`, [
  ...await pool(runs.filter(([t]) => !isTimed(t)), WIDTH, runSuite), ...await pool(runs.filter(([t]) => isTimed(t)), 1, runSuite)].filter(Boolean));
if (tz0 === undefined) delete process.env.TZ; else process.env.TZ = tz0;

// 4. The mutant tables, a text scan of seconds, so CI runs it on every PR (1.6.4's master went red on one).
step('every mutant applies once', tableProblems(suites, (f) => readFileSync(join(repo, f), 'utf8')));

if (!full) finish();

// 5 and 6. The mutants on the changed lines; the changed code lines none covers.
const on = [], bare = [], autoLines = new Map();
for (const [file, [, mutants]] of Object.entries(suites)) {
  if (!changed.includes(file) || !existsSync(join(repo, file))) continue;
  const text = readFileSync(join(repo, file), 'utf8'), lines = text.split('\n');
  const touched = touchedOf(untracked.includes(file), lines, lineDiff(git, base, file, changes.get(file) ?? file)), covered = new Set();
  if (touched.size && file.endsWith('.mjs')) autoLines.set(file, touched); // automut reads code, not hooks.json
  for (const [label, [from]] of Object.entries(mutants)) {
    const at = span(text, from);
    at.forEach((l) => covered.add(l));
    if (at.some((l) => touched.has(l))) on.push(label);
  }
  for (const l of touched) if (!covered.has(l) && /\S/.test(lines[l - 1] ?? '') && !/^\s*(\/\/|\*|\/\*)/.test(lines[l - 1]) && !/^\s*[})\]];?,?\s*$/.test(lines[l - 1])) bare.push(`${file}:${l}: ${lines[l - 1].trim().slice(0, 100)}`);
}
if (on.length) {
  console.log(`     ${on.length} mutant(s) on the changed lines ...`);
  const r = spawnSync(process.execPath, [join(repo, 'tools', 'mutate.mjs'), ...on], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  step('the mutants on the changed lines', failures(r, / (SURVIVED|TIMED OUT|MUTATION DID NOT APPLY|FIND-TEXT NOT UNIQUE)\b|fails unmutated/));
} else console.log('ok   the mutants on the changed lines (none there)');
// 5b. The automatic mutants on the changed lines; --no-auto skips them.
if (process.argv.includes('--no-auto')) console.log('ok   the automatic mutants on the changed lines: skipped (--no-auto)');
else if (!autoLines.size) console.log('ok   the automatic mutants on the changed lines (none there)');
else {
  const arg = autoArg(autoLines), run = (...a) => spawnSync(process.execPath, [join(repo, 'tools', 'mutate.mjs'), ...a, '--auto-lines', arg], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  const l = run('--list'), listed = failures(l, /$^/);
  if (listed.length) step('the automatic mutants on the changed lines (listing them)', listed);
  const n = l.stdout.split('\n').filter(Boolean).length;
  console.log(`     ${n} automatic mutant(s) on the changed lines (ignored ones included) ...`);
  if (n) {
    const r = run(), out = (r.stdout + r.stderr).split('\n'), stillborn = out.filter((x) => / STILLBORN\b/.test(x));
    step('the automatic mutants on the changed lines', failures(r, / (SURVIVED|TIMED OUT|MUTATION DID NOT APPLY)\b|fails unmutated/));
    if (stillborn.length) { console.log(`note ${stillborn.length} automatic mutant(s) stillborn (they do not compile):`); for (const x of stillborn.slice(0, 15)) console.log(`       ${x}`); }
  } else console.log('ok   the automatic mutants on the changed lines (none selected)');
}
if (bare.length) {
  console.log(`note ${bare.length} changed code line(s) no mutant covers: a rule there wants a test and a mutant (CONTRIBUTING)`);
  for (const b of bare.slice(0, 15)) console.log(`       ${b}`);
  if (bare.length > 15) console.log(`       and ${bare.length - 15} more`);
}

// 8. A hook's code changed: 20 s of fuzz, new rounds each time. Named here are the src/ files the fuzz does not drive, so a new
// module is fuzzed until someone says it need not be.
const NO_FUZZ = ['src/page.mjs', 'src/recall.mjs', 'src/enforce.mjs', 'src/enforce-hook.mjs', 'src/timing.mjs', 'src/memory.mjs', 'src/brief.mjs'];
if (changed.some((f) => f.startsWith('src/') && f.endsWith('.mjs') && !NO_FUZZ.includes(f))) {
  const r = spawnSync(process.execPath, [join(repo, 'tools', 'fuzz.mjs'), '20'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  step('20 s of fuzz', r.status === 0 ? [] : r.stdout.trim().split('\n'));
}
finish();
