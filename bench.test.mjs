// Self-check for live-times.mjs and `bench.mjs --live`: Claude Code's own hook durations,
// read from (made-up) conversation files. Run: node bench.test.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, tool, storeFor } from './harness.mjs';
import { liveTimes, scriptOf } from './live-times.mjs';
import { pct } from './timing.mjs';

const { home } = tempHome('bench-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const cwd = join(home, 'proj'), store = storeFor(home, cwd);
mkdirSync(cwd, { recursive: true }); mkdirSync(store, { recursive: true });
const f = join(store, '..', 'aaaa0000-0000-0000-0000-000000000000.jsonl');
const now = new Date().toISOString();
const old = '2026-10-01T00:00:00.000Z';
const cmd = (s) => `node "C:\\Users\\someone\\plugins\\x\\${s}" --token abc`;
writeFileSync(f, [
  { timestamp: now, attachment: { hookEvent: 'Stop', hookInfos: [500, 700, 900].map((d) => ({ command: cmd('memory-tier.mjs'), durationMs: d })) } },
  { timestamp: now, attachment: { hookName: 'PreToolUse:Bash', command: cmd('enforce-hook.mjs'), durationMs: 310 } },
  { timestamp: old, attachment: { hookEvent: 'SessionStart', hookInfos: [{ command: cmd('brief.mjs'), durationMs: 2600 }] } },
].map((r) => JSON.stringify(r)).join('\n') + '\nthis line is "hook" and "duration" but not JSON\n{"timestamp":"' + now + '","attachment":{"hookEvent":"Stop","hookInfos":[{"comm');

// both record shapes, grouped by event and script
const m = await liveTimes([f], {});
ok(eq(m.get('Stop memory-tier.mjs'), [500, 700, 900]), 'a list of hooks: one duration each');
ok(eq(m.get('PreToolUse enforce-hook.mjs'), [310]), 'a single hook record, event cut to its letters');
// a broken line is skipped
ok(m.size === 3, 'a line that is not JSON and a cut-off last line add nothing');
// a command is never printed
ok(scriptOf('node "C:\\Users\\someone\\plugins\\x\\run.mjs" --token abc') === 'run.mjs', 'the file name only');
ok(scriptOf('C:\\Users\\someone\\bin\\tool --flag') === 'other', 'no script name: other');
ok(scriptOf('C:/Program Files/nodejs/node.exe ${CLAUDE_PLUGIN_ROOT}/memory-tier.mjs --stop') === 'memory-tier.mjs', 'the script, not the interpreter');
ok(scriptOf('Saving memory') === 'memory-tier.mjs' && scriptOf('Briefing') === 'brief.mjs', 'a status message in place of a command');
// the window
ok(!(await liveTimes([f], { since: Date.parse('2026-11-01') })).has('SessionStart brief.mjs'), 'older than the window: out');
ok((await liveTimes([f], { since: Date.parse('2026-11-01') })).has('Stop memory-tier.mjs'), 'inside the window: in');
ok((await liveTimes(['no-such-file.jsonl'])).size === 0, 'a file that cannot be opened is skipped');
ok(pct([1, 2, 3], 0.5) === 2 && pct([1, 2, 3], 0.9) === 3, 'median and 90% of a sorted list');

// one Stop run written twice (a summary record and per-hook attachments) is one sample, under `Stop`
const summary = { type: 'system', subtype: 'stop_hook_summary', timestamp: now, hookInfos: [{ command: cmd('memory-tier.mjs'), durationMs: 800 }, { command: cmd('memory-tier.mjs') }] };
const perHook = (ms) => ({ timestamp: now, attachment: { type: 'hook_success', hookName: 'Stop', hookEvent: 'Stop', command: cmd('memory-tier.mjs'), durationMs: ms } });
const write = (name, recs) => { const p = join(home, name); writeFileSync(p, recs.map((x) => JSON.stringify(x)).join('\n') + '\n'); return p; };
const both = await liveTimes([write('both.jsonl', [summary, perHook(790)])]);
ok(eq([...both.keys()], ['Stop memory-tier.mjs']), 'a summary is a Stop row, not a second `stop` row');
ok(eq(both.get('Stop memory-tier.mjs'), [800]), 'both shapes of one run: one sample; a hook without a duration is skipped');
ok(eq((await liveTimes([write('loose.jsonl', [perHook(790), perHook(610)])])).get('Stop memory-tier.mjs'), [790, 610]), 'per-hook Stop records alone are still counted');
// the table
const r = spawnSync(process.execPath, [tool('bench.mjs'), '--live', '--project', cwd, '--days', '14'], { encoding: 'utf8' });
const out = r.stdout;
ok(r.status === 0, `bench --live exits 0 (${r.stderr})`);
ok(/^conversation files read: 1, last 14 days$/m.test(out), 'the header counts the files and the window');
ok(/^Stop\s+memory-tier\.mjs\s+3\s+700\s+900\s+900$/m.test(out), 'event, script, runs, median, 90%, worst in ms');
ok(/^PreToolUse\s+enforce-hook\.mjs\s+1\s+310\s+310\s+310$/m.test(out), 'a second row');
ok(!out.includes('someone') && !out.includes('token'), 'no part of a path or a command');
ok(!/brief\.mjs/.test(out), 'a run older than the window is not in the table');

console.log(`bench: ${checks} checks passed`);
