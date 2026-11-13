#!/usr/bin/env node
// What a person, or the model, asks of the memory the hooks keep: find a
// memory, see a store's state, take one back from the snapshots, share one with
// every project, check the hooks are wired. The hooks write on their own; this
// writes only when told to, under the same lock.
const USAGE = `node memory.mjs <command> [--store <dir> | --shared] [--session <id>]
  search <terms...> [--since D] [--until D] [--all] [--limit N]
                                          memories (name, description, then body; archive included)
                                          and the journal (asked, then changed and ran, then answered),
                                          ranked, a long request asked many times once. D is YYYY-MM-DD;
                                          dates with no terms list those days' requests
  show <key...> [--same] [--all]          journal entries whole, by the key a search hit prints;
                                          --same: every entry that asked the same
  forget [<words...>] [--key K]... [--same] [--since D] [--until D] [--conversation ID] [--yes]
                                          the journal entries holding every word (with those keys, of
                                          that conversation): listed with their keys, up to 200; with
                                          --yes removed
  incognito                               stop saving this conversation and sweep what it already saved
                                          (needs --session: the command passes it)
  off | on                                turn this project's memory off (nothing saved, snapshotted or
                                          tiered) or back on; search and show still answer
  help                                    this (--help and -h too)
  status [--all]                          index size, hot/archived, problems, dangling [[links]],
                                          the memories changed in the last 7 days
  history <memory> [--all] [--limit N]    the snapshots that changed it, the newest 30
  restore <memory> [--rev <commit>] [--force]   back from the snapshots, with its index line
  promote <memory>                        move it to the shared store, for every project
  doctor                                  wiring, live copy, Stop hook, locks, git
The store is this session's own (outside a session: the cwd's project, or the nearest
folder above it with one) unless --store or --shared says otherwise. --session names
the conversation asking (the skill passes it): its store is this session's, and doctor
reads its transcript. After --, every word is a term, one that starts with -- too.`;
import { appendFileSync, readFileSync, readdirSync, existsSync, statSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs';
import { join, relative, basename, dirname, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { storeOf, sharedStore, isShared, projectsRoot, opener, withLock, replaceIfUnchanged, utf8Only, budgetOf, POINTER, ARCHIVE, isIndex, frontEnd, pointerLine, LOCK_STALE, raw, gitWhy, reason, gitArgs, front, allStores, pathKey, same, configDir, memoryOff, local, HANDOFF_FAILED, startCwd, PROJECT_OFF, OFF_PERIODS, isOff, offSince, transcriptKey } from './store.mjs';
import { hushed, MISSED, sectionOf, parse, transcripts, stalled, lastTurn, GRACE, edited, clip, tag, unsaved, forgotten, FORGOTTEN, unsay } from './handoff-log.mjs';
// Loaded apart, as memory-tier loads it: a journal.mjs that will not load (or
// a copy without it) costs search the journal, said in its output, never doctor
// or restore. Imported statically, deploy.mjs would not start without it
// (handoff-log's deploy gate test, 2026-10-28).
let entries, forget, holds, summary, unwritten, takeBack;
try { ({ entries, forget, holds, summary, unwritten, takeBack } = await import('./journal.mjs')); }
catch (e) {
  const why = reason(e);
  entries = (dirs, { failed = [] } = {}) => { failed.push({ path: 'journal.mjs', code: why }); return []; };
  // Said by status too: silent, it read as a store with no journal.
  summary = () => ({ broken: why });
  forget = (dir, terms, o) => ({ matched: entries([dir], o), removed: [] });
  holds = () => false;
  unwritten = () => [];
  takeBack = () => { throw new Error(`journal.mjs could not be loaded: ${why}`); };
}

const OVERFLOW = /\s*<!-- overflow -->$/;
// The most entries a forget's look lists, and so the most one --yes removes:
// it showed 20 of 35, and --yes removed all 35.
const LOOK = 200;
// A forget by dates alone is confirmed by its range, not line by line: its look
// shows this many, and --yes removes every match. Capped at LOOK, "forget the
// whole journal" removed nothing past 200 entries (docs review, R35).
const RANGE_SHOWN = 20;
// What a journal hit prints: its request to HIT_ASK characters, and of the
// reply, files and commands only the stretches that hold a search word, HIT_SPAN
// either side, HIT_MORE in all. The top 3 printed whole were 30 KB, and the line
// that answered the question was lost in them (recall test, 2026-10-29). A
// headline, not the entry: ten hits at 400 and 800 were 7 KB a search, mostly
// passages and transcript paths nobody read; `show` gives one whole (2026-10-31).
// HIT_SPAN fits a third of HIT_MORE: at 80, three fields' stretches were all
// lead-in, cut before the word. HIT_HEAD: the reply's first sentence, what
// came of it, which a stretch from the middle never says (2026-10-31).
const HIT_ASK = 200, HIT_SPAN = 30, HIT_MORE = 240, HIT_HEAD = 140;
// The first sentence of a reply, HIT_HEAD at most: one of 20 characters or
// more, so a lone "Done." or "**Yes.**" is not taken for the whole outcome.
const result = (a) => { const t = clip(a, HIT_HEAD); return /^.{20,}?[.!?](?=\s|$)/u.exec(t)?.[0] ?? t; };
// A request this long (normalized) asked again is one hit: a script's prompt,
// a retry. A shorter one ("continue", "yes") is different work each time, and
// collapsed, its reply could not be read (review, 2026-10-29).
const SAME_MIN = 80;
const sameKey = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// What deploy.mjs needs to agree with doctor about, defined once: the plugin,
// the live copy, and what runs.
export const PLUGIN = 'project-memory@project-memory';
export const LIVE = join(homedir(), '.claude', 'hooks-live');
const json = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const plugins = (f) => json(join(configDir(), 'plugins', f));
// The installed plugin's id, from whichever marketplace added it: this repo's
// own (GitHub, or the live copy) or another that lists it.
const installedId = () => Object.keys(plugins('installed_plugins.json')?.plugins ?? {}).find((k) => k.split('@')[0] === 'project-memory');
// Where the installed plugin is copied to: one folder per version in Claude Code's cache.
export const installPath = () => plugins('installed_plugins.json')?.plugins?.[installedId()]?.[0]?.installPath ?? null;
// Where it runs from. Installed from a local folder -- for the maintainer, the
// live copy -- it is read in place (`claude plugin list`: readFromFolder), and
// the cache copy only sits beside it (measured 2026-10-27, Claude Code 2.1.311).
export const marketplace = () => plugins('known_marketplaces.json')?.[installedId()?.split('@')[1]]?.source ?? null;
export const pluginRoot = () => installPath() && (marketplace()?.source === 'directory' ? marketplace().path : installPath());
// The commit deploy.mjs checked and copied into a folder.
export const deployedCommit = (dir) => json(join(dir, '.deployed.json'))?.commit ?? null;

// `raw` (store.mjs) is what replaceIfUnchanged compares against; `read` is for parsing.
const read = (p) => { try { return readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; } };
// A BOM before the first line hid its pointer: promote left that line behind.
const target = (line) => (line.replace(/^\uFEFF/, '').match(POINTER) || [])[1];
const targets = (text) => (text ?? '').split(/\r?\n/).map(target).filter((t) => t && t !== ARCHIVE);
const no = (why) => ({ ok: false, lines: [why] });
// A memory by the name it has on disk: on Windows `ALPHA` opens alpha.md (and
// `memory~1` an index), and moved under the typed name, alpha.md's index line
// was left pointing at nothing. The disk says which file a name opens, and
// the entry that is that file is its name; case is never folded on Linux:
// Alpha.md and alpha.md are two notes there, and a folded match restored the
// other one. A name that opens nothing is the one name that reads alike
// (pick), or kept as typed.
const onDisk = (dir, file) => {
  try {
    const names = readdirSync(dir);
    if (names.includes(file)) return file;
    let st; try { st = statSync(join(dir, file), { bigint: true }); } catch { return pick(dir, file, names); }
    return names.find((n) => { try { const s = statSync(join(dir, n), { bigint: true }); return s.ino === st.ino && s.dev === st.dev; } catch { return false; } }) ?? file;
  } catch { return file; }
};
// The one name of `names` a typed name means, as the user's disk reads names: in any letter case where the folder is so, and in
// either Unicode form everywhere (a café typed composed, its file named decomposed). Two that read alike are two notes, and
// neither is taken. Each letter upper-cased alone, as NTFS does: a whole-string fold made straße STRASSE, which NTFS keeps
// apart (audit C-8).
// Whether the folder reads names in any case, asked of the folder: a note's name in the other case opens the same file or no file. A
// macOS volume can be case-sensitive, and Windows can mark a folder so; the platform's habit was wrong there, and `promote alpha`
// took Alpha.md. A folder with no letters in any name to try the question on has the platform's habit.
const FOLDS = process.platform === 'win32' || process.platform === 'darwin';
const caseless = (dir) => {
  try {
    for (const n of readdirSync(dir)) {
      const o = n === n.toLowerCase() ? n.toUpperCase() : n.toLowerCase();
      if (o === n || o.length !== n.length) continue;   // straße's STRASSE is no name NTFS opens for it
      const a = statSync(join(dir, n), { bigint: true });
      try { const b = statSync(join(dir, o), { bigint: true }); return a.ino === b.ino && a.dev === b.dev; } catch { return false; }
    }
  } catch {}
  return FOLDS;
};
const fold = (s, folds) => { const n = s.normalize('NFC'); return folds ? [...n].map((c) => { const u = c.toUpperCase(); return u.length === c.length ? u : c; }).join('') : n; };
const pick = (dir, file, names) => { if (names.includes(file)) return file; const f = caseless(dir), m = [...new Set(names)].filter((n) => fold(n, f) === fold(file, f)); return m.length === 1 ? m[0] : file; };
// A note no file has by that name, by the name the snapshots had for it: `history Pricing` found nothing of a deleted pricing.md.
const named = (dir, file) => { const d = onDisk(dir, file); return d !== file || existsSync(join(dir, d)) ? d : pick(dir, file, ever(dir)); };
// A write the disk refuses (read-only, held by another program) is said, with
// what it left behind: thrown, it was a stack trace, read as nothing done.
const put = (p, read, next) => { try { return replaceIfUnchanged(p, read, next); } catch (e) { return `failed: ${e.code || e.message}`; } };
const failed = (w) => typeof w === 'string' && w.startsWith('failed: ');
// A line added to an index goes before the archive's own line, which tiering
// keeps last and leaves where it is when nothing else changed.
const withLine = (text, line) => {
  const ls = text.replace(/\n*$/, '').split('\n'), at = ls.findIndex((l) => target(l) === ARCHIVE);
  if (at === -1) ls.push(line); else ls.splice(at, 0, line);
  return ls.join('\n') + '\n';
};

// The first pointer `match` takes, with the indented lines a long hook wraps onto, and the text without every such pointer and its wrap.
const take = (text, match) => {
  const kept = []; let line = null, own = false, first = false;
  for (const l of text.split(/\r?\n/)) {
    if (match(l)) { own = true; first = line === null; if (first) line = l.replace(OVERFLOW, ''); }
    else if (own && /^[ \t]+\S/.test(l)) { if (first) line += '\n' + l; }
    else { own = false; kept.push(l); }
  }
  return { line, rest: kept.join('\n') };
};

// Every memory in a store: what its frontmatter says, its [[links]], and which
// index names it.
export function memories(dir) {
  let files; try { files = readdirSync(dir); } catch { return []; }
  // By the file each line opens, as tiering counts them (store.mjs `opener`).
  // One listing for the store: read once a line, a 5 MB index hung status for good.
  const opens = opener(dir, files);
  const hot = new Set([...new Set(targets(read(join(dir, 'MEMORY.md'))))].map(opens)), cold = new Set([...new Set(targets(read(join(dir, ARCHIVE))))].map(opens));
  return files.filter((f) => f.endsWith('.md') && !isIndex(f)).flatMap((file) => {
    const path = join(dir, file);
    const text = read(path);
    if (text === null) return [];
    const end = frontEnd(text);
    // As tiering reads it: cut here, an unclosed frontmatter was none, and a
    // pinned rule showed in status and search with no description or type.
    const { name, desc, type, modified: stamp, superseded } = front(text);
    let mtime = 0; try { mtime = statSync(path).mtimeMs; } catch {}
    return [{
      file, path, dir, name, desc, type, superseded,
      // No newline after the closing --- (indexOf gives -1): the body is empty, not the whole file.
      body: end === -1 ? text : text.slice(text.indexOf('\n', end + 1) + 1 || text.length),
      // Not in code (`grid[[0]]`, a fenced block: its fences start a line, an
      // inline ``` in prose hid the links up to the next fence; ```` holds a
      // ``` fence and only ```` closes it), and `[[name.md]]` is name's. A
      // tilde run is taken whole: giving tildes back, 20,000 of them took
      // 17 s (review). One never closed hides nothing: run to the end, a
      // fence the regex misread hid the rest of the note.
      // A fence starts after a newline: ^ starts a line at a lone \r or a
      // U+2028 too, and lines of ~~~ split by them took 3 s per 100 KB.
      // shortcut: unclosed fences of many lengths each rescan the rest (0.2 s
      // for a hostile 300 KB note), upgrade to a line scanner if notes get that big.
      links: [...new Set([...text.replace(/(?<![^\n])[ \t]*(?:(?:>|[*+-]|\d+[.)])[ \t]*)*(`{3,}|~{3,}(?!~))[^`\n]*\n[\s\S]*?^[ \t]*(?:(?:>|[*+-]|\d+[.)])[ \t]*)*\1/gm, '').replace(/`[^`\n]*`/g, '').matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim().replace(/\.md$/i, '')))],
      modified: Number.isNaN(stamp) ? mtime : stamp,
      where: hot.has(file) ? 'hot' : cold.has(file) ? 'archived' : 'unindexed',
    }];
  });
}

// Words that say nothing about which memory: in a model's natural-language
// query they scored like content -- "the" in a file name took the name bonus,
// and "how do we deploy the site" filled its last places with them (review).
const STOP = new Set(['the', 'and', 'for', 'how', 'what', 'why', 'with', 'was', 'are', 'not', 'this', 'that', 'from',
  'when', 'where', 'who', 'did', 'does', 'have', 'has', 'can', 'you', 'our', 'about', 'into', 'there', 'their', 'then', 'than',
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we']);
// Two letters are a word too: CI, PR, DB were never found. But only standing
// alone: `ci` is in "decision".
// Combining marks (\p{M}) belong to the word (Hindi), and both sides are NFC so a decomposed "e" + accent is "é".
const words = (q) => [...new Set(q.normalize('NFC').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((t) => t.length >= 2 && !STOP.has(t)))];
const alone = (t) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${t}(?![\\p{L}\\p{M}\\p{N}])`, 'gu');
// Chinese and Japanese have no spaces round a word, so a two-character one is looked for as a substring.
const plain = (t) => t.length > 2 || /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]+$/u.test(t);
const count = (hay, t) => (plain(t) ? hay.normalize('NFC').split(t).length - 1 : (hay.normalize('NFC').match(alone(t)) ?? []).length);
const has = (hay, t) => (plain(t) ? hay.normalize('NFC').includes(t) : alone(t).test(hay.normalize('NFC')));
// The stretches of `text` around each match of `find`, joined, `room` characters
// at most; no cut leaves half an emoji, which prints as U+FFFD.
function around(text, find, room) {
  const spans = [];
  for (const m of text.matchAll(find)) {
    const a = Math.max(0, m.index - HIT_SPAN), b = Math.min(text.length, m.index + m[0].length + HIT_SPAN);
    if (spans.length && a <= spans.at(-1)[1]) spans.at(-1)[1] = b; else spans.push([a, b]);
  }
  const s = (spans[0][0] ? '…' : '') + spans.map(([a, b]) => text.slice(a, b).replace(/^[\uDC00-\uDFFF]/, '').replace(/[\uD800-\uDBFF]$/, '')).join(' … ') + (spans.at(-1)[1] < text.length ? '…' : '');
  return s.length > room ? s.slice(0, room - 1).replace(/[\uD800-\uDBFF]$/, '') + '…' : s;
}

// The journal as a reader sees it: never an entry forget listed. It lists the
// keys before it writes the days, and a day that would not be written keeps
// the entry until forget runs again, which reads them all. A list that won't
// read could name any entry: none of that store's is shown, and it is named.
const told = (dirs, o) => {
  const gone = new Set(), open = dirs.filter((d) => {
    const p = join(d, FORGOTTEN);
    try { for (const [k] of forgotten(readFileSync(p, 'utf8'))) gone.add(k); return true; }
    catch (e) { if (e.code === 'ENOENT') return true; o.failed?.push({ path: p, code: e.code || e.message }); return false; }
  });
  return entries(open, o).filter((e) => !gone.has(e.key));
};

// Ranked, not grepped: a name says more than a description, a description more
// than a passing mention. Every term in the name or description is the strong
// match; every term somewhere in the body is a weak one, or a month-long log
// that mentions everything outranked the memory named for the thing ("deploy
// checklist", 2026-10-27).
// `outside`: the notes that match but are dated out of the range.
export function search(dirs, query, { since, until, failed } = {}) {
  const terms = words(query), hits = [], held = new Set();
  let outside = 0;
  for (const dir of terms.length ? dirs : []) for (const m of memories(dir)) {
    // A log the startup line prints, and the journal's pointer: neither is a memory.
    if (m.file === 'handoff.md' || m.file === 'journal.md') continue;
    const name = `${m.file} ${m.name}`.toLowerCase(), desc = m.desc.toLowerCase(), body = m.body.toLowerCase();
    let score = 0, strong = true, every = true;
    const got = [];
    for (const t of terms) {
      const s = (has(name, t) ? 3 : 0) + (has(desc, t) ? 2 : 0);
      const b = Math.min(2, count(body, t));
      if (!s) strong = false;
      if (!s && !b) every = false; else got.push(t);
      score += s + b;
    }
    if (!score) continue;
    const d = local(m.modified).slice(0, 10);   // the date its hit line shows
    // A note's date is its last change: written in September and edited since,
    // a September search left it out, and the miss read as no record.
    if ((since && d < since) || (until && d > until)) { outside++; continue; }
    got.forEach((t) => held.add(t));
    hits.push({ ...m, kind: 'note', score: score + (strong ? 5 : every ? 2 : 0) });
  }
  // An entry by what was asked, then what it changed and ran (and its branch),
  // then the reply: a reply that names everything must not outrank the request.
  for (const e of terms.length ? told(dirs, { since, until, failed }) : []) {
    const asked = e.asked.toLowerCase(), did = [...e.changed, ...e.ran].join('\n').toLowerCase(), branch = e.branch.toLowerCase(), answered = e.answered.toLowerCase();
    let score = 0, strong = true, every = true;
    for (const t of terms) {
      // A branch is named on every entry of its work: below a file or command that names the word.
      const s = (has(asked, t) ? 3 : 0) + (has(did, t) ? 2 : has(branch, t) ? 1 : 0) + Math.min(2, count(answered, t));
      if (!has(asked, t)) strong = false;
      if (!s) every = false; else held.add(t);
      score += s;
    }
    if (score) hits.push({ ...e, kind: 'journal', modified: Date.parse(e.at.replace(' ', 'T')), score: score + (strong ? 5 : every ? 2 : 0) });
  }
  return Object.assign(hits.sort((a, b) => b.score - a.score || b.modified - a.modified), { outside, missing: terms.filter((t) => !held.has(t)) });
}

// What a [[link]] may name: a memory's file name without `.md`, or its `name:`.
const names = (ms) => ms.flatMap((m) => [m.file.replace(/\.md$/, ''), m.name].filter(Boolean));

export function status(dir, sharedNames = []) {
  const ms = memories(dir), main = read(join(dir, 'MEMORY.md'));
  const lines = [`${dir}${isShared(dir) ? '  (shared by every project)' : ''}`];
  const gone = isOff(dir);
  if (gone) lines.push(`  ${offText(gone)}`);
  // A journal alone is a store: search finds its entries.
  if (main === null && !ms.length && !existsSync(join(dir, 'journal'))) return [...lines, '  no store here yet'];
  const n = (w) => ms.filter((m) => m.where === w).length;
  // Not handoff.md and journal.md, the plugin's own, which tiering points to at its next run: a store with no index yet
  // counted them as notes with no pointer (audit C-10).
  const loose = ms.filter((m) => m.where === 'unindexed' && m.file !== 'handoff.md' && m.file !== 'journal.md').length;
  lines.push(`  index ${Buffer.byteLength(main ?? '')} / ${budgetOf(dir)} B · ${n('hot')} hot · ${n('archived')} archived` +
    (loose ? ` · ${loose} with no pointer yet` : ''));
  const health = (read(join(dir, '.health')) ?? '').trim();
  if (health) lines.push(...health.split('\n').map((h) => `  needs attention: ${h}`));
  // The Stop's record of what it could not save, as the briefing says it: only the briefing did (R64).
  const lost = json(join(projectsRoot(), `${HANDOFF_FAILED}${basename(dirname(dir))}`));
  if (lost) lines.push(`  needs attention: ${unsaved(lost)}`);
  const known = new Set([...names(ms), ...sharedNames]);
  const dangling = ms.flatMap((m) => m.links.filter((l) => !known.has(l)).map((l) => `${m.file} → [[${l}]]`));
  if (dangling.length) lines.push(`  links to no memory: ${dangling.join(', ')}`);
  const bare = ms.filter((m) => !m.desc || !m.type).map((m) => m.file);
  if (bare.length) lines.push(`  frontmatter without a description or type: ${bare.join(', ')}`);
  const doc = read(join(dir, 'handoff.md'));
  const { a, b } = sectionOf(doc ?? '');
  const all = a === -1 ? [] : parse(doc.slice(a, b));
  if (all.length) lines.push(`  handoff: ${all.length} exchanges from ${new Set(all.map((t) => t.s)).size} session(s), newest ${all.at(-1).at}`);
  const j = summary(dir);
  if (j?.broken) lines.push(`  journal: could not read journal.mjs: ${j.broken}`);
  // Failing from the first write, it has no day to show: the failure is the news.
  if (j?.first || j?.failed) lines.push(`  journal: ${j.first ? `${j.days} day${j.days === 1 ? '' : 's'} since ${j.first}, ${(j.bytes / 1048576).toFixed(1)} MB` : 'no days yet'}` + (j.left > 0 ? `; importing ${j.left} older conversations` : '') + (j.failed ? `; last write failed: ${j.failed}` : ''));
  // A day search can't read: its entries are missing from every search.
  lines.push(...(j?.unread ?? []).map((u) => `  journal: could not read ${u}`));
  const ch = recent(dir);
  if (ch) lines.push(`  changed in the last ${RECENT_DAYS} days: ${ch}`);
  return lines;
}

// The first n of a list, and how many it leaves out.
const more = (xs, n) => xs.slice(0, n).join(', ') + (xs.length > n ? `, and ${xs.length - n} more` : '');

// What the snapshots saw change in a store lately, so the user can see what
// Claude wrote down or dropped. The index and the handoff change every turn
// and are left out. By the kept link's path alone: a store with two links
// whose index was gone for one snapshot had both tracked for it, and the
// second's untracking then read as every note deleted (review).
const RECENT_DAYS = 7;
function recent(dir) {
  let out; try { out = git('-c', 'core.quotepath=off', 'log', `--since=${RECENT_DAYS}.days`, '--no-renames', '--name-status', '--format=@%s', '--', tracked(dir, '')[0]); } catch { return ''; }
  const last = new Map(), born = new Set();
  let first = false;
  for (const l of out.split('\n')) {
    // The first snapshot took in what was already there: not added this week.
    if (l.startsWith('@')) { first = l === '@memory: first snapshot'; continue; }
    if (first) continue;
    const [st, p] = l.trim().split('\t');
    const f = p && p.split('/').pop();
    // Nor a journal day: every finished one was listed as a memory added.
    if (!f || !f.endsWith('.md') || f === 'handoff.md' || isIndex(f) || p.includes('/journal/')) continue;
    if (!last.has(f)) last.set(f, st);                 // git lists the newest first
    if (st === 'A') born.add(f);
  }
  const of = (want) => [...last].filter(([f, st]) => want(f, st)).map(([f]) => f.replace(/\.md$/, ''));
  return [['added', of((f, st) => st !== 'D' && born.has(f))], ['edited', of((f, st) => st !== 'D' && !born.has(f))], ['deleted', of((f, st) => st === 'D')]]
    .filter(([, xs]) => xs.length).map(([w, xs]) => `${w} ${more(xs, 6)}`).join(' · ');
}

function snapshots() {
  const h = json(join(projectsRoot(), '.snapshot-health'));
  if (!h) return 'snapshots: none recorded yet';
  if (h.off) return `snapshots: off, ${h.off}: everything else works, but an old version of a note cannot be brought back`;
  // A first snapshot in parts, or one waiting on another git, as it is: "none recorded yet" hid a history that never
  // started, and "ok, last <now>" was said of none (audit H-F1).
  const waiting = h.busySince ? `; waiting since ${local(h.busySince)} for another git to let go of the repository` : '';
  return h.failures ? `snapshots: failing, ${h.failures} in a row (${h.error}); last ok ${h.lastOk ? local(h.lastOk) : 'never'}. ` +
    `The user's fix: run git -C "${projectsRoot()}" status in a terminal to see git's own message; if git says the repository is damaged, rename its .git folder and the next reply starts a new history`
    : h.partial ? `snapshots: the first is being taken in parts, ${h.partial} file(s) still to add; each reply adds more${waiting}`
    : !h.lastOk ? `snapshots: none taken yet${waiting}`
    : h.missed?.length ? `snapshots: ok, last ${local(h.lastOk)}, but they leave out ${h.missed.join(', ')}: ${MISSED}`
    : `snapshots: ok, last ${local(h.lastOk)}${waiting}`;
}

// The store the hooks give this session: Claude Code names the transcript by
// the session id, in the project folder it chose, whatever the cwd is now --
// a Bash cwd moved into another project once wrote that project's store.
// Outside a session, the cwd's project or the nearest folder above it with a
// store: a subdirectory's own slug has none, and searching it said "nothing".
// The session is the one the skill names with --session (Claude Code fills in
// ${CLAUDE_SESSION_ID} there), never one read from the environment: the plugin
// directory holds a plugin that reads what it could take for a credential.
let session = '';
// The session's transcript, by its id, in whichever project folder holds it.
function transcriptOf(id) {
  const root = projectsRoot();
  let all = []; try { all = readdirSync(root); } catch {}
  for (const p of all) if (existsSync(join(root, p, `${id}.jsonl`))) return join(root, p, `${id}.jsonl`);
  return null;
}
function sessionStore() {
  const t = session && transcriptOf(session);
  if (t) return storeOf({ transcript_path: t });
  for (let d = process.cwd(); ; d = dirname(d)) {
    if (existsSync(storeOf({ cwd: d }))) return storeOf({ cwd: d });
    if (dirname(d) === d) return storeOf({ cwd: process.cwd() });
  }
}

// The snapshot repo is ~/.claude/projects and tracks each store by its real
// path: memory-tier.mjs ignores the junctions.
// Paths literal: git reads a path with * ? [ as a pattern, and `notes[1].md`
// matched other notes' history. A version is read with cat-file for the same
// reason: `git show rev:a*.md` took the argument for a pattern, printed
// nothing and succeeded, and restore wrote an empty note.
const gitAs = (encoding, a) => execFileSync('git', gitArgs('--literal-pathspecs', ...a), { encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, timeout: 60_000 });
const git = (...a) => gitAs('utf8', a);
// A blob's own bytes: through a string, a note that is not UTF-8 lost its letters.
const gitBytes = (...a) => gitAs('buffer', a);
// The on-disk spelling: git's paths are case-sensitive, and the JS realpath
// keeps whatever case it was handed (a cwd typed in lower case).
const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
// A store linked to a folder outside the root is in the history by its link's
// path: resolved, git said the path was outside the repository.
// Its memory folder or its project folder, either can be the link: the
// project folder as the root lists it, then memory/.
// Every path git may hold it by, the one to read first first.
const tracked = (dir, file) => {
  const root = real(projectsRoot()), at = relative(root, real(dir));
  if (!at.startsWith('..') && !isAbsolute(at)) return [relative(root, join(real(dir), file)).replace(/\\/g, '/')];
  // Of two links to one folder, the first, which the snapshot keeps: named by
  // the second, git read an ignored path, and restore brought back a version
  // older than the last snapshot's. Then the others: a link that sorts first,
  // added later, holds none of the history made before it. In the order
  // gitignore() takes them, with no MEMORY.md needed: a deleted index is the
  // one to restore.
  const me = pathKey(real(dir));
  let names = []; try { names = readdirSync(projectsRoot()); } catch {}
  const links = names.filter((n) => pathKey(real(join(projectsRoot(), n, 'memory'))) === me);
  return (links.length ? links : [basename(dirname(dir))]).map((n) => `${n}/memory/${file}`);
};
// Every name the store's files had in the snapshots (each was added once).
const ever = (dir) => {
  try { return tracked(dir, '').flatMap((at) => git('-c', 'core.quotepath=off', 'log', '--format=', '--name-only', '--no-renames', '--diff-filter=A', '--', at).split('\n')).map((p) => p.split('/').pop()); }
  catch { return []; }
};

// Why no snapshot can be read, in plain words, or '' when one can: git's own ("fatal: not a git repository", "cannot change
// to") read as a fault, and without git, restore offered to replace a note "with the snapshot" (audit C-3, C-4).
const unsnapped = () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { return 'git is not installed, so there are no snapshots: everything else works. Installing Git (git-scm.com) turns them on'; }
  // Nor a repository with no commit yet: a large first snapshot is taken in parts, over several replies.
  let head = false; try { head = existsSync(join(projectsRoot(), '.git')) && !!git('rev-parse', '--verify', '-q', 'HEAD'); } catch {}
  return head ? '' : 'no snapshots yet: project-memory takes the first at the end of a reply';
};
// git saying a snapshot does not hold a path, or there is no such commit.
const missing = (e) => /does not exist in|exists on disk, but not in|invalid object name|not a valid object name|unknown revision|bad revision/i.test(String(e?.stderr));

// The newest `max`: a note edited every reply had 2,000 snapshots, 72 KB of output.
export function history(dirs, file, everywhere = false, max = 30) {
  const verb = { A: 'added', M: 'changed', D: 'deleted' };
  const why = unsnapped();
  if (why) return no(why);
  try {
    for (const dir of dirs) {
      const f = named(dir, file);
      // No renames: a link that sorts first moves every path to it, and an R line was no change.
      const out = git('log', '--no-renames', '--format=@%h %ad%x09%s', '--date=format:%Y-%m-%d %H:%M', '--name-status', '--', ...tracked(dir, f));
      const lines = [];
      let head = null;
      for (const l of out.split('\n')) {
        if (l.startsWith('@')) head = l.slice(1).split('\t');
        // The first snapshot took in what was already there: not when it was written.
        else if (head && verb[l[0]]) { lines.push(`  ${head[0]}  ${head[1] === 'memory: first snapshot' ? 'in the first snapshot' : verb[l[0]]}`); head = null; }
      }
      // The command that shows a change, with the path git tracks: a junctioned
      // store's own path shows nothing, and PowerShell expands no `~`.
      const moved = !isShared(dir) && !isIndex(f) && existsSync(join(sharedStore(), f)) ? [`  promoted: it is in ${sharedStore()} now`] : [];
      if (lines.length) return { ok: true, lines: [join(dir, f), ...lines.slice(0, max), ...(lines.length > max ? [`  and ${lines.length - max} older; --limit N shows more`] : []), ...moved, `  a change: git -C "${real(projectsRoot())}" --literal-pathspecs show <commit> -- ${tracked(dir, f).map((p) => `"${p}"`).join(' ')}`] };
    }
  } catch (e) { return no(`no snapshots to read: ${gitWhy(e)}`); }
  return no(`no snapshot holds ${file} (looked in ${dirs.join(', ')}): search <words> finds a memory's name${everywhere ? '' : '; --all looks in every project'}`);
}

// By default the newest snapshot that has it: the last one, or, when the last
// one has it deleted, the one before that deletion. (The parent of the newest
// deletion alone brought back a version older than one made since.) The index
// line it had at that revision comes back with it: hand-written, where
// tiering's orphan recovery would give it a machine line in the archive.
export function restore(dir, file, { rev, force = false } = {}) {
  const path = join(dir, file), why = unsnapped();
  if (why) return no(why);
  if (existsSync(path) && !force) return no(`${path} exists; restore --force replaces it with the snapshot`);
  // Deleted here by a promote: brought back, it would be in both stores, loaded twice, drifting apart.
  // Not an index: every store has its own, and a deleted one read as promoted.
  if (!isShared(dir) && !isIndex(file) && existsSync(join(sharedStore(), file)) && !force) return no(`${file} was promoted: it is in ${sharedStore()}; restore --force brings a second copy back here`);
  // A commit's name, or one counted back from it (abc123^, HEAD~2): anything
  // else reached git as an option, and `--format=...` wrote git's own output
  // into the note.
  // No `..` either: `A..B:path` is a range, and git showed it as an empty note.
  if (rev !== undefined && !/^[\w^~]{1,80}$/.test(rev)) return no(`--rev takes a commit from history, like abc1234: not "${rev}"`);
  // The first path that has it (tracked): the error is the first path's.
  let from, bytes, failure;
  for (const at of tracked(dir, file)) {
    from = rev;
    try {
      if (!from) {
        // HEAD read once: a snapshot committed between two reads of it (another
        // window deleting the note) failed the restore.
        try { const head = git('rev-parse', '--short', 'HEAD').trim(); git('cat-file', '-e', `${head}:${at}`); from = head; }
        catch { const gone = git('log', '-1', '--format=%h', '--diff-filter=D', '--', at).trim(); from = gone ? `${gone}^` : 'HEAD'; }
      }
      try { bytes = gitBytes('cat-file', '-p', `${from}:${at}`); }
      // The commit history names as "deleted" no longer has it: the version it
      // deleted is the one before. Neither there: the error is the commit's own.
      catch (e) {
        if (!rev) throw e;
        try { bytes = gitBytes('cat-file', '-p', `${rev}^:${at}`); } catch { throw e; }
        from = `${rev}^`;
      }
      failure = null; break;
    } catch (e) {
      // In plain words when git only says it has no such path or commit (audit C-3).
      failure ??= !missing(e) ? `no snapshot of ${at} at ${from || 'HEAD'}: ${gitWhy(e)}` : rev ? `no snapshot of ${file} at ${rev}: history ${file.replace(/\.md$/, '')} lists the ones that hold it`
        : `no snapshot of ${file} (looked in ${dir}): search <words> finds a memory's name`;
    }
  }
  if (failure) return no(failure);
  let line = null;
  if (!isIndex(file)) {
    for (const idx of ['MEMORY.md', ARCHIVE]) {
      const t = tracked(dir, idx).map((at) => { try { return git('cat-file', '-p', `${from}:${at}`); } catch { return ''; } }).join('\n');
      line = take(t, (l) => target(l) === file).line;
      if (line) break;
    }
  }
  mkdirSync(dir, { recursive: true });
  const r = withLock(dir, () => {
    const cur = raw(path), curB = cur === null ? null : readFileSync(path);   // bytes too: a string loses a non-UTF-8 note's letters
    if (cur !== null && !force) return `${path} appeared meanwhile; nothing written`;
    // Already that version: "restored" here told the model a bad version was gone.
    if (cur !== null && (curB[0] === 0xEF && curB[1] === 0xBB && curB[2] === 0xBF ? curB.subarray(3) : curB).equals(bytes)) return `${path} already matches ${from}: nothing to restore; history lists older versions, --rev <commit> picks one`;
    // What --force replaces is kept in the repo, not lost: no snapshot may hold it yet.
    let kept = '';
    // No copy, no replace: the text it would overwrite was gone for good (1.3.1 audit D-8).
    // Under a ref: a blob nothing refers to is dangling, and gc deletes it.
    if (cur !== null) { try { const sha = execFileSync('git', gitArgs('hash-object', '-w', '--stdin'), { input: curB, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim(); git('update-ref', `refs/project-memory/replaced/${sha}`, sha); kept = `; what it replaced is kept: git -C "${real(projectsRoot())}" cat-file -p ${sha}`; } catch { return `${path} could not be copied into the snapshots first; nothing restored`; } }
    // Or one the disk refuses (a name Windows cannot hold, from a store synced from Linux).
    const w = put(path, cur, bytes);
    if (failed(w)) return `${path} could not be written (${w.slice(8)}); nothing restored`;
    if (w === 'conflict') return `${path} changed meanwhile; nothing written`;
    if (isIndex(file)) return `restored ${path} from ${from}${kept}`;
    const idx = join(dir, 'MEMORY.md'), main = raw(idx);
    if ([main, raw(join(dir, ARCHIVE))].some((t) => targets(t).some((x) => x === file || same(join(dir, x), path)))) return `restored ${path} from ${from}; its index line is still there${kept}`;
    if (!line) return `restored ${path} from ${from}; no index line at that revision: the next turn's tiering gives it one${kept}`;
    const next = main ? withLine(main, line) : line + '\n';
    const wi = put(idx, main, next);
    if (failed(wi)) return `restored ${path} from ${from}; its index line could not be written (${wi.slice(8)}): the next turn's tiering gives it one${kept}`;
    if (wi === 'conflict') return `restored ${path} from ${from}; the index changed meanwhile, so the next turn's tiering gives it a line${kept}`;
    return `restored ${path} from ${from}, with its line: ${line}${kept}`;
  });
  if (r === null) return no(`${dir} is busy (another hook holds it); try again`);
  return { ok: r.startsWith('restored'), lines: [r] };
}

// Copy, index, and only then remove: a failure part-way leaves the memory in
// both stores, never in neither.
export function promote(dir, file) {
  const to = sharedStore(), src = join(dir, file), dst = join(to, file);
  if (isShared(dir)) return no(`${file} is in the shared store already`);
  // Nor the journal's pointer: promoted, the next Stop wrote it again, and it was in both stores (audit C-1).
  if (isIndex(file) || file === 'handoff.md' || file === 'journal.md') return no('only a memory is shared, not an index, the handoff or the journal');
  if (!existsSync(src)) return no(`no ${src}`);
  if (existsSync(dst)) return no(`the shared store has a ${file} already: rename one, or merge them by hand`);
  mkdirSync(to, { recursive: true });
  // Project, then shared: whatever takes both locks takes them in this order.
  const r = withLock(dir, () => withLock(to, () => {
    const text = raw(src);
    if (text === null) return `${src} went away meanwhile; nothing moved`;
    let home = null, homeText = null, line = null;
    // Its line by the file it names: on Windows one written `(Casey.md)` names casey.md.
    const its = (x) => { const t = target(x); return !!t && (t === file || same(join(dir, t), src)); };
    // Not through a string if it is no UTF-8: the shared copy would hold U+FFFD, and the original be deleted.
    try { utf8Only(src, text); } catch (e) { return e.message; }
    for (const p of [join(dir, 'MEMORY.md'), join(dir, ARCHIVE)]) {
      const t = raw(p), l = t && take(t, its).line;
      if (l) { home = p; homeText = t; line = l; break; }
    }
    line ??= pointerLine(file, front(text).desc || 'promoted');
    const wd = put(dst, null, text);
    if (failed(wd)) return `${dst} could not be written (${wd.slice(8)}); nothing moved`;
    if (wd === 'conflict') return `the shared store got a ${file} meanwhile; nothing moved`;
    const idx = join(to, 'MEMORY.md'), idxText = raw(idx);
    const next = idxText ? withLine(idxText, line) : '# Shared memory\n\n' + line + '\n';
    const wx = put(idx, idxText, next);
    if (failed(wx)) return `the shared index could not be written (${wx.slice(8)}): ${file} is in both stores, not yet in the shared index`;
    if (wx === 'conflict') return `the shared index changed meanwhile: ${file} is in both stores, not yet in the shared index`;
    // The model's Edit takes no lock: one that landed since the copy keeps the
    // project copy, and its index line, where it was written.
    const edited = `${src} changed while it was copied: it is in both stores; merge the edit into ${dst}, then delete ${src} and its line by hand`;
    if (raw(src) !== text) return edited;
    const wh = home ? put(home, homeText, take(homeText, its).rest) : false;
    if (failed(wh)) return `the project index could not be written (${wh.slice(8)}): ${file} is in both stores; delete ${src} and its line by hand`;
    if (wh === 'conflict') return `the project index changed meanwhile: ${file} is in both stores; delete ${src} and its line by hand`;
    if (raw(src) !== text) return edited;
    try { unlinkSync(src); } catch (e) { return `${src} could not be deleted (${e.code}): it is in both stores; delete it by hand`; }
    return true;
  }));
  if (r === null) return no('a store is busy (another hook holds it); try again');
  if (r !== true) return no(r);
  // Over the shared ceiling, the next reply moves the oldest lines out to the
  // archive, which no startup prints: a lesson promoted into a full store
  // vanished from every session while this said each one would see it.
  const size = Buffer.byteLength(raw(join(to, 'MEMORY.md')) ?? ''), cap = budgetOf(to);
  return { ok: true, lines: [size <= cap ? `moved ${file} to ${to}; every project's sessions see its line from their next start`
    : `moved ${file} to ${to}. The shared index is now ${size} of its ${cap} bytes: after the next reply its oldest lines move to the shared archive, which no session start prints. To keep this one in view, add "tier: hot" to its frontmatter`] };
}

// The Stop hook's runs, oldest first, one JSON line each (memory-tier.mjs).
const stopRuns = () => (read(join(projectsRoot(), '.stop-ran')) ?? '').split('\n').flatMap((l) => { try { const r = JSON.parse(l); return r?.at ? [r] : []; } catch { return []; } });
// Two wirings answer one Stop at once. Not a /compact typed after a reply (a
// PreCompact run), nor the reply to a block (stop_hook_active): both are a
// second run seconds later, and both read as hooks wired twice. Nor two
// replies, by their fingerprints (`m`): a task's end answered in a line came
// under 2 s after the reply before it (audit H-F10). A run logged before 1.2.5 has none,
// so a run without one matches any: an old copy wired by hand next to the plugin.
const TWICE = 2000;
const twin = (r, p) => r.s && r.s === p.s && (r.e ?? 'Stop') === 'Stop' && (p.e ?? 'Stop') === 'Stop' && !r.h === !p.h && (!r.m || !p.m || r.m === p.m) &&
  Math.abs(Date.parse(r.at) - Date.parse(p.at)) < TWICE;

export function doctor(site = sessionStore()) {
  const lines = [];
  let bad = 0;
  const say = (fine, text) => { lines.push(`${fine ? 'ok     ' : 'PROBLEM'} ${text}`); if (!fine) bad++; };
  // What is installed and what ran, never what settings.json says: that file
  // can hold the user's keys, and the plugin directory holds a plugin that
  // reads it. The Stop hook logs each run in .stop-ran (memory-tier.mjs).
  const id = installedId(), runs = stopRuns();
  if (id) say(true, `installed as ${id}`);
  // No install record: added from claude.ai (`project-memory@synced`), or wired by hand.
  else if (runs.length) say(true, `the hooks run from ${runs.at(-1).from} (no install record: added from claude.ai, or wired by hand)`);
  else say(false, `not installed: the project-memory plugin is not installed, and its hooks have never run. The user's fix: claude plugin marketplace add zdraveski/project-memory, then claude plugin install ${PLUGIN}`);
  // Two runs for one reply, seconds apart: two wirings answered one Stop.
  const twice = runs.slice(-10).find((r, i, rs) => i > 0 && twin(r, rs[i - 1]));
  // Two enabled plugins of one name run one's hooks only (Claude Code leaves
  // the other's out): a second run is hooks added to settings.json by hand.
  if (twice) say(false, `the Stop hook ran twice for one reply (${local(twice.at)}): project-memory's hooks are wired twice, so every hook runs twice. The user's fix: remove the project-memory hooks added to settings.json by hand (the plugin wires its own); if a second copy is installed under another name, uninstall it`);
  const gone = isOff(site);
  if (gone) say(!gone.unread, offText(gone));
  // Auto memory turned off: the hooks do nothing, so nothing below applies.
  if (memoryOff()) { say(true, 'auto memory is off (CLAUDE_CODE_DISABLE_AUTO_MEMORY): the hooks save and brief nothing until it is on again'); return { ok: !bad, lines }; }
  if (existsSync(join(LIVE, '.deployed.json'))) { const e = edited(LIVE); say(!e.length, e[0] || `${LIVE} matches what deploy.mjs checked`); }
  // Installed from the live copy, the plugin runs it in place; from anywhere
  // else, a cached copy that only `claude plugin update` refreshes.
  if (id) {
    const at = pluginRoot();
    if (!at) say(false, `${id} is listed as installed, but with no folder. The user's fix: claude plugin install ${PLUGIN}`);
    // From GitHub, or from any copy where nothing was deployed: it runs that copy.
    else if (!existsSync(join(LIVE, '.deployed.json')) || (marketplace()?.source !== 'directory' && !deployedCommit(at))) {
      say(true, `the plugin runs version ${json(join(at, '.claude-plugin', 'plugin.json'))?.version ?? '(none)'} from ${at}`);
    }
    // Added from anywhere but the live copy (the repo, a worktree), it runs
    // untested edits, and no plugin update fixes that.
    else if (marketplace()?.source === 'directory' && !same(at, LIVE)) say(false, `the plugin is read from ${at}, not the live copy. The user's fix: claude plugin marketplace remove ${installedId().split('@')[1]}, then claude plugin marketplace add "${LIVE}" and claude plugin install ${PLUGIN}`);
    else if (deployedCommit(at) !== deployedCommit(LIVE)) say(false, `the plugin runs ${deployedCommit(at) || 'an undeployed copy'} from ${at}, the last deploy is ${deployedCommit(LIVE)}. The user's fix: claude plugin update ${PLUGIN}`);
    else { const e = edited(at); say(!e.length, e[0] || `the plugin runs the last deploy, ${deployedCommit(at)}, from ${at}`); }
  }
  const ran = join(projectsRoot(), '.stop-ran');
  if (!existsSync(ran)) {
    // Nothing has saved before Claude's first reply ends: that is waiting, and
    // a new install checked at once said PROBLEM. It is one when this
    // conversation finished a reply over a minute ago and still nothing saved.
    const id = session;
    // Outside a session (a terminal), the project's newest conversation: with
    // none to read, a dead hook said "waiting" forever.
    let end = NaN;
    try { const p = id ? transcriptOf(id) : transcripts(sessionStore(), '')[0]?.p; if (p) end = lastTurn(p).end; } catch {}
    if (Date.now() - end > GRACE) say(false, `Claude finished a reply at ${local(end)}, but project-memory has not saved after any reply: its Stop hook is not running. The user's fix: restart Claude Code; if that reply came before project-memory was installed, finish one more and check again; if this line stays, check that Node.js is installed (node --version); a disableAllHooks setting, --bare, --settings or CLAUDE_CODE_SKIP_PROMPT_HISTORY would cause this too`);
    else say(true, "waiting for Claude's first reply: project-memory saves each time Claude finishes one");
  } else {
    // The newest conversation, and the newest other than this one, which is
    // the one the startup briefing judges: checked on the newest alone, the
    // two disagreed when this window saved and another did not.
    const ts = transcripts(sessionStore(), '', session && transcriptOf(session)), s = [ts[0], ts.find((t) => t.s !== tag(session))].flatMap((t) => stalled(t, false));
    // A record there that won't stat (a scan holding it) is said: unguarded, doctor was a stack trace (audit H-F7).
    let when; try { when = `last ran ${local(statSync(ran).mtime)}`; } catch (e) { when = `has run, but ${ran} could not be read (${e.code || e.message}), so not when`; }
    say(!s.length, s[0] || `the Stop hook ${when}${runs.length ? ` (from ${runs.at(-1).from})` : ''}`);
  }
  const stale = allStores().map((d) => join(d, '.lock')).filter((l) => { try { return Date.now() - statSync(l).mtimeMs > LOCK_STALE; } catch { return false; } });
  if (stale.length) say(true, `locks a killed hook left, taken over at the next write: ${stale.join(', ')}`);
  // No git is a setup the README allows: everything works but the history.
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); say(true, 'git on PATH'); } catch { say(true, 'git is not installed: everything works except bringing back an old version of a note. Installing Git (git-scm.com) turns that on'); }
  // A repack Windows could not finish leaves an index with no pack: harmless,
  // but git warns of each one on every command the snapshot runs.
  const pack = join(projectsRoot(), '.git', 'objects', 'pack');
  let packs = []; try { packs = readdirSync(pack); } catch {}
  const orphans = packs.filter((f) => f.endsWith('.idx') && !packs.includes(f.replace(/\.idx$/, '.pack')));
  if (orphans.length) say(true, `${orphans.length} pack index file(s) in ${pack} have no pack (a repack that could not finish): harmless, but git warns of each on every command; the user can delete them: ${orphans.join(', ')}`);
  const snap = snapshots();
  say(!snap.startsWith('snapshots: failing') && !snap.includes('but they leave out'), snap);
  return { ok: !bad, lines };
}

// What status and doctor say of a project turned off.
const offText = (o) => (o.unread
  ? `memory is paused here: the off marker can't be read (${o.unread}); next: tell the user, memory on won't help until that's fixed`
  : `memory is off in this project since ${offSince(o)}; next: run memory on if the user asks to turn it back on`);
// What Claude Code and the snapshots still keep, said wherever the plugin says it saved less.
const STILL = "Claude Code by default still keeps its own transcript (30 days unless changed), and its own auto memory may still save notes.";

// Stop saving this conversation: marked private in its store, then what it already saved is swept (the next reply's Stop
// retries a sweep that failed). Nothing is marked unless the whole of it can be: the failure says which part is left.
function incognito(opt) {
  const path = session && transcriptOf(session);
  if (!opt) return no('incognito needs --session <id>: the /incognito command passes it, and nothing was marked');
  if (!session) return no(`incognito NOT applied: "${clip(opt, 100)}" is not a session id; nothing was marked`);
  if (!path) return no(`incognito NOT applied: no conversation ${session} on this machine; nothing was marked`);
  const dir = storeOf({ transcript_path: path }), s = tag(session);
  let got;
  try {
    mkdirSync(dir, { recursive: true });
    got = withLock(dir, () => {
      if (hushed(dir, s, true) !== true) return { marked: false };
      try { takeBack(dir, transcriptKey(path), s, true, true); return { marked: true }; } catch (e) { return { marked: true, why: reason(e) }; }
    });
  } catch (e) { return no(`incognito NOT applied: ${reason(e)}; nothing was marked`); }
  if (!got) return no('incognito NOT applied: the memory folder is busy (another hook holds its lock); nothing was marked. Try again.');
  if (!got.marked) return no(`incognito NOT applied: the private-session list in ${dir} could not be written; nothing was marked`);
  if (got.why) return no(`incognito is marked for this conversation, but sweeping what it already saved failed: ${got.why}. The next reply's Stop tries again; until then it may still be in the journal and handoff.`);
  return { ok: true, lines: [`incognito is on for this conversation: what it saved so far is swept from the journal and handoff.md, and nothing more is saved from it. ${STILL} Notes Claude writes in it are kept like any other note, so save no note unless the user asks; snapshots of days already over keep a copy.`] };
}

// memory off: a marker in the store, and the plugin saves, tiers and snapshots nothing there. memory on: the marker goes.
// What was said while it was off must not be written once it is on: the period is kept (store wasOff) before the marker goes.
// By time, not by conversation: one that runs across off and on keeps what it said before and after.
function projectSwitch(dir, off) {
  const marker = join(dir, PROJECT_OFF), was = isOff(dir);
  try {
    if (off) {
      if (was && !was.unread) return { ok: true, lines: [`memory is already off in this project since ${offSince(was)}`] };
      mkdirSync(dir, { recursive: true });
      if (replaceIfUnchanged(marker, raw(marker), JSON.stringify({ t: Date.now() })) === 'conflict') return no('memory off NOT applied: the marker was changed meanwhile; try again');
      return { ok: true, lines: [`memory is off in this project (${dir}): nothing is saved, tiered or snapshotted here until memory on. Off stops adding; it doesn't hide: search and show still answer. ${STILL}`] };
    }
    if (!was) return { ok: true, lines: ['memory is already on in this project'] };
    if (!was.unread) appendFileSync(join(dir, OFF_PERIODS), `${was.since ?? statSync(marker).mtimeMs} ${Date.now()}\n`);
    unlinkSync(marker);
    return { ok: true, lines: [`memory is on in this project again (${dir}). What was said while it was off stays out of the journal and the handoff.`] };
  } catch (e) { return no(`memory ${off ? 'off' : 'on'} NOT applied: ${reason(e)}${off ? '' : "; memory stays off"}`); }
}

// The command line, its words as given; returns the exit code. Callable in
// the same process: memory.test runs it so, where a process a call was 0.2 s
// of its 50 s, 256 times (2026-10-30). Each call starts with no session.
export function main(given) {
  session = '';
  // The command is the first word that is no option or an option's value, so
  // `--store X search foo` searches; none (the skill run with no arguments,
  // just `--session <id>`) is status.
  // `--store=X` as `--store X`: the equals form was dropped, and the command ran on the cwd's store.
  // After `--` every word is a term: `search -- --no-verify` printed the usage.
  const cut = given.includes('--') ? given.indexOf('--') : given.length;
  const argv = given.slice(0, cut).flatMap((a) => { const m = a.match(/^(--(?:store|rev|limit|session|since|until|conversation|key))=([\s\S]*)$/); return m ? [m[1], m[2]] : [a]; });
  const valued = new Set(['--store', '--rev', '--limit', '--session', '--since', '--until', '--conversation', '--key']);
  // One it does not know is refused: dropped, `--from 2026-10-27` searched for
  // "2026", and `--after=2026-10-28` listed what came before it.
  const unknown = argv.find((a, i) => a.startsWith('--') && !valued.has(argv[i - 1]) && !valued.has(a) && !['--all', '--shared', '--yes', '--force', '--same', '--help'].includes(a));
  if (unknown) { console.log(`unknown option ${unknown}; help lists the options`); return 1; }
  // A value is never an option, nor missing: `forget --key --store X` took "--store" for the key, and a last --key was dropped,
  // so the words alone said what went (audit C-7). --rev says what it takes itself.
  const bare = argv.find((a, i) => valued.has(a) && a !== '--rev' && !(a === '--session' && i === argv.length - 1) && !valued.has(argv[i - 1]) && (i + 1 >= argv.length || argv[i + 1].startsWith('--')));
  if (bare) { console.log(`${bare} needs a value after it`); return 1; }
  const at = argv.findIndex((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const cmd = argv.some((a, i) => (a === '--help' || a === '-h') && !valued.has(argv[i - 1])) ? 'help' : at === -1 ? 'status' : argv[at], rest = argv.filter((_, i) => i !== at);
  const opt = (n) => { const i = rest.indexOf(n); return i === -1 ? undefined : rest[i + 1]; };
  // A number, or refused: `--limit ten` was dropped unsaid, and the default
  // listed. One below 1 is still the default (a test holds it).
  if (opt('--limit') !== undefined && !/^-?\d+$/.test(opt('--limit'))) { console.log(`--limit takes a number, not ${opt('--limit')}`); return 1; }
  // A session id names a file: anything but an id's characters is ignored.
  if (/^[\w-]{1,100}$/.test(opt('--session') || '')) session = opt('--session');
  const args = [...rest.filter((a, i) => !a.startsWith('--') && !valued.has(rest[i - 1])), ...given.slice(cut + 1)];
  // Another store is a memory folder under the projects root: promote and
  // restore write where it points, and one anywhere else was written there.
  const store = opt('--store') && resolve(opt('--store'));
  if (store && !(basename(store) === 'memory' && same(dirname(dirname(store)), projectsRoot()))) {
    console.log(`--store takes a memory folder in ${projectsRoot()} (search names them): not ${store}`);
    return 1;
  }
  // Days compare as text: `--since yesterday` would match no day, and say nothing matched. Nor one no calendar has: 2026-02-30
  // matched nothing, and forget said so with exit 0 (audit C-5). A day past its month's end, or 00, rolls into another month.
  const isDay = (v) => { const [y, m, d] = v.split('-').map(Number); return /^\d{4}-\d\d-\d\d$/.test(v) && new Date(Date.UTC(y, m - 1, d)).getUTCMonth() === m - 1; };
  for (const o of ['--since', '--until']) if (rest.includes(o) && !isDay(opt(o) ?? '')) { console.log(`${o} takes a date like 2026-10-01`); return 1; }
  const range = { since: opt('--since'), until: opt('--until') }, failed = [];
  const span = [range.since && `since ${range.since}`, range.until && `until ${range.until}`].filter(Boolean).join(' ');
  const here = rest.includes('--shared') ? sharedStore() : store || sessionStore();
  // --all includes the shared store before it has an index, as the default does,
  // and a project whose only memory is its journal (allStores() wants a
  // MEMORY.md). Each once, by its real path, as allStores() counts them.
  const every = () => {
    let ps = []; try { ps = readdirSync(projectsRoot()); } catch {}
    const seen = new Set();
    return [...allStores(), sharedStore(), ...ps.map((p) => join(projectsRoot(), p, 'memory')).filter((d) => existsSync(join(d, 'journal')))]
      .filter((d) => { const k = pathKey(real(d)); return !seen.has(k) && seen.add(k); });
  };
  const scope = rest.includes('--all') ? every() : isShared(here) ? [here] : [here, sharedStore()];
  // A memory is named by its file, with or without `.md`; never by a path. Every word of it: typed without quotes, `restore my
  // note` answered about my.md (audit C-2). `.MD` is `.md`: PRICING.MD was looked for as PRICING.MD.md (audit C-8).
  const file = args[0] && basename(args.join(' ')).replace(/(\.md)?$/i, '.md');
  let r;
  // What the model reads back: a hit's lines stay short (a 13-link hit was a
  // quarter of its output), and a miss says where it looked in one line.
  const where = scope.length <= 2 ? scope.join(' and ') : `${scope.length} stores`, n = Number(opt('--limit'));
  // An entry's line; under --all, with the project it is from: forget and --store need its folder. Named first by where its
  // conversations started: the folder alone (`C--work-api-server`) was no name a person reads (audit C-9).
  const project = (d) => { const f = dirname(d); let t; try { t = readdirSync(f).find((n) => n.endsWith('.jsonl')); } catch {} const cwd = t && startCwd(join(f, t)); return cwd ? `${cwd} (${basename(f)})` : basename(f); };
  const head = (e) => `${e.at}  conversation ${clip(e.s, 100)}${e.branch ? ` · branch ${clip(e.branch, 100)}` : ''}${rest.includes('--all') ? ` · project ${project(e.dir)}` : ''}`;
  // Its transcript, for detail; not a private turn's: the only detail it has
  // is the private part, and the transcript still holds it (final review).
  const full = (e, conv = join(projectsRoot(), `${e.t}.jsonl`)) => (e.answered !== '[private]' && existsSync(conv) ? [`     Full conversation: ${conv}`] : []);
  // Words that say nothing of which memory ("what did I do") with a range: the range's listing.
  if (cmd === 'search' && args.length && (words(args.join(' ')).length || !(range.since || range.until))) {
    const q = args.join(' '), terms = words(q), found = search(scope, q, { ...range, failed });
    const out = found.outside ? [`${found.outside} note${found.outside === 1 ? ' matches' : 's match'} outside the range (a note's date is its last change); search without --since/--until`] : [];
    // One long request asked again and again (a prompt a script sends, a retry)
    // is one hit with a count: its copies filled the list (recall test, 2026-10-29).
    const groups = [], like = new Map();
    for (const h of found) {
      const k = h.kind === 'journal' && sameKey(h.asked).length >= SAME_MIN ? sameKey(h.asked) : null;
      if (k !== null && like.has(k)) like.get(k).push(h);
      else { groups.push([h]); if (k !== null) like.set(k, groups.at(-1)); }
    }
    const shown = groups.slice(0, n > 0 ? n : 10), find = new RegExp(terms.map((t) => (plain(t) ? t : alone(t).source)).join('|'), 'giu');
    // NFC, as the scoring reads it: a decomposed "é" scored the entry, and its stretch must show too.
    const nfc = (v) => clip(v, Infinity).normalize('NFC');
    const entry = (h, also) => {
      const hold = [['Answered', h.answered], ['Changed', h.changed.join(', ')], ['Ran', h.ran.join(' · ')]].filter(([, v]) => nfc(v).search(find) !== -1);
      const ds = [h, ...also].map((x) => x.day).sort(), at = nfc(h.answered).search(find);
      // Redacted before it is cut: a stretch must not cut a secret in two. The
      // copies' keys are named: a forget of the one shown left them (review).
      // No Result when the reply's stretch already starts at its start.
      return [`${String(h.score).padStart(3)}  journal   ${head(h)}`, `     key: ${clip(h.key, Infinity)}`, `     Asked: ${clip(h.asked, HIT_ASK)}`,
        ...(h.answered && !(at !== -1 && at <= HIT_SPAN) ? [`     Result: ${result(h.answered)}`] : []),
        ...hold.map(([k, v]) => `     ${k}: ${around(nfc(v), find, Math.floor(HIT_MORE / hold.length))}`),
        ...(also.length ? [`     ${also.length} more like this, ${ds[0]}..${ds.at(-1)}: ${more(also.map((x) => clip(x.key, Infinity)), 5)}; --same takes them all`] : [])];
    };
    const wider = rest.includes('--all') ? '' : '; --all searches every project';
    r = { ok: true, lines: !words(q).length ? [`nothing to search for: "${q}" has no word that says which memory`]
      : shown.length ? [...shown.flatMap(([h, ...also]) => h.kind === 'journal' ? entry(h, also) : [`${String(h.score).padStart(3)}  ${isShared(h.dir) ? 'shared ' : ''}${h.where.padEnd(9)} ${local(h.modified).slice(0, 10)}  ${h.path}`,
        `     ${clip(h.desc || '(no description)', 200)}`, ...(h.superseded ? [`     replaced by ${h.superseded}: read that one`] : []),
        ...(h.links.length ? [`     links: ${more(h.links, 5)}`] : [])]), ...(found.missing.length ? [`no note or entry holds: ${found.missing.join(', ')}`] : []), ...out,
        // A hit's date, and what was not shown or not searched.
        `${shown.length} of ${groups.length} match(es) in ${where}${groups.length > shown.length ? '; --limit N shows more' : ''}${wider}${shown.some(([h]) => h.kind === 'journal') ? "; show '<key>' prints an entry whole" : ''}`]
      : [...out, `nothing matches "${q}" in ${where}${span && ` ${span}`}${wider}`] };
  } else if (cmd === 'show' && args.length) {
    // An entry whole, by the key its hit printed: a day file is 150 KB, and read
    // for one entry, the wrong conversation's was taken (recall test, 2026-10-29).
    const es = told(scope, { failed }), got = args.map((k) => es.find((e) => e.key === k)), seen = new Set();
    const whole = (e) => [head(e), `     key: ${clip(e.key, Infinity)}`,
      ...[['Asked', e.asked], ['Answered', e.answered], ['Changed', e.changed.join(', ')], ['Ran', e.ran.join(' · ')]].filter(([, v]) => v).map(([k, v]) => `     ${k}: ${clip(v, Infinity)}`),
      `     Day file: ${e.path}`, ...full(e)];
    // --same: every entry asking what this one asked, the copies a hit counts.
    const alike = (e) => (rest.includes('--same') ? es.filter((x) => sameKey(x.asked) === sameKey(e.asked)) : [e]).filter((x) => !seen.has(x) && seen.add(x));
    r = { ok: got.every(Boolean), lines: got.flatMap((e, i) => e ? alike(e).flatMap((x) => whole(x)) : [`no journal entry has the key ${args[i]} in ${where}${rest.includes('--all') ? '' : '; --all looks in every project'}`]) };
  } else if (cmd === 'search' && (range.since || range.until)) {
    // What was asked on those days, newest first: "what did we do last week".
    const es = told(scope, { ...range, failed }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)), shown = es.slice(0, n > 0 ? n : 30);
    r = { ok: true, lines: es.length ? [...shown.map((e) => `${head(e)}  ${clip(e.asked, 200)}`), `${shown.length} of ${es.length} journal entries in ${where}${es.length > shown.length ? '; --limit N shows more' : ''}`]
      : [`no journal entry ${span} in ${where}`] };
  } else if (cmd === 'forget') {
    // A blank term is in every entry: `forget "" --yes` would empty the journal.
    const conversation = opt('--conversation'), yes = rest.includes('--yes'), terms = args.filter((a) => a.trim());
    const named = rest.flatMap((a, i) => (a === '--key' ? [rest[i + 1]] : []));
    // A key no entry here has is named, never skipped: a confirmed key of another
    // project's entry went unsaid, with exit 0 (review, 2026-10-29).
    const unread = [], stored = named.length ? entries([here], { failed: unread }) : [];
    // Nor one of a turn no day holds yet, in this store's conversations: a Stop that met the lock writes it after the next
    // reply, and named as another project's, it was kept out by no key and came back (fuzz seed 1729835215).
    // Not one forgotten before: in no day, and still in its conversation, it was found again and said removed (review).
    // Nor while a day won't read: a key of that day, found in its conversation, was said removed while the day still held it (R73).
    const listed = forgotten(read(join(here, FORGOTTEN))), already = new Set(listed.map(([k]) => k)), none = (k) => !stored.some((e) => e.key === k);
    // By words alone, every such turn holding them: a look by words missed one, and the next reply wrote it (1.2.5).
    const late = unread.length ? [] : terms.length && !named.length ? unwritten(here, [], terms).filter((e) => !already.has(e.key)) : unwritten(here, named.filter((k) => none(k) && !already.has(k)));
    stored.push(...late);
    const before = named.filter((k) => none(k) && already.has(k));
    let again = before.map((k) => `key ${k} is already forgotten; nothing to remove`);
    const lost = named.filter((k) => none(k) && !already.has(k)).map((k) => (unread.length ? `no day of ${here} that could be read has the key ${k}: it may be in one that could not, so nothing was removed for it`
      : `no entry in ${here} has the key ${k}; is it another project's? use --store with its memory folder`));
    // --same: every entry asking what a keyed one asked, the copies a hit counts.
    const asks = new Set(stored.filter((e) => named.includes(e.key)).map((e) => sameKey(e.asked)));
    const keys = rest.includes('--same') ? stored.filter((e) => asks.has(sameKey(e.asked))).map((e) => e.key) : named;
    // By the tag, from the full session id too: the skill has the id, an entry the tag.
    // Keys given filter even when none is left: no key is never "every entry".
    const o = { ...range, conversation: conversation && tag(conversation), keys: named.length ? keys : undefined, more: late, failed };
    // With its key: the look is how the user's entries are found, and --key removes them. Not an unwritten turn's words: its
    // conversation may be one the journal never takes (private, or held with auto memory off).
    const line = (e) => `${e.at}  conversation ${e.s}  ${e.unsaid ? '[not in the journal yet]' : clip(e.asked, 120)}  (key ${clip(e.key, Infinity)})`;
    // One store: under --all it ran on this one alone, and said "removed 0" of
    // an entry search had just shown in another.
    if (rest.includes('--all')) r = no(`forget works on one store: --store <folder>, the memory folder of the project a search hit names (${join(projectsRoot(), '<project>', 'memory')})`);
    // Not "delete the journal folder": the backfill's lists live in it, and
    // without them it rebuilds the journal from the transcripts, forgotten entries too.
    else if (!terms.length && !range.since && !range.until && !conversation && !named.length) r = no('forget needs words, a date range, --conversation or --key; to forget the whole journal, use --since 1970-01-01 --yes (deleting the journal folder rebuilds it from the conversations still on disk)');
    // forget() lists the journal strictly: one that will not list read as empty, "nothing matches" with exit 0, and the entry stayed
    // (F20, R45). Named, as a refused restore is, and alone: the --key lookup above read the same failure as "no entry has the key".
    else try {
      // A retry after a handoff.md that would not be written finds the keys listed and no day holding them: their exchanges
      // still go from handoff.md, by the conversation and minute the list keeps. Said "already forgotten" alone, they stayed (R73).
      if (yes && before.length) {
        const at = new Set(listed.filter(([k, t, m]) => t && m && before.includes(k)).map(([, t, m]) => `${tag(basename(t))} ${m}`));
        try {
          const w = withLock(here, () => unsay(here, (t) => at.has(`${t.s} ${t.at}`)));
          if (w === null) failed.push({ path: join(here, 'handoff.md'), code: 'busy', write: true });
          // The retry did something: said, not "nothing to remove" alone.
          // Said once: which of several keys still had an exchange there is not known here.
          else if (w === true) again = [...before.map((k) => `key ${k} is already forgotten; nothing to remove from the journal`), 'handoff.md holds none of these exchanges now'];
        }
        catch (e) { failed.push({ path: join(here, 'handoff.md'), code: e.code || e.message, write: true }); }
      }
      const m = forget(here, terms, o).matched, byRange = !terms.length && !named.length && !conversation;
      const ds = m.map((e) => e.day).sort(), shown = byRange ? m.slice(0, RANGE_SHOWN) : m;
      if (m.length > LOOK && !byRange) r = { ok: !yes, lines: [`${m.length} entries in ${here} match; narrow it: a look lists ${LOOK} at most${yes ? ', and --yes removes only what a look can list: nothing removed' : ''}`] };
      else if (!m.length) {
        // The words of a sentence ("the password I pasted yesterday"): the ones no entry holds are why nothing matched.
        // Not when the keys left no entry to hold them: the words were blamed for a key of another store.
        // One read, each word tried on it: a look per word read the journal once a word.
        const all = forget(here, [], { ...o, failed: [] }).matched, left = !named.length || all.length > 0;
        const none = left ? terms.filter((t) => !all.some((e) => holds(e, t.toLowerCase()))) : [];
        const why = !terms.length || !left ? '' : `: no entry holds ${none.length ? none.map((t) => `"${t}"`).join(', ') : 'every word'}`;
        r = { ok: true, lines: [`nothing in ${here} matches${why}`] };
      } else if (!yes) {
        r = { ok: true, lines: [...shown.map(line), ...(m.length > shown.length ? [`and ${m.length - shown.length} more`] : []),
          `${m.length} entr${m.length === 1 ? 'y' : 'ies'} in ${here}${byRange ? ` from ${ds[0]} to ${ds.at(-1)}` : ''} would go; run again with --yes to remove them`] };
      }
      else {
        // What this look found and nothing since: --yes removes only what a look lists.
        let got;
        try { got = forget(here, terms, { ...o, keys: m.map((e) => e.key), apply: true }); }
        catch (e) { failed.push({ path: String(e.dest || e.path || here).replace(/\.tmp\d+$/, ''), code: e.code || e.message, write: true }); got = { matched: m, removed: [] }; }
        // Under --yes, what went: a day that kept changing under the write, or
        // one the disk refused, keeps its entries, and listed they read as gone.
        const tried = got?.matched ?? [], gone = got?.removed ?? [];
        // A day before today is in the snapshots already (memory-tier commits a
        // day once it closes), when they are the plugin's: a repository the user
        // made there holds no journal, and deleting it would lose their history.
        const ours = /^\[project-memory\]/m.test(read(join(projectsRoot(), '.git', 'config')) ?? '');
        // Not an unwritten turn's day: no snapshot holds what no day did.
        const old = ours ? [...new Set(gone.filter((e) => !e.unsaid && e.day !== local().slice(0, 10)).map((e) => e.day))] : [];
        r = !got ? no(`${here} is busy (another hook holds it); try again`)
          // Past LOOK (a range's), the count, not every line.
          : { ok: true, lines: [...(gone.length > LOOK ? [] : gone.map(line)), ...(old.length ? [`the snapshots still hold the journal of ${more(old, 6)}: deleting ${join(projectsRoot(), '.git')} removes them, and every older version of every memory with them`] : []),
            // As PRIVACY.md says it: forget empties project-memory's files, and said nothing of Claude Code's own (audit C-6).
            ...(gone.length ? [`Claude Code still keeps these exchanges in its own conversation files (the .jsonl files in ${projectsRoot()}): forget does not change them`] : []),
            `removed ${gone.length}${gone.length === tried.length ? '' : ` of ${tried.length}`} from ${here}`] };
      }
      r.lines.splice(-1, 0, ...again);
      if (lost.length) { r.lines.splice(-1, 0, ...lost); r.ok = false; }
    } catch (e) { if (!e.code) throw e; r = no(`${join(here, 'journal')} could not be listed (${e.code}); nothing removed`); }
  } else if (cmd === 'incognito') r = incognito(opt('--session'));
  else if (cmd === 'off' || cmd === 'on') r = projectSwitch(here, cmd === 'off');
  else if (cmd === 'status') {
    const sharedNames = names(memories(sharedStore()));
    r = { ok: true, lines: [...scope.flatMap((d) => status(d, sharedNames)), snapshots()] };
  } else if (cmd === 'history' && file) r = history(scope, file, rest.includes('--all'), n > 0 ? n : undefined);
  else if (cmd === 'restore' && file) r = restore(here, named(here, file), { rev: opt('--rev'), force: rest.includes('--force') });
  else if (cmd === 'promote' && file) r = promote(here, onDisk(here, file));
  else if (cmd === 'doctor') r = doctor(here);
  // The usage, after why: a misspelt command, or one with no word after it,
  // printed the usage alone.
  else r = { ok: !cmd || cmd === 'help', lines: [...(cmd && cmd !== 'help' ? [/^(?:search|show|history|restore|promote)$/.test(cmd) ? `${cmd} needs a word after it` : `no command "${cmd}"`] : []), USAGE] };
  // A day that could not be read or written: what it holds is missing from, or
  // still in, the lines above. Before the last line of a search or a forget,
  // which is its count, as the skill says. Once: a forget reads a day twice.
  r.lines.splice(cmd === 'search' || cmd === 'forget' ? -1 : r.lines.length, 0, ...new Set(failed.map((f) => `could not ${f.write ? 'write' : 'read'} ${f.path}: ${f.code}`)));
  // A --session no transcript has: the store came from the folder this runs in, and status reported it in silence (audit C-10).
  if (opt('--session') !== undefined && cmd !== 'incognito' && !store && !rest.includes('--shared') && !rest.includes('--all') && !(session && transcriptOf(session))) r.lines.unshift(`no conversation ${clip(opt('--session'), 100)} on this machine, so this is the store of the folder this runs in: ${here}`);
  console.log(r.lines.join('\n'));
  // A forget that failed anywhere fails: exit 0 read as all gone.
  return r.ok && !(cmd === 'forget' && failed.length) ? 0 : 1;
}

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
// Not process.exit(): on macOS a pipe is written asynchronously, and exiting
// cut a 3-entry search at 8 KB (CI, 2026-10-29).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
