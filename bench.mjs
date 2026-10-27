// How long each hook takes, against copies of this machine's largest transcript
// and largest store under a throwaway HOME: the real ones are never touched.
// Run: node bench.mjs [runs]   (default 9; prints p50 / p90 in ms)
import { readdirSync, statSync, copyFileSync, mkdirSync, cpSync, utimesSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { tool, tempHome, largestStore } from './harness.mjs';

const RUNS = Number(process.argv[2]) || 9;
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
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
console.log(`transcript ${Math.round(statSync(t).size / 1e6)} MB, store ${readdirSync(join(proj, 'memory')).length} files, ${RUNS} runs each`);
for (const [name, run] of Object.entries(cases)) {
  run();                                                 // warm the disk cache
  const xs = Array.from({ length: RUNS }, run).sort((a, b) => a - b);
  console.log(`${name.padEnd(24)} p50 ${String(Math.round(pct(xs, 0.5))).padStart(5)} ms   p90 ${String(Math.round(pct(xs, 0.9))).padStart(5)} ms`);
}
