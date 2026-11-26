// Self-check for timing.mjs, the one line of numbers every hook run appends to <projects root>/.timing.
// Run: node timing.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert';
import { tempHome, tool, storeFor, slug } from './harness.mjs';
import { begin, tag, mark, flush, read, stats, pct, FILE, MAX } from '../src/timing.mjs';

const { home } = tempHome('timing-');
let checks = 0;
const ok = (cond, msg) => { assert(cond, msg); checks++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const root = join(home, '.claude', 'projects'), file = join(root, FILE);
mkdirSync(root, { recursive: true });

begin('save'); tag('Stop'); mark('input'); mark('load'); mark('input'); await flush();
const [l] = read(0, file);
ok(l.h === 'save' && l.e === 'Stop', 'the hook and the event');
ok(Number.isInteger(l.node) && l.node > 0 && l.start >= l.node && l.ms >= l.start, 'node, then start, then the total');
ok(eq(Object.keys(l.p), ['input', 'load']), 'a phase marked twice is one phase');
ok(readFileSync(file, 'utf8').split('\n').length === 2, 'one line, one newline');
ok((statSync(file).mode & 0o777) === 0o600 || process.platform === 'win32', 'private to the user');

begin('save'); const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
spin(15); mark('a'); spin(15); mark('a'); await flush();
ok(read(0, file).at(-1).p.a >= 28, 'two marks of one name add up');

// tag keeps names only
for (const bad of ['C:\\Users\\someone', 'a b', 'x'.repeat(10000), '', undefined, { a: 1 }]) { begin('gate'); tag(bad, bad); await flush(); }
ok(read(0, file).slice(1).every((x) => x.e === '?'), 'what is not a name is ?');
begin('brief'); tag('SessionStart', 'compact'); await flush();
ok(read(0, file).at(-1).e === 'SessionStart:compact', 'the detail after a colon');
begin('brief'); tag('SessionStart', 'a b/c'); await flush();
ok(read(0, file).at(-1).e === 'SessionStart', 'a detail that is not a word is left out');
begin('brief'); await flush();
ok(read(0, file).at(-1).e === '?', 'no tag, no event name');
begin('brief'); tag('a b', 'compact'); await flush();
ok(read(0, file).at(-1).e === '?', 'a detail does not rescue an event that is not a name');
begin('brief'); tag('mysecretproject', 'compact'); await flush();
ok(read(0, file).at(-1).e === '?', 'a letters-only name that is not a hook event is ?');
begin('brief'); tag('SessionStart', 'mysecret'); await flush();
ok(read(0, file).at(-1).e === 'SessionStart', 'a letters-only detail that is not a source is left out');

// what starts nothing
const count = read(0, file).length;
begin('anything'); mark('x'); await flush();
mark('y'); await flush();
process.env.PROJECT_MEMORY_TIMING = '0'; begin('save'); await flush(); delete process.env.PROJECT_MEMORY_TIMING;
ok(read(0, file).length === count, 'an unknown hook, no begin and the off switch wrote no line');
begin('save'); await flush(); await flush();
ok(read(0, file).length === count + 1, 'a second flush writes nothing');

// the cut
ok(MAX === 256 * 1024, 'the file is cut at 256 KB, as PRIVACY.md says');
const fill = (n, t0) => Array.from({ length: n }, (_, i) => JSON.stringify({ t: t0 + i, h: 'save', e: 'Stop', start: 90, p: { load: 20 }, ms: 300 })).join('\n') + '\n';
writeFileSync(file, fill(Math.ceil(MAX / 60), 1000));
ok(statSync(file).size > MAX, 'the made-up file is over the limit');
begin('save'); tag('Stop'); await flush();
ok(statSync(file).size < MAX * 0.6, 'cut to its newer half');
const newest = read(0, file).at(-1);
ok(newest.t > 1e12, 'the newest line stays');
ok(!readdirSync(root).some((f) => f.startsWith('.timing.tmp')), 'no temp file stays');
ok(read(0, file).every((x, i, a) => !i || a[i - 1].t <= x.t), 'oldest first');

// The cut's race and its limit are store.mjs appendCapped's, tested in store.test.mjs.

// read(): a cut-off last line, a line of prose, a line with unknown keys, a line without numbers
writeFileSync(file, fill(3, 5000));
const n0 = read(0, file).length;
writeFileSync(file, readFileSync(file, 'utf8') + 'some prose\n{"t":1,"ms":"x"}\n{"t":9000,"h":"save","ms":5,"extra":7}\n{"t":9001,"h":"sa');
ok(read(0, file).length === n0 + 1 && read(0, file).at(-1).extra === 7, 'the broken ones are skipped, the unknown key is kept');
ok(read(5001, file).every((x) => x.t >= 5001), 'since cuts the old ones');
ok(eq(read(0, join(root, 'nothing')), []), 'a missing file is an empty list');

// stats
ok(eq(stats([5, 1, 3, 2, 4, 9, 7, 8, 6, 10]), { runs: 10, median: 6, p90: 10, worst: 10 }), 'the house percentile');
ok(pct([1, 2, 3], 0.5) === 2, 'pct');

// Every hook entry writes its line, and changes nothing else.
rmSync(file, { force: true });
const SAVE_PHASES = ['input', 'load', 'read', 'journal', 'handoff', 'index', 'backfill', 'notice', 'scan', 'snapshot', 'tier'];
const cwd = join(home, 'proj'), store = storeFor(home, cwd), projDir = join(root, slug(cwd));
mkdirSync(store, { recursive: true });
const tp = join(projDir, 'sess.jsonl');
writeFileSync(tp, [{ type: 'user', timestamp: '2026-11-01T09:00:00Z', message: { content: 'feed the tapir' } },
  { type: 'assistant', timestamp: '2026-11-01T09:00:30Z', message: { content: [{ type: 'text', text: 'fed it' }] } }].map((x) => JSON.stringify(x)).join('\n') + '\n');
writeFileSync(join(store, 'MEMORY.md'), '# Memory\n');
const base = { session_id: 'abcd1234-aaaa', cwd, transcript_path: tp };
const gitCommand = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } };
const CASES = [
  ['memory-tier.mjs', ['--stop'], { ...base, hook_event_name: 'Stop', last_assistant_message: 'fed it' }, 'save', 'Stop'],
  ['memory-tier.mjs', ['--stop'], { ...base, hook_event_name: 'SubagentStop', last_assistant_message: 'done' }, 'save', 'SubagentStop'],
  ['brief.mjs', ['--print'], { ...base, hook_event_name: 'SessionStart', source: 'startup' }, 'brief', 'SessionStart:startup'],
  ['enforce-hook.mjs', [], gitCommand, 'enforce', 'PreToolUse'],
  ['compact-gate.mjs', [], { ...base, hook_event_name: 'PreCompact', trigger: 'auto' }, 'gate', 'PreCompact:auto'],
];
const run = (script, args, payload, env = {}) => { const r = spawnSync(process.execPath, [tool(`src/${script}`), ...args], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, ...env } }); return { status: r.status, stdout: r.stdout, stderr: r.stderr }; };
const lines = () => (existsSync(file) ? read(0, file) : []);
const one = (script, args, payload) => { const n = lines().length; run(script, args, payload); const got = lines(); ok(got.length === n + 1, `${script} ${payload.hook_event_name}: one line (got ${got.length - n})`); return got.at(-1); };
let saveLine;
for (const [script, args, payload, h, e] of CASES) {
  const got = one(script, args, payload);
  ok(got.h === h && got.e === e, `${h}: the hook and the event (got ${got.h} ${got.e})`);
  if (h === 'save' && e === 'Stop') saveLine = got;
}
ok(Object.keys(saveLine.p).every((k) => SAVE_PHASES.includes(k)) && 'handoff' in saveLine.p, `only the known phases (got ${Object.keys(saveLine.p)})`);

// timing changes no output: stdout, stderr and the exit code are the same with it off
for (const [script, args, payload] of CASES) ok(eq(run(script, args, payload), run(script, args, payload, { PROJECT_MEMORY_TIMING: '0' })), `${script}: the same stdout, stderr and exit code with timing off`);
// off writes nothing
rmSync(file, { force: true });
for (const [script, args, payload] of CASES) run(script, args, payload, { PROJECT_MEMORY_TIMING: '0' });
ok(!existsSync(file), 'PROJECT_MEMORY_TIMING=0: no file');
// a manual run of memory-tier.mjs without --stop writes no line
run('memory-tier.mjs', ['--dry-run'], {});
ok(!existsSync(file), 'a manual run writes no line');

// a root that takes no file: .timing is a folder; then a projects root that is missing
mkdirSync(file);
for (const [script, args, payload] of CASES) ok(eq(run(script, args, payload), run(script, args, payload, { PROJECT_MEMORY_TIMING: '0' })), `${script}: .timing a folder, the hook answers as before`);
rmSync(file, { recursive: true });
for (const [script, args, payload] of CASES) {
  const cfg = join(home, 'cfg'), gone = () => rmSync(cfg, { recursive: true, force: true });
  gone(); const on = run(script, args, payload, { CLAUDE_CONFIG_DIR: cfg }), madeOn = existsSync(join(cfg, 'projects')), timed = existsSync(join(cfg, 'projects', FILE));
  gone(); const off = run(script, args, payload, { CLAUDE_CONFIG_DIR: cfg, PROJECT_MEMORY_TIMING: '0' }), madeOff = existsSync(join(cfg, 'projects'));
  ok(eq(on, off) && madeOn === madeOff && (madeOff || !timed), `${script}: no projects root, nothing created by timing`);
}

// no text reaches the file
for (const [script, args, payload] of CASES) {
  for (const evil of ['C:\\Users\\someone\\notes', 'a b', 'mysecretproject', 'x'.repeat(10000), { a: 1 }, undefined]) run(script, args, { ...payload, hook_event_name: evil, source: evil, trigger: evil });
}
const all = readFileSync(file, 'utf8');
ok(/^(\{"t":\d+,"h":"[a-z]+","e":"[A-Za-z?:]+",("node":\d+,)?"start":\d+,"p":\{("[a-z]+":\d+,?)*\},"ms":\d+\}\n)+$/.test(all), 'numbers and fixed names only');
ok(!/someone|notes|mysecret|feed the tapir|abcd1234|proj/.test(all), 'no path, no conversation text, no session');

console.log(`timing.test.mjs: ${checks} checks passed`);
