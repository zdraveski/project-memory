// The work journal: one file per day under <store>/journal/, one entry per
// turn, kept apart from handoff.md so what was done last month is still
// findable. Entries are capped and redacted here, the one place a turn's
// files and commands (uncapped in turns()) are shortened.
import { mkdirSync, readdirSync, statSync, utimesSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { clip, tag, PRIVATE, hash, turns, readTail, hushed, ACTIVE, OFF } from './handoff-log.mjs';
import { replaceIfUnchanged, raw, local, storeOf, projectsRoot, same, pathKey } from './store.mjs';

export const JOURNAL = 'journal';
export const J_ASK = 2000;     // chars of what was asked
export const J_ANSWER = 3000;  // chars of the reply
export const J_FILES = 20;     // files an entry names: the turn's last
export const J_RAN = 10;       // commands an entry names: the turn's last
export const J_CMD = 200;      // chars of one command
// A Stop imports old conversations for this long, holding the store's lock,
// then leaves the rest to the next: a month of them can be a gigabyte.
export const IMPORT_BUDGET_MS = 150;
// The most of one transcript an import reads, from its end: the lock is held
// one transcript past the budget, and one tool result can be 70 MB.
export const IMPORT_MAX_BYTES = 64 * 1024 * 1024;

const MARK = /^<!-- j:(.+) t:(.*) d:(\d{4}-\d\d-\d\d) -->$/;
const HEAD = /^## (\d\d:\d\d) · conversation (\S*?)(?: · branch (.*))?$/;
const day = (at) => at.slice(0, 10);

// A path inside the turn's folder reads shorter relative to it.
const rel = (p, cwd) => {
  const c = cwd ? cwd.replace(/[\\/]+$/, '') : '';
  return c && p.length > c.length + 1 && /[\\/]/.test(p[c.length]) && p.slice(0, c.length).toLowerCase() === c.toLowerCase() ? p.slice(c.length + 1) : p;
};

export function entryOf(turn, transcriptPath) {
  const s = tag(basename(transcriptPath, '.jsonl'));
  const quiet = PRIVATE.test(turn.raw ?? turn.ask);
  return {
    key: turn.id || `${s} ${turn.at} ${hash(turn.raw ?? turn.ask).slice(0, 12)}`,
    at: turn.at, s,
    t: `${basename(dirname(transcriptPath))}/${basename(transcriptPath, '.jsonl')}`,
    branch: clip(turn.branch || '', 100),
    asked: clip(turn.ask, J_ASK),
    answered: quiet ? '[private]' : clip(turn.did, J_ANSWER),
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

// An entry is its marker and the field lines under it, up to a blank line;
// any other line (a note someone wrote, a marker that won't parse) is prose.
export function parseDay(text) {
  const prose = [], entries = [];
  let e = null;
  // An editor saves CRLF or a BOM: handoff.md lost its entries to both.
  for (const line of text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^# Journal \d{4}-\d\d-\d\d\n*/, '').split('\n')) {
    const m = MARK.exec(line);
    if (m) { e = { key: m[1], at: `${m[3]} 00:00`, s: '', t: m[2], branch: '', asked: '', answered: '', changed: [], ran: [] }; entries.push(e); continue; }
    const f = e && line.trim() && [HEAD.exec(line), /^\*\*(Asked|Answered|Changed|Ran):\*\* ?(.*)$/.exec(line)];
    if (f?.[0]) { e.at = `${e.at.slice(0, 10)} ${f[0][1]}`; e.s = f[0][2]; e.branch = f[0][3] ?? ''; }
    else if (f?.[1]) {
      const [, k, v] = f[1];
      if (k === 'Asked') e.asked = v; else if (k === 'Answered') e.answered = v;
      else if (k === 'Changed') e.changed = v ? v.split(', ') : []; else e.ran = v ? v.split(' · ') : [];
    } else { e = null; prose.push(line); }
  }
  return { prose: prose.join('\n').trim(), entries };
}

export const dayFile = (dir, at) => join(dir, JOURNAL, day(at) + '.md');
const page = (d, prose, es) => `# Journal ${d}\n\n` + [prose, ...es.map(render)].filter(Boolean).join('\n\n') + '\n';

// Call under withLock(dir). Returns how many entries were added or changed.
export function record(dir, transcriptPath, turns) {
  const byDay = new Map();
  for (const t of turns) {
    const e = entryOf(t, transcriptPath), d = day(e.at);
    byDay.set(d, [...(byDay.get(d) || []), e]);
  }
  let n = 0;
  for (const [d, fresh] of byDay) {
    const file = dayFile(dir, d);
    mkdirSync(join(dir, JOURNAL), { recursive: true });
    for (let i = 0; i < 3; i++) {
      const before = raw(file);
      const { prose, entries } = parseDay(before ?? '');
      const have = new Map(entries.map((e) => [e.key, e]));
      let changed = 0;
      for (const e of fresh) {
        if (!have.has(e.key) || render(have.get(e.key)) !== render(e)) changed++;
        have.set(e.key, e);
      }
      const all = [...have.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const w = replaceIfUnchanged(file, before, page(d, prose, all));
      if (w !== 'conflict') { n += changed; break; }
    }
  }
  return n;
}

export function days(dir) {
  try { return readdirSync(join(dir, JOURNAL)).filter((f) => /^\d{4}-\d\d-\d\d\.md$/.test(f)).map((f) => f.slice(0, 10)).sort(); }
  catch { return []; }
}

// The day a conversation began: its transcript's first record time, from the
// head alone (a transcript runs to 50 MB). '' when there is none to read.
function began(transcriptPath) {
  try {
    const fd = openSync(transcriptPath, 'r'), buf = Buffer.alloc(65536);
    const n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
    const at = Date.parse(/"timestamp":"([^"]{1,40})"/.exec(buf.toString('utf8', 0, n))?.[1]);
    return at ? day(local(at)) : '';
  } catch { return ''; }
}

// A conversation marked private takes back what it wrote: its entries go from
// every day since it began. Call under withLock(dir). Returns how many went.
export function sweep(dir, s, transcriptPath) {
  const from = began(transcriptPath);
  let n = 0;
  for (const d of days(dir).filter((x) => x >= from)) {
    const file = dayFile(dir, d);
    for (let i = 0; i < 3; i++) {
      const before = raw(file), { prose, entries } = parseDay(before ?? '');
      const kept = entries.filter((e) => e.s !== s);
      if (kept.length === entries.length) break;
      if (replaceIfUnchanged(file, before, page(d, prose, kept)) !== 'conflict') { n += entries.length - kept.length; break; }
    }
  }
  return n;
}

// A throw kept in .failed for `status` to report: swallowed, the journal would
// stop and nothing say so. `from` names the writer when it is not the sink.
function fault(dir, e, from = '') {
  const failed = join(dir, JOURNAL, '.failed');
  try { mkdirSync(join(dir, JOURNAL), { recursive: true }); replaceIfUnchanged(failed, raw(failed), JSON.stringify({ at: new Date().toISOString(), error: from + String(e.message).split('\n')[0] })); } catch {}
}

// handoff()'s sink, called under its lock.
export function write(dir, transcriptPath, got, { quiet, hush }) {
  const failed = join(dir, JOURNAL, '.failed');
  try {
    if (quiet && hush) sweep(dir, tag(basename(transcriptPath, '.jsonl')), transcriptPath);
    else if (!quiet) record(dir, transcriptPath, got);
    else return;   // already private: nothing tried, so nothing to clear
    try { unlinkSync(failed); } catch {}
  } catch (e) { fault(dir, e); }
}

// What the backfill has read: `<folder>/<session> <bytes>`, one line a
// transcript, ` partial` when only its tail was, ` other` when it is another
// store's.
const IMPORTED = '.imported';
const LINE = /^(.+) (\d+)(?: \w+)?$/;
function mark(dir, lines) {
  const f = join(dir, JOURNAL, IMPORTED), ks = new Set(lines.map((l) => LINE.exec(l)[1]));
  mkdirSync(join(dir, JOURNAL), { recursive: true });
  for (let i = 0; i < 3; i++) {
    const before = raw(f), kept = (before ?? '').split(/\r?\n/).filter((l) => l && !ks.has(LINE.exec(l)?.[1]));
    if (replaceIfUnchanged(f, before, [...kept, ...lines].join('\n') + '\n') !== 'conflict') return;
  }
}

// The transcripts a backfill would read, oldest first. Only in the store's own
// folder and its subfolders' (`<folder>-*`): the head of every project's
// transcripts, read every Stop, would be hundreds of reads. Only quiet ones: a
// conversation still running is its own Stop's to journal, and its last reply
// may not be in its transcript yet. One listed is read again once it grew
// (turns a live write missed), looked at when `due` only.
// shortcut: a worktree outside the repository's folder has another folder name
// and is not backfilled (its live turns are still journaled); scan every
// project folder's first cwd if one is ever missed.
function candidates(dir, skip, due = true) {
  const root = projectsRoot(), me = pathKey(basename(dirname(dir))), done = new Map();
  for (const m of (raw(join(dir, JOURNAL, IMPORTED)) ?? '').split(/\r?\n/).map((l) => LINE.exec(l))) if (m) done.set(m[1], Number(m[2]));
  const out = [];
  let folders = []; try { folders = readdirSync(root).filter((f) => f !== '_shared' && (pathKey(f) === me || pathKey(f).startsWith(me + '-'))); } catch {}
  for (const f of folders) {
    let names = []; try { names = readdirSync(join(root, f)).filter((n) => n.endsWith('.jsonl')); } catch {}
    for (const n of names) {
      const p = join(root, f, n), k = `${f}/${n.slice(0, -6)}`;
      // The list first: a known transcript costs no stat between looks, and no read of its head.
      if ((done.has(k) && !due) || (typeof skip === 'string' && same(p, skip))) continue;
      let st; try { st = statSync(p); } catch { continue; }
      if (Date.now() - st.mtimeMs < ACTIVE || (done.has(k) && st.size <= done.get(k))) continue;
      out.push({ p, k, size: st.size, m: st.mtimeMs, mine: same(storeOf({ transcript_path: p }), dir) });
    }
  }
  return out.sort((a, b) => a.m - b.m);
}

// The conversations still on disk, into the journal: a new install starts with
// the last month, not empty. Call under withLock(dir). Each is recorded before
// it is listed, so a Stop killed between the two only reads it again (entries
// go by key). `skip`: the Stop's own transcript.
// shortcut: a <private-session> mark more than IMPORT_MAX_BYTES before a
// transcript's end, typed before the plugin kept marks, is not seen; read the
// rest of a partial transcript for it if that turns up.
export function backfill(dir, { budgetMs = IMPORT_BUDGET_MS, skip = null } = {}) {
  const t0 = Date.now(), f = join(dir, JOURNAL, IMPORTED), bad = join(dir, JOURNAL, '.failed');
  // The listed are looked at once in ACTIVE, by the list's age, not every
  // Stop: a stat is ~70 µs on Windows, 5 ms a Stop for a month's 68 transcripts.
  let due = true, todo = [], n = 0, err = null;
  try { due = t0 - statSync(f).mtimeMs >= ACTIVE; } catch {}
  try {
    const all = candidates(dir, skip, due), other = all.filter((c) => !c.mine).map((c) => `${c.k} ${c.size} other`);
    todo = all.filter((c) => c.mine);
    if (other.length) mark(dir, other);
    for (const [i, c] of todo.entries()) {
      if (i && Date.now() - t0 >= budgetMs) break;
      try {
        const s = tag(basename(c.p, '.jsonl'));
        let whole = true;
        // Private, or held with auto memory off: none of it is kept.
        if (!hushed(dir, s) && !hushed(projectsRoot(), s, false, OFF)) {
          const r = readTail(c.p, IMPORT_MAX_BYTES), got = turns(r.text);
          if (!got.hush) record(dir, c.p, got);
          whole = r.whole;
        }
        mark(dir, [`${c.k} ${c.size}${whole ? '' : ' partial'}`]);
        n++;
      } catch (e) { err = e; }   // left for a later Stop: one transcript that won't read must not hold up the rest
    }
  } catch (e) { err = e; }
  // Kept in .failed as the sink's is; the next import that goes through clears
  // it, and only its own: a live write's failure is the live write's to clear.
  if (err) fault(dir, err, 'backfill: ');
  else if (n && (raw(bad) ?? '').includes('"error":"backfill: ')) try { unlinkSync(bad); } catch {}
  if (due && n === todo.length) try { utimesSync(f, new Date(), new Date()); } catch {}
  return { imported: n, left: todo.length - n };
}
