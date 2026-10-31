// The work journal: one file per day under <store>/journal/, one entry per
// turn, kept apart from handoff.md so what was done last month is still
// findable. Entries are capped and redacted here, the one place a turn's
// files and commands (uncapped in turns()) are shortened.
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { isUtf8 } from 'node:buffer';
import { clip, tag, userText, PRIVATE, PRIVATE_SESSION, FORGETS, norm, hash, turns, hushed, unsay, FORGOTTEN, forgotten, ACTIVE, OFF, TAIL } from './handoff-log.mjs';
import { replaceIfUnchanged, raw, listOf, local, storeOf, projectsRoot, same, pathKey, transcriptKey, inProjects, withLock } from './store.mjs';

export const JOURNAL = 'journal';
export const J_ASK = 2000;     // chars of what was asked
export const J_ANSWER = 6000;  // chars of the reply; a longer one keeps its start and its end
export const J_TAIL = 2000;    // ...the end: a reply's end says what was done and why
export const J_FILES = 20;     // files an entry names: the turn's last
export const J_RAN = 20;       // commands an entry names: the turn's last
export const J_CMD = 400;      // chars of one command
export const J_BRANCH = 100;   // chars of a branch name: any real one whole, a pasted text in one cut
export const J_PATH = 300;     // chars of one file path: Windows' 260-character limit fits whole
// A Stop imports old conversations for this long, holding the store's lock,
// then leaves the rest to the next: a month of them can be a gigabyte.
export const IMPORT_BUDGET_MS = 150;
// The most of a transcript one read holds, and so the longest line read: the
// lock is held a segment past the budget, and one tool result can be 70 MB.
// A longer line (a tool's output: no prompt or reply is that long) is passed
// over unread.
export const IMPORT_SEGMENT = 64 * 1024 * 1024;
// The most turns one look imports from a transcript, the rest at the next: a
// segment of 49,053 short turns (a long /loop) held the lock 18 s, and a
// parallel session's handoff was skipped (P1 hunt, 2026-10-29).
export const IMPORT_TURNS = 500;
// A transcript that would not open is tried again this long after, grown or not.
const RETRY = 24 * 3600e3;

const MARK = /^<!-- j:(.+) t:(.*) d:(\d{4}-\d\d-\d\d) -->$/;
// The `·` read in any spelling (`Â·`): a day re-saved whole by an editor that
// took it for the code page lost every heading, and a sweep matched nothing.
const HEAD = /^## (\d\d:\d\d) \S{1,4} conversation (\S*?)(?: \S{1,4} branch (.*))?$/;
const TIME = /^\d{4}-\d\d-\d\d \d\d:\d\d$/;
const FIELDS = ['Asked', 'Answered', 'Changed', 'Ran'];   // as render() writes them, after the heading
const day = (at) => at.slice(0, 10);

// Before a day file is rewritten: one with a byte that is no UTF-8 (a note
// added in the Windows code page, as PowerShell 5.1's Add-Content writes) was
// read as U+FFFD and written back, its letters gone for good. It is left as
// it is, and the write that needed it fails, so status says why.
const UTF8 = new TextDecoder('utf-8', { fatal: true });
function utf8Only(file, text) {
  if (text?.includes('\uFFFD')) try { UTF8.decode(readFileSync(file)); } catch { throw Object.assign(new Error(`${file} is not UTF-8 text, so it was left as it is; save it as UTF-8`), { code: 'not UTF-8' }); }
}
// Each day's work, a day that throws (not UTF-8, a folder by its name) after
// the rest: one bad file must not keep the others from a write or a sweep.
function each(ds, fn) {
  let bad = null;
  for (const d of ds) try { fn(d); } catch (e) { bad = e; }
  if (bad) throw bad;
}

// A path inside the turn's folder reads shorter relative to it. In any case
// only where the disk ignores case (Windows, macOS): on Linux /home/USER is
// not /home/user (final review).
const fold = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
const rel = (p, cwd) => {
  const c = cwd ? cwd.replace(/[\\/]+$/, '') : '';
  return c && p.length > c.length + 1 && /[\\/]/.test(p[c.length]) && fold(p.slice(0, c.length)) === fold(c) ? p.slice(c.length + 1) : p;
};

// A reply over the cap keeps its first J_ANSWER - J_TAIL characters and its
// last J_TAIL. Redacted whole first, so no half of a key is left at either
// cut; and no half of an emoji, which reads back as U+FFFD, matches nothing,
// and was written again every Stop.
const reply = (s) => {
  const t = clip(s, Infinity);
  return t.length > J_ANSWER ? `${t.slice(0, J_ANSWER - J_TAIL).replace(/[\uD800-\uDBFF]$/, '')} … ${t.slice(-J_TAIL).replace(/^[\uDC00-\uDFFF]/, '')}` : t;
};

// `when`: the time of a turn whose own won't parse (a transcript another tool
// wrote): NaN-NaN-Na.md was its day file, which nothing lists or sweeps.
export function entryOf(turn, transcriptPath, when = local()) {
  const s = tag(basename(transcriptPath, '.jsonl'));
  // Every command, before the cap: a forget among a turn's first ones counts.
  const forgets = turn.ran.some((c) => FORGETS.test(c));
  const quiet = forgets || PRIVATE.test(userText(turn));
  return {
    key: turn.id || `${s} ${turn.at} ${hash(turn.raw ?? turn.ask).slice(0, 12)}`,
    at: TIME.test(turn.at) ? turn.at : when, s,
    t: transcriptKey(transcriptPath),
    branch: clip(turn.branch || '', J_BRANCH),
    asked: forgets ? '[private]' : clip(turn.ask, J_ASK),
    answered: quiet ? '[private]' : reply(turn.did),
    changed: quiet ? [] : turn.changed.slice(-J_FILES).map((p) => clip(rel(p, turn.cwd), J_PATH)),
    ran: quiet ? [] : turn.ran.slice(-J_RAN).map((c) => clip(c, J_CMD)),
  };
}

// shortcut: files joined by ", " and commands by " · " -- one containing its
// separator reads back as two; upgrade if a search ever needs them whole.
export const render = (e) => [
  `<!-- j:${e.key} t:${e.t} d:${day(e.at)} -->`,
  `## ${e.at.slice(11)} · conversation ${e.s}${e.branch ? ` · branch ${e.branch}` : ''}`,
  `**Asked:** ${e.asked}`,
  `**Answered:** ${e.answered}`,
  ...(e.changed.length ? [`**Changed:** ${e.changed.join(', ')}`] : []),
  ...(e.ran.length ? [`**Ran:** ${e.ran.join(' · ')}`] : []),
].join('\n');

// An entry is its marker and the field lines under it. A blank line keeps it
// open: a Markdown formatter puts one after the marker and the heading, and
// every entry of a day saved through one was read as prose. Any other line (a
// note someone wrote, a marker that won't parse) is prose, kept with the entry
// above it (`after`), or on top before the first: all of a day's notes went to
// the top at its next write, apart from what each was about.
export function parseDay(text) {
  const prose = [], entries = [];
  let e = null, last = -1;
  // An editor saves CRLF or a BOM: handoff.md lost its entries to both.
  for (const line of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^# Journal \d{4}-\d\d-\d\d\n*/, '').split('\n')) {
    const m = MARK.exec(line);
    if (m) { e = { key: m[1], at: `${m[3]} 00:00`, s: '', t: m[2], branch: '', asked: '', answered: '', changed: [], ran: [] }; last = -1; entries.push(e); continue; }
    if (e && !line.trim()) continue;
    const h = e && HEAD.exec(line), f = e && !h && /^\*\*(Asked|Answered|Changed|Ran):\*\* ?(.*)$/.exec(line);
    // In render order, each once: a note shaped like a field, written under an
    // entry, was read as that field, and the next write lost the note.
    const at = h ? 0 : f ? FIELDS.indexOf(f[1]) + 1 : -1;
    if (at > last && h) { last = at; e.at = `${e.at.slice(0, 10)} ${h[1]}`; e.s = h[2]; e.branch = h[3] ?? ''; }
    else if (at > last) {
      last = at;
      const [, k, v] = f;
      if (k === 'Asked') e.asked = v; else if (k === 'Answered') e.answered = v;
      else if (k === 'Changed') e.changed = v ? v.split(', ') : []; else e.ran = v ? v.split(' · ') : [];
    } else { e = null; const up = entries.at(-1); (up ? (up.after ??= []) : prose).push(line); }
  }
  for (const x of entries) if (x.after) x.after = x.after.join('\n').trim();
  return { prose: prose.join('\n').trim(), entries };
}

export const dayFile = (dir, at) => join(dir, JOURNAL, day(at) + '.md');
const page = (d, prose, es) => `# Journal ${d}\n\n` + [prose, ...es.flatMap((e) => [render(e), e.after])].filter(Boolean).join('\n\n') + '\n';

// Call under withLock(dir). Returns how many entries were added or changed.
// `when`: entryOf's, for a turn whose time won't parse. `gone`: the keys forget
// removed (FORGOTTEN, handoff-log's, which keeps them out of handoff.md too):
// a backfill reads a quiet conversation again once it grows, and would bring a
// forgotten entry back.
export function record(dir, transcriptPath, turns, when) {
  const byDay = new Map(), gone = new Set(forgotten(raw(join(dir, FORGOTTEN))).map(([k]) => k));
  for (const t of turns) {
    const e = entryOf(t, transcriptPath, when), d = day(e.at);
    if (gone.has(e.key)) continue;
    byDay.set(d, [...(byDay.get(d) || []), e]);
  }
  let n = 0;
  each(byDay.keys(), (d) => {
    const file = dayFile(dir, d), fresh = byDay.get(d);
    let added = null;
    mkdirSync(join(dir, JOURNAL), { recursive: true });
    for (let i = 0; i < 3; i++) {
      const before = raw(file);
      const { prose, entries } = parseDay(before ?? '');
      const have = new Map(entries.map((e) => [e.key, e])), novel = new Set(fresh.filter((e) => !have.has(e.key)).map((e) => e.key));
      let changed = 0;
      for (const e of fresh) {
        const was = have.get(e.key);
        if (!was || render(was) !== render(e)) changed++;
        have.set(e.key, was?.after ? { ...e, after: was.after } : e);
      }
      // Nothing new: no write, so a day not in UTF-8 is no failure of this one.
      if (!changed) break;
      const all = [...have.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      utf8Only(file, before);
      const w = replaceIfUnchanged(file, before, page(d, prose, all));
      if (w !== 'conflict') { n += changed; added = novel; break; }
    }
    // A key new here leaves the days beside it: dated again after a time-zone
    // change (a backfill of a grown conversation), a turn was a day off, and
    // in both (final review). After the write: killed between, it is twice, not gone.
    // Only a clean-up: a day beside it that won't read (a folder, held open) keeps
    // the copy; thrown, a Stop whose write landed showed "last write failed".
    if (added?.size) for (const k of [-1, 1]) {
      try { drop(dir, new Date(Date.parse(d) + k * 864e5).toISOString().slice(0, 10), (e) => !added.has(e.key)); } catch {}
    }
  });
  pin(dir);
  return n;
}

// journal.md is the note tiering gives a pinned index line, as it does handoff.md.
// Written once, never again: tiering builds the index line from its description
// only when it recovers it, so a rewrite would not reach the index, and a hand
// edit stays. A failure costs the pin, never the entry just recorded.
function pin(dir) {
  const file = join(dir, 'journal.md');
  try {
    if (raw(file) == null) replaceIfUnchanged(file, null, `---\nname: journal\ndescription: "Every exchange in this project, one file per day in journal/; search it before saying something was never done or decided"\nmetadata:\n  node_type: memory\n  type: reference\n  tier: hot\n---\n\nproject-memory writes one entry here after every reply: what was asked, what was answered, the files changed and the commands run. Search it with the memory skill (\`search <words>\`, \`--since\`/\`--until YYYY-MM-DD\`).\n`);
  } catch {}
}

export function days(dir) {
  try { return readdirSync(join(dir, JOURNAL)).filter((f) => /^\d{4}-\d\d-\d\d\.md$/.test(f)).map((f) => f.slice(0, 10)).sort(); }
  catch { return []; }
}

// The entries of the days in range (bounds inclusive, either optional). Only
// those days' files are opened: a year of journal is ~30 MB. A day that will
// not read goes in `failed`: passed over in silence, its work read as never done.
// So does one not in UTF-8: saved as UTF-16 (PowerShell 5.1's Out-File), it
// parsed as a day with no entry (final review).
export const entries = (dirs, { since, until, failed = [] } = {}) => dirs.flatMap((dir) => days(dir).filter((d) => (!since || d >= since) && (!until || d <= until))
  .flatMap((d) => {
    const path = dayFile(dir, d);
    try {
      const text = raw(path) ?? '';
      try { utf8Only(path, text); } catch (e) { failed.push({ path, code: e.code }); }
      return parseDay(text).entries.map((e) => ({ ...e, day: d, path, dir }));
    } catch (e) { failed.push({ path, code: e.code || e.message }); return []; }
  }));

// Day d without the entries `keep` refuses; its prose stays. Call under
// withLock(dir). Returns the entries that went: none when the day changed
// under each of three writes. A day left with nothing goes: kept as its
// heading, every later status and briefing read it to find it empty.
function drop(dir, d, keep) {
  const file = dayFile(dir, d);
  for (let i = 0; i < 3; i++) {
    const before = raw(file), p = parseDay(before ?? ''), entries = p.entries, kept = [];
    let prose = p.prose;
    // A note goes up to the entry before when its own goes: it is the user's.
    for (const e of entries) {
      if (keep(e)) kept.push(e);
      else if (e.after) { const up = kept.at(-1); if (up) up.after = [up.after, e.after].filter(Boolean).join('\n\n'); else prose = [prose, e.after].filter(Boolean).join('\n\n'); }
    }
    if (kept.length === entries.length) return [];
    utf8Only(file, before);
    if (replaceIfUnchanged(file, before, page(d, prose, kept)) === 'conflict') continue;
    if (!kept.length && !prose) try { unlinkSync(file); } catch {}
    return entries.filter((e) => !keep(e));
  }
  return [];
}

// A conversation marked private takes back what it wrote: its entries go from
// every day (`ds`: the days owed). Not from the day it began on: worked out
// again after a time-zone change, that was a day late, and its first day
// stayed. Once a conversation. Call under withLock(dir). Returns how many
// went; throws, once the days it stopped short of are owed, an error marked `owed`.
export function sweep(dir, s, ds = days(dir)) {
  let n = 0, bad = null;
  const left = ds.filter((d) => { try { n += drop(dir, d, (e) => e.s !== s).length; return false; } catch (e) { bad = e; return true; } });
  owe(dir, s, ds, left);
  if (bad) throw Object.assign(bad, { owed: true });
  return n;
}

// The days a sweep stopped short of (not in UTF-8), `<tag> <day>` a line,
// swept again at every write and every look until it goes through: the mark
// is read once, and a private conversation's entries stayed (R33). Only those
// days: an owed sweep of every day, at every Stop, took 1.4-1.7 s for three
// on a year of journal (review, 2026-10-29).
const SWEEPS = '.sweeps';
function owe(dir, s, ds, left) {
  const f = join(dir, JOURNAL, SWEEPS), before = raw(f);
  if (before == null && !left.length) return;
  const tried = new Set(ds.map((d) => `${s} ${d}`)), next = [...listOf(before).filter((l) => !tried.has(l)), ...left.map((d) => `${s} ${d}`)];
  if (next.length) replaceIfUnchanged(f, before, next.join('\n') + '\n');
  else try { unlinkSync(f); } catch {}
}
// The sweeps owed, each tried on its days; throws while one still stops short. Returns how many.
function resweep(dir) {
  const owed = new Map();
  for (const l of listOf(raw(join(dir, JOURNAL, SWEEPS)))) { const [s, d] = l.split(' '); owed.set(s, [...(owed.get(s) ?? []), d]); }
  each(owed, ([s, ds]) => sweep(dir, s, ds));
  return owed.size;
}

// The entries with every term (any case) in one of their fields, in the range,
// of the conversation when one is given. With apply they go, under the store's
// lock (null when it stayed busy); their keys are listed first, so a forget
// killed half-way leaves entries no record brings back. `removed`: the matches
// that went, fewer when a day kept changing under the write (its keys listed
// all the same). `keys`: only those entries, the ones a search showed. They go
// from handoff.md too, which the next startup's briefing prints (R36).
// An entry holds a word (lower case) when any of its fields does, in any case.
export const holds = (e, t) => [e.asked, e.answered, e.branch, ...e.changed, ...e.ran].some((v) => v.toLowerCase().includes(t));
export function forget(dir, terms, { since, until, conversation, keys: only, apply = false, failed = [] } = {}) {
  // The keys as a set: looked up in the list once an entry, a range forget of
  // 15,000 entries spent 5 s here.
  const ts = terms.map((t) => t.toLowerCase()), want = only && new Set(only);
  const matched = entries([dir], { since, until, failed }).filter((e) => (!conversation || e.s === conversation) && (!want || want.has(e.key)) &&
    ts.every((t) => holds(e, t)));
  if (!apply || !matched.length) return { matched, removed: [] };
  const keys = new Set(matched.map((e) => e.key)), f = join(dir, FORGOTTEN), seen = new Map();
  // Listed only while its transcript is on disk: one gone is never read
  // again, so nothing brings its entry back, and forgetting everything listed
  // every key, read at every Stop (final review). A line with no transcript
  // (older) stays; so does one whose stat fails but for its absence.
  const there = (t) => { try { statSync(join(projectsRoot(), `${t}.jsonl`)); return true; } catch (e) { return e.code !== 'ENOENT'; } };
  const live = ([, t]) => !t || (seen.has(t) ? seen.get(t) : seen.set(t, there(t)).get(t));
  return withLock(dir, () => {
    for (let i = 0; i < 3; i++) {
      const before = raw(f), lines = new Map([...forgotten(before), ...matched.map((e) => [e.key, e.t, e.at])].filter(live).map((l) => [l[0], l.join('\t')]));
      if (replaceIfUnchanged(f, before, [...lines.values()].map((l) => l + '\n').join('')) !== 'conflict') break;
    }
    // A day that won't be written (not UTF-8, read-only, held open) keeps its
    // entries and is named: thrown, the days after it went untried.
    const went = new Set([...new Set(matched.map((e) => e.day))].flatMap((d) => {
      try { return drop(dir, d, (e) => !keys.has(e.key)).map((e) => e.key); }
      catch (e) { failed.push({ path: dayFile(dir, d), code: e.code || e.message, write: true }); return []; }
    }));
    // By conversation and minute, as handoff.md keeps them: two exchanges of
    // one minute go together.
    const at = new Set(matched.map((e) => `${e.s} ${e.at}`));
    try { unsay(dir, (t) => at.has(`${t.s} ${t.at}`)); } catch (e) { failed.push({ path: join(dir, 'handoff.md'), code: e.code || e.message, write: true }); }
    return { matched, removed: matched.filter((e) => went.has(e.key)) };
  });
}

// A throw kept in .failed for `status` to report: swallowed, the journal would
// stop and nothing say so. `from` names the writer when it is not the sink.
// One line a writer, the newest first: each writes and clears its own only.
// The next reply's write cleared a backfill that kept failing, and a failed
// backfill overwrote the live write's failure: status said nothing of either.
const FAILED = '.failed';
const own = (text, backfill) => (text ?? '').split(/\r?\n/).filter((l) => l && l.includes('"error":"backfill: ') === backfill);
function fault(dir, e, from = '') {
  const f = join(dir, JOURNAL, FAILED);
  try {
    mkdirSync(join(dir, JOURNAL), { recursive: true });
    const before = raw(f), line = JSON.stringify({ at: new Date().toISOString(), error: from + String(e.message).split('\n')[0] });
    replaceIfUnchanged(f, before, [line, ...own(before, !from)].join('\n') + '\n');
  } catch {}
}
function clear(dir, backfill) {
  const f = join(dir, JOURNAL, FAILED), before = raw(f), left = own(before, !backfill);
  if (before == null) return;
  if (left.length) replaceIfUnchanged(f, before, left.join('\n') + '\n');
  else try { unlinkSync(f); } catch {}
}

// The conversations a live Stop looked at past its read for a mark,
// `<folder>/<session> <bytes>` (how far), and those a Stop or a look swept
// out (private, or held with auto memory off), ` swept` after. Pruned as
// .imported is.
const CHECKED = '.checked';
// Its line: `swept` in [4], the bytes looked at in [2].
function checked(dir, k) {
  for (const l of (raw(join(dir, JOURNAL, CHECKED)) ?? '').split(/\r?\n/)) { const m = LINE.exec(l); if (m && pathKey(m[1]) === pathKey(k)) return m; }
  return null;
}

// What a conversation private or held with auto memory off has in the journal
// goes, from every day, and a private one's (`priv`) from handoff.md (first:
// a sweep a day stops short of throws, and is owed). Once, ` swept` written
// after it (a kill mid-sweep sweeps again), and after one that stopped short:
// its days owed are retried alone, and swept whole again, each of its Stops
// read every day. Again when `again`.
function takeBack(dir, k, s, again = false, priv = false) {
  if (!again && checked(dir, k)?.[4] === 'swept') return;
  if (priv) unsay(dir, (t) => t.s === s);
  let owed = null;
  try { sweep(dir, s); } catch (e) { if (!e.owed) throw e; owed = e; }
  mark(dir, [`${k} 0 swept`], null, CHECKED);
  if (owed) throw owed;
}

// What a Stop's read of its conversation does to the journal (importOne does
// the same for an import). Call under withLock(dir). False when nothing was
// tried for this read's sake: a conversation private or memory-off already.
function take(dir, transcriptPath, got, { quiet, hush }) {
  const s = tag(basename(transcriptPath, '.jsonl')), k = transcriptKey(transcriptPath), was = checked(dir, k), f = basename(dirname(transcriptPath));
  // Its folder first, a quiet one's too: in a folder no look listed, its
  // ` swept` line went at every look, and it was swept again at each.
  if (!near(dir, f) && inProjects(transcriptPath)) noteFolder(dir, f);
  // Private, or held with auto memory off once: never recorded, and what it
  // has in the journal goes at its first such Stop, not only at the one whose
  // read holds the mark. Marked by a writer with no sink (the compaction gate),
  // it kept its entries, and so did one imported before its memory-off tag
  // (P1 hunt, 2026-10-29). Resumed with memory on, a memory-off conversation's
  // first Stop journaled every turn (review, 2026-10-29).
  if (quiet || hushed(projectsRoot(), s, false, OFF)) { takeBack(dir, k, s, hush); return hush; }
  // A read short of the whole transcript: what no look has read is looked at
  // for a mark, from where the last stopped, once more has come since than
  // any Stop's read covers (TAIL). A mark typed in a turn that got no Stop,
  // then 512 KB of a tool's output, was never read, and the conversation was
  // journaled and committed (P1 hunt, 2026-10-29); looked at once only, so
  // was a mark typed after the look (review, 2026-10-29).
  // One swept is looked at too: its tag lost from the list, its mark past the read was missed (F6).
  const from = Number(was?.[2] ?? 0);
  if (got.whole === false && statSync(transcriptPath).size - from > TAIL) {
    const fd = openSync(transcriptPath, 'r');
    let size, hit;
    try { size = fstatSync(fd).size; hit = marked(fd, from, IMPORT_SEGMENT, size).hit; } finally { closeSync(fd); }
    if (hit) { hushed(dir, s, true); takeBack(dir, k, s, true); return true; }
    mark(dir, [`${k} ${size}`], null, CHECKED);
  }
  record(dir, transcriptPath, got);
  return true;
}

// Folders not named like the store's own where a live Stop recorded a
// conversation that storeOf brings here (a worktree outside the repository's
// folder): the import looks in them too. 27 of one machine's transcripts were
// in one and never imported (R30).
const FOLDERS = '.folders';
const near = (dir, f) => { const me = pathKey(basename(dirname(dir))); return pathKey(f) === me || pathKey(f).startsWith(me + '-'); };
const folders = (dir) => listOf(raw(join(dir, JOURNAL, FOLDERS)));
// The list as `edit` makes it of the one there; given back the same, no write.
function refold(dir, edit) {
  const file = join(dir, JOURNAL, FOLDERS);
  mkdirSync(join(dir, JOURNAL), { recursive: true });
  for (let i = 0; i < 3; i++) {
    const before = raw(file), have = listOf(before), next = edit(have);
    if (next === have || replaceIfUnchanged(file, before, next.map((f) => f + '\n').join('')) !== 'conflict') return;
  }
}
const noteFolder = (dir, f) => refold(dir, (have) => (have.some((h) => pathKey(h) === pathKey(f)) ? have : [...have, f]));

// handoff()'s sink, called under its lock. A sweep still owed keeps its
// failure until it goes through.
export function write(dir, transcriptPath, got, opts) {
  try { const did = take(dir, transcriptPath, got, opts); resweep(dir); if (did) clear(dir, false); }
  catch (e) { fault(dir, e); }
}

// What the backfill has read: `<folder>/<session> <bytes>`, one line a
// transcript, its bytes all looked at for a mark; ` at <offset>` while it is
// imported only up to there (the next segment's start), ` other` when it is
// another store's, ` failed <ms>` when it won't open. `keep`: the transcripts
// still on disk; any other line goes.
const IMPORTED = '.imported', LOOKED = '.looked';
const LINE = /^(.+?) (\d+)(?: at (\d+)| (\w+)(?: (\d+))?)?$/;
const FAILING = / \d+ failed\b/;
// By pathKey, as `keep` (a look's `seen`) holds them: a Stop's line spelt the
// folder as its payload did, a look's listing as the disk does, and the look
// dropped the Stop's ` swept`, so every look swept that conversation again.
function mark(dir, lines, keep = null, list = IMPORTED) {
  const key = (l) => { const k = LINE.exec(l)?.[1]; return k && pathKey(k); };
  const f = join(dir, JOURNAL, list), ks = new Set(lines.map(key));
  mkdirSync(join(dir, JOURNAL), { recursive: true });
  for (let i = 0; i < 3; i++) {
    const before = raw(f), kept = (before ?? '').split(/\r?\n/).filter((l) => { const k = key(l); return l && !ks.has(k) && (!keep || keep.has(k)); });
    if (replaceIfUnchanged(f, before, [...kept, ...lines].join('\n') + '\n') !== 'conflict') return;
  }
}

// The transcripts a backfill would read, oldest first. Only in the store's own
// folder, its subfolders' (`<folder>-*`) and the folders a live Stop noted:
// the head of every project's transcripts, read every Stop, would be hundreds
// of reads. Only quiet ones: a
// conversation still running is its own Stop's to journal, and its last reply
// may not be in its transcript yet. One listed is read again once it grew
// (turns a live write missed), from where it was read up to; one imported in
// part goes on from there; a known one costs no read of its head. `from`:
// where its import goes on; `looked`: the bytes looked at for a mark. `seen`:
// every transcript the folders hold; `mine`: the folders holding one not
// listed as another store's.
// shortcut: a worktree folder no live Stop has recorded in yet is not looked
// in; scan every project folder's first cwd if one is ever missed.
function candidates(dir, skip) {
  const root = projectsRoot(), noted = new Set(folders(dir).map(pathKey)), done = new Map(), theirs = new Set(), out = [];
  // Another's or one that won't open: up to its size, from nothing read. One
  // ` partial` (before R24 only its last 64 MB was read): nothing read either,
  // or its start was never imported.
  // One that failed to open a day ago or more is tried again, grown or not: a
  // transcript held open a moment (EBUSY), or a look out of handles (EMFILE),
  // was never imported.
  for (const m of (raw(join(dir, JOURNAL, IMPORTED)) ?? '').split(/\r?\n/).map((l) => LINE.exec(l))) {
    const retry = m?.[4] === 'failed' && !(Math.abs(Date.now() - Number(m[5])) < RETRY);
    if (m?.[4] === 'other') theirs.add(m[1]);
    if (m && m[4] !== 'partial' && !retry) done.set(m[1], m[4] ? { upto: Number(m[2]), from: 0, looked: 0 } : { upto: Number(m[3] ?? m[2]), from: Number(m[3] ?? m[2]), looked: Number(m[2]) });
  }
  // A listing that fails leaves `seen` null, so nothing is pruned: read as
  // empty, it would drop the lines of every transcript in it.
  out.seen = new Set(); out.mine = new Set();
  let looks = []; try { looks = readdirSync(root).filter((f) => f !== '_shared' && (near(dir, f) || noted.has(pathKey(f)))); } catch { out.seen = null; }
  for (const f of looks) {
    let names = []; try { names = readdirSync(join(root, f)).filter((n) => n.endsWith('.jsonl')); } catch { out.seen = null; }
    for (const n of names) {
      const p = join(root, f, n), k = transcriptKey(p);
      out.seen?.add(pathKey(k));
      if (!theirs.has(k)) out.mine.add(pathKey(f));
      if (typeof skip === 'string' && same(p, skip)) continue;
      let st; try { st = statSync(p); } catch { continue; }
      const was = done.get(k) ?? { upto: -1, from: 0, looked: 0 };
      if (Math.abs(Date.now() - st.mtimeMs) < ACTIVE || st.size <= was.upto) continue;
      out.push({ p, k, size: st.size, m: st.mtimeMs, from: was.from, looked: was.looked });
    }
  }
  return out.sort((a, b) => a.m - b.m);
}
const ours = (dir, p) => same(storeOf({ transcript_path: p }), dir);

// Past the line that runs on at `pos`: its newline found in 1 MB reads, never decoded.
function past(fd, pos, size) {
  const buf = Buffer.allocUnsafe(1 << 20);
  for (; pos < size; pos += buf.length) {
    const i = buf.subarray(0, readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos)).indexOf(10);
    if (i !== -1) return pos + i + 1;
  }
  return size;
}

// The whole lines in the `seg` bytes from `pos`, and where they start (`pos`):
// a line longer than `seg` is passed over unread. null at the end.
function chunk(fd, pos, seg, size) {
  while (pos < size) {
    const buf = Buffer.allocUnsafe(Math.min(seg, size - pos)), n = readSync(fd, buf, 0, buf.length, pos);
    if (!n) return null;
    const nl = pos + n >= size ? n - 1 : buf.subarray(0, n).lastIndexOf(10);
    if (nl !== -1) return { buf: buf.subarray(0, nl + 1), pos };
    pos = past(fd, pos + n, size);
  }
  return null;
}

// A transcript's exchanges from `at` (a prompt's line), in segments of whole
// lines, each cut where its last prompt starts, so turns() never splits an
// exchange; `next`: where the next starts. An exchange longer than a segment
// is read in several, `next` null until it ends: each part after its prompt's
// line and a record of what it held so far (its last reply, its commands and
// files), so turns() reads it on as one. A segment of more than `cap` turns is
// cut at the prompt of the first past them.
// shortcut: the cut is found by the prompt record's uuid, which Claude Code
// writes; in a transcript without one an exchange can be cut at a segment's
// end (its rest unread), and only a transcript of 64 MB has two segments.
const so = (t) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
  ...t.ran.map((command) => ({ type: 'tool_use', name: 'Bash', input: { command } })),
  ...t.changed.map((file_path) => ({ type: 'tool_use', name: 'Edit', input: { file_path } })), { type: 'text', text: t.did }] } }) + '\n';
function* segments(fd, at, seg, size, cap) {
  let prompt = '', head = '';
  for (let b; (b = chunk(fd, at, seg, size)); ) {
    const next = b.pos + b.buf.length, got = turns(head + b.buf.toString('utf8'));
    const over = got.length > cap && got[cap].id ? b.buf.indexOf(`"uuid":"${got[cap].id}"`) : -1;
    if (over > 0) { prompt = head = ''; at = b.pos + b.buf.lastIndexOf(10, over) + 1; yield { got: got.slice(0, cap), next: at }; continue; }
    if (next >= size) { yield { got, next: size }; return; }
    const id = got.open?.id, i = id ? b.buf.lastIndexOf(`"uuid":"${id}"`) : -1, cut = i === -1 ? -1 : b.buf.lastIndexOf(10, i) + 1;
    if (cut > 0 || (cut === 0 && prompt)) { prompt = head = ''; at = b.pos + cut; yield { got: got.filter((t) => t !== got.open), next: at }; continue; }
    if (cut === 0) prompt = b.buf.subarray(0, b.buf.indexOf(10) + 1).toString('utf8');
    if (prompt) head = prompt + so(got.open);
    at = next;
    yield { got, next: prompt ? null : at };
  }
  // No whole line left (the last one longer than a segment, passed over): the
  // end. Left at the line's start, the import never finished, and every look
  // read the transcript again.
  yield { got: [], next: size };
}

// Whether a typed <private-session> mark is in the bytes from `pos`, looked
// for while `more()`: a text search, turns() only for a segment it finds one
// in (a tag quoted in a tool's output is no mark). `pos`: where the look
// stopped, the size when it got to the end.
function marked(fd, pos, seg, size, more = () => true) {
  for (let b; (b = chunk(fd, pos, seg, size)); ) {
    const t = b.buf.toString('utf8');
    if (PRIVATE_SESSION.test(norm(t)) && turns(t).hush) return { hit: true, pos: size };
    pos = b.pos + b.buf.length;
    if (pos < size && !more()) return { hit: false, pos };
  }
  return { hit: false, pos: size };
}

// One transcript, from where the last look left it. First the
// <private-session> mark, looked for in every byte not looked at yet: one
// anywhere keeps the whole conversation out, so nothing of it may be recorded
// before. That look keeps to the budget, a segment past it, and the next look
// goes on from where it stopped (a gigabyte held the lock ~5 s). Then its
// exchanges, a segment at a time while `more()`. Returns the offset the
// import reached (its size when done), the size, and how far the look got.
function importOne(dir, c, fd, seg, cap, more) {
  const s = tag(basename(c.p, '.jsonl')), size = fstatSync(fd).size, none = { at: size, size, looked: size };
  // Marked private, or held with auto memory off: never imported, and what it
  // has in the journal goes at the first look that meets it, as at its first
  // such Stop. Tagged by a writer with no sink (a memory-off Stop, the
  // compaction gate) and no Stop after, it kept its entries (review, 2026-10-29).
  if (hushed(dir, s)) { takeBack(dir, c.k, s, false, true); return none; }
  // A mark typed while the plugin was off is taken as its Stop takes one: the
  // conversation is marked, and what it wrote before goes, from the journal
  // and from handoff.md.
  const look = marked(fd, c.looked, seg, size, more);
  if (look.hit) { hushed(dir, s, true); takeBack(dir, c.k, s, true, true); return none; }
  if (look.pos < size) return { at: c.from, size, looked: look.pos };
  if (hushed(projectsRoot(), s, false, OFF)) { takeBack(dir, c.k, s); return none; }
  let at = c.from;
  try {
    for (const { got, next } of segments(fd, at, seg, size, cap)) {
      // A turn whose time won't parse: the transcript's, not the import's.
      record(dir, c.p, got, local(c.m));
      if (next == null) continue;
      at = next;
      if (at < size && !more()) break;
    }
  } catch (e) {
    // Its look for a mark kept: read again at every look, a transcript whose
    // import kept failing cost every look its whole read.
    mark(dir, [`${c.k} ${size} at ${at}`]);
    throw e;
  }
  return { at, size, looked: size };
}

// Whether a look at the folders is due: none in ACTIVE; between looks a Stop
// reads nothing more (the list was parsed whole every Stop). The clock is the
// time the last look wrote, in a file of its own: the list's mtime moved with
// every write to it, and a pass killed after an import waited half an hour.
// Either way: a look dated ahead (the clock set back since) stopped every
// import until real time caught up. A time that won't read is no look. Asked
// before the store's lock too: under contention a Stop waited for it twice to
// learn nothing was due (P1 hunt, 2026-10-29).
export function due(dir, t0 = Date.now()) {
  try { return !(Math.abs(t0 - Number(raw(join(dir, JOURNAL, LOOKED)))) < ACTIVE); } catch { return true; }
}

// The conversations still on disk, into the journal: a new install starts with
// the last month, not empty. Call under withLock(dir). Each is recorded before
// it is listed, so a Stop killed between the two only reads it again (entries
// go by key). `skip`: the Stop's own transcript. `segment` and `turns`:
// IMPORT_SEGMENT's and IMPORT_TURNS', lowered by a test.
export function backfill(dir, { budgetMs = IMPORT_BUDGET_MS, skip = null, segment = IMPORT_SEGMENT, turns: cap = IMPORT_TURNS } = {}) {
  const t0 = Date.now(), look = join(dir, JOURNAL, LOOKED);
  if (!due(dir, t0)) return { imported: 0, left: 0 };
  let all = [], n = 0, done = 0, err = null, owed = 0;
  const other = [];
  // The sweeps owed are tried here too, their failure the live write's to
  // report: it tries them first at every Stop. The look's own kept an import
  // with work left to a look in half an hour, and its line in status after
  // the day was fixed and a live write finished the sweep (review, 2026-10-29).
  try { owed = resweep(dir); } catch {}
  try {
    all = candidates(dir, skip);
    for (const [i, c] of all.entries()) {
      if (i && Date.now() - t0 >= budgetMs) break;
      // Whose it is, from its head, inside the budget: told for every one
      // before the first import, a home folder's month took ~1 s.
      if (!ours(dir, c.p)) { other.push(`${c.k} ${c.size} other`); continue; }
      try {
        // One that won't open is listed as failed, read again once it grows:
        // retried at every look, it failed at every look.
        let fd; try { fd = openSync(c.p, 'r'); } catch (e) { mark(dir, [`${c.k} ${c.size} failed ${Date.now()}`]); throw e; }
        try {
          const { at, size, looked } = importOne(dir, c, fd, segment, cap, () => Date.now() - t0 < budgetMs);
          mark(dir, [at < size ? `${c.k} ${looked} at ${at}` : `${c.k} ${size}`]);
          n++; if (at >= size) done++;
        } finally { closeSync(fd); }
      } catch (e) { err = e; }   // left for a later Stop: one transcript that won't read must not hold up the rest
    }
    // Another store's are listed so no look opens them again, and a transcript
    // gone from disk loses its line: the list holds a month, not every month.
    mark(dir, other, all.seen);
    if (raw(join(dir, JOURNAL, CHECKED)) != null) mark(dir, [], all.seen, CHECKED);
    // So does a noted folder gone, or holding none of this store's: kept, it
    // was listed at every look for good.
    if (all.seen) refold(dir, (have) => { const keep = have.filter((h) => all.mine.has(pathKey(h))); return keep.length < have.length ? keep : have; });
  } catch (e) { err = e; }
  const left = all.length - done - other.length;
  // Kept in .failed as the sink's is; the next import that goes through clears
  // it, and only its own: a live write's failure is the live write's to clear.
  // Not while a transcript is listed as failing to open: cleared by another's
  // import, it was skipped in silence.
  if (err) fault(dir, err, 'backfill: ');
  else if ((n || owed) && !FAILING.test(raw(join(dir, JOURNAL, IMPORTED)) ?? '')) clear(dir, true);
  // The next look: the next Stop while the budget left some, else in ACTIVE (a
  // failure too: retried every Stop, it would cost every Stop a look).
  try { mkdirSync(join(dir, JOURNAL), { recursive: true }); replaceIfUnchanged(look, raw(look), String(left && !err ? t0 - ACTIVE : Date.now())); } catch {}
  return { imported: n, left };
}

// Whether a day holds an entry: a marker line, found in its bytes. Parsed,
// a year of days (~30 MB) took status 0.6-1 s each time.
const held = (b) => b.includes('\n<!-- j:');

// The first day with an entry: a day a sweep or forget emptied is gone, so
// this is one read, and the briefing can ask at every session start.
export function firstDay(dir) {
  for (const d of days(dir)) { try { if (held(readFileSync(dayFile(dir, d)))) return d; } catch {} }
  return null;
}

// What `status` says of a store's journal. `left`: the transcripts the backfill
// has yet to read (candidates() is a folder walk: not for the briefing).
// `unread`: the days that won't read or are not UTF-8, as search names them.
export function summary(dir) {
  let first = null, n = 0, bytes = 0, failed = null;
  const unread = [];
  for (const d of days(dir)) {
    const f = dayFile(dir, d);
    try {
      const b = readFileSync(f);
      if (!isUtf8(b)) unread.push(`${f}: not UTF-8`);
      if (!held(b)) continue;
      bytes += b.length; n++; first ??= d;
    } catch (e) { unread.push(`${f}: ${e.code || e.message}`); }
  }
  try { failed = (raw(join(dir, JOURNAL, FAILED)) ?? '').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).error).join('; ') || null; } catch {}
  let left = 0; try { left = candidates(dir).filter((c) => ours(dir, c.p)).length; } catch {}
  return { first, days: n, bytes, left, failed, unread };
}
