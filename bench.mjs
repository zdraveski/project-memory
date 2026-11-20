// How long each hook takes. Two ways:
//   node bench.mjs [runs]   times each hook on copies of this machine's largest transcript and
//                           largest store under a throwaway HOME: the real ones are never touched
//                           (default 9 runs; prints p50 / p90 in ms).
//   node bench.mjs --live [--project <folder>|all] [--days <n>]
//                           reads the hook durations Claude Code recorded in its own conversation
//                           files (read-only): this plugin's hooks beside every other plugin's.
import { readdirSync, statSync, copyFileSync, mkdirSync, cpSync, utimesSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { tool, tempHome, largestStore } from './harness.mjs';
import { projectsRoot, storeOf } from './store.mjs';
import { liveTimes } from './live-times.mjs';
import { pct } from './timing.mjs';

const OURS = ['memory-tier.mjs', 'brief.mjs', 'enforce-hook.mjs', 'compact-gate.mjs', 'handoff-log.mjs'];

async function live(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i < 0 ? dflt : argv[i + 1]; };
  const days = Number(arg('--days', 14)) || 14, project = arg('--project', process.cwd());
  const root = projectsRoot();
  const dirs = project === 'all' ? readdirSync(root).map((d) => join(root, d)) : [dirname(storeOf({ cwd: project }))];
  const files = dirs.flatMap((d) => { try { return readdirSync(d).filter((f) => f.endsWith('.jsonl')).map((f) => join(d, f)); } catch { return []; } });
  const rows = [...(await liveTimes(files, { since: Date.now() - days * 864e5 }))].map(([key, xs]) => {
    const [event, script] = key.split(' '), s = xs.sort((a, b) => a - b);
    return { event, script, n: s.length, row: [pct(s, 0.5), pct(s, 0.9), s.at(-1)].map(Math.round) };
  });
  const ours = rows.filter((r) => OURS.includes(r.script)).sort((a, b) => a.script.localeCompare(b.script) || a.event.localeCompare(b.event));
  const others = rows.filter((r) => !OURS.includes(r.script)).sort((a, b) => b.n - a.n).slice(0, 10);
  console.log(`conversation files read: ${files.length}, last ${days} days`);
  console.log(`${'event'.padEnd(18)}${'script'.padEnd(24)}${'runs'.padStart(6)}${'p50'.padStart(8)}${'p90'.padStart(8)}${'worst'.padStart(8)}  (ms)`);
  for (const r of [...ours, ...others]) console.log(`${r.event.padEnd(18)}${r.script.padEnd(24)}${String(r.n).padStart(6)}${r.row.map((x) => String(x).padStart(8)).join('')}`);
}

function bench(runs) {
  const RUNS = Number(runs) || 9;
  const real = join(homedir(), '.claude', 'projects');
  const projects = readdirSync(real).map((p) => join(real, p)).filter((p) => statSync(p).isDirectory());
  const biggest = (paths) => paths.map((p) => [p, statSync(p).size]).sort((a, b) => b[1] - a[1])[0]?.[0];
  const transcript = biggest(projects.flatMap((p) => readdirSync(p).filter((f) => f.endsWith('.jsonl')).map((f) => join(p, f))));
  const store = largestStore();
  if (!transcript || !store) { console.error('bench needs a transcript and a memory store on this machine to copy'); process.exit(1); }

  const { home, env } = tempHome('bench-');
  const proj = join(home, '.claude', 'projects', 'C--bench-project');
  mkdirSync(proj, { recursive: true });
  const t = join(proj, 'bbbbbbbb-0000-0000-0000-000000000000.jsonl');
  copyFileSync(transcript, t);
  cpSync(store, join(proj, 'memory'), { recursive: true, filter: (s) => !/[\\/]\.(lock|tiered|health)$/.test(s) });
  const payload = (extra) => JSON.stringify({ cwd: 'C:\\bench-project', transcript_path: t, session_id: 'bbbbbbbb-0000', ...extra });
  const node = (file, args, input) => {
    const t0 = process.hrtime.bigint();
    spawnSync(process.execPath, [tool(file), ...args], { env, input, encoding: 'utf8' });
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  node('memory-tier.mjs', [], '');                       // the snapshot repo, as a live machine has it
  node('memory-tier.mjs', ['--stop'], payload({ hook_event_name: 'Stop' }));   // and a stamp

  const some = join(proj, 'memory', readdirSync(join(proj, 'memory')).find((f) => f.endsWith('.md') && !f.startsWith('MEMORY') && f !== 'handoff.md'));
  const cases = {
    'Stop, nothing changed': () => node('memory-tier.mjs', ['--stop'], payload({ hook_event_name: 'Stop' })),
    'Stop, a memory changed': () => { const n = new Date(Date.now() - 600_000 + Math.random() * 1000); utimesSync(some, n, n); return node('memory-tier.mjs', ['--stop'], payload({ hook_event_name: 'Stop' })); },
    'SessionStart startup': () => node('handoff-log.mjs', ['--print'], payload({ hook_event_name: 'SessionStart', source: 'startup' })),
    'SessionStart compact': () => node('handoff-log.mjs', ['--print'], payload({ hook_event_name: 'SessionStart', source: 'compact' })),
    'PreCompact auto': () => node('compact-gate.mjs', [], payload({ hook_event_name: 'PreCompact', trigger: 'auto' })),
    'node, empty script': () => { const t0 = process.hrtime.bigint(); spawnSync(process.execPath, ['-e', ''], { env }); return Number(process.hrtime.bigint() - t0) / 1e6; },
  };
  console.log(`transcript ${Math.round(statSync(t).size / 1e6)} MB, store ${readdirSync(join(proj, 'memory')).length} files, ${RUNS} runs each`);
  for (const [name, run] of Object.entries(cases)) {
    run();                                                 // warm the disk cache
    const xs = Array.from({ length: RUNS }, run).sort((a, b) => a - b);
    console.log(`${name.padEnd(24)} p50 ${String(Math.round(pct(xs, 0.5))).padStart(5)} ms   p90 ${String(Math.round(pct(xs, 0.9))).padStart(5)} ms`);
  }
}

export async function main(argv) {
  if (argv.includes('--live')) return live(argv);
  return bench(argv[0]);
}

if (import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main(process.argv.slice(2));
