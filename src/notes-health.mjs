// Coded findings about a store's notes (1.7.0 E6, E1), for `memory doctor` and `memory status` only: structure() gives N01-N11, stale()
// gives S01-S02, health() the lines both print. Reads the store and runs one git log; saves nothing. Imports store, enforce and
// lessons' counters reader, never memory (ADR 0003).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { POINTER, ARCHIVE, indexLines, opener, frontEnd, front, foldCase, budgetOf, local } from './store.mjs';
import { notesOf } from './enforce.mjs';
import { readCounters } from './lessons.mjs';

// The plugin's own files in a store: not notes, and no note's rules apply to them.
const OWN = ['handoff.md', 'journal.md'], RESERVED = ['MEMORY.md', ARCHIVE, 'handoff.md'];
// A folder named like a note reads as empty on Windows and throws elsewhere: it is no file, and holds no text, on every platform.
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const text = (p) => { try { return isFile(p) ? readFileSync(p, 'utf8').replace(/^﻿/, '') : ''; } catch { return ''; } };

// A note's [[links]]. Not in code (`grid[[0]]`, a fenced block: its fences start a line, an inline ``` in prose hid the links up to the
// next fence; ```` holds a ``` fence and only ```` closes it), and `[[name.md]]` is name's. A tilde run is taken whole: giving tildes
// back, 20,000 of them took 17 s (review). One never closed hides nothing: run to the end, a fence the regex misread hid the rest of
// the note. A fence starts after a newline: ^ starts a line at a lone \r or a U+2028 too, and lines of ~~~ split by them took 3 s per
// 100 KB.
// shortcut: unclosed fences of many lengths each rescan the rest (0.2 s for a hostile 300 KB note), upgrade to a line scanner if notes get that big.
export const linksOf = (t) => [...new Set([...t.replace(/(?<![^\n])[ \t]*(?:(?:>|[*+-]|\d+[.)])[ \t]*)*(`{3,}|~{3,}(?!~))[^`\n]*\n[\s\S]*?^[ \t]*(?:(?:>|[*+-]|\d+[.)])[ \t]*)*\1/gm, '').replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim().replace(/\.md$/i, '')))];

// What names clash: two file names that are one name on Windows or macOS (case, Unicode form), or a note named like a file the plugin keeps.
export function clashes(names) {
  const key = (n) => n.normalize('NFC').toLowerCase(), groups = new Map();
  for (const n of names) groups.set(key(n), [...(groups.get(key(n)) ?? []), n]);
  const out = [];
  for (const [k, g] of groups) {
    const own = RESERVED.find((r) => key(r) === k);
    if (g.length > 1) out.push(`${g.join(' and ')} are one name on Windows and macOS: rename all but one`);
    else if (own && g[0] !== own) out.push(`${g[0]} is named like ${own}, a file the plugin keeps: rename it`);
  }
  return out;
}

const PER_CODE = 20;
const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
// shortcut: every pair of descriptions is compared (n squared), fine for hundreds of notes, and it stops at 1000 pairs; upgrade if a store holds thousands.
function twins(notes) {
  const out = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const [a, b] = [notes[i], notes[j]], same = a.w.join(' ') === b.w.join(' ');
      let near = false;
      if (!same && a.set.size >= 5 && b.set.size >= 5) near = [...a.set].filter((w) => b.set.has(w)).length / Math.max(a.set.size, b.set.size) >= 0.8;
      if ((same || near) && out.length < 1000) out.push(`${a.file} and ${b.file} have ${same ? 'the same description' : 'nearly the same description'}: merge them, or reword one`);
    }
  }
  return out;
}

// The findings about a store's notes: [{ code, level: 'note' | 'PROBLEM', text }]. errorIds (a Set or array of the error ids
// .mistakes.json holds) is null while that file does not exist, which skips N08. `shared` names the shared store's notes, which a
// [[link]] may name. With `all`, N09 names its notes.
export function structure(dir, { errorIds = null, shared = [], all = false } = {}) {
  // At most PER_CODE findings of one code are kept, then one line with the rest: a store of 300,000 index lines gave 300,000 lines.
  const out = [], count = new Map(), add = (code, level, t) => { const c = (count.get(code)?.k ?? 0) + 1; count.set(code, { level, k: c }); if (c <= PER_CODE) out.push({ code, level, text: t }); };
  let listed; try { listed = readdirSync(dir); } catch { return out; }
  for (const t of clashes(listed.filter((n) => /\.md$/i.test(n)))) add('N04', 'PROBLEM', t);
  const notes = notesOf(dir, { write: false }).filter((x) => !OWN.includes(x.file));
  const opens = opener(dir, listed), has = new Set(listed.filter((n) => isFile(join(dir, n))));
  const indexed = new Set(), bare = [];
  // N01 and N11 are also found by tiering (.health); shown here with their codes.
  for (const f of ['MEMORY.md', ARCHIVE]) {
    for (const line of indexLines(text(join(dir, f)))) {
      const t = line.match(POINTER)?.[1];
      if (!t || t === ARCHIVE) continue;
      if (!has.has(opens(t))) add('N01', 'note', `${f} lists ${t}, a file that is gone: delete that line`); else indexed.add(opens(t));
    }
  }
  // The plugin's own files are linkable by their names once they are there.
  const known = new Set([...shared, ...OWN.filter((f) => has.has(f)).map((f) => f.replace(/\.md$/, ''))]), seen = [];
  for (const n of notes) {
    const t = text(join(dir, n.file)), { name, desc } = front(t);
    known.add(n.file.replace(/\.md$/, '')); if (name) known.add(name);
    seen.push({ file: n.file, links: linksOf(t), desc });
    if (!indexed.has(n.file)) add('N02', 'note', `${n.file} is in neither MEMORY.md nor ${ARCHIVE}: add a line for it, or let the next Stop do it`);
    if (frontEnd(t) === -1) add('N05', 'PROBLEM', `${n.file} has no front matter, or it is never closed: start the file with --- and end the header with ---`);
  }
  for (const t of twins(seen.filter((s) => s.desc).map((s) => ({ ...s, w: words(s.desc), set: new Set(words(s.desc)) })))) add('N03', 'note', t);
  for (const s of seen) for (const l of s.links) if (!known.has(l)) add('N06', 'note', `${s.file} links to [[${l}]], which is no note: write that note, or remove the link`);
  const ids = errorIds && new Set(errorIds), { notes: counters } = readCounters(dir);
  for (const n of notes) {
    const l = n.l;
    if (l?.bad) { add('N07', 'note', `${n.file} has a lesson key that is not read: ${l.bad}`); continue; }
    if (!l?.lesson) continue;
    const { hidden, resolves, to, when, named, type } = l.lesson, retired = counters[n.file]?.retired;
    if (hidden || retired) { add('N10', 'note', `the lesson ${n.file} is not shown: ${hidden || `retired (${retired})`}`); continue; }
    if (ids) for (const id of resolves) if (!ids.has(id)) add('N08', 'note', `${n.file} resolves ${id}, which no recorded error has: fix the id, or remove the line`);
    if (type === 'feedback' && !n.r && !to.length && !when.length && !named.paths.length && !named.files.length && !named.families.length) bare.push(n.file);
  }
  if (bare.length) add('N09', 'note', `${bare.length} feedback note${bare.length === 1 ? '' : 's'} can never fire: no applies_to, no applies_when, and no path, file or command word in the name or description. Add applies_to: or applies_when:${all ? ` (${bare.join(', ')})` : ' (status --all names them)'}`);
  const size = Buffer.byteLength(text(join(dir, 'MEMORY.md')));
  if (size > budgetOf(dir)) add('N11', 'note', `MEMORY.md is ${size} B, over its budget of ${budgetOf(dir)} B: shorten the text after each link, or archive old notes`);
  for (const [code, { level, k }] of count) if (k > PER_CODE) out.push({ code, level, text: `and ${k - PER_CODE} more ${code} findings` });
  return out;
}

const DAY = 864e5, GIT_WAIT = 5000;
const defaultGit = (args, opts) => execFileSync('git', args, { timeout: GIT_WAIT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024, ...opts });
// A name in a note that is no path of the project: home, absolute, parent, or one git would read as pathspec magic.
const outside = (p) => /^(?:~|[A-Za-z]:|[\\/]|:)/.test(p) || p.split(/[\\/]/).includes('..');
// A changed file against a name a note gives: a path (a folder or a glob's fixed start counts), or a bare file name.
// shortcut: a glob is read as its text before the first `*`, so `src/*.mjs` counts every file under src/; upgrade if that is too loud.
const touches = (file, p) => {
  const f = foldCase(file), q = foldCase(p.replace(/[\\/]+$/, '').replace(/[*?[].*$/, '').replace(/\/+$/, ''));
  return q !== '' && (f === q || f.startsWith(`${q}/`) || (!p.includes('/') && f.endsWith(`/${q}`)));
};

// [{ code, level: 'note', text }] for the notes whose paths changed in 3 or more commits since the note (S01), or are gone (S02).
// A note's paths are its `to`, else its named paths and files; its date is its mtime. One git log for every note.
export function stale(dir, repo, { run = defaultGit, now = Date.now() } = {}) {
  const found = [], skip = (why) => [{ code: 'S00', level: 'note', text: `stale check skipped: ${why}` }];
  const of = notesOf(dir, { write: false }).flatMap((n) => {
    const l = n.l?.lesson;
    const paths = !l || l.hidden ? [] : l.to.length ? l.to : [...l.named.paths, ...l.named.files];
    const own = paths.filter((p) => !outside(p));
    return own.length ? [{ file: n.file, mtime: n.mtime, paths: own }] : [];
  });
  if (!of.length) return found;
  if (!repo) return skip('no repository');
  const since = Math.max(Math.min(...of.map((n) => n.mtime)), now - 365 * DAY);
  let log;
  // Only the notes' paths, in any case (touches() is the judge of case): a folder and a glob as written, a bare file name in any folder. shortcut: past 200 names the log is not narrowed.
  const specs = [...new Set(of.flatMap((n) => n.paths).map((p) => `:(icase)${p.includes('/') ? p : `*${p}`}`))];
  try { log = run(['log', `--since=@${Math.floor(since / 1000)}`, '--name-only', '--format=@@%ct', ...(specs.length <= 200 ? ['--', ...specs] : [])], { cwd: repo }); } catch (e) {
    return skip(e?.code === 'ENOENT' ? 'git was not found' : e?.code === 'ETIMEDOUT' ? `git took more than ${GIT_WAIT / 1000} seconds` : 'git could not read the history');
  }
  const commits = []; // [ct in ms, files]
  for (const line of String(log).split(/\r?\n/)) {
    if (line.startsWith('@@')) commits.push([Number(line.slice(2)) * 1000, []]);
    else if (line && commits.length) commits.at(-1)[1].push(line);
  }
  for (const n of of) {
    for (const p of n.paths) {
      // Gone only when the path's first folder is the repository's: `PR/run` and `navy/amber` are words, and a bare file name cannot be
      // looked up (only git's history says anything of it).
      if (p.includes('/') && !/[*?[]/.test(p) && existsSync(join(repo, p.split('/')[0])) && !existsSync(join(repo, p))) { found.push({ code: 'S02', level: 'note', text: `${n.file} names ${p}, which no longer exists` }); continue; }
      const k = commits.filter(([t, fs]) => t > n.mtime && fs.some((f) => touches(f, p))).length;
      if (k >= 3) found.push({ code: 'S01', level: 'note', text: `${n.file} names ${p}, which changed in ${k} commits since the note (${local(n.mtime).slice(0, 10)}): check that it still holds` });
    }
  }
  return found;
}

// The lines doctor and status print, as say() pads them. `repo` undefined leaves the stale check out (a shared store's notes name no project's paths).
const line = (code, level, t) => `${level.padEnd(7)} ${code} ${t}`;
export function health(dir, repo, opts = {}) {
  const out = structure(dir, opts).map((f) => line(f.code, f.level, f.text));
  if (repo === undefined) return out;
  const st = stale(dir, repo, opts);
  out.push(...st.slice(0, 10).map((f) => line(f.code, f.level, f.text)));
  if (st.length > 10) out.push(`${'note'.padEnd(7)} and ${st.length - 10} more stale notes`);
  return out;
}
