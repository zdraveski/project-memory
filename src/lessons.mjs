// Lessons (1.7.0): the switch that says which triggers speak, a note's lessons from the enforce cache, the matching of a lesson to a path
// or a command family, their order, the block Claude would see, the counters file and the session line. No hook code here: a hook
// calls these. Imports store, text, enforce and recall (never the other way round, ADR 0003).
import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, posix, isAbsolute, resolve } from 'node:path';
import { foldCase, projectsRoot, sharedStore, withLock, replaceIfUnchanged, raw, tag, keyed, local } from './store.mjs';
import { gate, PRIVATE } from './privacy.mjs';
import { sessionsOf, readSession, sessionLine } from './sessions.mjs';
import { fit } from './text.mjs';
import { notesOf, hits, familyOf } from './enforce.mjs';
import { own, userText } from './transcript.mjs';
import { cleanPath, whole, BLOCK_MAX } from './recall.mjs';
import { targetOf, errorLine, NOT_FAILURE, readMistakes } from './mistakes.mjs';
import { lessonsOn } from './switches.mjs';
import * as T from './transcript.mjs';

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
  const alive = new Map([[store, ''], [sharedStore(), '_shared/']].flatMap(([d, pre]) => (d === store && pre ? [] : notesOf(d, opts).filter((x) => x.l?.lesson && !x.l.lesson.hidden).map((x) => [`${pre}${x.file}`, x.l.lesson]))));
  const told = due.filter(([name, c]) => name.startsWith('cochange:') || (alive.has(name) && (c.rev === undefined || c.rev === revOf(alive.get(name)))));
  return { names: told.map(([name]) => name), lines: told.map(([name, c]) => `project-memory: the lesson ${name} is no longer shown (shown ${c.shown || 0}, broken ${c.broken || 0}). Fix the note or add resolved-by: to it. See: memory skill, lessons`) };
}

// F3's `rev`: what a counter was earned by. Another description, path or rule makes another lesson, with counters of its own.
export const revOf = (l) => keyed(JSON.stringify([l.to, l.when, l.instead, l.resolves, l.desc]), 8);

// The project's lessons, then the shared store's (named `_shared/<file>`, `shared: true`): [{ name, l, mtime, r }]. Left out: a note that
// is no lesson, a bad or hidden one, and one the counters say is retired (unless the note changed since: another rev).
export function lessonsFor(store, opts) {
  const keep = (x) => x.l?.lesson && !x.l.lesson.hidden;
  const out = notesOf(store, opts).filter(keep).map((x) => ({ name: x.file, l: x.l.lesson, mtime: x.mtime, r: x.r }));
  if (sharedStore() !== store) out.push(...notesOf(sharedStore(), opts).filter(keep).map((x) => ({ name: `_shared/${x.file}`, l: x.l.lesson, mtime: x.mtime, r: x.r, shared: true })));
  const { notes } = readCounters(store);
  return out.filter((x) => { const c = notes[x.name]; return !(c?.retired && (c.rev === undefined || c.rev === revOf(x.l))); });
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

// H5. The correction nudge, from the prompt hook (ctx is onPrompt's: the session file's path and the lines read before this prompt's own).
// { say, ids, why }: `say` is the text for Claude ('' for none), `why` the reason for none ('' when it fires), for `memory preview --prompt`.
// Writes a `nudge fired:` or `nudge dropped:` line (pattern ids and a filter id, never the prompt's words) unless `dry`. The cooldown: none
// within 10 prompts of the last nudge, none once 3 are in the file. The previous turn's end is read from the last 64 KB of the transcript.
export const NUDGE_TEXT = 'project-memory: this reads like a correction that should last. If it is, save it now as a feedback note: the rule, why, and applies_to (files) or applies_when (push, merge, publish, release, deploy, destroy). If it is not, ignore this.';
// correction.mjs (~45 unicode regexes, 11 ms to load) is read only once the switch is on, so a prompt with the nudge off pays nothing:
// nudgeFor is the hook's async entry, nudgeWith the same with the module in hand (the memory command is sync and imports it itself).
const noNudge = (why, ids = []) => ({ say: '', ids, why });
export async function nudgeFor(input, ctx, opts) {
  return lessonsOn('nudge') ? nudgeWith(await import('./correction.mjs'), input, ctx, opts) : noNudge('nudge is off');
}
export function nudgeWith({ correction, VERSION }, input, ctx, { dry = false, readTail } = {}) {
  const none = noNudge;
  if (!lessonsOn('nudge')) return none('nudge is off');
  const { lines, at } = ctx;
  let recs;
  const tail = () => recs ??= (() => {
    try { return [...T.records((readTail ?? T.readTail)(input.transcript_path, 64 * 1024).text, { types: ['user', 'assistant'] })]; } catch { return []; }
  })();
  // The turn's last record (a record of tool calls alone has no text and is skipped by the question check, so an older reply's ? may count: accepted), leaving out the prompt itself when the transcript already holds it.
  const last = () => { const r = tail(), i = r.length - 1; return i >= 0 && r[i].type === 'user' && T.prompt(r[i], T.text(r[i]).trim()) ? i - 1 : i; };
  const marker = () => { const r = tail()[last()], c = r?.message?.content; return r?.type === 'user' && (/^\s*\[Request interrupted by user/.test(T.text(r)) || (Array.isArray(c) && c.some((b) => b?.type === 'tool_result' && T.refused(r, b)))); };
  const lastEndsWithQuestion = () => { const r = tail().slice(0, last() + 1).findLast((x) => x.type === 'assistant' && T.text(x).trim()); return !!r && T.text(r).trim().endsWith('?'); };
  const v = correction(T.own(input.prompt), { helper: input.agent_id != null, first: !lines.some((l) => l.kind === 'asked'), marker, lastEndsWithQuestion });
  const k = 1 + lines.filter((l) => l.kind === 'nudge').length, add = (rest) => { if (!dry) try { appendFileSync(at, sessionLine('nudge', `${rest} v${VERSION} #${k}`), { mode: 0o600 }); } catch {} };
  if (!v.fire) { if (v.drop) add(`dropped:${v.drop}`); return none(v.drop || 'no match', v.ids); }
  // tidy (sessions.mjs) may collapse asked lines past 64 KB; that only makes the cooldown stricter.
  const asked = lines.flatMap((l, i) => (l.kind === 'asked' ? [i] : [])), cut = asked.length >= 10 ? asked.at(-10) : -1;
  const fired = lines.flatMap((l, i) => (l.kind === 'nudge' && l.rest.startsWith('fired:') ? [i] : []));
  if (fired.length >= 3 || fired.some((i) => i > cut)) return none('cooldown', v.ids);
  add(`fired:${v.ids.join(',')}`);
  // The turn before: the lines after the newest prompt line. A co-change lesson has no note to fix.
  const lastPrompt = lines.findLastIndex((l) => l.kind === 'asked' || l.kind === 'quiet');
  const shown = lines.slice(lastPrompt + 1).findLast((l) => l.kind === 'lesson' && l.by === '' && !parseLesson(l.rest)?.name.startsWith('cochange:') && parseLesson(l.rest));
  return { say: shown ? `${NUDGE_TEXT} The lesson ${parseLesson(shown.rest).name} was shown before this; if it did not hold, fix that note instead of writing a new one.` : NUDGE_TEXT, ids: v.ids, why: '' };
}

// L2. Whether a command of `target` went through between the last two failures of it in this turn, read from the transcript's last
// 512 KB (only when about to speak). Raw records, not turns(): turns() clears an exact re-run's earlier marks. A call with no result yet
// is the failure being reported. true: yes; false: no, or fewer than two failures show in the tail; null: the transcript will not read.
// `side`: the file is a helper's own, whose records are all sidechain.
async function wentThrough(path, target, side) {
  try {
    const { readTail, TAIL, records, text, prompt } = await import('./transcript.mjs');
    let calls = [];
    const done = new Map();
    for (const r of records(readTail(path, TAIL).text, { types: ['user', 'assistant'], sidechain: side })) {
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
    // shortcut: two failures at once (parallel calls) may both count the other as the first and both stay silent, or both speak; no lock, fine for a nudge.
    if (!turn.some((l) => theirs(l, 'fail')) || cur.some((l) => theirs(l, 'stuck'))) return none;
    // A helper's calls are in its own file next to the conversation's (<folder>/<session id>/subagents/agent-<id>.jsonl), never in the main one.
    const main = typeof input.transcript_path === 'string' ? input.transcript_path : '', sid = String(input.session_id);
    const path = !main ? '' : !by ? main : /^[\w-]+$/.test(sid) ? join(dirname(main), sid, 'subagents', `agent-${by}.jsonl`) : '';
    if (await wentThrough(path, target, !!by) !== false) return none;
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

// L13 and L4, at the Stop: each `lesson` line of this turn (main conversation) gets a verdict, f followed, b broken, n not applicable, u unknown,
// from what the turn changed and ran; the counters and `retired` follow, and one `judged` line ends it. A request that is a correction moves
// the verdicts of the turn before it to b. { say: '' } always (step 13 fills it). Never throws: the Stop's journal save is done before this.
// shortcut: a show and a command in one turn are not ordered, so "after the show" is "in the turn"; upgrade if the replay says it is too coarse.
const COUNT = { f: 'followed', b: 'broken', n: 'na', u: 'unknown' };
const fresh = (rev) => ({ rev, shown: 0, followed: 0, broken: 0, na: 0, unknown: 0, sessions: [], last: '', retired: '', told: false });
const lose = (c) => { const n = c.shown - c.na; if (n > 0 && (c.broken >= 3 || wilson(c.broken, n)[0] >= 0.25)) c.retired = `broken ${c.broken} of ${n}`; };
function judge(on, turn, cwd, rule) {
  const i = on.indexOf(':'), kind = on.slice(0, i), arg = on.slice(i + 1), ran = (turn.ran ?? []).map((c) => c.split(' → failed: ')[0]), changed = (turn.changed ?? []).map((p) => relPath(p, cwd));
  if (kind === 'pair') return changed.includes(foldCase(arg)) ? 'f' : 'u';
  if (kind === 'edit' ? !changed.includes(arg) : !ran.some((c) => familyOf(c).includes(arg))) return 'n';
  const seen = rule ? ran.map((c) => hits(rule, c)) : [];
  return seen.some((h) => h.hit) ? 'b' : seen.some((h) => h.on) ? 'f' : 'u';
}
export async function atStop(payload, seen, { now = Date.now() } = {}) {
  const none = { say: '' }, turn = seen?.got?.at(-1), s = tag(payload?.session_id);
  try {
    if (!turn || seen.quiet || turn.frozen || !['edit', 'command', 'cochange'].some((t) => lessonsOn(t)) || !/^[\w-]+$/.test(s) || PRIVATE.test(userText(turn))) return none;
    const { why, store } = gate(payload, s, 1);
    if (why) return none;
    const at = join(sessionsOf(store), s), lines = readSession(at), prompt = (l) => l.kind === 'asked' || l.kind === 'quiet';
    if (!lines) return none;
    const a = lines.findLastIndex(prompt), j = lines.findLastIndex((l) => l.kind === 'judged');
    if (lines[a]?.kind === 'quiet') return none;
    const mine = lines.slice(Math.max(a, j) + 1).filter((l) => l.kind === 'lesson' && !l.by).flatMap((l) => parseLesson(l.rest) ?? []);
    // The turn before, when it was judged and this request is a correction of it: its verdicts move to b (one already b moves nowhere).
    let moves = [];
    if (j < a) {
      const before = lines.slice(lines.findLastIndex((l, i) => i < a && prompt(l)) + 1, a).findLast((l) => l.kind === 'judged');
      moves = (before?.rest ?? '').split(',').flatMap((x) => { const [n, v] = x.split(':'); try { return COUNT[v] ? [[decodeURIComponent(n), v]] : []; } catch { return []; } });
      if (moves.length && !(await import('./correction.mjs')).correction(own(turn.raw ?? turn.ask ?? ''), { first: false, helper: false }).fire) moves = [];
    }
    if (!mine.length && !moves.length) return none;
    const found = new Map(lessonsFor(store).map((x) => [x.name, x])), cwd = String(payload.cwd ?? '').replaceAll('\\', '/');
    const revFor = (name) => (name.startsWith('cochange:') ? keyed(name, 8) : found.has(name) ? revOf(found.get(name).l) : null);
    const done = mine.map(({ name, on }) => [name, judge(on, turn, cwd, found.get(name)?.r?.rule)]);
    let touched = false;
    const saved = updateCounters(store, (c) => {
      for (const [name, v] of done) {
        const rev = revFor(name);
        if (!rev) continue;
        if (c.notes[name]?.rev !== rev) c.notes[name] = fresh(rev);
        const e = c.notes[name];
        e.shown++; e[COUNT[v]]++; e.last = local(now).slice(0, 10); e.sessions = [...e.sessions.filter((x) => x !== s), s].slice(-20);
        lose(e); touched = true;
      }
      for (const [name, v] of moves) {
        const e = c.notes[name];
        if (e && e.rev === revFor(name) && e[COUNT[v]] > 0) { e[COUNT[v]]--; e.broken++; lose(e); touched = true; }
      }
    });
    if (touched && !saved) return none;
    appendFileSync(join(sessionsOf(store), s), sessionLine('judged', done.map(([n, v]) => `${encodeURIComponent(n)}:${v}`).join(','), '', new Date(now).toISOString()), { mode: 0o600 });
  } catch {}
  return none;
}
