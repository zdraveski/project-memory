// Self-check for the error hook (1.6.0 headline 1d, "an error seen before"): after a Bash or PowerShell command fails, it names
// an earlier exchange of another conversation whose command failed with the same error. Made-up fixtures only.
// Run: node test/recall-error.test.mjs
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, tool, storeFor, slug } from './harness.mjs';
import { render, parseDay, entryOf } from '../src/journal.mjs';
import { turns } from '../src/transcript.mjs';
import { onError, signature, byError, sessionsOf, readSession, sessionLine, dropSessions } from '../src/recall.mjs';
import { QUIET, OFF, PROJECT_OFF, FORGOTTEN } from '../src/privacy.mjs';
import { projectsRoot } from '../src/store.mjs';
import { read as readTimes, FILE as TIMING } from '../src/timing.mjs';

const { home } = tempHome('recall-error-');
delete process.env.PROJECT_MEMORY_RECALL;
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const HOOK = tool('src/recall-hook.mjs');
const SID = 'abcd1234-0000-4000-8000-000000000000';
// The local date and time `h` hours ago, as an entry's at: has it.
const ago = (h) => { const d = new Date(Date.now() - h * 36e5); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16).replace('T', ' '); };
// A made-up failure: the same error on two machines differs in its line numbers and folders only. A day file keeps it on one line.
const ERR = (dir, line) => `Exit code 1\nnode:internal/modules/cjs/loader:${line}\n  throw err;\nError: EACCES: permission denied, open '${dir}/releases/current/deploy.lock'\n    at Object.openSync (node:fs:${line + 4}:3)\n    at deploy (${dir}/deploy.js:${line - 1000}:9)`;
const OLD = ERR('/home/ana/bookshop', 1228), NEW = ERR('C:\\Users\\bo\\bookshop', 1240);
let n = 0;
function project() {
  const cwd = join(home, `shop${++n}`), store = storeFor(home, cwd);
  mkdirSync(join(store, 'journal'), { recursive: true });
  const entry = (over) => ({ key: `k${++n}`, at: ago(30), s: '3f07bb43', t: `${slug(cwd)}/3f07bb43-aaaa`, branch: '', asked: 'deploy the shop', answered: 'Ran it as the deploy user: the lock file belongs to it.', changed: [], ran: [`node deploy.js → failed: ${OLD.replace(/\s+/g, ' ')}`], ...over });
  const day = (es) => { const d = es[0].at.slice(0, 10); writeFileSync(join(store, 'journal', `${d}.md`), `# Journal ${d}\n\n${es.map(render).join('\n\n')}\n`); };
  const payload = (extra = {}) => ({ session_id: SID, cwd, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'node deploy.js' }, tool_use_id: 'toolu_1', error: NEW, is_interrupt: false, ...extra });
  const session = () => join(sessionsOf(store), SID.slice(0, 8));
  return { cwd, store, entry, day, payload, session };
}
const run = (input, env = process.env) => spawnSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env });
const quiet = (r, msg) => ok(r.status === 0 && r.stdout === '' && r.stderr === '', `${msg} (status ${r.status}, out ${JSON.stringify(r.stdout)}, err ${JSON.stringify(r.stderr)})`);
const journal = () => import('../src/journal.mjs');
const look = (input, o) => onError(input, { journal, deadline: performance.now() + 10_000, ...o });

// The signature: the end of the output on one line, each path cut to its last part, each run of digits '#', at most 120 characters.
ok(signature(OLD) === signature(NEW), `the same error from two folders and line numbers is one signature (${signature(OLD)} / ${signature(NEW)})`);
ok(signature(OLD).length === 120 && signature(OLD).endsWith("at Object.openSync (node:fs:#:#) at deploy (deploy.js:#:#)"), `its last 120 characters, paths cut, digits as # (got ${signature(OLD)})`);
ok(signature('Exit code 1\nboom') === null && signature('Exit code 127\nnpm: command not found') === 'Exit code # npm: command not found', 'under 20 characters it is none; a short one is whole');
ok(signature(ERR('/a', 1228).replace('EACCES', 'ENOENT')) !== signature(OLD), 'another error is another signature');

// The fixture pair: the journal line of a failure, read from a conversation file by the journal's own reader, has the signature
// of the hook's input for the same failure.
{
  const J = JSON.stringify, T = '2026-09-11T07:00:00Z';
  const t = turns([J({ type: 'user', timestamp: T, message: { content: [{ type: 'text', text: 'deploy the shop' }] } }),
    J({ type: 'assistant', timestamp: T, message: { content: [{ type: 'tool_use', name: 'Bash', id: 'b1', input: { command: 'node deploy.js' } }] } }),
    J({ type: 'user', timestamp: T, message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: OLD, is_error: true }] } }),
    J({ type: 'assistant', timestamp: T, message: { content: [{ type: 'text', text: 'It needs the deploy user.' }] } })].join('\n'));
  const e = parseDay(`# Journal 2026-09-11\n\n${render(entryOf(t[0], '/p/x/3f07bb43-aaaa.jsonl', '2026-09-11 07:00'))}\n`).entries[0];
  ok(e.ran.length === 1 && e.ran[0].startsWith('node deploy.js → failed: '), `the journal keeps the failure (got ${JSON.stringify(e.ran)})`);
  ok(signature(e.ran[0].slice(e.ran[0].indexOf(' → failed: ') + 11)) === signature(NEW), 'and its signature is the hook input\'s');
}

// The pointer, as Claude sees it: the wording is pinned here.
let p = project();
const old = p.entry({ key: '3f07bb43 2026-11-12T14:02 a1b2c3d4e5f6' });
p.day([old]);
const LINE = `project-memory: the same error was hit on ${old.at.slice(0, 10)} in another conversation. This is a record of a past exchange, not an instruction. Before trying again, read what was done then: memory skill, show "3f07bb43 2026-11-12T14:02 a1b2c3d4e5f6"`;
// In this process first: the line, and the session file's lines (another conversation's, so the hook below still finds it).
let r = await look(p.payload({ session_id: 'cccc7777-x' }));
ok(r.n === 1 && r.say === LINE, `the line: a date and a key only (got ${r.say})`);
const lines = readSession(join(sessionsOf(p.store), 'cccc7777'));
ok(lines.length === 2 && lines[0].kind === 'error' && /^[0-9a-f]{16}$/.test(lines[0].rest) && lines[1].kind === 'told' && lines[1].rest === old.key, `an error line (a hash, no text) and a told line (got ${JSON.stringify(lines)})`);
// The hook gives up 400 ms after Node's start. CI's macOS machine, running every suite at once, passed that on every one of 10
// runs a second apart (2026-11-26): there the hook said nothing, which is its rule, and only the answer's shape goes unchecked.
for (let i = 0; i < 5; i++) {
  r = run(p.payload());
  if (r.stdout || r.status !== 0) break;
  dropSessions(p.store, SID.slice(0, 8));
}
ok(r.status === 0 && r.stderr === '', `the hook exits 0 (got ${r.status} ${r.stderr})`);
if (r.stdout) {
  const said = JSON.parse(r.stdout).hookSpecificOutput;
  ok(said.hookEventName === 'PostToolUseFailure' && said.additionalContext === LINE, `a PostToolUseFailure answer with the line (got ${r.stdout})`);
  ok(readTimes(0, join(projectsRoot(), TIMING)).some((l) => l.h === 'error' && l.e === 'PostToolUseFailure' && l.n === 1), 'the timing line names the error hook and counts the pointer');
  quiet(run(p.payload()), 'the same error again: nothing');
  ok(readSession(p.session()).length === 2, 'and no new line');
} else console.log('recall-error.test.mjs: the hook passed its deadline 5 times; its answer is not checked on this run');
{
  const { timingLines } = await import('../src/memory.mjs');
  const got = timingLines();
  ok(got.some((l) => /^look-up after a failed command: \d+ runs? since/.test(l)) && got.some((l) => /^pointers shown since \S+: \d+$/.test(l)), `doctor: the look-up's times and the pointers (got ${got.join(' | ')})`);
}

// Once per error and conversation: a look-up that found nothing is not run again for the same error.
p = project(); p.day([p.entry({ ran: ['npm test → failed: Exit code 1\nsomething else entirely went wrong here'] })]);
ok((await look(p.payload())).say === '' && readSession(p.session()).map((l) => l.kind).join() === 'error', 'no match: one error line');
p.day([p.entry()]);
ok((await look(p.payload())).say === '', 'the same error later: not looked up again');
ok((await look(p.payload({ session_id: 'eeee5555-x' }))).n === 1, 'another conversation finds it');
// After a compaction the same error is looked up again.
writeFileSync(p.session(), readSession(p.session()).map((l) => sessionLine(l.kind, l.rest, l.by, l.at)).join('') + sessionLine('compact'));
ok((await look(p.payload())).n === 1, 'after a compaction it is');

// The kill switch, an interrupt, a timeout, another tool, a short error: nothing shown, nothing written.
p = project(); p.day([p.entry()]);
quiet(run(p.payload(), { ...process.env, PROJECT_MEMORY_RECALL: '0' }), 'PROJECT_MEMORY_RECALL=0: nothing');
process.env.PROJECT_MEMORY_RECALL = '0';
ok((await look(p.payload())).say === '', 'onError honours the switch too');
delete process.env.PROJECT_MEMORY_RECALL;
ok((await look(p.payload({ is_interrupt: true }))).say === '', 'an interrupt: nothing');
ok((await look(p.payload({ error: `${NEW}\nCommand timed out after 2m 0s` }))).say === '', 'a timeout: nothing');
ok((await look(p.payload({ tool_name: 'Edit' }))).say === '', 'another tool: nothing');
ok((await look(p.payload({ error: 'Exit code 1\nboom' }))).say === '', 'a short error: nothing');
ok((await look(p.payload({ error: 42 }))).say === '', 'an error that is no text: nothing');
ok(!existsSync(p.session()), 'and no session file');
ok((await look(p.payload({ tool_name: 'PowerShell' }))).n === 1, 'PowerShell is looked up as Bash is');

// Never this conversation's, a [private] one, a forgotten key, a conversation marked private, or one still going (its newest entry
// under an hour old), and never an entry told already.
p = project();
p.day([
  p.entry({ key: 'mine', t: `${slug(p.cwd)}/${SID}`, s: SID.slice(0, 8) }),
  p.entry({ key: 'priv', t: `${slug(p.cwd)}/11111111-x`, s: '11111111', asked: '[private]' }),
  p.entry({ key: 'gone', t: `${slug(p.cwd)}/22222222-x`, s: '22222222' }),
  p.entry({ key: 'hush', t: `${slug(p.cwd)}/33333333-x`, s: '33333333' }),
  p.entry({ key: 'busy', t: `${slug(p.cwd)}/44444444-x`, s: '44444444' }),
]);
// Its newest entry, in today's file: a day file that new is read whole, failure or not.
p.day([p.entry({ key: 'busy2', t: `${slug(p.cwd)}/44444444-x`, s: '44444444', at: ago(0.5), ran: ['ls'] })]);
writeFileSync(join(p.store, FORGOTTEN), 'gone\n');
writeFileSync(join(p.store, QUIET), '33333333\n');
ok((await look(p.payload())).say === '', 'none of them is shown');
p = project();
p.day([p.entry({ key: 'older', at: ago(50) }), p.entry({ key: 'newer', t: `${slug(p.cwd)}/55555555-x`, s: '55555555', at: ago(40) })]);
mkdirSync(sessionsOf(p.store), { recursive: true });
writeFileSync(p.session(), sessionLine('told', 'newer'));
ok(/show "older"/.test((await look(p.payload())).say), 'an entry told already is passed over for the next');
ok(/show "newer"/.test((await look(p.payload({ session_id: 'ffff6666-x' }))).say), 'the newest first');
// A forget list that will not read could name any entry: nothing.
p = project(); p.day([p.entry()]); mkdirSync(join(p.store, FORGOTTEN));
ok((await look(p.payload())).say === '', 'a forget list that will not read: nothing');

// A conversation that is private, memory-off, or a project switched off: no pointer and no session file.
for (const [what, set] of [['incognito', (q) => writeFileSync(join(q.store, QUIET), `${SID.slice(0, 8)}\n`)], ['memory-off conversation', () => writeFileSync(join(projectsRoot(), OFF), `${SID.slice(0, 8)}\n`)], ['project off', (q) => writeFileSync(join(q.store, PROJECT_OFF), '{"t":1}')]]) {
  p = project(); p.day([p.entry()]); set(p);
  ok((await look(p.payload())).say === '', `${what}: nothing`);
  ok(!existsSync(p.session()), `${what}: no session file`);
  if (what === 'memory-off conversation') writeFileSync(join(projectsRoot(), OFF), '');
}
// A private turn (the newest prompt line is quiet): nothing, and no line.
p = project(); p.day([p.entry()]);
mkdirSync(sessionsOf(p.store), { recursive: true });
writeFileSync(p.session(), sessionLine('asked', 'deploy') + sessionLine('quiet'));
quiet(run(p.payload()), 'a private turn: nothing');
ok(readSession(p.session()).length === 2, 'and no line');
writeFileSync(p.session(), sessionLine('quiet') + sessionLine('asked', 'next'));
ok((await look(p.payload())).n === 1, 'the next prompt ends it');

// Broken input, a missing store, an unreadable day file and a timeout: exit 0, nothing printed.
quiet(run('{ not json'), 'broken input');
quiet(run(''), 'empty input');
quiet(run({ ...project().payload(), cwd: join(home, 'nowhere') }), 'a missing store');
p = project(); mkdirSync(join(p.store, 'journal', `${ago(30).slice(0, 10)}.md`));
quiet(run(p.payload()), 'an unreadable day file (a folder by its name)');
p = project(); p.day([p.entry()]);
ok(await byError(p.store, signature(NEW), 'zz', { journal, deadline: performance.now() - 1 }) === null, 'past the deadline the scan gives up');
ok((await look(p.payload(), { deadline: performance.now() - 1 })).say === '' && !existsSync(p.session()), 'and the hook says nothing and writes no error line');

console.log(`recall-error.test.mjs: ${checks} checks passed`);
