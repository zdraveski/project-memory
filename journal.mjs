// The work journal: one file per day under <store>/journal/, one entry per
// turn, kept apart from handoff.md so what was done last month is still
// findable. Entries are capped and redacted here, the one place a turn's
// files and commands (uncapped in turns()) are shortened.
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { clip, tag, PRIVATE, hash, turns, readTail, hushed, ACTIVE, OFF } from './handoff-log.mjs';
import { replaceIfUnchanged, raw, local, storeOf, projectsRoot, same, pathKey, withLock } from './store.mjs';

export const JOURNAL = 'journal';
export const J_ASK = 2000;     // chars of what was asked
export const J_ANSWER = 6000;  // chars of the reply; a longer one keeps its start and its end
export const J_TAIL = 2000;    // ...the end: a reply's end says what was done and why
export const J_FILES = 20;     // files an entry names: the turn's last
export const J_RAN = 20;       // commands an entry names: the turn's last
export const J_CMD = 400;      // chars of one command
// A Stop imports old conversations for this long, holding the store's lock,
// then leaves the rest to the next: a month of them can be a gigabyte.
export const IMPORT_BUDGET_MS = 150;
// The most of one transcript an import reads, from its end: the lock is held
// one transcript past the budget, and one tool result can be 70 MB.
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;

const MARK = /^<!-- j:(.+) t:(.*) d:(\d{4}-\d\d-\d\d) -->$/;
const HEAD = /^## (\d\d:\d\d) · conversation (\S*?)(?: · branch (.*))?$/;
const TIME = /^\d{4}-\d\d-\d\d \d\d:\d\d$/;
const day = (at) => at.slice(0, 10);

// Before a day file is rewritten: one with a byte that is no UTF-8 (a note
// added in the Windows code page, as PowerShell 5.1's Add-Content writes) was
// read as U+FFFD and written back, its letters gone for good. It is left as
// it is, and the write that needed it fails, so status says why.
const UTF8 = new TextDecoder('utf-8', { fatal: true });
function whole(file, text) {
  if (text?.includes('\uFFFD')) try { UTF8.decode(readFileSync(file)); } catch { throw Object.assign(new Error(`${file} is not UTF-8 text, so it was left as it is; save it as UTF-8`), { code: 'not UTF-8' }); }
}
// Each day's work, a day that throws (not UTF-8, a folder by its name) after
// the rest: one bad file must not keep the others from a write or a sweep.
function each(ds, fn) {
  let bad = null;
  for (const d of ds) try { fn(d); } catch (e) { bad = e; }
  if (bad) throw bad;
}

// A path inside the turn's folder reads shorter relative to it.
const rel = (p, cwd) => {
  const c = cwd ? cwd.replace(/[\\/]+$/, '') : '';
  return c && p.length > c.length + 1 && /[\\/]/.test(p[c.length]) && p.slice(0, c.length).toLowerCase() === c.toLowerCase() ? p.slice(c.length + 1) : p;
};

// A turn that ran forget is kept like a private one: its listing, saved as the
// reply and committed with the day, kept what it removed (review, 2026-10-29).
// The subcommand only: "memory.mjs" anywhere before the word took a commit
// message or a search for "forget" for one, and dropped a whole turn.
// Options may come first (`--session X forget`, as the CLI takes them). A
// value never starts with - or a quote it does not close: one that could be
// the next option too doubled the work per option (40 took 7 s).
const FORGETS = /memory\.mjs["']?(?:\s+--[\w-]+(?:[= ](?:"[^"]*"|'[^']*'|[^\s"'-]\S*))?)*\s+forget\b/;

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
  const quiet = forgets || PRIVATE.test(turn.raw ?? turn.ask);
  return {
    key: turn.id || `${s} ${turn.at} ${hash(turn.raw ?? turn.ask).slice(0, 12)}`,
    at: TIME.test(turn.at) ? turn.at : when, s,
    t: `${basename(dirname(transcriptPath))}/${basename(transcriptPath, '.jsonl')}`,
    branch: clip(turn.branch || '', 100),
    asked: forgets ? '[private]' : clip(turn.ask, J_ASK),
    answered: quiet ? '[private]' : reply(turn.did),
    changed: quiet ? [] : turn.changed.slice(-J_FILES).map((p) => clip(rel(p, turn.cwd), 300)),
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
  let e = null;
  // An editor saves CRLF or a BOM: handoff.md lost its entries to both.
  for (const line of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^# Journal \d{4}-\d\d-\d\d\n*/, '').split('\n')) {
    const m = MARK.exec(line);
    if (m) { e = { key: m[1], at: `${m[3]} 00:00`, s: '', t: m[2], branch: '', asked: '', answered: '', changed: [], ran: [] }; entries.push(e); continue; }
    if (e && !line.trim()) continue;
    const f = e && [HEAD.exec(line), /^\*\*(Asked|Answered|Changed|Ran):\*\* ?(.*)$/.exec(line)];
    if (f?.[0]) { e.at = `${e.at.slice(0, 10)} ${f[0][1]}`; e.s = f[0][2]; e.branch = f[0][3] ?? ''; }
    else if (f?.[1]) {
      const [, k, v] = f[1];
      if (k === 'Asked') e.asked = v; else if (k === 'Answered') e.answered = v;
      else if (k === 'Changed') e.changed = v ? v.split(', ') : []; else e.ran = v ? v.split(' · ') : [];
    } else { e = null; const up = entries.at(-1); (up ? (up.after ??= []) : prose).push(line); }
  }
  for (const x of entries) if (x.after) x.after = x.after.join('\n').trim();
  return { prose: prose.join('\n').trim(), entries };
}

export const dayFile = (dir, at) => join(dir, JOURNAL, day(at) + '.md');
const page = (d, prose, es) => `# Journal ${d}\n\n` + [prose, ...es.flatMap((e) => [render(e), e.after])].filter(Boolean).join('\n\n') + '\n';
// The keys forget removed, one a line: a backfill reads a quiet conversation
// again once it grows, and would bring a forgotten entry back. Read trimmed,
// as hushed() reads its list: a key with a \r or space after it is still one.
const FORGOTTEN = '.forgotten';

// Call under withLock(dir). Returns how many entries were added or changed.
// `when`: entryOf's, for a turn whose time won't parse.
export function record(dir, transcriptPath, turns, when) {
  const byDay = new Map(), gone = new Set((raw(join(dir, JOURNAL, FORGOTTEN)) ?? '').split(/\r?\n/).map((l) => l.trim()));
  for (const t of turns) {
    const e = entryOf(t, transcriptPath, when), d = day(e.at);
    if (gone.has(e.key)) continue;
    byDay.set(d, [...(byDay.get(d) || []), e]);
  }
  let n = 0;
  each(byDay.keys(), (d) => {
    const file = dayFile(dir, d), fresh = byDay.get(d);
    mkdirSync(join(dir, JOURNAL), { recursive: true });
    for (let i = 0; i < 3; i++) {
      const before = raw(file);
      const { prose, entries } = parseDay(before ?? '');
      const have = new Map(entries.map((e) => [e.key, e]));
      let changed = 0;
      for (const e of fresh) {
        const was = have.get(e.key);
        if (!was || render(was) !== render(e)) changed++;
        have.set(e.key, was?.after ? { ...e, after: was.after } : e);
      }
      const all = [...have.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      whole(file, before);
      const w = replaceIfUnchanged(file, before, page(d, prose, all));
      if (w !== 'conflict') { n += changed; break; }
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
export const entries = (dirs, { since, until, failed = [] } = {}) => dirs.flatMap((dir) => days(dir).filter((d) => (!since || d >= since) && (!until || d <= until))
  .flatMap((d) => {
    const path = dayFile(dir, d);
    try { return parseDay(raw(path) ?? '').entries.map((e) => ({ ...e, day: d, path, dir })); }
    catch (e) { failed.push({ path, code: e.code || e.message }); return []; }
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
    whole(file, before);
    if (replaceIfUnchanged(file, before, page(d, prose, kept)) === 'conflict') continue;
    if (!kept.length && !prose) try { unlinkSync(file); } catch {}
    return entries.filter((e) => !keep(e));
  }
  return [];
}

// A conversation marked private takes back what it wrote: its entries go from
// every day. Not from the day it began on: worked out again after a time-zone
// change, that was a day late, and its first day stayed. Once a conversation.
// Call under withLock(dir). Returns how many went.
export function sweep(dir, s) {
  let n = 0;
  each(days(dir), (d) => { n += drop(dir, d, (e) => e.s !== s).length; });
  return n;
}

// The entries with every term (any case) in one of their fields, in the range,
// of the conversation when one is given. With apply they go, under the store's
// lock (null when it stayed busy); their keys are listed first, so a forget
// killed half-way leaves entries no record brings back. `removed`: the matches
// that went, fewer when a day kept changing under the write (its keys listed
// all the same).
export function forget(dir, terms, { since, until, conversation, apply = false, failed } = {}) {
  const ts = terms.map((t) => t.toLowerCase());
  const matched = entries([dir], { since, until, failed }).filter((e) => (!conversation || e.s === conversation) &&
    ts.every((t) => [e.asked, e.answered, e.branch, ...e.changed, ...e.ran].some((v) => v.toLowerCase().includes(t))));
  if (!apply || !matched.length) return { matched, removed: [] };
  const keys = new Set(matched.map((e) => e.key)), f = join(dir, JOURNAL, FORGOTTEN);
  return withLock(dir, () => {
    for (let i = 0; i < 3; i++) {
      const before = raw(f);
      if (replaceIfUnchanged(f, before, [...(before ?? '').split(/\r?\n/).filter(Boolean), ...keys].join('\n') + '\n') !== 'conflict') break;
    }
    // A day that won't be written (not UTF-8) is named, the rest still go.
    const went = new Set([...new Set(matched.map((e) => e.day))].flatMap((d) => {
      try { return drop(dir, d, (e) => !keys.has(e.key)).map((e) => e.key); }
      catch (e) { failed?.push({ path: dayFile(dir, d), code: e.code || e.message }); return []; }
    }));
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

// What a read of a conversation does to the journal, at its Stop or its
// import: the read that marks it private takes back what it wrote. Call under
// withLock(dir). False when it was private already: nothing tried.
// Held with auto memory off once, it is never recorded, live or imported:
// resumed with memory on, its first Stop journaled every turn (review,
// 2026-10-29). A private mark still sweeps it.
function take(dir, transcriptPath, got, { quiet, hush, when }) {
  const s = tag(basename(transcriptPath, '.jsonl'));
  if (quiet && hush) sweep(dir, s);
  else if (!quiet && !hushed(projectsRoot(), s, false, OFF)) record(dir, transcriptPath, got, when);
  else return false;
  return true;
}

// handoff()'s sink, called under its lock.
export function write(dir, transcriptPath, got, opts) {
  try { if (take(dir, transcriptPath, got, opts)) clear(dir, false); }
  catch (e) { fault(dir, e); }
}

// What the backfill has read: `<folder>/<session> <bytes>`, one line a
// transcript, ` partial` when only its tail was, ` other` when it is another
// store's. `keep`: the transcripts still on disk; any other line goes.
const IMPORTED = '.imported', LOOKED = '.looked';
const LINE = /^(.+) (\d+)(?: \w+)?$/;
function mark(dir, lines, keep = null) {
  const f = join(dir, JOURNAL, IMPORTED), ks = new Set(lines.map((l) => LINE.exec(l)[1]));
  mkdirSync(join(dir, JOURNAL), { recursive: true });
  for (let i = 0; i < 3; i++) {
    const before = raw(f), kept = (before ?? '').split(/\r?\n/).filter((l) => { const k = LINE.exec(l)?.[1]; return l && !ks.has(k) && (!keep || keep.has(k)); });
    if (replaceIfUnchanged(f, before, [...kept, ...lines].join('\n') + '\n') !== 'conflict') return;
  }
}

// The transcripts a backfill would read, oldest first. Only in the store's own
// folder and its subfolders' (`<folder>-*`): the head of every project's
// transcripts, read every Stop, would be hundreds of reads. Only quiet ones: a
// conversation still running is its own Stop's to journal, and its last reply
// may not be in its transcript yet. One listed is read again once it grew
// (turns a live write missed); a known one costs no read of its head. `seen`:
// every transcript the folders hold.
// shortcut: a worktree outside the repository's folder has another folder name
// and is not backfilled (its live turns are still journaled); scan every
// project folder's first cwd if one is ever missed.
function candidates(dir, skip) {
  const root = projectsRoot(), me = pathKey(basename(dirname(dir))), done = new Map(), out = [];
  for (const m of (raw(join(dir, JOURNAL, IMPORTED)) ?? '').split(/\r?\n/).map((l) => LINE.exec(l))) if (m) done.set(m[1], Number(m[2]));
  // A listing that fails leaves `seen` null, so nothing is pruned: read as
  // empty, it would drop the lines of every transcript in it.
  out.seen = new Set();
  let folders = []; try { folders = readdirSync(root).filter((f) => f !== '_shared' && (pathKey(f) === me || pathKey(f).startsWith(me + '-'))); } catch { out.seen = null; }
  for (const f of folders) {
    let names = []; try { names = readdirSync(join(root, f)).filter((n) => n.endsWith('.jsonl')); } catch { out.seen = null; }
    for (const n of names) {
      const p = join(root, f, n), k = `${f}/${n.slice(0, -6)}`;
      out.seen?.add(k);
      if (typeof skip === 'string' && same(p, skip)) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (Math.abs(Date.now() - st.mtimeMs) < ACTIVE || (done.has(k) && st.size <= done.get(k))) continue;
      out.push({ p, k, size: st.size, m: st.mtimeMs });
    }
  }
  return out.sort((a, b) => a.m - b.m);
}
const ours = (dir, p) => same(storeOf({ transcript_path: p }), dir);

// The conversations still on disk, into the journal: a new install starts with
// the last month, not empty. Call under withLock(dir). Each is recorded before
// it is listed, so a Stop killed between the two only reads it again (entries
// go by key). `skip`: the Stop's own transcript.
// shortcut: a <private-session> mark more than IMPORT_MAX_BYTES before a
// transcript's end, typed before the plugin kept marks, is not seen; read the
// rest of a partial transcript for it if that turns up.
export function backfill(dir, { budgetMs = IMPORT_BUDGET_MS, skip = null } = {}) {
  const t0 = Date.now(), look = join(dir, JOURNAL, LOOKED);
  // A look at the folders once in ACTIVE; between looks a Stop reads nothing
  // more (the list was parsed whole every Stop). The clock is the time the
  // last look wrote, in a file of its own: the list's mtime moved with every
  // write to it, and a pass killed after an import waited half an hour.
  // Either way: a look dated ahead (the clock set back since) stopped every
  // import until real time caught up. A time that won't read is no look.
  let due = true; try { due = !(Math.abs(t0 - Number(raw(look))) < ACTIVE); } catch {}
  if (!due) return { imported: 0, left: 0 };
  let all = [], n = 0, err = null;
  const other = [];
  try {
    all = candidates(dir, skip);
    for (const [i, c] of all.entries()) {
      if (i && Date.now() - t0 >= budgetMs) break;
      // Whose it is, from its head, inside the budget: told for every one
      // before the first import, a home folder's month took ~1 s.
      if (!ours(dir, c.p)) { other.push(`${c.k} ${c.size} other`); continue; }
      try {
        // take() keeps none of a private one, nor of one held with auto memory
        // off. A mark typed while the plugin was off is taken as its Stop takes
        // one: the conversation is marked, and what it wrote before goes.
        // One that won't read is listed as failed, read again once it grows:
        // retried at every look, it failed at every look.
        let r; try { r = readTail(c.p, IMPORT_MAX_BYTES); } catch (e) { mark(dir, [`${c.k} ${c.size} failed`]); throw e; }
        const got = turns(r.text), hush = got.hush === true;
        // A turn whose time won't parse: the transcript's, not the import's.
        take(dir, c.p, got, { quiet: hushed(dir, tag(basename(c.p, '.jsonl')), hush), hush, when: local(c.m) });
        mark(dir, [`${c.k} ${c.size}${r.whole ? '' : ' partial'}`]);
        n++;
      } catch (e) { err = e; }   // left for a later Stop: one transcript that won't read must not hold up the rest
    }
    // Another store's are listed so no look opens them again, and a transcript
    // gone from disk loses its line: the list holds a month, not every month.
    mark(dir, other, all.seen);
  } catch (e) { err = e; }
  const left = all.length - n - other.length;
  // Kept in .failed as the sink's is; the next import that goes through clears
  // it, and only its own: a live write's failure is the live write's to clear.
  if (err) fault(dir, err, 'backfill: ');
  else if (n) clear(dir, true);
  // The next look: the next Stop while the budget left some, else in ACTIVE (a
  // failure too: retried every Stop, it would cost every Stop a look).
  try { mkdirSync(join(dir, JOURNAL), { recursive: true }); replaceIfUnchanged(look, raw(look), String(left && !err ? t0 - ACTIVE : Date.now())); } catch {}
  return { imported: n, left };
}

// Whether a day holds an entry: a marker line, found in its bytes. Parsed,
// a year of days (~30 MB) took status 0.6-1 s each time.
const held = (dir, d) => readFileSync(dayFile(dir, d)).includes('\n<!-- j:');

// The first day with an entry: a day a sweep or forget emptied is gone, so
// this is one read, and the briefing can ask at every session start.
export function firstDay(dir) {
  for (const d of days(dir)) { try { if (held(dir, d)) return d; } catch {} }
  return null;
}

// What `status` says of a store's journal. `left`: the transcripts the backfill
// has yet to read (candidates() is a folder walk: not for the briefing).
export function summary(dir) {
  let first = null, n = 0, bytes = 0, failed = null;
  for (const d of days(dir)) {
    try {
      if (!held(dir, d)) continue;
      bytes += statSync(dayFile(dir, d)).size; n++; first ??= d;
    } catch {}
  }
  try { failed = (raw(join(dir, JOURNAL, FAILED)) ?? '').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).error).join('; ') || null; } catch {}
  let left = 0; try { left = candidates(dir).filter((c) => ours(dir, c.p)).length; } catch {}
  return { first, days: n, bytes, left, failed };
}
