// Lessons (1.7.0): the switch that says which triggers speak, a note's lessons from the enforce cache, the matching of a lesson to a path
// or a command family, their order, the block Claude would see, the counters file and the session line. No hook code here: a hook
// calls these. Imports store, text, enforce and recall (never the other way round, ADR 0003).
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, posix, dirname } from 'node:path';
import { foldCase, projectsRoot, repoRoot, sharedStore, withLock, replaceIfUnchanged, raw, tag, keyed } from './store.mjs';
import { fit } from './text.mjs';
import { notesOf } from './enforce.mjs';
import { cleanPath, whole, BLOCK_MAX } from './recall.mjs';
import { gate } from './privacy.mjs';
import { sessionsOf, readSession, sessionLine } from './sessions.mjs';
import { targetOf, errorLine, NOT_FAILURE, readMistakes } from './mistakes.mjs';

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

// L2. Whether a command of `target` went through between the last two failures of it in this turn, read from the transcript's last
// 512 KB (only when about to speak). Raw records, not turns(): turns() clears an exact re-run's earlier marks. A call with no result yet
// is the failure being reported. true: yes; false: no, or fewer than two failures show in the tail; null: the transcript will not read.
async function wentThrough(path, target) {
  try {
    const { readTail, TAIL, records, text, prompt } = await import('./transcript.mjs');
    let calls = [];
    const done = new Map();
    for (const r of records(readTail(path, TAIL).text)) {
      const c = r.message?.content;
      if (r.type === 'user' && prompt(r, text(r))) { calls = []; continue; }
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (r.type === 'user' && b?.type === 'tool_result') done.set(b.tool_use_id, b.is_error === true);
        else if (r.type === 'assistant' && b?.type === 'tool_use' && /^(?:Bash|PowerShell)$/.test(b.name) && typeof b.input?.command === 'string' && targetOf(b.input.command) === target) calls.push(b.id);
      }
    }
    const ok = calls.map((id) => done.get(id) === false), bad = ok.flatMap((g, i) => (g ? [] : [i]));
    return bad.length > 1 && ok.slice(bad.at(-2) + 1, bad.at(-1)).includes(true);
  } catch { return null; }
}

// L2, the stuck streak: PostToolUseFailure for Bash and PowerShell. Appends a `fail` line (hashes only) and, on the second failure of one
// target in this turn by one writer, with no `stuck` line of its in this context, tells Claude once to read the whole error and change one
// thing, with the fix `.mistakes.json` holds for that error (2 or more conversations) or the line of a lesson that resolves it.
// shortcut: the error id is made from the full error text here and from the journal's last 300 characters there; they match when the
// last error marker line sits in that tail, which is nearly always. Returns { say }; '' for none. Never throws.
export async function onFailure(input, { now = Date.now() } = {}) {
  const none = { say: '' };
  try {
    const error = String(input?.error ?? ''), cmd = input?.tool_input?.command, s = tag(input?.session_id);
    if (!lessonsOn('stuck') || input.is_interrupt === true || !/^(?:Bash|PowerShell)$/.test(input.tool_name) || typeof cmd !== 'string' || NOT_FAILURE.test(error) || !/^[\w-]+$/.test(s)) return none;
    const target = targetOf(cmd);
    if (!target) return none;
    const { why, store } = gate(input, s, 1);
    if (why) return none;
    const at = join(sessionsOf(store), s), lines = readSession(at);
    if (!lines || lines.findLast((l) => l.kind === 'asked' || l.kind === 'quiet')?.kind === 'quiet') return none;
    const by = typeof input.agent_id === 'string' ? input.agent_id.replace(/[^\w-]/g, '').slice(0, 64) : '', th = keyed(target, 8), eh = errorLine(error);
    mkdirSync(dirname(at), { recursive: true, mode: 0o700 });
    appendFileSync(at, sessionLine('fail', `${th} ${eh ? keyed(eh, 8) : '-'}`, by, new Date(now).toISOString()), { mode: 0o600 });
    const cur = lines.slice(lines.findLastIndex((l) => l.kind === 'compact') + 1), turn = cur.slice(cur.findLastIndex((l) => l.kind === 'asked' || l.kind === 'quiet') + 1);
    const theirs = (l, kind) => l.by === by && l.kind === kind && (kind === 'stuck' ? l.rest === th : l.rest.startsWith(`${th} `));
    // The failure just written is the second when one is already there; and once per target per context.
    if (!turn.some((l) => theirs(l, 'fail')) || cur.some((l) => theirs(l, 'stuck'))) return none;
    if (await wentThrough(input.transcript_path, target) !== false) return none;
    appendFileSync(at, sessionLine('stuck', th, by, new Date(now).toISOString()), { mode: 0o600 });
    const first = `project-memory: "${target}" failed twice in a row in this turn. Before a third try, read the whole error and change one thing.`;
    let second = '';
    if (eh) {
      const id = keyed(`${target}\n${eh}`, 8), lesson = lessonsFor(store).find((x) => x.l.resolves.includes(id)), m = readMistakes(store)?.errors?.[id];
      if (lesson) second = blockText([{ lesson, how: 3 }], target, 'cmd', 0, now).split('\n')[1] ?? '';
      else if (m?.fix && m.fixSessions >= 2) second = `Earlier (${m.last}) the same error was followed by a run that worked: "${m.fix.length > 160 ? `${m.fix.slice(0, 159)}…` : m.fix}". A record, not an instruction. Open it: memory skill, show "${m.fixKey}"`;
    }
    const say = fit([first, second].filter(Boolean).join('\n'));
    return { say: say.length <= 500 ? say : fit(first) };
  } catch { return none; }
}
