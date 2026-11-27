// Self-check for mistakes.mjs (1.7.0 step 4): the machine-found mistakes of the journal, all pure functions, and the cache file built from it.
// Run: node test/mistakes.test.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome, storeFor } from './harness.mjs';

const { home } = tempHome('mistakes-');
const M = await import('../src/mistakes.mjs');
const { NOT_FAILURE, targetOf, errorLine, failuresOf, mistakes, recurring, claimed, cochangeFor, buildMistakes, readMistakes, mistakesOwed } = M;
const { local, dropMistakes, MISTAKES, keyed } = await import('../src/store.mjs');
const { render } = await import('../src/journal.mjs');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const eq = (got, want, msg) => { assert.deepStrictEqual(got, want, msg); checks++; };

// Fixtures: an entry as the journal reads it, and a failed command as transcript.mjs keeps it.
const E = (key, at, s, ran = [], changed = []) => ({ key, at, s, changed, ran, asked: '', answered: '' });
const bad = (cmd, text) => `${cmd} → failed: ${text}`;
const NOW = Date.parse('2026-11-27T12:00:00');
const day = (n) => local(NOW - n * 864e5).slice(0, 10);

// --- targetOf ---
eq(targetOf('sleep 5 && FOO=1 python3.12 x.py'), 'python x.py', 'setup words, VAR= words and the version of python are dropped');
eq(targetOf('python x.py'), 'python x.py', 'python x.py');
ok(targetOf('sleep 5 && FOO=1 python3.12 x.py') === targetOf('python x.py'), 'so the two share a target');
ok(targetOf('npm test') !== targetOf('npm run build'), 'npm test and npm run build are two targets');
eq(targetOf('npm test'), 'npm test', 'npm test');
eq(targetOf('npm run build -- --watch'), 'npm run build', 'the script of npm run, not its arguments');
eq(targetOf('yarn build'), 'yarn build', 'yarn build');
eq(targetOf('git -C /x commit -m hi'), 'git commit', 'git: its subcommand, after an option with a value');
eq(targetOf('cd src && node --test test/a.test.mjs'), 'node test/a.test.mjs', 'an interpreter: the script path, after cd and a flag');
eq(targetOf('node tools/check.mjs --base master'), 'node tools/check.mjs', 'a script and its arguments');
eq(targetOf('/usr/bin/python3 -m pytest'), 'python pytest', 'a program by its path');
eq(targetOf('"C:\\nodejs\\node.exe" a.mjs'), 'node a.mjs', 'a Windows path and .exe are dropped');
eq(targetOf('node'), 'node', 'an interpreter with no script is itself');
eq(targetOf('rtk npm test'), 'npm test', 'a lead word (rtk) is dropped');
eq(targetOf('make'), 'make', 'any other program: the program alone');
eq(targetOf('echo hi && cd x'), null, 'only setup words: none');
eq(targetOf('python -c "print(1)"'), null, 'python -c gives none');
eq(targetOf('node -e "1"'), null, 'node -e gives none');
eq(targetOf('node --eval 1'), null, 'node --eval gives none');
eq(targetOf('bash -c "ls"'), null, 'bash -c gives none');
eq(targetOf('python - <<EOF\nprint(1)\nEOF'), null, 'a heredoc gives none');
eq(targetOf('cat <<EOF\nx\nEOF'), null, 'a heredoc to any program gives none');
eq(targetOf(''), null, 'an empty command gives none');

// --- errorLine ---
eq(errorLine('all fine, nothing wrong here'), '', 'no marker: no error line');
eq(errorLine(''), '', 'no text: no error line');
eq(errorLine("node:internal/x\nError: Cannot find module '/tmp/abc/x.js'\n    at y"), "Error: Cannot find module '<tmp>'", 'the line with the marker, a temp path folded');
for (const [a, b] of [
  ['TypeError: bad 12 of 40', 'TypeError: bad 99 of 41'],
  ["Error: ENOENT: no such file '/tmp/a1/x.txt'", "Error: ENOENT: no such file '/tmp/b2/x.txt'"],
  ['Error: cannot open C:\\Users\\bob\\AppData\\Local\\Temp\\p-1\\x.js', 'Error: cannot open C:\\Users\\amy\\AppData\\Local\\Temp\\q-2\\x.js'],
  ['Error: cannot open %TEMP%\\p-1\\x.js', 'Error: cannot open %TEMP%\\q-9\\x.js'],
  ['fatal: bad object 1a2b3c4d5e6f', 'fatal: bad object 9f8e7d6c5b4a'],
  ['Error: stale since 10:45:12', 'Error: stale since 23:01:59'],
]) ok(errorLine(a) === errorLine(b) && errorLine(a) !== '', `two lines that differ only in a number, a temp path, a hash or a time are one error: ${a}`);
ok(errorLine('Error: listen EADDRINUSE: address already in use :::3000') !== errorLine('Error: listen EADDRINUSE: address already in use :::3001'), 'two that differ in a port are two');
ok(/:12:5$/.test(errorLine('Error: boom at /a/b.js:12:5')), 'a line:col after a path stays');
eq(errorLine('Error: x 5 y'), 'Error: x # y', 'numbers become #');
eq(errorLine('fatal: ref 1234567abc gone'), 'fatal: ref <hex> gone', 'a hex run of 7 or more becomes <hex>');
eq(errorLine('Error: at 10:45 and 3:07:09.5'), 'Error: at <time> and <time>', 'clock times become <time>');
for (const m of ['TypeError: x', 'RuntimeException: x', 'fatal: x', 'error: x', 'npm ERR! x', 'FAILED x', 'not ok 1 - x', 'spawn ENOENT', 'src/a.ts(1,2): TS2304 x']) ok(errorLine(m) !== '', `a marker: ${m}`);
ok(errorLine(`Error: ${'x'.repeat(300)}`).length === 120, 'cut to 120 characters');
eq(errorLine('Error: first\nok: fine\nTypeError: last one\ndone'), 'TypeError: last one', 'the last line with a marker');
{ const s = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_');
  ok(!errorLine(`Error: the key ${s} was refused`).includes(s), 'a secret in the line is redacted'); }

// --- NOT_FAILURE: the texts step 0 measured (Claude Code 2.1.332) ---
for (const t of [
  'Exit code 143\nCommand timed out after 1s',
  "The user doesn't want to proceed with this tool use. The tool use was rejected",
  '[Request interrupted by user for tool use]',
  'Permission to use Bash with command rm nothing-here.txt has been denied.',
  'Claude requested permissions to write to C:\\x, which contains a suspicious Windows path pattern that requires manual approval.',
]) ok(NOT_FAILURE.test(t), `a timeout, an interrupt or a refusal is no failure: ${t.slice(0, 50)}`);
ok(NOT_FAILURE.test('rm nothing-here.txt\nhas been denied.'), 'a denial whose start was cut off (a failure keeps the last 300 characters) still matches');
ok(NOT_FAILURE.test('...it. The instruction to stop and wait still stands.'), 'so does the end of the interrupt text');
for (const t of ['Error: Cannot find module x', 'npm ERR! code ELIFECYCLE', 'exit 1', 'Error: the user denied nothing']) ok(!NOT_FAILURE.test(t), `a real failure is not skipped: ${t}`);

// --- failuresOf ---
eq(failuresOf(E('k', `${day(1)} 10:00`, 'a', ['ls', bad('npm test', 'Error: boom 1'), 'git status', bad('python -c "x"', 'Error: no target'), bad('npm run build', 'Command timed out after 5s')])),
  [{ i: 1, cmd: 'npm test', target: 'npm test', error: 'Error: boom #' }], 'a failure with a target; inline code and a timeout are skipped');
eq(failuresOf(E('k', `${day(1)} 10:00`, 'a', ['npm test', 'echo hi'])), [], 'a command that did not fail is none');
eq(failuresOf(E('k', `${day(1)} 10:00`, 'a', [bad('make', 'no marker here')])), [{ i: 0, cmd: 'make', target: 'make', error: '' }], 'a failure with no marker has error ""');
eq(failuresOf(E('k', `${day(1)} 10:00`, 'a', [bad('npm test', 'Permission to use Bash with command npm test has been denied.')])), [], 'a denied call counts nowhere');
eq(failuresOf({ ...E('k', 'x', 'a'), ran: undefined }), [], 'an entry with no ran list');

// --- mistakes(): pairs ---
const T1 = `${day(2)} 10:00`;
const ERR = bad('npm test', 'Error: Cannot find module x');
let m = mistakes([E('e1', T1, 's1', [ERR, 'npm ci', 'npm test'])], NOW);
let rec = Object.values(m.errors);
ok(rec.length === 1 && rec[0].target === 'npm test' && rec[0].error === 'Error: Cannot find module x' && rec[0].n === 1, `one error (got ${JSON.stringify(m.errors)})`);
// The pair: the failed `npm test` is closed by a later `npm test` that passed; the fix is that command.
m = mistakes([E('e1', T1, 's1', [ERR, 'npm ci', 'npm test --silent'])], NOW);
rec = Object.values(m.errors)[0];
ok(rec.fix === 'npm test --silent' && rec.fixKey === 'e1' && rec.fixSessions === 1, `the fix is the first later command of the same target that did not fail (got ${JSON.stringify(rec)})`);
eq(Object.keys(m.errors)[0], keyed('npm test\nError: Cannot find module x', 8), 'the id is keyed(target + newline + error)');
m = mistakes([E('e1', T1, 's1', [ERR, 'npm  test'])], NOW);
eq(Object.values(m.errors)[0].fix, '', 'the same command with other blanks is no fix');
m = mistakes([E('e1', T1, 's1', [ERR, 'npm test --help', 'npm test -h', 'npm test --version', 'npm test --dry-run', 'npm test --list'])], NOW);
eq(Object.values(m.errors)[0].fix, '', 'a probe does not close a pair');
m = mistakes([E('e1', T1, 's1', [bad('git push', 'fatal: no remote'), 'git status', 'git log', 'git diff', 'git show'])], NOW);
eq(Object.values(m.errors)[0].fix, '', 'git status, log, diff and show are probes');
m = mistakes([E('e1', T1, 's1', [ERR, bad('npm test', 'Error: Cannot find module x'), 'npm run build'])], NOW);
eq(Object.values(m.errors)[0].fix, '', 'a command of another target, or one that failed, is no fix');
// The next 2 entries of the same conversation within 60 minutes.
const later = (min, key, s, ran) => E(key, `${day(2)} ${String(10 + Math.floor((min) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`, s, ran);
m = mistakes([E('e1', T1, 's1', [ERR]), later(5, 'e2', 's1', ['npm test --silent'])], NOW);
eq(Object.values(m.errors)[0].fix, 'npm test --silent', 'a fix in the next entry of the conversation');
eq(Object.values(m.errors)[0].fixKey, 'e2', 'and its key');
m = mistakes([E('e1', T1, 's1', [ERR]), later(5, 'e2', 's2', ['npm test --silent'])], NOW);
eq(Object.values(m.errors)[0].fix, '', 'not in another conversation');
m = mistakes([E('e1', T1, 's1', [ERR]), later(61, 'e2', 's1', ['npm test --silent'])], NOW);
eq(Object.values(m.errors)[0].fix, '', 'not after 60 minutes');
m = mistakes([E('e1', T1, 's1', [ERR]), later(60, 'e2', 's1', ['npm test --silent'])], NOW);
eq(Object.values(m.errors)[0].fix, 'npm test --silent', 'at 60 minutes it still is');
m = mistakes([E('e1', T1, 's1', [ERR]), later(1, 'e2', 's1', ['ls']), later(2, 'e3', 's1', ['ls']), later(3, 'e4', 's1', ['npm test --silent'])], NOW);
eq(Object.values(m.errors)[0].fix, '', 'only the next 2 entries of the conversation');
m = mistakes([later(3, 'e4', 's1', ['npm test --silent']), E('e1', T1, 's1', [ERR])], NOW);
eq(Object.values(m.errors)[0].fix, 'npm test --silent', 'entries are sorted by time first');
// A refused call is not in ran at all (transcript.mjs drops it); a NOT_FAILURE text counts nowhere.
m = mistakes([E('e1', T1, 's1', [bad('npm test', 'Exit code 143\nCommand timed out after 9s'), 'npm test'])], NOW);
ok(!Object.keys(m.errors).length && m.window.failures === 0, 'a timeout is no failure');
m = mistakes([E('e1', T1, 's1', [ERR, bad('npm test', "The user doesn't want to proceed with this tool use. x"), 'npm test --silent'])], NOW);
eq(Object.values(m.errors)[0].fix, 'npm test --silent', 'and no success, no failure: it is skipped');
// Counting.
{
  const es = [E('a1', `${day(3)} 09:00`, 's1', [ERR]), E('a2', `${day(3)} 09:30`, 's1', [bad('npm test', 'Error: Cannot find module x'), 'npm test --silent']), E('b1', `${day(1)} 09:00`, 's2', [ERR, 'npm test --silent']), E('c1', `${day(1)} 11:00`, 's3', [ERR])];
  m = mistakes(es, NOW);
  const r = Object.values(m.errors)[0];
  ok(Object.keys(m.errors).length === 1 && r.n === 4 && r.sessions === 3 && r.days === 2 && r.first === day(3) && r.last === day(1) && r.key === 'c1', `n, sessions, days, first, last and the newest failure's key (got ${JSON.stringify(r)})`);
  ok(r.fix === 'npm test --silent' && r.fixKey === 'b1' && r.fixSessions === 2, `the fix of the newest pair; fixSessions counts the conversations (got ${JSON.stringify(r)})`);
  eq(m.window, { from: day(3), to: day(1), entries: 4, failures: 4, days: 2 }, 'the window');
  eq(m.built, day(0), 'built: today, local');
  ok(m.v === 1 && Array.isArray(m.together), 'v and together');
  eq(JSON.stringify(mistakes(es.slice().reverse(), NOW)), JSON.stringify(m), 'the same whatever the order of the entries');
}
eq(mistakes([], NOW).window, { from: day(0), to: day(0), entries: 0, failures: 0, days: 0 }, 'no entries: an empty window');
{ // the caps: 500 errors, newest first
  const es = Array.from({ length: 520 }, (_, i) => E(`k${i}`, `${day(1)} ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, `s${i}`, [bad(`tool${i} run`, `Error: e${i}x`)]));
  ok(Object.keys(mistakes(es, NOW).errors).length === 500, 'at most 500 errors');
  const old = [E('old', `${day(40)} 10:00`, 'o', [bad('oldtool', 'Error: old')]), ...es.slice(0, 500)];
  ok(!Object.values(mistakes(old, NOW).errors).some((e) => e.key === 'old'), 'the oldest go first');
}
{ const s = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_'), r = Object.values(mistakes([E('s', T1, 's1', [bad(`deploy --key ${s}`, 'Error: x'), `deploy --key ${s} again`])], NOW).errors)[0];
  ok(!JSON.stringify(r).includes(s), 'the command text passes through clip, which redacts'); }

// --- recurring ---
const rec3 = (n, daysOf, extra = {}) => mistakes(Array.from({ length: n }, (_, i) => E(`r${i}`, `${day(daysOf[i % daysOf.length])} 10:0${i}`, `s${i}`, [ERR])), NOW);
ok(recurring(rec3(3, [1, 2]), NOW).length === 1, '3 conversations on 2 days are listed');
ok(recurring(rec3(3, [1]), NOW).length === 0, '3 on 1 day are not');
ok(recurring(rec3(2, [1, 2]), NOW).length === 0, '2 are not');
ok(recurring(rec3(3, [40, 41]), NOW).length === 0, 'one older than 30 days is not');
ok(recurring(rec3(3, [30, 31]), NOW).length === 1 && recurring(rec3(3, [29, 31]), NOW).length === 1, 'its last day 30 days back is still in');
{ const x = rec3(3, [1, 2]), id = Object.keys(x.errors)[0];
  ok(recurring(x, NOW, new Set([id])).length === 0, 'a resolved id is not');
  ok(recurring(x, NOW)[0].id === id && recurring(x, NOW)[0].target === 'npm test', 'an item has its id and the record'); }
ok(recurring(mistakes(Array.from({ length: 3 }, (_, i) => E(`n${i}`, `${day(i + 1)} 10:00`, `s${i}`, [bad('make', 'no marker')])), NOW), NOW).length === 0, 'an error with no error line is not');
{ const es = [];
  for (let i = 0; i < 3; i++) es.push(E(`a${i}`, `${day(i + 1)} 10:00`, `a${i}`, [bad('npm test', 'Error: aaa')]));
  for (let i = 0; i < 4; i++) es.push(E(`b${i}`, `${day(i + 1)} 11:00`, `b${i}`, [bad('npm run build', 'Error: bbb')]));
  for (let i = 0; i < 3; i++) es.push(E(`c${i}`, `${day(i)} 12:00`, `c${i}`, [bad('make', 'Error: ccc')]));
  eq(recurring(mistakes(es, NOW), NOW).map((x) => x.target), ['npm run build', 'make', 'npm test'], 'sorted by sessions, then last, newest first'); }

// --- co-change ---
const together = (convs, both, aOnly = 'src/a.mjs', b = 'test/a.test.mjs') => {
  const es = [];
  for (let i = 0; i < convs; i++) es.push(E(`c${i}`, `${day(1)} 10:${String(i).padStart(2, '0')}`, `s${i}`, [], i < both ? [aOnly, b] : [aOnly]));
  return mistakes(es, NOW).together;
};
eq(together(5, 5), [{ a: 'src/a.mjs', b: 'test/a.test.mjs', n: 5, both: 5 }, { a: 'test/a.test.mjs', b: 'src/a.mjs', n: 5, both: 5 }], '5 conversations with both files make the rule, both ways');
ok(together(4, 4).length === 0, '4 do not');
ok(together(5, 3).length === 0, '5 with B in 3 of them do not');
eq(together(5, 4)[0], { a: 'src/a.mjs', b: 'test/a.test.mjs', n: 5, both: 4 }, '5 with B in 4 do (80 %)');
{ const files = Array.from({ length: 30 }, (_, i) => `f${i}.mjs`);
  ok(mistakes(Array.from({ length: 6 }, (_, i) => E(`w${i}`, `${day(1)} 10:0${i}`, `s${i}`, [], files)), NOW).together.length === 0, 'a 30-file entry is ignored');
  ok(mistakes(Array.from({ length: 6 }, (_, i) => E(`w${i}`, `${day(1)} 10:0${i}`, `s${i}`, [], files.slice(0, 20))), NOW).together.length === 200, 'a 20-file entry is not (its 380 rules are cut to 200)'); }
{ // a conversation's changed set is the union of its entries
  const es = Array.from({ length: 5 }, (_, i) => [E(`x${i}`, `${day(1)} 10:0${i}`, `s${i}`, [], ['a.mjs']), E(`y${i}`, `${day(1)} 11:0${i}`, `s${i}`, [], ['b.mjs'])]).flat();
  ok(mistakes(es, NOW).together.some((r) => r.a === 'a.mjs' && r.b === 'b.mjs' && r.n === 5 && r.both === 5), 'the union of the entries of a conversation'); }
for (const p of ['/abs/a.mjs', 'C:\\x\\a.mjs', '../up/a.mjs', 'a/../b.mjs', '.claude/projects/x/memory/a.md']) {
  const es = Array.from({ length: 5 }, (_, i) => E(`p${i}`, `${day(1)} 10:0${i}`, `s${i}`, [], ['src/a.mjs', p]));
  ok(mistakes(es, NOW).together.length === 0, `a path that is absolute, goes up or is under .claude/projects is left out: ${p}`);
}
{ const es = Array.from({ length: 5 }, (_, i) => E(`p${i}`, `${day(1)} 10:0${i}`, `s${i}`, [], ['.\\src\\A.mjs', './test/a.test.mjs']));
  ok(mistakes(es, NOW).together.some((r) => r.a === 'src/a.mjs' && r.b === 'test/a.test.mjs'), 'paths are cleaned (cleanPath): slashes, a leading ./, case'); }
{ const names = Array.from({ length: 120 }, (_, i) => `d${String(i).padStart(3, '0')}.mjs`);
  const es = Array.from({ length: 5 }, (_, i) => E(`t${i}`, `${day(1)} 10:0${i}`, `s${i}`, [], names.slice(0, 15)));
  ok(mistakes(es, NOW).together.length === 200, 'at most 200 rules'); }
{ const t = [{ a: 'src/a.mjs', b: 'test/a.test.mjs', n: 9, both: 8 }, { a: 'src/b.mjs', b: 'test/b.test.mjs', n: 7, both: 7 }];
  eq(cochangeFor(t, ['src/a.mjs'], []), t[0], 'the rule whose a the turn changed and whose b neither list has');
  eq(cochangeFor(t, ['SRC\\a.mjs'], []), t[0], 'paths compared with cleanPath');
  eq(cochangeFor(t, ['src/a.mjs'], ['test/a.test.mjs']), null, 'b in the context: no');
  eq(cochangeFor(t, ['src/a.mjs', 'test/a.test.mjs'], []), null, 'b in the turn: no');
  eq(cochangeFor(t, ['src/b.mjs', 'src/a.mjs'], ['test/a.test.mjs']), t[1], 'the first rule that fits');
  eq(cochangeFor(t, ['x.mjs'], []), null, 'a not changed: no');
  eq(cochangeFor([], ['src/a.mjs'], []), null, 'no rules'); }

// --- claimed ---
const GREEN = 'Done. All tests pass.';
const failedTest = [bad('npm test', 'Error: 3 tests failed')];
eq(claimed(GREEN, failedTest), { cmd: 'npm test', target: 'npm test', kind: 'test' }, 'the claim with a failed last run fires');
eq(claimed(GREEN, [...failedTest, 'npm test']), null, 'a later passing run of the same target does not');
eq(claimed(GREEN, ['npm test', ...failedTest]), { cmd: 'npm test', target: 'npm test', kind: 'test' }, 'only the last run counts');
eq(claimed('All tests pass, except the timing suite.', failedTest), null, '"all pass except the timing suite" does not');
eq(claimed('The tests should pass now.', failedTest), null, '"the tests should pass now" does not');
eq(claimed(GREEN, [bad('npm run build', 'Error: x')]), null, 'a test claim with only a failed build does not');
eq(claimed('The build succeeds.', [bad('npm run build', 'Error: x')]), { cmd: 'npm run build', target: 'npm run build', kind: 'build' }, 'a build claim and a failed build');
eq(claimed('Lint is clean.', [bad('node tools/check.mjs', 'Error: x')]), { cmd: 'node tools/check.mjs', target: 'node tools/check.mjs', kind: 'lint' }, 'a lint claim and a script named check');
eq(claimed('No errors.', [bad('cargo build', 'error: x')]), { cmd: 'cargo build', target: 'cargo build', kind: 'build' }, 'no errors fits any kind');
eq(claimed('All green.', [bad('pytest', 'FAILED x')]), { cmd: 'pytest', target: 'pytest', kind: 'test' }, 'all green fits any kind');
eq(claimed('No failures.', [bad('eslint .', 'error: x')]), { cmd: 'eslint .', target: 'eslint', kind: 'lint' }, 'no failures is a claim, though it holds "fail"');
eq(claimed('A test passes.', failedTest)?.kind, 'test', 'a test passes');
eq(claimed('Tests all pass.', failedTest)?.kind, 'test', 'tests all pass');
eq(claimed('Tests are passing.', failedTest), null, 'a spelling no claim has');
eq(claimed('Tests passing.', failedTest)?.kind, 'test', 'tests passing');
for (const h of ['but', 'still', 'will', 'once', 'if', 'expected', 'not yet', 'should', 'fail', '?']) eq(claimed(`All tests pass ${h} x`, failedTest), null, `a hedge: ${h}`);
eq(claimed('Is it done? All tests pass.', failedTest), null, 'a question mark anywhere in the text is a hedge');
eq(claimed('All tests pass.', []), null, 'no commands');
eq(claimed('', failedTest), null, 'no text');
eq(claimed('Fixed it.', failedTest), null, 'no claim');
eq(claimed('```\nall tests pass\n```\nDone.', failedTest), null, 'a claim in a code fence is none');
eq(claimed('The line `tests pass` is in the log.', failedTest), null, 'nor in inline code');
eq(claimed('> all tests pass\nDone.', failedTest), null, 'nor in a quote');
eq(claimed(`${'x '.repeat(2000)} All tests pass.`, failedTest)?.kind, 'test', 'only the last 1,500 characters are read');
eq(claimed(`All tests pass. ${'x '.repeat(2000)}`, failedTest), null, 'a claim before them is not');
eq(claimed('But first things. ' + 'x '.repeat(1000) + 'All tests pass.', failedTest)?.kind, 'test', 'a hedge before the last 1,500 characters is not read');
for (const c of ['npm test', 'pnpm test', 'yarn test', 'bun test', 'node --test', 'node test/a.test.mjs', 'node spec/a.mjs', 'pytest -x', 'go test ./...', 'cargo test', 'dotnet test', 'vitest run', 'jest']) eq(claimed(GREEN, [bad(c, 'Error: x')])?.kind, 'test', `a test command: ${c}`);
for (const c of ['eslint src', 'tsc --noEmit', 'ruff check', 'mypy x', 'node tools/lint.mjs', 'node tools/verify.mjs', 'npm run lint']) eq(claimed('Lint is clean.', [bad(c, 'Error: x')])?.kind, 'lint', `a lint command: ${c}`);
for (const c of ['npm run build', 'cargo build', 'go build ./...', 'make']) eq(claimed('The build succeeds.', [bad(c, 'Error: x')])?.kind, 'build', `a build command: ${c}`);
eq(claimed(GREEN, [bad('node tools/other.mjs', 'Error: x')]), null, 'a script that is no check');
eq(claimed(GREEN, [bad('npm test', 'Exit code 143\nCommand timed out after 9s')]), null, 'a timeout is no failure');

// --- the cache: build, delete, rebuild ---
const store = storeFor(home, 'C:\\mist-selftest');
mkdirSync(join(store, 'journal'), { recursive: true });
const ent = (key, d, hm, s, o = {}) => ({ key, at: `${d} ${hm}`, s, t: `C--mist/${s}-aaaa`, branch: 'main', asked: `ask ${key}`, answered: `answer ${key}`, changed: [], ran: [], ...o });
const days = new Map();
const put = (e) => days.set(e.at.slice(0, 10), [...(days.get(e.at.slice(0, 10)) ?? []), e]);
[ent('j1', day(3), '09:00', 'aaaaaaaa', { ran: [ERR, 'npm test --silent'], changed: ['src/a.mjs'] }), ent('j2', day(2), '09:00', 'bbbbbbbb', { ran: [ERR], changed: ['src/a.mjs'] }), ent('j3', day(1), '09:00', 'cccccccc', { ran: [ERR, 'npm test --silent'] }),
  ent('j0', day(100), '09:00', 'dddddddd', { ran: [bad('old', 'Error: ancient')] })].forEach(put);
for (const [d, es] of days) writeFileSync(join(store, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`);
const file = join(store, MISTAKES);
ok(readMistakes(store) === null && mistakesOwed(store, NOW), 'no file: nothing to read, owed');
ok(await buildMistakes(store, NOW) === true, 'a build writes the file');
const first = readFileSync(file, 'utf8'), built = JSON.parse(first);
ok(built.v === 1 && built.built === day(0) && built.window.entries === 3 && built.window.failures === 3 && built.window.days === 3, `the window holds the last 90 days (got ${JSON.stringify(built.window)})`);
const r0 = Object.values(built.errors)[0];
ok(Object.keys(built.errors).length === 1 && r0.n === 3 && r0.sessions === 3 && r0.days === 3 && r0.fix === 'npm test --silent' && r0.fixSessions === 2, `the errors of the journal (got ${JSON.stringify(built.errors)})`);
ok(!first.includes('ancient'), 'a day older than 90 is not read');
eq(readMistakes(store), built, 'readMistakes reads it back');
ok(!mistakesOwed(store, NOW) && !mistakesOwed(store, NOW + 3600e3) && mistakesOwed(store, NOW + 36 * 3600e3), 'owed from the next local day on');
if (process.platform !== 'win32') ok((statSync(file).mode & 0o777) === 0o600, 'the file is 0600');
ok(!readdirSync(store).some((f) => f.includes('.tmp')), 'no temp file is left');
ok(await buildMistakes(store, NOW) === false, 'a build that changes nothing writes nothing');
eq(dropMistakes(store), true, 'dropMistakes: true when the file was there');
ok(!existsSync(file) && mistakesOwed(store, NOW), 'and it is gone, and owed');
eq(dropMistakes(store), false, 'false when none was');
await buildMistakes(store, NOW);
eq(readFileSync(file, 'utf8'), first, 'build, delete, rebuild gives the same bytes');
writeFileSync(file, '{not json');
ok(readMistakes(store) === null && mistakesOwed(store, NOW), 'a broken file reads as none');
writeFileSync(file, '\uFEFF' + first);
eq(readMistakes(store), built, 'a BOM is stripped');
writeFileSync(file, JSON.stringify({ ...built, v: 2 }));
ok(readMistakes(store) === null, 'another version reads as none');
// A killed build leaves its temp copy; it holds journal text, so dropMistakes takes it too.
writeFileSync(`${file}.tmp4242`, first);
eq(dropMistakes(store), true, 'a temp copy of a killed build goes with it');
ok(!existsSync(`${file}.tmp4242`), 'the temp copy is gone');
// A forget list that will not read, or a store with no journal: no file is written, nothing throws.
{ const empty = storeFor(home, 'C:\\mist-empty'); mkdirSync(empty, { recursive: true });
  ok(await buildMistakes(empty, NOW) === true && readMistakes(empty).window.entries === 0, 'a store with no journal: an empty file');
  ok(await buildMistakes(join(home, 'no', 'such', 'store'), NOW) === false, 'a store that is not there: false, no throw'); }
// A private conversation's entries are never read (recent() leaves them out).
{ const p = storeFor(home, 'C:\\mist-private'); mkdirSync(join(p, 'journal'), { recursive: true });
  writeFileSync(join(p, 'journal', `${day(1)}.md`), `# Journal ${day(1)}\n\n${[ent('pv1', day(1), '10:00', 'eeeeeeee', { ran: [bad('secrettool x', 'Error: hush')] })].map(render).join('\n\n')}\n`);
  writeFileSync(join(p, '.private-sessions'), 'eeeeeeee\n');
  await buildMistakes(p, NOW);
  ok(!readFileSync(join(p, MISTAKES), 'utf8').includes('hush'), 'a private conversation leaves nothing'); }
// dropMistakes with no store: every project's.
{ const proot = join(home, '.claude', 'projects'), a = join(proot, 'P-a', 'memory'), b = join(proot, 'P-b', 'memory');
  for (const d of [a, b]) { mkdirSync(d, { recursive: true }); writeFileSync(join(d, MISTAKES), '{}'); }
  const keepA = existsSync(join(a, MISTAKES));
  eq(dropMistakes(a), true, 'one store'); ok(keepA && !existsSync(join(a, MISTAKES)) && existsSync(join(b, MISTAKES)), 'only that store\'s');
  eq(dropMistakes(null), true, 'every store');
  ok(!existsSync(join(b, MISTAKES)) && !readdirSync(proot, { recursive: true }).some((f) => f.endsWith(MISTAKES)), 'every project\'s file is gone'); }
{ const d = join(home, 'a-file'); writeFileSync(d, 'x');
  ok(dropMistakes(join(d, 'sub')) === false, 'a store that is a file path: no throw'); }

console.log(`mistakes: ${checks} checks passed`);
