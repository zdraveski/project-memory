// Self-check for headline 4 of 1.6.0, sessions that see each other: the `title`, `saw` and `end` lines, the SessionEnd hook,
// and the four places (the briefing, status, a prompt, a change). Two made-up sessions in one made-up project.
// Run: node test/sessions.test.mjs
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, tool, storeFor } from './harness.mjs';
import { onChange, onPrompt, sessionsOf, readSession, sessionLine, dropSessions, cleanPath, others, titleOf, ACTIVE } from '../src/recall.mjs';
import { readTail } from '../src/transcript.mjs';
import { hushed } from '../src/privacy.mjs';
import { local, projectsRoot } from '../src/store.mjs';
import { read as readTimes, FILE as TIMING } from '../src/timing.mjs';

const { home } = tempHome('sessions-');
delete process.env.PROJECT_MEMORY_RECALL;
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const HOOK = tool('src/recall-hook.mjs');
const A = 'aaaaaaaa-0000-4000-8000-000000000000', B = 'bbbbbbbb-0000-4000-8000-000000000000';
const journal = () => import('../src/journal.mjs');
const iso = (ago) => new Date(Date.now() - ago).toISOString(), hhmm = (t) => local(t).slice(11);
let n = 0;
// A project with its store and journal folder (no entries: the pointers stay out of the way), and B's session file writer.
function project() {
  const cwd = join(home, `shop${++n}`), store = storeFor(home, cwd);
  mkdirSync(join(store, 'journal'), { recursive: true });
  const full = (f) => cleanPath(join(cwd, f));
  const file = (s) => join(sessionsOf(store), s.slice(0, 8));
  const b = (...lines) => { mkdirSync(sessionsOf(store), { recursive: true }); appendFileSync(file(B), lines.map(([k, rest, ago]) => sessionLine(k, rest, '', iso(ago))).join('')); };
  const change = (f, s = A) => onChange({ session_id: s, cwd, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: join(cwd, f) } }, { journal, deadline: performance.now() + 10_000 });
  const prompt = (text, extra = {}) => onPrompt({ session_id: A, cwd, hook_event_name: 'UserPromptSubmit', prompt: text, ...extra }, { journal, deadline: performance.now() + 10_000 });
  return { cwd, store, full, file, b, change, prompt };
}
const run = (input) => spawnSync(process.execPath, [HOOK], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });

// 4. At a change: B changed src/close.js 5 minutes ago, on its request.
let p = project();
const at = iso(5 * 60e3);
p.b(['asked', 'move the export to 02:00', 6 * 60e3], ['file', p.full('src/close.js'), 5 * 60e3], ['file', p.full('test/close.test.js'), 4 * 60e3]);
let r = await p.change('src/close.js');
const WARN = `project-memory: another session [bbbbbbbb] changed this file at ${hhmm(at)} (its request: "move the export to 02:00"). Check with the user or that session before changing it again.`;
ok(r.say === WARN, `the same-file warning (got ${r.say})`);
ok(readSession(p.file(A)).some((l) => l.kind === 'saw' && l.rest === `bbbbbbbb ${p.full('src/close.js')}`), 'a saw line with the tag and the path');
ok((await p.change('src/close.js')).say === '', 'once per other session and file');
ok((await p.change('src/other.js')).say === '', 'another file: nothing');
p.b(['file', p.full('src/close.js'), 0]);
ok((await p.change('src/close.js')).say.startsWith('project-memory: another session [bbbbbbbb] changed this file at'), 'again after B changed it since the warning');
// The same name in another worktree is another file.
p = project();
p.b(['file', cleanPath(join(home, 'shop-worktree', 'src/close.js')), 60e3]);
ok((await p.change('src/close.js')).say === '', 'a file of another worktree: nothing');
// No request (B's turn was private: its newest prompt line is quiet), and no warning once B ended or went quiet for ACTIVE.
p = project();
p.b(['asked', 'an older request', 9 * 60e3], ['quiet', '', 8 * 60e3], ['file', p.full('a.js'), 60e3]);
ok((await p.change('a.js')).say === `project-memory: another session [bbbbbbbb] changed this file at ${hhmm(iso(60e3))}. Check with the user or that session before changing it again.`, 'no request after a private prompt');
p = project();
p.b(['file', p.full('a.js'), 60e3], ['end', 'logout', 30e3]);
ok((await p.change('a.js')).say === '' && others(p.store, 'aaaaaaaa').length === 0, 'an ended session is not live');
p = project();
p.b(['file', p.full('a.js'), ACTIVE + 60e3]);
ok((await p.change('a.js')).say === '', 'a session silent for 30 minutes is not live');
p = project();
p.b(['file', p.full('a.js'), 60e3]); hushed(p.store, 'bbbbbbbb', true);
ok((await p.change('a.js')).say === '', 'a conversation marked private is not seen');

// 3. At a prompt: once per other session, when it became live since this one last looked; the title; a file both changed.
p = project();
const t = join(p.cwd, 'b.jsonl');
mkdirSync(p.cwd, { recursive: true });
writeFileSync(t, [{ type: 'user', message: { content: 'hi' } }, { type: 'custom-title', customTitle: '  nightly\n export ', sessionId: A }].map((x) => JSON.stringify(x)).join('\n') + '\n');
ok(titleOf(t, readTail, 512_000) === 'nightly export' && titleOf(join(p.cwd, 'none.jsonl'), readTail, 512_000) === '', 'titleOf: the newest custom-title, blanks squeezed; none for no file');
p.b(['title', 'export fix', 20 * 60e3], ['asked', 'move the export to 02:00', 20 * 60e3], ['file', p.full('src/close.js'), 19 * 60e3], ['file', p.full('test/close.test.js'), 18 * 60e3]);
await p.change('src/close.js');
r = await p.prompt('please tidy the readme', { transcript_path: t });
ok(r.say === `project-memory: another session [bbbbbbbb] ("export fix") is working in this project since ${hhmm(iso(20 * 60e3))} on: "move the export to 02:00". Files it changed: test/close.test.js, src/close.js. This session changed src/close.js too.`, `the prompt line (got ${r.say})`);
let mine = readSession(p.file(A));
ok(mine.filter((l) => l.kind === 'title').map((l) => l.rest).join() === 'nightly export' && mine.some((l) => l.kind === 'saw' && l.rest === 'bbbbbbbb'), 'a title line and a saw line with the tag alone');
ok((await p.prompt('and the changelog', { transcript_path: t })).say === '' && readSession(p.file(A)).filter((l) => l.kind === 'title').length === 1, 'the next prompt: nothing, and the same title is not written again');
dropSessions(p.store, B.slice(0, 8));
p.b(['asked', 'a new start', 0]);
ok((await p.prompt('one more thing')).say === `project-memory: another session [bbbbbbbb] is working in this project since ${hhmm(iso(0))} on: "a new start".`, 'live again after a gap: said again');
ok((await p.prompt('quiet now <private>x</private>')).say === '', 'a private turn: nothing');

// 1. The briefing and 2. status: B is live only by its session file (its conversation file is in another folder).
p = project();
p.b(['title', 'export fix', 2 * 60e3], ['asked', 'move the export to 02:00', 2 * 60e3], ['file', p.full('src/close.js'), 60e3]);
const brief = spawnSync(process.execPath, [tool('src/brief.mjs'), '--print'], { input: JSON.stringify({ session_id: A, cwd: p.cwd, hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8' });
ok(brief.stdout.includes('Another session is working in this project: [bbbbbbbb] "export fix", on: "move the export to 02:00"; files it changed: src/close.js'), `the briefing names it (got ${brief.stdout})`);
const status = spawnSync(process.execPath, [tool('src/memory.mjs'), 'status', '--store', p.store], { encoding: 'utf8' });
ok(status.stdout.includes(`  live session [bbbbbbbb] "export fix", on: "move the export to 02:00"; files it changed: ${p.full('src/close.js')}`), `status names it (got ${status.stdout})`);
// Live by its session file, its conversation file here with its turn finished (waiting for its user): still named (audit start#0).
{
  const q = project();
  q.b(['asked', 'move the export to 02:00', 3 * 60e3]);
  writeFileSync(join(q.store, '..', `${B}.jsonl`), [{ type: 'user', timestamp: iso(3 * 60e3), message: { role: 'user', content: 'move the export to 02:00' } }, { type: 'assistant', timestamp: iso(2 * 60e3), message: { role: 'assistant', content: [{ type: 'text', text: 'Moved it; waiting for your ok.' }], stop_reason: 'end_turn', usage: { input_tokens: 1 } } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const out = spawnSync(process.execPath, [tool('src/brief.mjs'), '--print'], { input: JSON.stringify({ session_id: A, cwd: q.cwd, hook_event_name: 'SessionStart', source: 'startup' }), encoding: 'utf8' }).stdout;
  ok(out.includes('Another session is working in this project: [bbbbbbbb], on: "move the export to 02:00"') && !out.includes('Last session here ended'), `a live session waiting for its user is named, not ended (got ${out})`);
}
hushed(p.store, 'bbbbbbbb', true);
ok(!spawnSync(process.execPath, [tool('src/memory.mjs'), 'status', '--store', p.store], { encoding: 'utf8' }).stdout.includes('bbbbbbbb'), 'status: not a conversation marked private');

// SessionEnd: an end line with the reason, only to a file that is there; any failure exits 0 with no output.
p = project();
p.b(['asked', 'x y z', 60e3]);
r = run({ session_id: B, cwd: p.cwd, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
ok(r.status === 0 && r.stdout === '' && r.stderr === '', `the hook exits 0, silent (${r.status} ${r.stderr})`);
ok(readSession(p.file(B)).at(-1).kind === 'end' && readSession(p.file(B)).at(-1).rest === 'prompt_input_exit', 'an end line with the reason');
run({ session_id: B, cwd: p.cwd, hook_event_name: 'SessionEnd', reason: 'a b; rm' });
ok(readSession(p.file(B)).at(-1).rest === 'other', 'a reason that is not a plain word is "other"');
run({ session_id: A, cwd: p.cwd, hook_event_name: 'SessionEnd', reason: 'clear' });
ok(!existsSync(p.file(A)), 'no session file: none is made');
ok(readTimes(0, join(projectsRoot(), TIMING)).some((l) => l.h === 'end' && l.e === 'SessionEnd'), 'its timing line is named end');
for (const bad of ['not json', '{}', JSON.stringify({ hook_event_name: 'SessionEnd' }), JSON.stringify({ session_id: B, hook_event_name: 'SessionEnd', cwd: join(home, 'nowhere') })]) {
  r = run(bad);
  ok(r.status === 0 && r.stdout === '' && r.stderr === '', `bad input ${bad}: exit 0, no output`);
}
mkdirSync(p.file(A), { recursive: true });
r = run({ session_id: A, cwd: p.cwd, hook_event_name: 'SessionEnd', reason: 'clear' });
ok(r.status === 0 && r.stdout === '', 'an unreadable session file: exit 0, no output');

// Deletion ships with the line: a file holding title, saw and end lines goes with the others.
p = project();
p.b(['title', 'x', 0], ['saw', 'aaaaaaaa', 0], ['end', 'clear', 0]);
ok(dropSessions(p.store) === true && !existsSync(p.file(B)), 'dropSessions takes a file with title, saw and end lines');

console.log(`sessions.test.mjs: ${checks} checks passed`);
