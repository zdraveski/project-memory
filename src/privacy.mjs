// Whether a turn or a conversation may be saved or shown, decided in one place (docs/adr/0001-privacy-decided-in-one-module.md).
// It knows the six sources -- a private turn, a private conversation, a conversation switched off, a project switched off, an off
// period and a forgotten exchange -- and the formats of the marker files they are kept in, reading and writing them.
// THE ONE RULE: a marker file that exists but cannot be read means private, for every caller. A caller may also learn that it could
// not be read, to record the failure (the Stop hook does, and throws unreadable()); none can ask for the other answer.
// Imports: Node built-ins and store.mjs only, so a hook that must start fast (the git rule) can load it. Never handoff-log,
// journal or transcript. memoryOff() (Claude Code's auto memory switch) stays in store.mjs.
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tag, projectsRoot, withLock, replaceIfUnchanged, listOf, raw, offSince, BUSY, sleep, STEP } from './store.mjs';

// A <private> block's opener, and the <private-session> mark: in any case,
// with spaces or attributes, self-closed, or as private_session. Only the
// exact forms counted, and `<private-session/>` recorded the conversation.
// An opener never closed with `>` runs to the end: `<private my pin` was saved.
export const PRIVATE = /<\s*private(?![-_\w])(?:[^>]*>|[^>]*$)/i;
// Bounded: with no `>`, 256 KB of openers took 5 s a test.
export const PRIVATE_SESSION = /<\s*private[-_]session\b[^>]{0,200}>/i;

// The conversations marked private, by tag (hushed() writes and reads them): in a store.
export const QUIET = '.private-sessions';
// The conversations held with auto memory off, kept the same way beside the projects.
export const OFF = '.memory-off';

// A project turned off (memory off): a marker in its store, {"t": ms}. A dotfile, so the snapshot's .gitignore leaves it out.
export const PROJECT_OFF = '.project-off';
// null when the project is on; else {since} (null when the marker does not read). A marker that cannot be stat'ed counts as
// there, with {unread: code}: guessing "on" would write into a project the user turned off.
export function isOff(dir) {
  const f = join(dir, PROJECT_OFF);
  try { lstatSync(f); } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? null : { since: null, unread: e.code || 'error' }; }
  try { const t = JSON.parse(readFileSync(f, 'utf8')).t; return { since: Number.isFinite(t) ? t : null }; } catch { return { since: null }; }
}
// When a project was off, one `<from ms> <to ms>` a line (memory on adds it). A transcript runs on while the marker is there, and
// its Stops and the import come later: a turn asked inside a period is never written. Tested on what a turn's own time says.
export const OFF_PERIODS = '.off-periods';
export function wasOff(dir) {
  // A read error throws: the Stop records it and writes nothing.
  const periods = listOf(raw(join(dir, OFF_PERIODS))).map((l) => l.split(' ').map(Number));
  // A turn of unknown time (NaN: its record had no timestamp) is placed in none, so it is kept out once the project has been off.
  return (t) => Number.isNaN(t.ms) ? periods.length > 0 : periods.some(([from, to]) => t.ms >= from && t.ms <= to);
}

// The conversations marked private, by tag: the newest 1,000, one per line
// (9 KB). The newest 50 let an older private conversation, resumed, be
// recorded again.
// The conversations held with auto memory off, kept the same way beside the
// projects (off(), at their start and every Stop, which make no store for
// them): the journal never records or imports them.
// What a start says in a project turned off (memory off). The only text such a project gets.
export const offLine = (o) => (o.unread
  ? `project-memory: memory is paused here because the off marker can't be read (${o.unread}). Tell the user; memory on won't help until that's fixed.`
  : `project-memory is off in this project since ${offSince(o)} (the user turned it off). Mention it if the user asks about memory; memory on turns it back on.`);
// `prune`: the tags kept beside a new one. False: not marked, or a mark that
// lost every race, unwritten. Null: unknown, the list refused three reads.
export function hushed(dir, s, mark = false, list = QUIET, prune = (have) => have.slice(-999)) {
  const p = join(dir, list);
  if (!s) return false;
  let unread;
  for (let i = 0; i < 3; i++) {
    // CRLF too: a tag with a \r left over matched no conversation, and a marked
    // one was written again.
    // A read refused (EBUSY: a scan holding the list) is no answer: read as no
    // tags, a private conversation was saved as public (F12). Held for a moment, it is read again after a pause, as the store's other
    // retries do: three reads in the same instant all met the hold (release review). None after the last, none for a folder.
    let before = null;
    try { before = readFileSync(p, 'utf8'); unread = false; } catch (e) { unread = e.code !== 'ENOENT'; if (i < 2 && BUSY.includes(e.code)) sleep(STEP); }
    if (unread) continue;
    const have = listOf(before);
    if (!mark || have.includes(s)) return have.includes(s);
    // By rename: written in place, a hook killed mid-write forgot every mark.
    // Again, from the text read, when another wrote first.
    if (replaceIfUnchanged(p, before, [...prune(have), s].join('\n') + '\n') !== 'conflict') return true;
  }
  return unread ? null : false;
}
// What a writer throws when hushed() answers unknown, after changing nothing.
export const unreadable = (dir, list) => new Error(`${join(dir, list)} could not be read`);

// The tags of the transcripts in every project folder; null when one won't list.
function onDisk(root) {
  const all = new Set();
  try {
    for (const f of readdirSync(root)) {
      let ns = []; try { ns = readdirSync(join(root, f)); } catch (e) { if (e.code !== 'ENOTDIR') return null; }
      for (const n of ns) if (n.endsWith('.jsonl')) all.add(tag(n));
    }
  } catch { return null; }
  return all;
}
// A conversation held with auto memory off, into OFF. Under the projects'
// lock: 24 memory-off Stops at once, with no lock, lost 46 tags of 96 (P1
// hunt, 2026-10-29). Pruned by the transcripts still on disk, as the
// journal's list is: the newest 1,000 anywhere evicted a quiet project's tags,
// and its conversations were imported. The newest OFF_NEW stay whatever: a
// transcript is made with its first message, after its start wrote the tag.
// False when the tag is not there. A list that won't read throws, after
// writing nothing, so the Stop records it: swallowed, the conversation stayed
// untagged, nothing said so, and once the list read the journal took it in (R67).
const OFF_NEW = 100, OFF_MOST = 10_000;
export function off(input) {
  const root = projectsRoot(), s = tag(input.session_id || basename(String(input.transcript_path || ''), '.jsonl'));
  return withLock(root, () => {
    const r = hushed(root, s, true, OFF, (have) => {
      const live = onDisk(root);
      return have.filter((t, i) => !live || live.has(t) || i >= have.length - OFF_NEW).slice(-OFF_MOST);
    });
    if (r === null) throw unreadable(root, OFF);
    return r;
  }) === true;
}

// The exchanges forget took out, `<key>\t<folder>/<session>\t<time>` a line
// (journal.mjs writes it; an older line is its key alone). Trimmed: an
// editor's CRLF, or a space left after a line, is still the line.
export const FORGOTTEN = join('journal', '.forgotten');
export const forgotten = (text) => listOf(text).map((l) => l.split('\t'));
