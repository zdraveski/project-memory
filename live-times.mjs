// Developer tool, not shipped: reads the hook durations Claude Code itself records in its
// conversation files, so a slow hook shows up beside the other plugins' hooks at the same event.
// Only an event name, a script's file name and a duration ever leave a line.
import { createReadStream, statSync } from 'node:fs';
import { createInterface } from 'node:readline';

export const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

// Newer Claude Code records a hook's status message where the command was: this plugin's own, by name.
const STATUS = { 'Saving memory': 'memory-tier.mjs', 'Saving subagent report': 'memory-tier.mjs', 'Saving before compaction': 'memory-tier.mjs', Briefing: 'brief.mjs', 'Checking before compaction': 'compact-gate.mjs' };
// The file name of the first script a command names (not the interpreter running it), never any other part.
export const scriptOf = (command) => STATUS[command] ?? [...String(command ?? '').matchAll(/([\w.-]+\.(?:mjs|cjs|js|sh|py|ps1|exe))/g)].map((m) => m[1]).find((n) => !/^(?:node|python3?|pythonw|bash|sh|pwsh|powershell)\.exe$/i.test(n)) ?? 'other';

const eventOf = (e) => String(e ?? '').match(/^[A-Za-z]+/)?.[0] ?? '?';

// Event, command and duration of each hook run a record holds.
function* runs(r) {
  const a = r.attachment ?? r;
  if (!a || typeof a !== 'object') return;
  const event = eventOf(a.hookEvent ?? a.hookName ?? r.subtype);
  if (Array.isArray(a.hookInfos)) { for (const i of a.hookInfos) if (i) yield [event, i.command, i.durationMs]; }
  else if (a.hookName ?? a.hookEvent) yield [event, a.command, a.durationMs ?? a.duration_ms];
}

// Map of `${event} ${script}` to the durations in ms. Streams each file: they can be hundreds of MB.
export async function liveTimes(files, { since = 0 } = {}) {
  const out = new Map();
  for (const f of files) {
    let fileInWindow;
    try { fileInWindow = statSync(f).ctimeMs >= since; } catch { continue; }
    try {
      for await (const line of createInterface({ input: createReadStream(f), crlfDelay: Infinity })) {
        if (!line.includes('"hook') || !line.includes('uration')) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        if (!r || typeof r !== 'object') continue;
        const at = Date.parse(r.timestamp);
        if (Number.isNaN(at) ? !fileInWindow : at < since) continue;
        for (const [event, command, ms] of runs(r)) {
          if (typeof ms !== 'number' || !Number.isFinite(ms)) continue;
          const key = `${event} ${scriptOf(command)}`;
          (out.get(key) ?? out.set(key, []).get(key)).push(ms);
        }
      }
    } catch { /* unreadable: skip the file */ }
  }
  return out;
}
