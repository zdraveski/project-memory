#!/usr/bin/env node
// The quick check, for every edit: what the full check (deploy.mjs, CI, the
// mutate workflow) would say about the files changed since the last commit,
// in seconds to a minute or two instead of the hour the mutation check took
// (2026-10-30). In order, each step stopping the check when it fails:
//   1. every .mjs parses;
//   2. no file imports a name it never uses;
//   3. every mutant's find-text is in its file exactly once, no label twice;
//   4. the suites of the changed files, --mutant mode, in UTC and in New
//      York: GitHub's machines run in UTC, where a test of local midnight
//      once checked nothing;
//   5. the hand-written mutants on the changed lines;
//   6. the automatic mutants on the changed lines (--no-auto skips them);
//   7. changed code lines no mutant covers: a reminder, not a failure;
//   8. after a change to a hook's code, 20 s of fuzz.mjs.
// Run: node check.mjs [--no-auto]  (from this repo)
import { readFileSync, existsSync } from 'node:fs';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';
import { suites } from './mutate.mjs';

const repo = dirname(fileURLToPath(import.meta.url));
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
// What every suite stands on: changed, all six run.
const SHARED = ['store.mjs', 'harness.mjs'];
const ALL = [...new Set(Object.values(suites).map(([t]) => t))];

// The suites a set of changed files needs: a source's own, a suite itself,
// or all of them after a change to what they share.
export const suitesFor = (changed) => (changed.some((f) => SHARED.includes(f)) ? ALL
  : [...new Set(changed.flatMap((f) => (ALL.includes(f) ? [f] : suites[f] ? [suites[f][0]] : [])))]);
// The lines a unified diff with no context (-U0) adds or changes, in the new file.
export const changedLines = (diff) => {
  const at = new Set();
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) for (let i = 0; i < (m[2] === undefined ? 1 : Number(m[2])); i++) at.add(Number(m[1]) + i);
  return at;
};
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
assert.deepEqual(suitesFor(['journal.mjs', 'memory.test.mjs']), ['journal.test.mjs', 'memory.test.mjs']);
assert.equal(suitesFor(['harness.mjs']).length, ALL.length);
assert.deepEqual([...changedLines('@@ -3 +3,2 @@\n@@ -9,0 +11 @@\n')], [3, 4, 11]);
assert.deepEqual(span('a\nbb\nc', 'b\nc'), [2, 3]);
assert.equal(autoArg(new Map([['a.mjs', new Set([3, 4])], ['b.mjs', new Set([11])]])), 'a.mjs:3,4;b.mjs:11');
// mutate.mjs --list --auto-lines names the automatic mutants of a line, each once, running nothing.
{
  const n = readFileSync(join(repo, 'store.mjs'), 'utf8').split('\n').findIndex((l) => l.includes(' === ')) + 1;
  const r = spawnSync(process.execPath, [join(repo, 'mutate.mjs'), '--list', '--auto-lines', `store.mjs:${n}`], { encoding: 'utf8' }), listed = r.stdout.split('\n').filter(Boolean);
  assert.ok(listed.includes(`auto equality store.mjs:${n} === -> !==`), `exit ${r.status}\n${listed.join('\n')}\n${r.stderr}`);
  assert.equal(new Set(listed).size, listed.length);
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
const pool = async (items, fn) => {
  const out = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, availableParallelism() - 1) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
};

const files = git('ls-files', '-co', '--exclude-standard', '*.mjs').split('\n').filter(Boolean);
const changed = [...new Set([...git('diff', '--name-only', 'HEAD').split('\n'), ...git('ls-files', '-o', '--exclude-standard').split('\n')].filter(Boolean))];
console.log(`changed since the last commit: ${changed.length ? changed.join(', ') : 'nothing'}`);

// 1. Every file parses.
step('every .mjs parses', (await pool(files, (f) => new Promise((done) => execFile(process.execPath, ['--check', join(repo, f)], (e, _o, err) => done(e ? `${f}: ${String(err).trim().split('\n').slice(0, 4).join(' | ')}` : null))))).filter(Boolean));

// 2. No name imported and never used.
const unused = [];
for (const f of files) {
  const s = readFileSync(join(repo, f), 'utf8');
  for (const m of s.matchAll(/^import \{([^}]+)\} from/gm)) for (const n of m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()).filter(Boolean)) {
    if ((s.match(new RegExp(`(?<![\\w$])${n.replace(/\$/g, '\\$')}(?![\\w$])`, 'g')) ?? []).length < 2) unused.push(`${f}: ${n}`);
  }
}
step('no unused imports', unused);

// 3. The mutant table. A label given twice is one key in an object literal:
// counted in the text, per file group.
const table = readFileSync(join(repo, 'mutate.mjs'), 'utf8'), bad = [];
for (const [file, [, mutants]] of Object.entries(suites)) {
  const text = readFileSync(join(repo, file), 'utf8');
  for (const [label, [from]] of Object.entries(mutants)) { const n = text.split(from).length - 1; if (n !== 1) bad.push(`${file} :: ${label}: find-text found ${n} times`); }
  const group = table.slice(table.indexOf(`\n  '${file}': [`), table.indexOf('\n  }],', table.indexOf(`\n  '${file}': [`)));
  const keys = [...group.matchAll(/^ {4}(['"])((?:(?!\1)[^\\]|\\.)*)\1: \[/gm)].map((m) => m[2]);
  for (const k of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) bad.push(`${file} :: ${k}: label given twice`);
}
step('every mutant applies once', bad);

// 4. The changed files' suites, in two time zones.
const runs = suitesFor(changed).flatMap((t) => ['UTC', 'America/New_York'].map((tz) => [t, tz]));
// Why a suite failed: its error line, not the stack or Node's closing version line.
const why = (text) => { const ls = String(text).split('\n').map((l) => l.trim()).filter((l) => l && !/^at /.test(l) && !/^Node\.js v/.test(l)); return (ls.find((l) => /Error\b/.test(l)) ?? ls.at(-1) ?? '').slice(0, 300); };
step(`the changed files' suites (${runs.length ? [...new Set(runs.map(([t]) => t))].join(', ') : 'none'})`, (await pool(runs, ([t, tz]) => new Promise((done) =>
  execFile(process.execPath, [join(repo, t), '--mutant'], { env: { ...process.env, TZ: tz }, maxBuffer: 1 << 26 }, (e, out, err) => done(e ? `${t} (TZ=${tz}): ${why(err + out)}` : null))))).filter(Boolean));

// 5 and 6. The mutants on the changed lines; the changed code lines none covers.
const on = [], bare = [], autoLines = new Map();
for (const [file, [, mutants]] of Object.entries(suites)) {
  if (!changed.includes(file) || !existsSync(join(repo, file))) continue;
  const text = readFileSync(join(repo, file), 'utf8'), lines = text.split('\n');
  const touched = changedLines(git('diff', '-U0', 'HEAD', '--', file)), covered = new Set();
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
  const r = spawnSync(process.execPath, [join(repo, 'mutate.mjs'), ...on], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  step('the mutants on the changed lines', r.status === 0 ? [] : (r.stdout + r.stderr).split('\n').filter((l) => / (SURVIVED|TIMED OUT|MUTATION DID NOT APPLY|FIND-TEXT NOT UNIQUE)\b|fails unmutated/.test(l)));
} else console.log('ok   the mutants on the changed lines (none there)');
// 5b. The automatic mutants on the changed lines; --no-auto skips them.
if (autoLines.size && !process.argv.includes('--no-auto')) {
  const arg = autoArg(autoLines), run = (...a) => spawnSync(process.execPath, [join(repo, 'mutate.mjs'), ...a, '--auto-lines', arg], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  const n = run('--list').stdout.split('\n').filter(Boolean).length;
  console.log(`     ${n} automatic mutant(s) on the changed lines ...`);
  if (n) {
    const out = (r => r.stdout + r.stderr)(run()).split('\n');
    const stillborn = out.filter((l) => / STILLBORN\b/.test(l));
    step('the automatic mutants on the changed lines', out.filter((l) => / (SURVIVED|TIMED OUT|MUTATION DID NOT APPLY)\b/.test(l)));
    if (stillborn.length) { console.log(`note ${stillborn.length} automatic mutant(s) stillborn (they do not compile):`); for (const s of stillborn.slice(0, 15)) console.log(`       ${s}`); }
  }
} else console.log('ok   the automatic mutants on the changed lines (none there or --no-auto)');
if (bare.length) {
  console.log(`note ${bare.length} changed code line(s) no mutant covers: a rule there wants a test and a mutant (CONTRIBUTING)`);
  for (const b of bare.slice(0, 15)) console.log(`       ${b}`);
  if (bare.length > 15) console.log(`       and ${bare.length - 15} more`);
}

// 7. A hook's code changed: 20 s of fuzz, new rounds each time.
if (changed.some((f) => ['store.mjs', 'handoff-log.mjs', 'journal.mjs', 'memory-tier.mjs', 'compact-gate.mjs'].includes(f))) {
  const r = spawnSync(process.execPath, [join(repo, 'fuzz.mjs'), '20'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  step('20 s of fuzz', r.status === 0 ? [] : r.stdout.trim().split('\n'));
}
finish();
