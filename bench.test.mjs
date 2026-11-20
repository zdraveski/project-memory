// Self-check for live-times.mjs and `bench.mjs --live`: Claude Code's own hook durations,
// read from (made-up) conversation files. Run: node bench.test.mjs
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import { tempHome, tempDir, tool, storeFor, capture } from './harness.mjs';
import { build, CWD } from './bench-store.mjs';
import { CASES, LIMITS, verdict, main } from './bench.mjs';
import { tmpdir, homedir } from 'node:os';
import { days, parseDay, dayFile } from './journal.mjs';
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

// a made-up .timing: three Stop lines inside, one SubagentStop that must not count
const tline = (e, ms) => JSON.stringify({ t: Date.now(), h: 'save', e, start: 80, p: { load: 20 }, ms });
writeFileSync(join(store, '..', '..', '.timing'), [tline('Stop', 300), tline('Stop', 300), tline('Stop', 300), tline('SubagentStop', 9000)].join('\n') + '\n');

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
ok(/^Stop\s+memory-tier\.mjs\s+3\s+700\s+900\s+900\s+300\s+400$/m.test(out), 'event, script, runs, median, 90%, worst, then inside and gap beside the live median');
ok(/^PreToolUse\s+enforce-hook\.mjs\s+1\s+310\s+310\s+310\s+-\s+-$/m.test(out), 'a second row, no timing lines: dashes');
ok(!out.includes('someone') && !out.includes('token'), 'no part of a path or a command');
ok(!/brief\.mjs/.test(out), 'a run older than the window is not in the table');

// the made-up store: two builds match byte for byte, and it is healthy
const home1 = tempHome('bench-a-').home, home2 = tempDir('bench-b-');
const at = Date.parse('2026-11-20T12:00:00Z');
const a = build(home1, { now: at, scale: 0.02 }), b = build(home2, { now: at, scale: 0.02 });
const tree = (d) => readdirSync(d, { recursive: true }).sort().map((p) => (statSync(join(d, p)).isDirectory() ? p : `${p} ${createHash('sha1').update(readFileSync(join(d, p))).digest('hex')}`));
ok(eq(tree(a.proj), tree(b.proj)), 'two builds match, byte for byte');
ok(a.sizes.entries === 40 && days(a.store).length === 60, 'the scaled counts');
ok(statSync(join(a.shared, 'MEMORY.md')).size === 3000, 'the shared index at its budget');
const cli = (...args) => spawnSync(process.execPath, [tool('memory.mjs'), ...args, '--store', a.store], { encoding: 'utf8' }).stdout;
ok(!/^PROBLEM(?! not installed)/m.test(cli('doctor')), 'doctor finds no problem in it (a temp home has no plugin installed)');
ok(/harbor/i.test(cli('search', 'harbor')), 'search finds a word of the list');
const entriesIn = () => days(a.store).flatMap((d) => parseDay(readFileSync(dayFile(a.store, d), 'utf8')).entries).length;
const stop = () => spawnSync(process.execPath, [tool('memory-tier.mjs'), '--stop'], { input: JSON.stringify({ cwd: CWD, transcript_path: a.transcript, session_id: 'bbbbbbbb-0000', hook_event_name: 'Stop' }), encoding: 'utf8' });
// the first Stop journals what its read window holds of the conversation; every later one finds nothing new
ok(stop().status === 0 && entriesIn() > a.sizes.entries, 'a first Stop saves the conversation');
const first = entriesIn();
ok(stop().status === 0 && entriesIn() === first, 'a second Stop changes nothing: the bench times a steady state');

// the bench itself, spawned small: every case, the json, the split
const EMPTY = 'node, empty script';
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const version = JSON.parse(readFileSync(tool('.claude-plugin/plugin.json'), 'utf8')).version;
const jsonPath = join(home, 'bench.json');
const bench = spawnSync(process.execPath, [tool('bench.mjs'), '2', '--scale', '0.02', '--json', jsonPath], { encoding: 'utf8' });
ok(bench.status === 0, `bench exits 0 (${bench.stderr})`);
ok(CASES.every((c) => new RegExp(`^${esc(c)}\\s+p50\\s+\\d+ ms\\s+p90\\s+\\d+ ms`, 'm').test(bench.stdout)), 'every case prints');
const j = JSON.parse(readFileSync(jsonPath, 'utf8'));
ok(eq(Object.keys(j.cases), CASES) && j.briefingBytes > 0 && j.plugin === version, 'the json holds every case');
ok(j.cases['Stop, nothing changed'].start > 0 && j.cases.search.start === null, 'the split for hooks, none for the CLI');
ok(!JSON.stringify(j).includes(tmpdir()) && !JSON.stringify(j).includes(homedir()), 'no path in the json');

// verdict, and the second look
ok(eq(verdict({ a: 100, [EMPTY]: 50 }, { a: 3 }), []), 'under the limit');
ok(eq(verdict({ a: 200, [EMPTY]: 50 }, { a: 3 }), ['"a" took 200 ms, 4.0 times the empty script\'s 50 ms; the limit is 3 times']), 'over it, in plain words');
ok(/no limit set for "b"/.test(verdict({ b: 1, [EMPTY]: 50 }, {})[0]), 'a case without a limit fails');
const fake = (first) => { let n = 0; return () => ({ store: {}, runs: 1, briefingBytes: 1, cases: { a: { p50: n++ ? 100 : first }, [EMPTY]: { p50: 50 } } }); };
const second = await capture(() => main(['--check', '1'], fake(400), { a: 3 }));
ok(second.value === 0 && /measured again/.test(second.out), 'one slow measurement is not a failure: the second decides');
const twice = await capture(() => main(['--check', '1'], fake(400), { a: 1 }));
ok(twice.value === 1, 'slow twice is a failure');
ok(eq(Object.keys(LIMITS).sort(), CASES.filter((c) => c !== EMPTY).sort()), 'a limit for every case');

// --real copies the machine's own transcript and store, found before HOME points at the throwaway folder
const real = spawnSync(process.execPath, [tool('bench.mjs'), '1', '--real'], { encoding: 'utf8' });
ok(real.status === 0 && /^Stop, nothing changed\s+p50/m.test(real.stdout), `--real runs on a home that has a transcript and a store (${real.stderr.slice(0, 200)})`);
const keep = process.env.HOME, empty = tempDir('bench-empty-');
process.env.HOME = empty; process.env.USERPROFILE = empty;
const none = spawnSync(process.execPath, [tool('bench.mjs'), '1', '--real'], { encoding: 'utf8' });
process.env.HOME = keep; process.env.USERPROFILE = keep;
ok(none.status === 1 && /needs a transcript and a memory store/.test(none.stderr), '--real with nothing to copy says so in plain words');

console.log(`bench: ${checks} checks passed`);
