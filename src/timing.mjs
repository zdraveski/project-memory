// One line of numbers per hook run, appended to <projects root>/.timing and shown by `memory doctor`.
// The line holds the time, a fixed hook name, an event name from a fixed list and milliseconds: no text
// from a conversation, no path, no command. Time zero is Node's own start. It never throws into a
// hook and never creates a folder. PROJECT_MEMORY_TIMING=0 turns it off.
// No static import of a plugin module: store.mjs is loaded inside flush(), when the hook has it already.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FILE = '.timing';
export const MAX = 256 * 1024;
const HOOKS = ['save', 'tidy', 'brief', 'enforce', 'gate', 'recall', 'prompt', 'end', 'lesson', 'fail'];
// Claude Code's own names only: whatever else a payload holds never reaches the file.
const EVENTS = ['Stop', 'SubagentStop', 'SessionStart', 'PreCompact', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'UserPromptSubmit', 'Notification', 'SessionEnd'];
const DETAILS = ['startup', 'resume', 'compact', 'clear', 'auto', 'manual'];

export const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
export function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  return { runs: s.length, median: pct(s, 0.5), p90: pct(s, 0.9), worst: s.at(-1) };
}

let run = null;

export function begin(hook) {
  run = null;
  if (!HOOKS.includes(hook) || process.env.PROJECT_MEMORY_TIMING === '0') return;
  const now = performance.now(), node = Math.round(performance.nodeTiming.bootstrapComplete);
  run = { h: hook, e: '?', start: Math.round(now), p: {}, last: now };
  if (node >= 1 && node <= run.start) run.node = node;
}

export function tag(event, detail) {
  if (!run) return;
  run.e = EVENTS.includes(event) ? event : '?';
  if (run.e !== '?' && DETAILS.includes(detail)) run.e += `:${detail}`;
}

export function mark(phase) {
  if (!run) return;
  const now = performance.now();
  run.p[phase] = (run.p[phase] ?? 0) + (now - run.last);
  run.last = now;
}

// A script that serves two hooks names the one it ran as, once its input is read (recall-hook.mjs: `prompt`).
export function name(hook) {
  if (run && HOOKS.includes(hook)) run.h = hook;
}

// The number of pointers the run showed (1.6.0 step 4): a count, never what they said.
export function shown(n) {
  if (run && n > 0) run.n = n;
}

export async function flush() {
  const r = run; run = null;
  if (!r) return;
  try {
    const { projectsRoot, appendCapped } = await import('./store.mjs');
    const p = Object.fromEntries(Object.entries(r.p).map(([k, v]) => [k, Math.round(v)]));
    const { h, e, node, start, n } = r;
    // Past MAX the newer half stays.
    appendCapped(join(projectsRoot(), FILE), JSON.stringify({ t: Date.now(), h, e, ...(node && { node }), start, p, ...(n && { n }), ms: Math.round(performance.now()) }) + '\n', MAX);
  } catch {}
}

// Lines of `file` with t >= since, oldest first. Lines that do not parse or lack numbers are skipped.
export function read(since, file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o && typeof o.t === 'number' && typeof o.ms === 'number' && o.t >= since) out.push(o);
  }
  return out;
}
