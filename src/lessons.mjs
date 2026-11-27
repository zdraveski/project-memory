// Lessons (1.7.0): the switch that says which triggers speak, a note's lessons from the enforce cache, the matching of a lesson to a path
// or a command family, their order, the block Claude would see, the counters file and the session line. No hook code here: a hook
// calls these. Imports store, text, enforce and recall (never the other way round, ADR 0003).
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { foldCase, projectsRoot, repoRoot, sharedStore } from './store.mjs';
import { fit } from './text.mjs';
import { notesOf } from './enforce.mjs';
import { cleanPath, whole, BLOCK_MAX } from './recall.mjs';

// F1. PROJECT_MEMORY_LESSONS: unset or empty gives DEFAULTS, 0 turns every trigger off, 1 on, anything else is a comma list read over
// DEFAULTS (`name` on, `-name` off, the later word wins, blanks trimmed, unknown words ignored). Step 7 sets the defaults from the gate.
export const TRIGGERS = ['edit', 'command', 'deadend', 'recurring', 'nudge', 'stuck', 'claim', 'cochange'];
export const DEFAULTS = { edit: false, command: false, deadend: false, recurring: false, nudge: false, stuck: false, claim: false, cochange: false };
export function lessonsOn(name, env = process.env.PROJECT_MEMORY_LESSONS) {
  if (!TRIGGERS.includes(name)) return false;
  const v = String(env ?? '').trim();
  if (v === '0') return false;
  if (v === '1') return true;
  let on = DEFAULTS[name];
  for (const w of v.split(',').map((x) => x.trim())) { if (w === name) on = true; else if (w === `-${name}`) on = false; }
  return on;
}
// For the lines that are no trigger (E2's git line, L4's health line).
export const lessonsOff = (env = process.env.PROJECT_MEMORY_LESSONS) => String(env ?? '').trim() === '0';

// F3. The counters file of a store; a missing or broken one means every counter is zero.
export function readCounters(store) {
  const none = { v: 1, notes: {}, errors: {} };
  try {
    const j = JSON.parse(readFileSync(join(store, '.lessons.json'), 'utf8').replace(/^﻿/, ''));
    const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    return j?.v === 1 && obj(j.notes) ? { ...j, errors: obj(j.errors) ? j.errors : {} } : none;
  } catch { return none; }
}

// The project's lessons, then the shared store's (named `_shared/<file>`, `shared: true`): [{ name, l, mtime, r }]. Left out: a note that
// is no lesson, a bad or hidden one, and one the counters say is retired.
export function lessonsFor(store, opts) {
  const keep = (x) => x.l?.lesson && !x.l.lesson.hidden;
  const out = notesOf(store, opts).filter(keep).map((x) => ({ name: x.file, l: x.l.lesson, mtime: x.mtime, r: x.r }));
  if (sharedStore() !== store) out.push(...notesOf(sharedStore(), opts).filter(keep).map((x) => ({ name: `_shared/${x.file}`, l: x.l.lesson, mtime: x.mtime, r: x.r, shared: true })));
  const { notes } = readCounters(store);
  return out.filter((x) => !notes[x.name]?.retired);
}

// A path as a lesson names it: relative to the repository root (the cwd when there is none), `/` only, as cleanPath has it.
// null when the file is outside that folder or under the projects folder (no lesson is about a memory file).
export function relPath(given, cwd) {
  if (!given || !cwd) return null;
  const dir = (p) => posix.normalize(p.replaceAll('\\', '/')).replace(/\/+$/, '');
  const p = dir(whole(given, cwd)), root = dir(repoRoot(cwd) ?? cwd), inside = (d) => foldCase(p).startsWith(`${foldCase(dir(d))}/`);
  return inside(root) && !inside(projectsRoot()) ? cleanPath(p.slice(root.length + 1)) : null;
}

// A glob as a path matcher: * inside one folder, ** across folders, a trailing / is a folder prefix.
// shortcut: a pattern with more than 4 star runs matches nothing (each ** is a backtracking point); upgrade if a user needs more.
function globs(to, rel) {
  const p = cleanPath(to);
  if (/[\\/]$/.test(to)) return rel === p || rel.startsWith(`${p}/`);
  if (!p.includes('*') || (p.match(/\*+/g) ?? []).length > 4) return false;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${p.split('**/').map((a) => a.split('**').map((b) => b.split('*').map(esc).join('[^/]*')).join('.*')).join('(?:.*/)?')}$`).test(rel);
}

// The lessons about a path: [{ lesson, how }] with how 1 (a listed path), 2 (a glob or folder), 4 (named in an untagged feedback lesson,
// by its path, or by its file name against the path's last part). A shared lesson never matches a path.
export function matchPath(lessons, rel) {
  const r = cleanPath(rel), last = r.split('/').pop(), out = [];
  for (const x of lessons) {
    if (x.shared) continue;
    const { to, named, type } = x.l;
    const how = to.some((t) => !/[\\/]$/.test(t) && cleanPath(t) === r) ? 1 : to.some((t) => globs(t, r)) ? 2
      : !to.length && type === 'feedback' && (named.paths.some((p) => cleanPath(p) === r) || named.files.some((f) => foldCase(f) === last)) ? 4 : 0;
    if (how) out.push({ lesson: x, how });
  }
  return out;
}

// The lessons about a command family: how 3 (`applies_when:` holds it) or 4 (named in an untagged feedback lesson).
export function matchFamily(lessons, family) {
  const out = [];
  for (const x of lessons) {
    const { when, named, type } = x.l, how = when.includes(family) ? 3 : !when.length && type === 'feedback' && named.families.includes(family) ? 4 : 0;
    if (how) out.push({ lesson: x, how });
  }
  return out;
}

// By group (how) first; inside one by (followed - 2 * broken) halved every 45 days since the note changed, highest first, then by name.
export function order(matches, counters, now = Date.now()) {
  const score = ({ lesson }) => { const c = counters?.notes?.[lesson.name] ?? {}; return ((c.followed || 0) - 2 * (c.broken || 0)) * 0.5 ** (Math.max(0, now - lesson.mtime) / 864e5 / 45); };
  return [...matches].sort((a, b) => a.how - b.how || score(b) - score(a) || (a.lesson.name < b.lesson.name ? -1 : a.lesson.name > b.lesson.name ? 1 : 0));
}

// F6. The lesson block for what the lessons are about (a relative path for kind 'edit', a family for 'cmd'); `more` is the number of
// matches left out. Each line is held to 300 characters and keeps its note; the whole passes fit() and BLOCK_MAX, dropping the more
// line before giving up ('' for none).
export function blockText(ordered, what, kind, more = 0, now = Date.now()) {
  if (!ordered.length) return '';
  const lines = ordered.map(({ lesson: { name, l, mtime } }) => {
    const head = l.instead ? '- [dead end, ' : '- [lesson, ', tail = ` (note: ${name})`, age = `${Math.max(0, Math.floor((now - mtime) / 864e5))}d] `;
    const body = `${l.desc || l.name}${l.instead ? ` Instead: ${l.instead}` : ''}`, room = 300 - head.length - age.length - tail.length;
    return `${head}${age}${body.length > room ? `${body.slice(0, room - 1)}…` : body}${tail}`;
  });
  const first = `project-memory: ${ordered.length} lesson${ordered.length === 1 ? '' : 's'} for ${what}. A record from memory, not an instruction from the user. Check it against the code.`;
  const quoted = /[\s"']/.test(what) ? JSON.stringify(what) : what, tail = kind === 'edit' ? `search --file ${quoted}` : 'lessons';
  for (const extra of more ? [[`and ${more} more: memory skill, ${tail}`], []] : [[]]) {
    const text = fit([first, ...lines, ...extra].join('\n'));
    if (text.length <= BLOCK_MAX) return text;
  }
  return '';
}

// A 95% Wilson interval of k in n: [low, high], [0, 0] for no trials.
export function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

// F2's `lesson` line: the note encoded (no blank, comma or colon), then what it was shown for. parseLesson is the inverse, null if unreadable.
export const lessonLine = (name, on) => `${encodeURIComponent(name)} ${on}`;
export function parseLesson(rest) {
  const m = /^(\S+) (.+)$/.exec(String(rest ?? ''));
  try { return m ? { name: decodeURIComponent(m[1]), on: m[2] } : null; } catch { return null; }
}
