// Self-check for the 1.7.0 lines of the startup briefing (step 10): H3 dead ends, H4 recurring errors, E2's git line and L4's retired-lesson
// line, and that the briefing stays within BRIEF. The other briefing lines are held by handoff-log.test.mjs. Run: node briefing.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, readdirSync, statSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome, tempDir, storeFor } from './harness.mjs';

const { home } = tempHome('brief-');
const { briefing } = await import('../src/briefing.mjs');
const { storeOf, local, sharedStore } = await import('../src/store.mjs');
const { sessionsOf, sessionLine } = await import('../src/sessions.mjs');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const DAY = 864e5, day = (back = 0) => local(Date.now() - back * DAY).slice(0, 10);
const env = (v) => { if (v === undefined) delete process.env.PROJECT_MEMORY_LESSONS; else process.env.PROJECT_MEMORY_LESSONS = v; };
let n = 0;
// A project: its own folder name, its store.
const project = () => { const cwd = `C:\\brief-selftest-${++n}`, dir = storeFor(home, cwd); mkdirSync(dir, { recursive: true }); return { cwd, dir }; };
const start = (p, source = 'startup', opts, id = 'aaaaaaaa-1') => briefing({ cwd: p.cwd, session_id: id, source }, opts);
// A feedback note with the lesson keys, written 3 days ago.
const note = (dir, file, { desc = `desc of ${file}`, extra = '' } = {}) => {
  writeFileSync(join(dir, file), `---\nname: ${file.replace(/\.md$/, '')}\ndescription: "${desc}"\nmetadata:\n  type: feedback\n${extra}---\n\nbody\n`);
  const t = new Date(Date.now() - 3 * DAY - 60000); utimesSync(join(dir, file), t, t);
};
const dead = (dir, file, instead, extra = '') => note(dir, file, { extra: `instead: ${instead}\n${extra}` });
const counters = (dir) => JSON.parse(readFileSync(join(dir, '.lessons.json'), 'utf8'));
const err = (o = {}) => ({ target: 'npm test', error: 'Error: Cannot find module', n: 5, sessions: 3, days: 2, first: day(5), last: day(1), key: 'k1', fix: '', fixKey: '', fixSessions: 0, ...o });
const mistakes = (dir, errors) => writeFileSync(join(dir, '.mistakes.json'), JSON.stringify({ v: 1, built: day(), window: { from: day(9), to: day(), entries: 9, failures: 9, days: 3 }, errors, together: [] }));
const E = { aaaaaaa1: err(), bbbbbbb2: err({ target: 'npm ci', error: 'Error: ENOENT', sessions: 4, fix: 'npm install', fixKey: 'k2', fixSessions: 2 }), ccccccc3: err({ target: 'make', error: 'make: *** failed', sessions: 3, last: day(3) }) };
const snapshot = (dir) => readdirSync(dir).sort().map((f) => { const s = statSync(join(dir, f)); return `${f} ${s.size} ${s.mtimeMs}`; }).join('\n');

// 1. H3, dead ends.
{
  const p = project();
  for (let i = 1; i <= 5; i++) dead(p.dir, `dead-${i}.md`, `use approach number ${i} instead`);
  dead(p.dir, 'dead-6.md', 'use the helper '.repeat(12).trim());
  env('deadend');
  const out = await start(p);
  const want = ['Dead ends in this project (records, check them against the code):',
    ...[1, 2, 3].map((i) => `- [3d] desc of dead-${i}.md: Instead: use approach number ${i} instead (note: dead-${i}.md)`), 'and 3 more: memory skill, lessons'].join('\n');
  ok(out.includes(`${want}\n`), `the block lists 3 dead ends and counts the rest (got ${out})`);
  env('0'); const base = await start(p); env(undefined);
  ok(!(await start(p)).includes('Dead ends'), 'off by default (DEFAULTS.deadend is false)');
  ok(out.replace(`${want}\n`, '') === base, 'the block is the only difference from the 1.6.7 briefing (switch 0)');
  // A long one is held to 200 characters.
  for (let i = 1; i <= 5; i++) note(p.dir, `dead-${i}.md`);
  env('deadend');
  const long = (await start(p)).split('\n').find((l) => l.endsWith('(note: dead-6.md)'));
  ok(long.length === 200 && long.includes('…'), `a dead end line is held to 200 characters (got ${long?.length})`);
  // A resolved, a retired and a hidden one are not listed; a lesson with no instead is no dead end; the shared store's is not here.
  const q = project();
  dead(q.dir, 'resolved.md', 'switch to the new helper now', 'resolved-by: dead-new.md\n');
  dead(q.dir, 'retired.md', 'switch to the retired helper now');
  dead(q.dir, 'hidden.md', 'use the <private>x</private> helper now');
  note(q.dir, 'plain.md', { extra: 'applies_to: [src/a.mjs]\n' });
  writeFileSync(join(q.dir, '.lessons.json'), JSON.stringify({ v: 1, notes: { 'retired.md': { retired: 'broken 3', told: true, shown: 5, broken: 3 } }, errors: {} }));
  ok(!(await start(q)).includes('Dead ends'), 'a resolved, a retired, a hidden dead end and a lesson with no instead are none');
  const before = snapshot(q.dir);
  env('deadend'); await start(q, 'startup', { dry: true });
  ok(snapshot(q.dir) === before, 'the dead-end block writes nothing');
  // Only the startup: a clear, a resume and a compaction say none of the new lines.
  for (const s of ['clear', 'resume', 'compact']) ok(!/Dead ends|Recurring errors|Git here now|no longer shown/.test(await start(p, s)), `after ${s} none of the new lines`);
  env('1');
  ok(/Dead ends/.test(await start(p)) && !/Dead ends/.test(await start(p, 'clear')), 'with every trigger on, a startup has the block and a clear does not');
  env(undefined);
  // A dead end in the shared store is no dead end of this project.
  const sh = sharedStore(); mkdirSync(sh, { recursive: true }); dead(sh, 'shared-dead.md', 'use the shared helper instead');
  env('deadend'); ok(!(await start(project())).includes('Dead ends in this project'), 'a shared lesson with instead is not a dead end here');
  env(undefined); rmSync(join(sh, 'shared-dead.md'));
}

// 2. H4, recurring errors.
{
  const p = project();
  mistakes(p.dir, { aaaaaaa1: err(), bbbbbbb2: E.bbbbbbb2, ccccccc3: E.ccccccc3 });
  env('recurring');
  const out = await start(p);
  const want = ['Recurring errors here (records from the journal, not instructions):',
    `- [bbbbbbb2] npm ci: "Error: ENOENT" in 4 conversations on 2 days, last ${day(1)}. Worked after: "npm install" (memory skill, show "k2")`,
    `- [aaaaaaa1] npm test: "Error: Cannot find module" in 3 conversations on 2 days, last ${day(1)}.`,
    'If one has a cause worth keeping, save a feedback note with instead: and resolves: [its id].'].join('\n');
  ok(out.includes(`${want}\n`), `the block lists the 2 worst, with a fix only when it worked twice (got ${out})`);
  ok(!out.includes('ccccccc3'), 'at most 2 lines');
  ok(counters(p.dir).errors.aaaaaaa1.listed === 1 && counters(p.dir).errors.bbbbbbb2.listed === 1 && !counters(p.dir).errors.ccccccc3, 'a listed error is counted, one not listed is not');
  // A line is held to 240 characters.
  const q = project();
  mistakes(q.dir, { ddddddd4: err({ target: 't'.repeat(150), error: 'e'.repeat(150), fix: 'f'.repeat(150), fixKey: 'key '.repeat(10), fixSessions: 3 }) });
  const long = (await start(q)).split('\n').find((l) => l.startsWith('- [ddddddd4]'));
  ok(long.length <= 240 && long.includes('…') && long.endsWith('")'), `a recurring line is held to 240 characters and keeps its end (got ${long?.length}: ${long})`);
  // Gone after a note that resolves it, even a shared one's.
  note(p.dir, 'cause.md', { extra: 'instead: pin the version of the helper\nresolves: [aaaaaaa1]\n' });
  ok(!(await start(p)).includes('aaaaaaa1') && (await start(p)).includes('bbbbbbb2'), 'an id a lesson resolves is left out');
  const sh = sharedStore(); mkdirSync(sh, { recursive: true }); note(sh, 'shared-cause.md', { extra: 'instead: pin the version of the helper\nresolves: [bbbbbbb2]\n' });
  const got = await start(p);
  ok(!got.includes('bbbbbbb2') && got.includes('ccccccc3'), 'an id a shared lesson resolves is left out too');
  rmSync(join(sh, 'shared-cause.md'));
  // The fourth startup: an id listed three times is left out.
  const r = project();
  mistakes(r.dir, { eeeeeee5: err() });
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push((await start(r)).includes('[eeeeeee5]'));
  ok(seen.join() === 'true,true,true,false' && counters(r.dir).errors.eeeeeee5.listed === 3, `listed at three startups, not at the fourth (got ${seen})`);
  // Dry: nothing counted. Off: nothing said, nothing written. Recent only: a stale one is none.
  const s = project();
  mistakes(s.dir, { fffffff6: err(), 'aaaaaaa0': err({ last: day(40) }) });
  ok((await start(s, 'startup', { dry: true })).includes('[fffffff6]') && !existsSync(join(s.dir, '.lessons.json')), 'a dry run says it and counts nothing');
  env('0'); ok(!(await start(s)).includes('Recurring') && !existsSync(join(s.dir, '.lessons.json')), 'with the switch at 0 nothing is said or written');
  env(undefined); ok(!(await start(s)).includes('Recurring') && !existsSync(join(s.dir, '.lessons.json')), 'off by default');
  env('recurring'); ok(!(await start(s, 'clear')).includes('Recurring') && !(await start(s, 'compact')).includes('Recurring'), 'not after a clear or a compaction');
  ok(!(await start(s)).includes('aaaaaaa0'), 'an error last seen 40 days ago is none');
  env(undefined);
}

// 3. E2, the git line.
{
  const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, stdio: 'pipe' });
  const repo = tempDir('brief-repo-');
  git(repo, 'init', '-q'); git(repo, 'symbolic-ref', 'HEAD', 'refs/heads/trunk'); git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'one\n'); writeFileSync(join(repo, 'b.txt'), 'x\n');
  git(repo, 'add', 'a.txt', 'b.txt'); git(repo, 'commit', '-q', '-m', 'first');
  mkdirSync(storeOf({ cwd: repo }), { recursive: true });
  const line = async (cwd = repo, opts, source = 'startup') => (await briefing({ cwd, session_id: 'aaaaaaaa-1', source }, opts)).split('\n').find((l) => l.startsWith('Git here now'));
  env(undefined);
  ok(await line() === 'Git here now: branch trunk.', `a clean tree prints the branch alone (got ${await line()})`);
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n'); writeFileSync(join(repo, 'b.txt'), 'y\n'); writeFileSync(join(repo, 'c.txt'), 'new\n');
  ok(await line() === 'Git here now: branch trunk. Uncommitted: 3 files (+3 -1): a.txt, b.txt, c.txt', `three uncommitted files (got ${await line()})`);
  for (let i = 1; i <= 5; i++) writeFileSync(join(repo, `f${i}.txt`), 'n\n');
  ok(await line() === 'Git here now: branch trunk. Uncommitted: 8 files (+3 -1): a.txt, b.txt, c.txt, f1.txt, f2.txt and 3 more', `eight: five names and the count of the rest (got ${await line()})`);
  ok(await line(repo, undefined, 'clear') === undefined && await line(repo, undefined, 'compact') === undefined, 'only at a startup');
  env('0'); ok(await line() === undefined, 'the switch at 0 turns it off');
  env('deadend'); ok(await line() !== undefined, 'a trigger list does not turn it off (it is no trigger)');
  env(undefined);
  const plain = tempDir('brief-plain-');
  mkdirSync(storeOf({ cwd: plain }), { recursive: true });
  ok(await line(plain) === undefined && (await briefing({ cwd: plain, session_id: 'aaaaaaaa-1', source: 'startup' })).includes('Shared memory'), 'no repository: no line, and the briefing prints');

  // The runner: the two calls, in the cwd, with the 1.5 s timeout; the answers through an injected one.
  const calls = [];
  const canned = (st, diff = ' 1 file changed, 4 insertions(+), 2 deletions(-)\n') => (args, o) => { calls.push({ args, o }); return args.includes('status') ? st : diff; };
  const head = (...l) => ['# branch.oid 1234', '# branch.head main', ...l, ''].join('\n');
  const p = project();
  const via = async (st, opts = {}) => (await briefing({ cwd: p.cwd, session_id: 'aaaaaaaa-1', source: 'startup' }, { run: canned(st), ...opts })).split('\n').find((l) => l.startsWith('Git here now'));
  ok(await via(head('# branch.upstream origin/main', '# branch.ab +2 -1')) === 'Git here now: branch main, 2 ahead of and 1 behind origin.', 'ahead of and behind');
  ok(await via(head('# branch.upstream origin/main', '# branch.ab +2 -0')) === 'Git here now: branch main, 2 ahead of origin.', 'ahead');
  ok(await via(head('# branch.upstream upstream/dev', '# branch.ab +0 -3')) === 'Git here now: branch main, 3 behind upstream.', 'behind');
  ok(await via(head('# branch.upstream origin/main', '# branch.ab +0 -0')) === 'Git here now: branch main.', 'in step');
  ok(await via(head('1 .M N... 100644 100644 100644 aaa bbb dir with space/f.txt', '2 R. N... 100644 100644 100644 aaa bbb R100 new.txt\told.txt', 'u UU N... 100644 100644 100644 100644 a b c conflict.txt', '? u.txt'))
    === 'Git here now: branch main. Uncommitted: 4 files (+4 -2): dir with space/f.txt, new.txt, conflict.txt, u.txt', 'every kind of entry, a path with a space, a rename by its new name');
  calls.length = 0; await via(head('? u.txt'));
  ok(calls.map((c) => c.args.join(' ')).join('|') === '-c core.quotePath=false status --porcelain=v2 --branch|diff --shortstat --no-ext-diff --no-textconv HEAD' && calls.every((c) => c.o.cwd === p.cwd.replaceAll('\\', '/') && c.o.timeout === 1500), 'both calls, in the cwd, with 1.5 s, names as typed, no diff driver run');
  calls.length = 0; await via(head('# branch.upstream origin/main', '# branch.ab +1 -0'));
  ok(calls.length === 1 && calls[0].args.includes('status'), 'a tree with nothing uncommitted costs no diff');
  ok(await via('') === undefined && await via('garbage\n') === undefined, 'an answer with no branch is no line');
  ok(await via(head('1 .M N... 100644 100644 100644 aaa bbb f.txt'), { run: (a) => (a.includes('status') ? head('1 .M N... 100644 100644 100644 aaa bbb f.txt') : Promise.reject(new Error('no HEAD'))) }) === 'Git here now: branch main. Uncommitted: 1 files (+0 -0): f.txt', 'a diff that fails costs the counts, not the line');
  ok(await via(head(), { run: async () => { throw new Error('boom'); } }) === undefined && await via(head(), { run: () => { throw new Error('boom'); } }) === undefined, 'a runner that throws gives no line');
  // Another live session: its files may be among them.
  mkdirSync(sessionsOf(p.dir), { recursive: true });
  writeFileSync(join(sessionsOf(p.dir), 'bbbbbbbb-2'), sessionLine('asked', 'x'));
  ok(await via(head('? u.txt')) === "Git here now: branch main. Uncommitted: 1 files (+4 -2): u.txt (some may be the other session's)", 'with another live session the line says so');
  ok(await via(head()) === 'Git here now: branch main.', 'and a clean tree says nothing of it');
  // The line is held to 300 characters.
  const long = await via(head(...[1, 2, 3, 4, 5].map((i) => `? file${i}-${'name-'.repeat(20)}.txt`)));
  ok(long.length === 300 && long.endsWith('…'), `the git line is held to 300 characters (got ${long.length})`);
  // A name that is not ASCII is printed as typed, not as git's quoted escapes.
  const odd = tempDir('brief-odd-');
  git(odd, 'init', '-q'); writeFileSync(join(odd, 'ü-é.txt'), 'x\n'); mkdirSync(storeOf({ cwd: odd }), { recursive: true });
  ok((await line(odd)).endsWith(': ü-é.txt'), `a non-ASCII name is printed as typed (got ${await line(odd)})`);
  // A hung git: no line, the briefing still prints. The runner is handed the timeout.
  const slow = (args, { cwd, timeout }) => { const r = spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { cwd, timeout }); if (r.error || r.status !== 0) throw new Error('timed out'); return ''; };
  const out = await briefing({ cwd: p.cwd, session_id: 'aaaaaaaa-1', source: 'startup' }, { run: slow });
  ok(!out.includes('Git here now') && out.includes('Shared memory'), 'a git that hangs gives no line, and the briefing prints');
}

// 4. L4, the retired-lesson line.
{
  const p = project();
  dead(p.dir, 'old.md', 'use the new helper instead');
  writeFileSync(join(p.dir, '.lessons.json'), JSON.stringify({ v: 1, notes: { 'old.md': { shown: 7, followed: 0, broken: 3, na: 0, unknown: 0, sessions: [], last: day(), retired: 'broken 3', told: false },
    'gone.md': { retired: 'broken 3', told: false, shown: 1, broken: 3 }, 'done.md': { retired: 'broken 3', told: true, shown: 1, broken: 3 } }, errors: {} }));
  const line = 'project-memory: the lesson old.md is no longer shown (shown 7, broken 3). Fix the note or add resolved-by: to it. See: memory skill, lessons';
  env(undefined);
  const before = snapshot(p.dir);
  ok((await start(p, 'startup', { dry: true })).includes(`${line}\n`) && snapshot(p.dir) === before, 'a dry run says it and writes nothing');
  const out = await start(p);
  ok(out.includes(`${line}\n`) && !out.includes('gone.md') && !out.includes('done.md'), 'a retired lesson is told once; a note that is gone or already told is not');
  ok(counters(p.dir).notes['old.md'].told === true && counters(p.dir).notes['gone.md'].told === false, 'told is written for the one said');
  ok(!(await start(p)).includes('no longer shown'), 'and it is not said again');
  const q = project();
  writeFileSync(join(q.dir, '.lessons.json'), JSON.stringify({ v: 1, notes: { 'cochange:1a2b3c4d': { retired: 'broken 3', told: false, shown: 4, broken: 3 } }, errors: {} }));
  ok((await start(q)).includes('the lesson cochange:1a2b3c4d is no longer shown (shown 4, broken 3).'), 'a retired co-change lesson has no note to find, and is told');
  const r = project();
  dead(r.dir, 'old.md', 'use the new helper instead');
  writeFileSync(join(r.dir, '.lessons.json'), JSON.stringify({ v: 1, notes: { 'old.md': { retired: 'broken 3', told: false, shown: 7, broken: 3 } }, errors: {} }));
  env('0'); const off = await start(r); env(undefined);
  ok(!off.includes('no longer shown') && counters(r.dir).notes['old.md'].told === false, 'the switch at 0 turns it off and writes nothing');
  // Only at a startup: a clear tells nothing and counts nothing.
  const c = await start(r, 'clear');
  ok(!c.includes('no longer shown') && counters(r.dir).notes['old.md'].told === false, 'after a clear a retired lesson is not told');
}

// A dry run says the left-behind notes but leaves the one-time notice due.
{
  const p = project(), old = join(p.dir, '..', '..', `D--old-${p.cwd.split('-').slice(-2).join('-')}`, 'memory');
  mkdirSync(old, { recursive: true }); writeFileSync(join(old, 'left-behind.md'), '---\nname: left-behind\n---\n\nbody\n');
  const before = snapshot(p.dir);
  ok((await start(p, 'startup', { dry: true })).includes('Notes may have been left behind') && snapshot(p.dir) === before, 'a dry run says the notes left behind and writes nothing');
  ok((await start(p)).includes('Notes may have been left behind') && !(await start(p)).includes('Notes may have been left behind'), 'and the real startup still says it, once');
}

// 5. The briefing stays within BRIEF, the older exchanges going first.
{
  const p = project();
  const stamp = (m) => new Date(Date.now() - 2 * DAY + m * 60000).toLocaleString('sv-SE').slice(0, 16);
  writeFileSync(join(p.dir, 'handoff.md'), `---\nname: handoff\n---\n\n<!-- auto:start -->\n${[1, 2, 3, 4, 5].map((i) => `- **asked** ${stamp(i)} [ffffffff]: ask number ${i} ${'q'.repeat(300)}\n  **did:** answer number ${i} ${'a'.repeat(400)}`).join('\n')}\n<!-- auto:end -->\n`);
  for (let i = 1; i <= 5; i++) dead(p.dir, `dead-${i}.md`, `use approach number ${i} instead`);
  mistakes(p.dir, E);
  env(undefined);
  const plain = await start(p);
  env('1');
  const info = {}, full = await start(p, 'startup', { run: () => ' 1 file changed, 4 insertions(+)\n', info });
  env(undefined);
  const base = {}; await start(p, 'startup', { info: base });
  const shown = (s) => (s.match(/ask number \d/g) ?? []).length;
  ok(/Dead ends/.test(full) && /Recurring errors/.test(full), 'the new lines are in');
  ok(full.length <= 3500 && plain.length <= 3500, `within BRIEF (got ${full.length} and ${plain.length})`);
  const asked = (t) => (t.match(/\*\*asked\*\*/g) ?? []).length;
  ok(info.left >= 1 && asked(full) === 5 - info.left && asked(plain) === 5 - base.left, `it says how many older exchanges it left out (${info.left}, ${base.left})`);
  ok(shown(plain) > shown(full) && shown(full) >= 1, `the older exchanges go first, for the new lines (${shown(plain)} then ${shown(full)})`);
}

console.log(`briefing.test.mjs: ${checks} checks passed`);
