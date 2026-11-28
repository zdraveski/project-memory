// The session file (1.6.0 spec, "The session file"): its line format, where it lives, how it is read, cut down, swept and
// deleted, and which sessions it says are live. The journal, the briefing, the memory command and the recall hooks import it.
// Imports store.mjs and privacy.mjs only, so a hook that loads it stays small.
import { readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { projectsRoot } from './store.mjs';
import { isHushed, QUIET } from './privacy.mjs';

// One per conversation, outside the store, so no fingerprint, snapshot or status sees it. Append-only,
// `<kind> <ISO time> [agent:<helper id>] <rest>` a line. Kinds: `file` (a path the conversation changed, as recall.mjs's
// cleanPath has it), `told` (an entry key it was shown), `compact`, `asked`, `quiet`, `title`, `saw`, `end`, `late` (a path
// whose pointer look-up gave up), `fail` (a failed Bash or PowerShell command: two hashes, 1.7.0 L2) and `stuck` (its streak was named, once a context).
export const SESSIONS = '.sessions';
export const sessionsOf = (store) => join(projectsRoot(), SESSIONS, basename(dirname(store)));
const LINE = /^(\S+) (\S+)(?: agent:([\w-]{1,64}))?(?: (.*))?$/;
// The lines, oldest first; [] when there is no file, null when one is there and will not read: it may hold a private turn's mark.
export function readSession(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { return e.code === 'ENOENT' ? [] : null; }
  return text.split('\n').flatMap((l) => { const m = LINE.exec(l); return m ? [{ kind: m[1], at: m[2], by: m[3] ?? '', rest: m[4] ?? '' }] : []; });
}
export const sessionLine = (kind, rest = '', by = '', at = new Date().toISOString()) => `${kind} ${at}${by ? ` agent:${by}` : ''}${rest ? ` ${rest}` : ''}\n`;
// Every deletion goes through here: one conversation's file (`s`), a project's (`store`), or every project's (neither). forget,
// off and rescan take a project's or all, incognito and a private-session mark (journal.takeBack) one. Never throws: true, or the Error.
export function dropSessions(store, s) {
  const p = !store ? join(projectsRoot(), SESSIONS) : s ? join(sessionsOf(store), s) : sessionsOf(store);
  try { rmSync(p, { recursive: true, force: true }); return true; } catch (e) { return e; }
}
// The save after a reply: session files untouched for 7 days go, in every project (a project never opened again keeps none).
export const WEEK = 7 * 864e5;
export function sweepSessions(now = Date.now()) {
  const root = join(projectsRoot(), SESSIONS);
  let n = 0;
  try {
    for (const d of readdirSync(root)) for (const f of readdirSync(join(root, d))) try {
      if (statSync(join(root, d, f)).mtimeMs < now - WEEK) { rmSync(join(root, d, f), { force: true }); n++; }
    } catch {}
  } catch {}
  return n;
}
// The prompt hook rewrites a file grown too big (recall.mjs's SESSION_MAX) to this: the newest line of each kind and path (or
// key) stays, in order. Only the prompt hook rewrites: a line another hook appends in that instant can be lost, and the cost is
// one repeated pointer.
const ONE = new Set(['asked', 'quiet', 'title', 'compact', 'end']);
export const tidy = (lines) => {
  const id = (l) => `${l.kind} ${l.by} ${ONE.has(l.kind) ? '' : l.rest}`, last = new Map(lines.map((l, i) => [id(l), i]));
  return lines.filter((l, i) => last.get(id(l)) === i).map((l) => sessionLine(l.kind, l.rest, l.by, l.at)).join('');
};

// Headline 4, sessions that see each other. ACTIVE is the plugin's one window for a session still working: here by the newest
// line of its session file (not `end`), in handoff-log, the journal and the briefing by its transcript's last change.
export const ACTIVE = 30 * 60e3;
// The other live sessions of `store`, but `me`: { s, lines, since }, `since` the first line of its live run (no gap over ACTIVE,
// no `end`). Only files changed within ACTIVE are opened. Never a conversation marked private (one try; unknown is private).
export function others(store, me = '', now = Date.now()) {
  const dir = sessionsOf(store), out = [];
  let names = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const s of names) {
    if (s === me || !/^[\w-]+$/.test(s)) continue;
    try { if (now - statSync(join(dir, s)).mtimeMs > ACTIVE) continue; } catch { continue; }
    const lines = readSession(join(dir, s)), last = lines?.at(-1);
    if (!last || last.kind === 'end' || now - Date.parse(last.at) > ACTIVE || isHushed(store, s, QUIET, 1)) continue;
    let i = lines.length - 1;
    while (i > 0 && lines[i - 1].kind !== 'end' && Date.parse(lines[i].at) - Date.parse(lines[i - 1].at) <= ACTIVE) i--;
    out.push({ s, lines, since: lines[i].at });
  }
  return out;
}
