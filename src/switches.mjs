// The lesson switches (1.7.0 F1), apart from lessons.mjs so a hook can ask "is this trigger on?" without loading anything else.
// No imports: keep it so. lessons.mjs re-exports these.

// F1. PROJECT_MEMORY_LESSONS: unset or empty gives DEFAULTS, 0 turns every trigger off, 1 on, anything else is a comma list read over
// DEFAULTS (`name` on, `-name` off, the later word wins, blanks trimmed, unknown words ignored). The replay gate (2026-11-28) turned on
// only `command`, the one trigger that fired enough to judge (122 in 31 days, median 2 an active day); the rest wait for notes that carry
// `applies_to:` and `instead:`.
export const TRIGGERS = ['edit', 'command', 'deadend', 'recurring', 'nudge', 'stuck', 'claim', 'cochange'];
export const DEFAULTS = { edit: false, command: true, deadend: false, recurring: false, nudge: false, stuck: false, claim: false, cochange: false };
export function lessonsOn(name, env = process.env.PROJECT_MEMORY_LESSONS) {
  if (!TRIGGERS.includes(name)) return false;
  const v = String(env ?? '').trim();
  if (v === '0') return false;
  if (v === '1') return true;
  let on = DEFAULTS[name];
  for (const w of v.split(',').map((x) => x.trim())) { if (w === name) on = true; else if (w === `-${name}`) on = false; }
  return on;
}
