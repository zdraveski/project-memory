// How long each hook takes. Three ways:
//   node bench.mjs [runs]   times each hook on a made-up busy store under a throwaway HOME (default 9
//                           runs; prints p50 / p90 in ms, the time before the hook's first line, and its
//                           largest phase). --real copies this machine's largest transcript and store
//                           instead: the real ones are never touched.
//     --plugin <dir>        runs the hooks of another checkout against the same store
//     --json <path>         also writes the numbers as JSON (no path, no machine name)
//     --check               fails when a case is too slow beside an empty `node -e ""` (LIMITS below)
//   node bench.mjs --live [--project <folder>|all] [--days <n>]
//                           reads the hook durations Claude Code recorded in its own conversation
//                           files (read-only): this plugin's hooks beside every other plugin's, and
//                           for ours how much of it was inside the script and how much outside.
import { readdirSync, statSync, copyFileSync, mkdirSync, cpSync, utimesSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { tool, tempHome, largestStore } from './harness.mjs';
import { projectsRoot, storeOf } from './store.mjs';
import { liveTimes } from './live-times.mjs';
import { pct, stats, read, FILE } from './timing.mjs';
import { build, PROJECT, CWD } from './bench-store.mjs';

const OURS = ['memory-tier.mjs', 'brief.mjs', 'enforce-hook.mjs', 'compact-gate.mjs', 'handoff-log.mjs'];
// The name timing.mjs gives each script's lines; handoff-log.mjs writes none.
const HOOK = { 'memory-tier.mjs': 'save', 'brief.mjs': 'brief', 'enforce-hook.mjs': 'enforce', 'compact-gate.mjs': 'gate' };
const EMPTY = 'node, empty script';
export const CASES = ['Stop, nothing changed', 'Stop, a memory changed', 'SessionStart startup', 'SessionStart compact', 'PreCompact auto', 'PreToolUse git', 'search', 'status', EMPTY];
// A case's median may be at most this many times the empty script's, measured in the same run.
// Each is max(3, ceil(3 * the largest ratio seen)) over the four CI machines and the build PC, 2026-11-20.
export const LIMITS = {
  'Stop, nothing changed': 56, 'Stop, a memory changed': 59, 'SessionStart startup': 13, 'SessionStart compact': 49,
  'PreCompact auto': 49, 'PreToolUse git': 7, search: 27, status: 22,
};

async function live(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i < 0 ? dflt : argv[i + 1]; };
  const days = Number(arg('--days', 14)) || 14, project = arg('--project', process.cwd());
  const root = projectsRoot(), since = Date.now() - days * 864e5;
  const dirs = project === 'all' ? readdirSync(root).map((d) => join(root, d)) : [dirname(storeOf({ cwd: project }))];
  const files = dirs.flatMap((d) => { try { return readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => join(d, f)); } catch { return []; } });
  const lines = read(since, join(root, FILE));
  const rows = [...(await liveTimes(files, { since }))].map(([key, xs]) => {
    const [event, script] = key.split(' '), s = xs.sort((a, b) => a - b);
    const mine = lines.filter((l) => l.h === HOOK[script] && l.e.split(':')[0] === event).map((l) => l.ms);
    const p50 = Math.round(pct(s, 0.5)), inside = mine.length ? Math.round(stats(mine).median) : null;
    return { event, script, n: s.length, row: [p50, Math.round(pct(s, 0.9)), Math.round(s.at(-1))], inside, gap: inside === null ? null : p50 - inside };
  });
  const ours = rows.filter((r) => OURS.includes(r.script)).sort((a, b) => a.script.localeCompare(b.script) || a.event.localeCompare(b.event));
  const others = rows.filter((r) => !OURS.includes(r.script)).sort((a, b) => b.n - a.n).slice(0, 10);
  const num = (x) => String(x ?? '-').padStart(8);
  console.log(`conversation files read: ${files.length}, last ${days} days`);
  console.log(`${'event'.padEnd(18)}${'script'.padEnd(24)}${'runs'.padStart(6)}${'p50'.padStart(8)}${'p90'.padStart(8)}${'worst'.padStart(8)}${'inside'.padStart(8)}${'gap'.padStart(8)}  (ms)`);
  for (const r of [...ours, ...others]) console.log(`${r.event.padEnd(18)}${r.script.padEnd(24)}${String(r.n).padStart(6)}${r.row.map(num).join('')}${OURS.includes(r.script) ? num(r.inside) + num(r.gap) : ''}`);
}

const median = (xs) => Math.round(stats(xs).median);
// The median of each phase over the timing lines a case wrote; null when it wrote none (a plugin before 1.5.4, the CLI).
function split(lines) {
  if (!lines.length) return { start: null, phases: null };
  const names = new Set(lines.flatMap((l) => Object.keys(l.p ?? {})));
  return { start: median(lines.map((l) => l.start ?? 0)), phases: Object.fromEntries([...names].map((n) => [n, median(lines.map((l) => l.p?.[n] ?? 0))])) };
}

// One measurement of the cases named in `only` (all by default) on a fresh store.
function measure({ runs, real, plugin, scale, only }) {
  const { home, env } = tempHome('bench-');
  let t, store, sizes;
  if (real) {
    const root = join(homedir(), '.claude', 'projects');
    const projects = readdirSync(root).map((p) => join(root, p)).filter((p) => statSync(p).isDirectory());
    const biggest = (paths) => paths.map((p) => [p, statSync(p).size]).sort((a, b) => b[1] - a[1])[0]?.[0];
    const transcript = biggest(projects.flatMap((p) => readdirSync(p).filter((f) => f.endsWith('.jsonl')).map((f) => join(p, f))));
    const from = largestStore();
    if (!transcript || !from) { console.error('bench --real needs a transcript and a memory store on this machine to copy'); process.exit(1); }
    const proj = join(home, '.claude', 'projects', PROJECT);
    store = join(proj, 'memory'); t = join(proj, 'bbbbbbbb-0000-0000-0000-000000000000.jsonl');
    mkdirSync(proj, { recursive: true });
    copyFileSync(transcript, t);
    cpSync(from, store, { recursive: true, filter: (s) => !/[\\/]\.(lock|tiered|health)$/.test(s) });
    sizes = { transcriptBytes: statSync(t).size, notes: readdirSync(store).length };
  } else {
    ({ store, transcript: t, sizes } = build(home, { scale }));
  }
  const file = (name) => (plugin ? join(plugin, name) : tool(name));
  const payload = (extra) => JSON.stringify({ cwd: CWD, transcript_path: t, session_id: 'bbbbbbbb-0000', ...extra });
  let out = '';
  const spawn = (name, args, input) => {
    const t0 = process.hrtime.bigint();
    out = spawnSync(process.execPath, [file(name), ...args], { env, input, encoding: 'utf8' }).stdout ?? '';
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  spawn('memory-tier.mjs', [], '');                       // the snapshot repo, as a live machine has it
  spawn('memory-tier.mjs', ['--stop'], payload({ hook_event_name: 'Stop' }));   // and a stamp, and the conversation journaled

  const some = join(store, readdirSync(store).find((f) => f.endsWith('.md') && !f.startsWith('MEMORY') && f !== 'handoff.md'));
  const stop = () => spawn('memory-tier.mjs', ['--stop'], payload({ hook_event_name: 'Stop' }));
  const cases = {
    'Stop, nothing changed': stop,
    'Stop, a memory changed': () => { const n = new Date(Date.now() - 600_000 + Math.random() * 1000); utimesSync(some, n, n); return stop(); },
    'SessionStart startup': () => spawn('brief.mjs', ['--print'], payload({ hook_event_name: 'SessionStart', source: 'startup' })),
    'SessionStart compact': () => spawn('brief.mjs', ['--print'], payload({ hook_event_name: 'SessionStart', source: 'compact' })),
    'PreCompact auto': () => spawn('compact-gate.mjs', [], payload({ hook_event_name: 'PreCompact', trigger: 'auto' })),
    'PreToolUse git': () => spawn('enforce-hook.mjs', [], payload({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, tool_use_id: 'toolu_1' })),
    search: () => spawn('memory.mjs', ['search', 'harbor', '--store', store]),
    status: () => spawn('memory.mjs', ['status', '--store', store]),
    [EMPTY]: () => { const t0 = process.hrtime.bigint(); spawnSync(process.execPath, ['-e', ''], { env }); return Number(process.hrtime.bigint() - t0) / 1e6; },
  };
  const timing = join(projectsRoot(), FILE), result = {};
  let briefingBytes = 0;
  for (const [name, run] of Object.entries(cases)) {
    if (only && name !== EMPTY && !only.includes(name)) continue;
    const before = read(0, timing).length;
    run();                                                 // warm the disk cache
    const xs = Array.from({ length: runs }, run).sort((a, b) => a - b);
    if (name === 'SessionStart startup') briefingBytes = Buffer.byteLength(out);
    result[name] = { p50: Math.round(pct(xs, 0.5)), p90: Math.round(pct(xs, 0.9)), ...split(read(0, timing).slice(before)) };
  }
  return { store: sizes, cases: result, briefingBytes };
}

function show({ store, cases, runs }) {
  const mb = (n) => `${Math.round(n / 1e6)} MB`;
  console.log(`transcript ${mb(store.transcriptBytes)}, ${store.entries == null ? '' : `${store.entries} journal entries (${mb(store.journalBytes)}), `}${store.notes} notes, ${runs} runs each`);
  for (const [name, c] of Object.entries(cases)) {
    const top = c.phases && Object.entries(c.phases).sort((a, b) => b[1] - a[1])[0];
    console.log(`${name.padEnd(24)} p50 ${String(c.p50).padStart(5)} ms   p90 ${String(c.p90).padStart(5)} ms   start ${c.start === null ? '-' : `${c.start} ms`}   largest phase ${top ? `${top[0]} ${top[1]} ms` : '-'}`);
  }
}

// A case with no limit fails; one over its limit fails with its numbers in plain words.
export function verdict(cases, limits) {
  const base = cases[EMPTY];
  return Object.entries(cases).filter(([name]) => name !== EMPTY).flatMap(([name, ms]) => {
    if (!(name in limits)) return [`no limit set for "${name}"`];
    const ratio = ms / base;
    return ratio > limits[name] ? [`"${name}" took ${ms} ms, ${ratio.toFixed(1)} times the empty script's ${base} ms; the limit is ${limits[name]} times`] : [];
  });
}

// `run` measures; main returns the exit code. A case over its limit is measured once more on fresh runs, and fails only if it is over twice.
export async function main(argv, run = measure, limits = LIMITS) {
  if (argv.includes('--live')) return live(argv);
  const flag = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const plugin = flag('--plugin'), scale = Number(flag('--scale')) || 1, jsonPath = flag('--json');
  const runs = Number(argv.find((a, i) => /^\d+$/.test(a) && !a.startsWith('-') && !argv[i - 1]?.startsWith('--'))) || 9;
  const opts = { runs, real: argv.includes('--real'), plugin, scale };
  const r = { ...(await run(opts)), runs };
  show(r);
  if (jsonPath) {
    const root = plugin ?? dirname(tool('bench.mjs'));
    const version = JSON.parse(readFileSync(join(root, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const { store, cases, briefingBytes } = r;
    writeFileSync(jsonPath, JSON.stringify({ at: new Date().toISOString(), node: process.version, platform: process.platform, plugin: version, runs, store, cases, briefingBytes }, null, 2) + '\n');
  }
  if (!argv.includes('--check')) return 0;
  const p50 = (c) => Object.fromEntries(Object.entries(c).map(([n, v]) => [n, v.p50]));
  let fails = verdict(p50(r.cases), limits);
  if (fails.length) {
    const slow = fails.map((f) => /"(.*?)"/.exec(f)[1]);
    console.log(`over the limit: ${slow.join(', ')}; measured again`);
    fails = verdict(p50((await run({ ...opts, only: slow })).cases), limits);
  }
  for (const f of fails) console.error(f);
  return fails.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
