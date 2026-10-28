// The work journal: one file per day under <store>/journal/, one entry per
// turn, kept apart from handoff.md so what was done last month is still
// findable. Entries are capped and redacted here, the one place a turn's
// files and commands (uncapped in turns()) are shortened.
import { mkdirSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { clip, tag, PRIVATE, hash } from './handoff-log.mjs';
import { replaceIfUnchanged, raw } from './store.mjs';

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
      const next = `# Journal ${d}\n\n` + [prose, ...all.map(render)].filter(Boolean).join('\n\n') + '\n';
      const w = replaceIfUnchanged(file, before, next);
      if (w !== 'conflict') { n += changed; break; }
    }
  }
  return n;
}

export function days(dir) {
  try { return readdirSync(join(dir, JOURNAL)).filter((f) => /^\d{4}-\d\d-\d\d\.md$/.test(f)).map((f) => f.slice(0, 10)).sort(); }
  catch { return []; }
}
