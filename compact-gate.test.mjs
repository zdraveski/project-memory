// Self-check for compact-gate.mjs: a turn boundary lets the compaction run, a
// turn in flight defers it, the ceiling lets it through with the in-flight
// note written, the Stop nudge fires once per cycle and re-arms after a
// compaction, and the next Stop drops the note. Run: node compact-gate.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import assert from 'node:assert';
import { tool, tempHome, storeFor } from './harness.mjs';

const GATE = tool('compact-gate.mjs'), HOOK = tool('handoff-log.mjs');
const { home, env } = tempHome('cg-test-');
const cwd = 'C:\\compact-gate-selftest';
const dir = storeFor(home, cwd);
const transcript = join(dir, 'transcript.jsonl');
mkdirSync(dir, { recursive: true });
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };

const rec = (type, content, extra = {}) => JSON.stringify({ type, timestamp: '2026-09-13T13:00:00Z', ...extra, message: { content, ...extra.message } });
const user = (s) => rec('user', [{ type: 'text', text: s }]);
const result = (s) => rec('user', [{ type: 'tool_result', tool_use_id: 'x', content: s }]);
const asst = (s, ctx, stop, blocks = []) => rec('assistant', [{ type: 'text', text: s }, ...blocks],
  { message: { stop_reason: stop, usage: { input_tokens: 3, cache_read_input_tokens: ctx - 3, cache_creation_input_tokens: 0, output_tokens: 9 } } });
const edit = (file) => ({ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: file, old_string: 'a', new_string: 'b' } });
const write = (...lines) => writeFileSync(transcript, lines.join('\n') + '\n');
const launch = (id) => `Command running in background with ID: ${id}. Output is being written to: C:\\Temp\\tasks\\${id}.output. You will be notified when it completes.`;
// An Agent launch: the id and the output file sit ~450 characters apart.
const agentLaunch = (id) => `Async agent launched successfully.\nagentId: ${id} (internal ID - do not mention to user. ${'x'.repeat(420)})\noutput_file: C:\\Temp\\tasks\\${id}.output`;

const gate = (trigger = 'auto') => {
  try { execFileSync(process.execPath, [GATE], { input: JSON.stringify({ cwd, transcript_path: transcript, trigger, session_id: 's1' }), env, stdio: ['pipe', 'pipe', 'pipe'] }); return { code: 0, err: '' }; }
  catch (e) { return { code: e.status, err: String(e.stderr) }; }
};
// The nudge runs inside memory-tier.mjs's Stop path; call it in-process here.
process.env.HOME = home; process.env.USERPROFILE = home;
const { nudge, TRIGGER, WINDOW } = await import('./compact-gate.mjs');
// The trigger moves with CLAUDE_CODE_AUTO_COMPACT_WINDOW: sizes are relative to it.
const T = Math.round(TRIGGER * WINDOW);
// The nudge must land a turn before Claude Code compacts (~0.959 of the window):
// a turn above 300k adds 46k at p75 (2026-10-26). At 0.95 the room was 7k.
ok(0.959 * WINDOW - TRIGGER * WINDOW >= 60_000, `the nudge leaves at least 60k of room (${Math.round(0.959 * WINDOW - TRIGGER * WINDOW)})`);
const stop = (session = 's1', extra = {}) => nudge({ hook_event_name: 'Stop', cwd, transcript_path: transcript, session_id: session, ...extra });

// 1. A finished turn: the compaction may run, whatever the size.
write(user('build it'), asst('done.', 870_000, 'end_turn'));
ok(gate().code === 0, 'end_turn lets the compaction run');

// 2. Mid-turn under the ceiling: deferred, and only for an auto compaction.
write(user('build it'), asst('running the suites', 870_000, 'tool_use'), result(launch('bg1')));
const d = gate();
ok(d.code === 2 && /mid-turn/.test(d.err), `mid-turn under the ceiling is deferred (got ${d.code}: ${d.err})`);
ok(gate('manual').code === 0, 'a manual /compact is never blocked');

// 3. Mid-turn over the ceiling: allowed, and the handoff says what was in flight.
writeFileSync(join(dir, 'handoff.md'), '---\nname: handoff\n---\n\n<!-- auto:start -->\n- **asked** 2026-09-13 12:00: earlier\n  **did:** earlier answer\n<!-- auto:end -->\n');
// A long turn: the prompt is past the first tail, so the note's own read has to grow.
write(user('build it'), asst('editing', 500_000, 'tool_use', [edit('C:\\repo\\a.py')]), result('ok'), result('y'.repeat(300_000)),
  asst('## **running** the suites', 965_000, 'tool_use'), result(launch('bg1')), result(launch('bg2')), result(agentLaunch('ag1')),
  user('<task-notification><task-id>bg2</task-id><status>completed</status></task-notification>'));
ok(gate().code === 0, 'over the ceiling the compaction runs');
const doc = readFileSync(join(dir, 'handoff.md'), 'utf8');
ok(/\*\*cut mid-turn\*\* \[s1\] .* at 965k tokens, asked \S+ \S+: build it/.test(doc), 'the note names its session, the turn and its size');
ok(/still running[^\n]*bg1 → C:\\Temp\\tasks\\bg1\.output/.test(doc) && !/bg2 →/.test(doc), 'running tasks are the launched minus the notified, with their output files');
ok(/ag1 → C:\\Temp\\tasks\\ag1\.output/.test(doc), 'an agent launch is found across its long result');
ok(/edited this turn:\*\* C:\\repo\\a\.py/.test(doc), 'files edited this turn are listed');
ok(/last said:\*\* running the suites/.test(doc), 'the last words said are kept');
ok(doc.indexOf('cut mid-turn') < doc.indexOf('<!-- auto:end -->'), 'the note sits inside the auto section, so the next Stop drops it');

// 4. The next finished turn rebuilds the section and the note is gone.
write(user('build it'), asst('all green', 200_000, 'end_turn'), user('next thing'), asst('next answer', 210_000, 'end_turn'));
execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd, transcript_path: transcript }), env });
ok(!/cut mid-turn/.test(readFileSync(join(dir, 'handoff.md'), 'utf8')), 'the Stop hook drops the note');

// 5. The Stop nudge: once per cycle, re-armed by a compaction, never twice in a turn.
write(user('q'), asst('a', T - 20_000, 'end_turn'));
ok(stop() === null, 'under the trigger: no nudge');
write(user('q'), asst('a', T + 20_000, 'end_turn'));
const n = stop();
ok(n?.decision === 'block' && /update memory/.test(n.reason), 'over the trigger: the stop is blocked with the memory reason');
write(user('q'), asst('memory written', T + 30_000, 'end_turn'));
ok(stop() === null, 'the same cycle is not nudged twice');
ok(stop('s1', { stop_hook_active: true }) === null, 'stop_hook_active is never nudged');
write(user('q'), asst('after compaction', 300_000, 'end_turn'));
ok(stop() === null, 'after a compaction: no nudge, and the stamp is re-armed');
write(user('q2'), asst('grown again', T + 50_000, 'end_turn'));
ok(stop()?.decision === 'block', 'the next crossing nudges again');
ok(stop('s2')?.decision === 'block', 'another session has its own nudge');
ok(stop() === null, 'and does not re-arm this one: the stamp is per session');

// The same script runs as the PreCompact hook, where a printed block would
// block the compaction and spend the cycle's nudge: only a Stop is nudged.
write(user('q3'), asst('over the trigger, mid-turn', T + 60_000, 'tool_use'));
ok(stop('s3', { hook_event_name: 'PreCompact', trigger: 'auto' }) === null, 'a PreCompact payload is never nudged');
const n3 = stop('s3');
ok(n3?.decision === 'block', 'and it did not arm the stamp: the turn end still gets its nudge');
ok(n3.reason.startsWith('[SYSTEM: compaction gate]'), 'the reason is tagged so the handoff never reads it as a prompt');
const nudgeDir = join(home, '.claude', 'projects', '.nudge');
ok(existsSync(join(nudgeDir, 's1')) && existsSync(join(nudgeDir, 's2')), 'each session keeps its nudge state in a file of its own');
writeFileSync(join(nudgeDir, 'gone-session'), '5');
const week = new Date(Date.now() - 8 * 86400000);
utimesSync(join(nudgeDir, 'gone-session'), week, week);
write(user('q4'), asst('grown', T + 70_000, 'end_turn'));
stop('s4');
ok(!existsSync(join(nudgeDir, 'gone-session')), "a session's nudge file is pruned after a week");

// 6. Second audit. Under the smallest window any model has, a deferral can only
// be wrong: a 200k-model session would otherwise wait for a 900k that never comes.
write(user('small model'), asst('working', 190_000, 'tool_use'));
ok(gate().code === 0, 'mid-turn under 200k is not deferred');

// A task launched in an earlier turn is still running now: the note must say so.
writeFileSync(join(dir, 'handoff.md'), '---\nname: handoff\n---\n\n<!-- auto:start -->\n<!-- auto:end -->\n');
write(user('first turn'), asst('launching', 300_000, 'tool_use'), result(launch('bg9')), asst('launched.', 310_000, 'end_turn'),
  user('second turn'), asst('cut here', 965_000, 'tool_use', [{ type: 'tool_use', id: 't2', name: 'NotebookEdit', input: { notebook_path: 'C:\\repo\\n.ipynb' } }]));
ok(gate().code === 0, 'over the ceiling again');
const doc2 = readFileSync(join(dir, 'handoff.md'), 'utf8');
ok(/still running[^\n]*bg9 → /.test(doc2), 'a task from an earlier turn is still listed as running');
ok(/edited this turn:\*\* C:\\repo\\n\.ipynb/.test(doc2), 'a notebook edit is listed by its own path');
ok(/\*\*asked\*\* \S+ \S+(?: \[\w+\])?: second turn\n  \*\*did:\*\* cut here/.test(doc2) && doc2.indexOf('**asked**') < doc2.indexOf('cut mid-turn'),
  'the gate writes the handoff entry itself, before the note: one writer, no race');

// A store whose handoff cannot be written still lets the compaction run, and says why.
// Through a symlinked folder the gate still runs: --state prints what it sees.
symlinkSync(dirname(GATE), join(home, 'linked-hooks'), 'junction');
const viaLink = spawnSync(process.execPath, [join(home, 'linked-hooks', 'compact-gate.mjs'), '--state', transcript], { env, encoding: 'utf8' });
ok(viaLink.stdout.trim() !== '', `the gate run through a symlinked folder still runs (got ${JSON.stringify(viaLink.stdout + viaLink.stderr)})`);
const cwd2 = 'C:\\compact-gate-broken';
mkdirSync(join(storeFor(home, cwd2), 'handoff.md'), { recursive: true });   // a directory where the file should be
const broken = spawnSync(process.execPath, [GATE], { input: JSON.stringify({ cwd: cwd2, transcript_path: transcript, trigger: 'auto', session_id: 's9' }), env, encoding: 'utf8' });
ok(broken.status === 0 && /handoff: /.test(broken.stderr), `an unwritable handoff never defers, and the failure is named (got ${broken.status}: ${broken.stderr.trim()})`);

// A cwd with no store at all: nothing is written, and the gate says so rather
// than "written" -- an early return is not a write.
const nowhere = spawnSync(process.execPath, [GATE], { input: JSON.stringify({ cwd: 'C:\\no-store-here', transcript_path: transcript, trigger: 'auto', session_id: 's9' }), env, encoding: 'utf8' });
ok(nowhere.status === 0 && /handoff: nothing written/.test(nowhere.stderr) && /note: no handoff\.md/.test(nowhere.stderr) && !/note written/.test(nowhere.stderr),
  `with no store the gate reports nothing written (got ${nowhere.status}: ${nowhere.stderr.trim()})`);

// 7. Claude Code compacted mid-turn without heeding the gate (a precomputed
// summary, 2026-10-03): SessionStart puts the in-flight note back regardless.
const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-09-13T13:05:00Z', compactMetadata: { trigger: 'auto', preTokens: 767_072, precomputed: true } });
const summary = rec('user', 'This session is being continued from a previous conversation.', { isCompactSummary: true });
const section7 = (notes = '') => writeFileSync(join(dir, 'handoff.md'),
  `---\nname: handoff\n---\n\n<!-- auto:start -->\n- **asked** 2026-09-13 12:00 [s1]: earlier\n  **did:** earlier answer\n${notes}<!-- auto:end -->\n`);
const printed = () => execFileSync(process.execPath, [HOOK, '--print'], { input: JSON.stringify({ cwd, transcript_path: transcript, session_id: 's1', source: 'compact' }), env }).toString();
section7();
write(user('first turn'), asst('launching', 300_000, 'tool_use'), result(launch('bg7')), asst('launched.', 310_000, 'end_turn'),
  user('build the thing'), asst('editing', 700_000, 'tool_use', [edit('C:\\repo\\b.py')]), result('ok'), boundary, summary);
const p7 = printed();
ok(/cut mid-turn\*\* \[s1\][^\n]*asked \S+ \S+: build the thing/.test(p7), `a mid-turn compaction gets its note back at SessionStart (got: ${p7.slice(0, 300)})`);
ok(/bg7 → C:\\Temp\\tasks\\bg7\.output/.test(p7) && /edited this turn:\*\* C:\\repo\\b\.py/.test(p7), 'with a task from an earlier turn still running, and the files edited');
ok(p7.indexOf('cut mid-turn') < p7.indexOf('earlier answer'), 'the note comes before the exchanges');
write(user('q'), asst('done', 500_000, 'end_turn'), boundary, summary);
ok(!/cut mid-turn/.test(printed()), 'a compaction at a turn boundary needs no note');
// The gate already wrote this session's note (over the ceiling): shown once, not rebuilt.
const gateNote = '- **cut mid-turn** [s1] 2026-09-13 13:05 at 965k tokens, asked 2026-09-13 13:00: build it\n  **last said:** x\n  **still running (read their output files, do not rerun):** none\n  **edited this turn:** none\n';
section7(gateNote);
write(user('build it'), asst('x', 965_000, 'tool_use'), boundary, summary);
ok((printed().match(/cut mid-turn/g) || []).length === 1, "the gate's own note is shown once, not rebuilt");
// Another session's note in the same file is not this one's.
section7(gateNote.replace('[s1]', '[s2]'));
const p7b = printed();
ok((p7b.match(/cut mid-turn/g) || []).length === 1 && /cut mid-turn\*\* \[s1\]/.test(p7b), "another session's note is neither shown nor taken for this one's");
// A wide refactor turn: the note names the newest twenty files edited and
// counts the rest, as it caps running tasks. Uncapped it was tens of KB,
// printed at every mid-turn compaction (final review, 2026-10-26).
write(user('wide refactor'), asst('editing', 700_000, 'tool_use', Array.from({ length: 25 }, (_, i) => edit(`C:\\repo\\f${i}.py`))), boundary, summary);
const wide = printed();
ok(/f24\.py, and 5 earlier/.test(wide) && /\\f5\.py/.test(wide) && !/\\f4\.py/.test(wide), `the edited list keeps the newest twenty and counts the rest (got: ${(wide.match(/edited this turn[^\n]*/) || [''])[0].slice(0, 200)})`);

// 8. Another hook holding the store past the lock wait is named as that, not as
// a store with no handoff.md (final review, 2026-10-26).
write(user('build it'), asst('running', 965_000, 'tool_use'));
mkdirSync(join(dir, '.lock'));
const heldGate = spawnSync(process.execPath, [GATE], { input: JSON.stringify({ cwd, transcript_path: transcript, trigger: 'auto', session_id: 's1' }), env, encoding: 'utf8' });
rmSync(join(dir, '.lock'), { recursive: true });
ok(heldGate.status === 0 && /handoff: another hook held the store/.test(heldGate.stderr) && /note: another hook held the store/.test(heldGate.stderr),
  `a held store is reported as held, and the compaction runs (got ${heldGate.status}: ${heldGate.stderr.trim()})`);

console.log(`compact-gate: ${checks} checks passed`);
