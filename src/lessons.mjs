// Lessons (1.7.0): the switch that says which triggers speak, a note's lessons from the enforce cache, the matching of a lesson to a path
// or a command family, their order, the block Claude would see, the counters file and the session line. No hook code here: a hook
// calls these. Imports store, text, enforce and recall (never the other way round, ADR 0003).
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, posix, isAbsolute, resolve } from 'node:path';
import { foldCase, projectsRoot, sharedStore, withLock, replaceIfUnchanged, raw, tag } from './store.mjs';
import { gate } from './privacy.mjs';
import { sessionsOf, readSession, sessionLine } from './sessions.mjs';
import { fit } from './text.mjs';
import { notesOf } from './enforce.mjs';
import { cleanPath, whole, BLOCK_MAX } from './recall.mjs';
import { lessonsOn } from './switches.mjs';

// F1. The switches live in switches.mjs (no imports, so a hook can ask without loading this file); re-exported here.
export { TRIGGERS, DEFAULTS, lessonsOn } from './switches.mjs';
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

// F3's writer for the startup briefing (`listed`, `told`): `edit` changes the counters in place, under the store's lock, written only if
// the file is as it was read. true when written; false when nothing changed, the lock stayed busy or the write failed (the briefing says
// the same again next time).
export function updateCounters(store, edit) {
  try {
    return withLock(store, () => { const file = join(store, '.lessons.json'), c = readCounters(store); edit(c); return replaceIfUnchanged(file, raw(file), `${JSON.stringify(c)}
`) === true; }) ?? false;
  } catch { return false; }
}

// H3. The dead ends of this project (lessons with `instead`, none retired, resolved or hidden), as the briefing prints them: a header, at most
// 3 lines of 200 characters, and the count of the rest; [] for none. `opts` goes to notesOf ({ write: false } leaves the cache alone).
export function deadEnds(store, now = Date.now(), opts) {
  const ends = lessonsFor(store, opts).filter((x) => !x.shared && x.l.instead).map((lesson) => ({ lesson, how: 0 }));
  const shown = order(ends, readCounters(store), now).slice(0, 3).map(({ lesson: { name, l, mtime } }) => {
    const head = `- [${Math.max(0, Math.floor((now - mtime) / 864e5))}d] `, tail = ` (note: ${name})`, body = `${l.desc || l.name}: Instead: ${l.instead}`, room = 200 - head.length - tail.length;
    return `${head}${body.length > room ? `${body.slice(0, Math.max(0, room - 1))}…` : body}${tail}`;
  });
  return shown.length ? ['Dead ends in this project (records, check them against the code):', ...shown, ...(ends.length > 3 ? [`and ${ends.length - 3} more: memory skill, lessons`] : [])] : [];
}

// L4. A lesson that was retired and not yet told: { names, lines } (`told: true` is written by the caller). A note that is no longer a
// lesson (gone, archived, hidden) is not told; a co-change lesson (`cochange:<hash>`) has no note.
export function retiredLines(store, opts) {
  const { notes } = readCounters(store), due = Object.entries(notes).filter(([, c]) => c?.retired && !c.told);
  if (!due.length) return { names: [], lines: [] };
  const alive = new Set([[store, ''], [sharedStore(), '_shared/']].flatMap(([d, pre]) => (d === store && pre ? [] : notesOf(d, opts).filter((x) => x.l?.lesson && !x.l.lesson.hidden).map((x) => `${pre}${x.file}`))));
  const told = due.filter(([name]) => name.startsWith('cochange:') || alive.has(name));
  return { names: told.map(([name]) => name), lines: told.map(([name, c]) => `project-memory: the lesson ${name} is no longer shown (shown ${c.shown || 0}, broken ${c.broken || 0}). Fix the note or add resolved-by: to it. See: memory skill, lessons`) };
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

// The folder a lesson's paths are relative to: the nearest one at or above `cwd` that holds a `.git` (a folder, or the file of a worktree
// or submodule), so a worktree is its own root, not its main repository as repoRoot would have it; the cwd when there is none.
function topOf(cwd) {
  if (!isAbsolute(cwd)) return cwd;
  for (let d = resolve(cwd); ; d = dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    if (dirname(d) === d) return cwd;
  }
}

// A path as a lesson names it: relative to that folder (topOf), `/` only, as cleanPath has it.
// null when the file is outside that folder or under the projects folder (no lesson is about a memory file).
export function relPath(given, cwd) {
  if (!given || !cwd) return null;
  const dir = (p) => posix.normalize(p.replaceAll('\\', '/')).replace(/\/+$/, '');
  const p = dir(whole(given, cwd)), root = dir(topOf(cwd)), inside = (d) => foldCase(p).startsWith(`${foldCase(dir(d))}/`);
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

// Why a path matched a lesson, as `memory preview --file` words it. `x` is one matchPath item.
export function whyPath({ lesson: { name, l }, how }, rel) {
  const r = cleanPath(rel);
  if (how === 1) return `${name} lists ${r} in applies_to`;
  if (how === 2) return `${name} matches ${l.to.find((t) => globs(t, r))} in applies_to`;
  return `${name} names ${l.named.paths.find((p) => cleanPath(p) === r) ?? l.named.files.find((f) => foldCase(f) === r.split('/').pop())} in its name or description`;
}

// H1. The lessons Claude sees before an edit: at most EDIT_SHOW of them, once per lesson per context (since the last `compact` line, per
// writer), EDIT_CAP a context, each as a `lesson <note> edit:<path>` session line. { say, shown }; say is '' for none. `dry` reads no
// session file (a fresh context) and writes nothing. Nothing throws out of the checks that read files: a hook calls this and must go on.
export const EDIT_SHOW = 2, EDIT_CAP = 6, EDIT_MS = 150;
export function onEdit(input, { dry = false, now = Date.now(), deadline = performance.now() + EDIT_MS } = {}) {
  const none = { say: '', shown: [] };
  if (!lessonsOn('edit')) return none;
  const given = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path, s = tag(input?.session_id);
  if (typeof given !== 'string' || !given.trim() || typeof input.cwd !== 'string' || !input.cwd.trim() || !/^[\w-]+$/.test(s)) return none;
  const rel = relPath(given, input.cwd.replaceAll('\\', '/'));
  if (!rel || /[\r\n]/.test(rel)) return none;
  const { why, store } = gate(input, s, 1);
  if (why) return none;
  const all = lessonsFor(store, dry ? { write: false } : undefined);
  if (!all.length || performance.now() > deadline) return none;
  const hits = matchPath(all, rel);
  if (!hits.length) return none;
  const at = join(sessionsOf(store), s), lines = dry ? [] : readSession(at);
  if (!lines || lines.findLast((l) => l.kind === 'asked' || l.kind === 'quiet')?.kind === 'quiet') return none;
  const by = typeof input.agent_id === 'string' ? input.agent_id.replace(/[^\w-]/g, '').slice(0, 64) : '';
  const told = lines.slice(lines.findLastIndex((l) => l.kind === 'compact') + 1).filter((l) => l.kind === 'lesson' && l.by === by);
  const seen = new Set(told.map((l) => parseLesson(l.rest)?.name)), room = Math.min(EDIT_SHOW, EDIT_CAP - told.length);
  const ordered = order(hits.filter((x) => !seen.has(x.lesson.name)), readCounters(store), now), shown = ordered.slice(0, Math.max(0, room));
  const say = blockText(shown, rel, 'edit', ordered.length - shown.length, now);
  if (!say) return none;
  // shortcut: parallel edits may both show the same lesson, no lock; fine for a nudge
  if (!dry) try {
    mkdirSync(dirname(at), { recursive: true, mode: 0o700 });
    appendFileSync(at, shown.map((x) => sessionLine('lesson', lessonLine(x.lesson.name, `edit:${rel}`), by, new Date(now).toISOString())).join(''), { mode: 0o600 });
  } catch { return none; }
  return { say, shown };
}

// H2. The lessons Claude sees before a risky command: `families` is familyOf(command). As onEdit, but a lesson is matched to each family
// (matchFamily, in order; a lesson for two is told once, as the first), the block is about the first family with a match, and the line is
// `lesson <note> cmd:<family>`. A filter in hooks.json can start the hook twice for one call (probe P5c): the first to create
// `<session file>.pre-<tool_use_id>` speaks, the other stays silent. { say, shown }, each shown item { lesson, how, family }.
export const whyFamily = ({ lesson: { name }, how, family }) => (how === 3 ? `${name} lists ${family} in applies_when` : `${name} names ${family} in its name or description`);
export function onCommand(input, families, { dry = false, now = Date.now(), deadline = performance.now() + EDIT_MS } = {}) {
  const none = { say: '', shown: [] }, s = tag(input?.session_id);
  if (!lessonsOn('command') || !Array.isArray(families) || !/^[\w-]+$/.test(s)) return none;
  const { why, store } = gate(input, s, 1);
  if (why) return none;
  const all = lessonsFor(store, dry ? { write: false } : undefined);
  if (!all.length || performance.now() > deadline) return none;
  const first = new Map();
  for (const family of families) for (const h of matchFamily(all, family)) if (!first.has(h.lesson.name)) first.set(h.lesson.name, { ...h, family });
  if (!first.size) return none;
  const at = join(sessionsOf(store), s), lines = dry ? [] : readSession(at);
  if (!lines || lines.findLast((l) => l.kind === 'asked' || l.kind === 'quiet')?.kind === 'quiet') return none;
  const by = typeof input.agent_id === 'string' ? input.agent_id.replace(/[^\w-]/g, '').slice(0, 64) : '';
  const told = lines.slice(lines.findLastIndex((l) => l.kind === 'compact') + 1).filter((l) => l.kind === 'lesson' && l.by === by);
  const seen = new Set(told.map((l) => parseLesson(l.rest)?.name)), room = Math.min(EDIT_SHOW, EDIT_CAP - told.length);
  const ordered = order([...first.values()].filter((x) => !seen.has(x.lesson.name)), readCounters(store), now), shown = ordered.slice(0, Math.max(0, room));
  const say = blockText(shown, [...first.values()][0].family, 'cmd', ordered.length - shown.length, now);
  if (!say) return none;
  if (!dry) try {
    mkdirSync(dirname(at), { recursive: true, mode: 0o700 });
    const id = String(input.tool_use_id ?? '').replace(/[^\w-]/g, '').slice(0, 64);
    if (id) try { writeFileSync(`${at}.pre-${id}`, '', { flag: 'wx', mode: 0o600 }); } catch (e) { if (e.code === 'EEXIST') return none; }
    appendFileSync(at, shown.map((x) => sessionLine('lesson', lessonLine(x.lesson.name, `cmd:${x.family}`), by, new Date(now).toISOString())).join(''), { mode: 0o600 });
  } catch { return none; }
  return { say, shown };
}
