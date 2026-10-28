// The work journal: one file per day under <store>/journal/, one entry per
// turn, kept apart from handoff.md so what was done last month is still
// findable. Entries are capped and redacted here, the one place a turn's
// files and commands (uncapped in turns()) are shortened.
import { mkdirSync, readdirSync, openSync, readSync, closeSync, unlinkSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { clip, tag, PRIVATE, hash } from './handoff-log.mjs';
import { replaceIfUnchanged, raw, local } from './store.mjs';

export const JOURNAL = 'journal';
export const J_ASK = 2000;     // chars of what was asked
export const J_ANSWER = 3000;  // chars of the reply
export const J_FILES = 20;     // files an entry names: the turn's last
export const J_RAN = 10;       // commands an entry names: the turn's last
export const J_CMD = 200;      // chars of one command

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

// handoff()'s sink, called under its lock. A throw is kept in .failed for
// `status` to report: swallowed, the journal would stop and nothing say so.
export function write(dir, transcriptPath, got, { quiet, hush }) {
  const failed = join(dir, JOURNAL, '.failed');
  try {
    if (quiet && hush) sweep(dir, tag(basename(transcriptPath, '.jsonl')), transcriptPath);
    else if (!quiet) record(dir, transcriptPath, got);
    else return;   // already private: nothing tried, so nothing to clear
    try { unlinkSync(failed); } catch {}
  } catch (e) {
    try { mkdirSync(join(dir, JOURNAL), { recursive: true }); replaceIfUnchanged(failed, raw(failed), JSON.stringify({ at: new Date().toISOString(), error: String(e.message).split('\n')[0] })); } catch {}
  }
}
