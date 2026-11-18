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
  forget [<words...>] [--key K]... [--same] [--since D] [--until D] [--conversation ID] [--yes] [--purge]
                                          the journal entries holding every word (with those keys, of
                                          that conversation): listed with their keys, up to 200; with
                                          --yes removed; --purge also drops those days from the snapshot history
  rescan [--apply [--yes]]                today's redaction rules over what is already saved (notes, journal,
                                          handoff, snapshots): counts and places only; --apply --yes backs up,
                                          then writes [redacted] and rewrites the snapshot history
  incognito                               stop saving this conversation and sweep what it already saved
                                          (needs --session: the command passes it)
  off | on                                turn this project's memory off (nothing saved, snapshotted or
                                          tiered) or back on; search and show still answer
  help                                    this (--help and -h too)
  status [--all]                          index size, hot/archived, problems, dangling [[links]],
                                          the memories changed in the last 7 days
  history <memory> [--all] [--limit N]    the snapshots that changed it, the newest 30
  restore <memory> [--rev <commit>] [--force]   back from the snapshots, with its index line
  promote <memory> [--force]              move it to the shared store, for every project; refused when
                                          it holds a key, token or password, unless --force
  enforce status                          each rule note: hits in the last 30 days from the live log
  enforce replay <note> [--all]           what the enforce: rule in a note (or in any .md file) would have
                                          caught in the last 30 days of this project's conversations, or
                                          every project's; read-only
  doctor                                  wiring, live copy, Stop hook, locks, git
The store is this session's own (outside a session: the cwd's project, or the nearest
folder above it with one) unless --store or --shared says otherwise. --session names
the conversation asking (the skill passes it): its store is this session's, and doctor
reads its transcript. After --, every word is a term, one that starts with -- too.`;
import { appendFileSync, readFileSync, readdirSync, existsSync, statSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, basename, dirname, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { holdsSecret, storeOf, sharedStore, isShared, projectsRoot, opener, withLock, replaceIfUnchanged, utf8Only, budgetOf, POINTER, ARCHIVE, isIndex, frontEnd, pointerLine, LOCK_STALE, raw, gitWhy, reason, gitArgs, front, allStores, pathKey, same, configDir, autoMemory, local, HANDOFF_FAILED, startCwd, PROJECT_OFF, OFF_PERIODS, isOff, offSince, transcriptKey } from './store.mjs';
import { ruleOf, hits, commandsOf, tally } from './enforce.mjs';
import { WINDOW, MODEL_WINDOW, TRIGGER, COMPACTS_AT } from './compact-gate.mjs';
import { BLOCK, redact, hushed, MISSED, HELD, sectionOf, parse, transcripts, stalled, lastTurn, GRACE, edited, clip, tag, unsaved, forgotten, FORGOTTEN, unsay } from './handoff-log.mjs';
// Loaded apart, as memory-tier loads it: a journal.mjs that will not load (or
// a copy without it) costs search the journal, said in its output, never doctor
// or restore. Imported statically, deploy.mjs would not start without it
// (handoff-log's deploy gate test, 2026-10-28).
let entries, forget, holds, summary, unwritten, takeBack, chunk;
try { ({ entries, forget, holds, summary, unwritten, takeBack, chunk } = await import('./journal.mjs')); }
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
// Hits from the 6th on print the request, Result and key only; a short request ("go", "yes") is shown with the reply before it.
const AGAIN = 'Not the entry you meant? Search again with other words.';   // the last line of a search with hits; failure notices stay above the count
const LOW_FROM = 5, SHORT_ASK = 25, BEFORE = 200;
const HIT_ASK = 200, HIT_SPAN = 30, HIT_MORE = 240, HIT_HEAD = 140;
// The first sentence of a reply's last text block (after the last BLOCK marker; an old entry has none: its first), HIT_HEAD at most: one of 20 characters or
// more, so a lone "Done." or "**Yes.**" is not taken for the whole outcome.
const result = (a) => { const t = clip(a.slice(a.lastIndexOf(BLOCK) + 1), HIT_HEAD); return /^.{20,}?[.!?](?=\s|$)/u.exec(t)?.[0] ?? t; };
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
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'he', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we',
  // Question filler: "which design skill did I put in all projects" ranked the real entry 7th (1.5.0 audit).
  'which', 'will', 'many', 'all', 'any', 'last', 'month', 'take', 'ever', 'just', 'before', 'after', 'some', 'got',
  'should', 'would', 'could', 'been', 'were', 'one', 'them', 'they', 'your', 'its', 'also', 'very', 'much', 'more', 'most', 'need',
  'want', 'like', 'used', 'tell', 'remind', 'again', 'week', 'day', 'today', 'yesterday', 'ago']);
// Two letters are a word too: CI, PR, DB were never found. But only standing
// alone: `ci` is in "decision".
// Combining marks (\p{M}) belong to the word (Hindi), and both sides are NFC so a decomposed "e" + accent is "é".
// A version (1.4.3, v1.4.3) is one word, matched whole: split at the dots, its pieces were all dropped, and 1.4.3 is not 1.4.30.
const VERSION = /(?<![\p{L}\p{N}.])v?(\d+(?:\.\d+)+)/gu;
const isVer = (t) => /^\d+(?:\.\d+)+$/.test(t);
// A one-dot version (1.4) is every release of it (1.4.1), so only a three-part version refuses a further .N.
const verRe = (t) => new RegExp(`(?<![\\p{L}\\p{N}.])v?${t.replaceAll('.', '\\.')}(?!\\p{N}${t.split('.').length > 2 ? '|\\.\\p{N}' : ''})`, 'gu');
// Word forms: the query's word loses one regular ending, and the match finds the longer forms (the index is not stemmed).
// shortcut: regular endings only (run and ran, or decide and decision, are not one word; no irregular-verb table).
// A root of 5 letters or more matches at the start of a word (migrat: migrate, migration). A root of 3 or 4 letters from
// s, es, ed, ing, ies or ied (and a 3-letter word as typed) matches only itself and those endings, so "log" finds logs, logged
// and logging but not login, and "planned" finds plan but not planet. A 3-letter root needs a vowel and one of s, es, ed, ing.
// A final y or e is dropped only when an ending was cut, so "ready" is not "read". "-us" and "-is" words (status) keep their s.
const EN_SUF = ['ational', 'ations', 'ation', 'ments', 'ment', 'ingly', 'ings', 'ing', 'edly', 'ies', 'ied', 'ures', 'ure', 'ed', 'es', 's', 'ly'];
// Macedonian: articles, plurals and common verb endings; the stem stays 3 letters or more.
const MK_SUF = ['ињата', 'ијата', 'ување', 'увања', 'ите', 'ата', 'ото', 'ета', 'ови', 'еви', 'ања', 'ање', 'вме', 'вте', 'ше', 'ме', 'те', 'та', 'то', 'от', 'ов', 'ва', 'во', 'ве', 'он', 'на', 'но', 'не', 'ат', 'ам', 'аш', 'и', 'а', 'е', 'о', 'у'];
const INFL = new Set(['s', 'es', 'ed', 'ing', 'ings', 'ies', 'ied']), DOUBLED = new Set(['ed', 'ing', 'ings', 'edly', 'ingly']);
// An English word as [root, the ending cut, the final y or e dropped].
function cutEn(t) {
  let x = t, cut = '', drop = '';
  for (const f of EN_SUF) {
    const n = x.length - f.length;
    if (x.endsWith(f) && (n >= 4 || n === 3 && ['s', 'es', 'ed', 'ing'].includes(f) && /[aeiou]/.test(x.slice(0, 3))) && !(f === 's' && /(ss|us|is)$/.test(x))) { x = x.slice(0, -f.length); cut = f; break; }
  }
  if (DOUBLED.has(cut) && x.length >= 4 && /([b-df-hj-np-tv-z])\1$/.test(x) && !/(ll|ss|zz|ff)$/.test(x)) x = x.slice(0, -1);
  else if (cut && x.length > 4 && /[^aeiou][ye]$/.test(x)) { drop = x.at(-1); x = x.slice(0, -1); }
  return [x, cut, drop];
}
function stem(t) {
  if (/^[a-z]+$/.test(t)) return cutEn(t)[0];
  if (/^[Ѐ-ӿ]+$/.test(t)) for (const f of MK_SUF) if (t.endsWith(f) && t.length - f.length >= 3) return t.slice(0, -f.length);
  return t;
}
// The search words of a query, each as its stem; `.as` gives the word as typed. `any`: a query of only stop words
// searches them rather than nothing. Without it, only words that say which memory (a date range alone lists the days).
const words = (q, any = false) => {
  const n = q.normalize('NFC').toLowerCase();
  const all = [...[...n.matchAll(VERSION)].map((m) => m[1]), ...n.replace(VERSION, ' ').split(/[^\p{L}\p{M}\p{N}]+/u).filter((t) => t.length >= 2 || CJK.test(t))];
  const kept = all.filter((t) => !STOP.has(t)), as = new Map();
  for (const t of kept.length || !any ? kept : all) if (!as.has(stem(t))) as.set(stem(t), t);
  return Object.assign([...as.keys()], { as });
};
// Han, Hiragana and Katakana have no spaces round a word, so they are not the letters a Latin word must not touch.
const CJK = /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]$/u, NC = '(?![\\p{scx=Han}\\p{scx=Hiragana}\\p{scx=Katakana}])';
const alone = (t) => new RegExp(`(?<!${NC}[\\p{L}\\p{M}\\p{N}])${t}(?!${NC}[\\p{L}\\p{M}\\p{N}])`, 'gu');
// Chinese and Japanese have no spaces round a word, so a two-character one is looked for as a substring.
const plain = (t) => t.length > 2 || /^[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]+$/u.test(t);
// A cut stem counts only at the start of a word: "stor" finds "store" and "storage", not "history" (`cut`: the term was shortened).
// A short English root (see stem()) is a whole word with its endings instead; `w` is the word as typed.
const starts = (t, w = t) => {
  const [r, f, d] = /^[a-z]+$/.test(w) ? cutEn(w) : [], B = `(?<!${NC}[\\p{L}\\p{N}])`;
  if (!r || r.length > 4 || !(f ? INFL.has(f) : r.length === 3)) {
    // An uncut consonant + y word also finds its plural and past: library, libraries; story, stories (not store).
    const y = !f && /[^aeiou]y$/.test(t) ? `|${t.slice(0, -1)}i(?:es|ed)` : '';
    return new RegExp(`${B}(?:${t}${y})`, 'gu');
  }
  const l = r.at(-1), o = [`e?(?:s|es|d|ed|ing|ings|ies|ied|${l}ed|${l}ing|${l}ings)`];
  if (!d && !(f === 'ed' && r.endsWith('e'))) o.push(['s', 'es', 'ed', 'ing', 'ings'].includes(f) ? 'e?' : '');
  return new RegExp(`${B}(?:${w}|${r}(?:${o.join('|')}))(?!${NC}[\\p{L}\\p{N}])`, 'gu');
};
// A term is matched as word forms when it was cut, is a 3-letter English word, or ends in a consonant and y (library: libraries).
const forms = (t, cut) => (cut || /^[a-z]{3}$/.test(t) || /^[a-z]*[^aeiou]y$/.test(t)) && plain(t);
const count = (hay, t, cut) => (isVer(t) ? (hay.match(verRe(t)) ?? []).length : forms(t, cut) ? (hay.normalize('NFC').match(starts(t, cut || t)) ?? []).length : plain(t) ? hay.normalize('NFC').split(t).length - 1 : (hay.normalize('NFC').match(alone(t)) ?? []).length);
const has = (hay, t, cut) => (isVer(t) ? verRe(t).test(hay) : forms(t, cut) ? starts(t, cut || t).test(hay.normalize('NFC')) : plain(t) ? hay.normalize('NFC').includes(t) : alone(t).test(hay.normalize('NFC')));
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
// Rare words win: each term is weighted by how few notes and entries hold it (1 + ln of N over df), so "476" or "quokka"
// outranks "first" or "schedule". The score a hit prints stays the plain sum; the weights only order the hits.
// `outside`: the notes that match but are dated out of the range.
export function search(dirs, query, { since, until, failed } = {}) {
  const terms = words(query, true), cut = (t) => terms.as.get(t) !== t && terms.as.get(t), hits = [], held = new Set(), df = terms.map(() => 0);
  let outside = 0, docs = 0;
  // `parts`: what each term scored, in terms' order; `bonus`: the +5 or +2 for every term.
  const add = (h, parts, bonus) => hits.push({ ...h, score: parts.reduce((a, p) => a + p, 0) + bonus, parts, bonus });
  for (const dir of terms.length ? dirs : []) for (let m of memories(dir)) {
    // The journal's pointer is no memory; handoff.md is searched in its hand-written part, not its automatic log (which repeats the journal).
    if (m.file === 'journal.md') continue;
    const hand = m.file === 'handoff.md';
    if (hand) {
      // A start marker with no end marker (a half-written file): the log runs to the end of the file.
      // Every block is cut, last first (sectionOf finds the last one); each cut shortens the text, so the loop ends.
      let body = m.body;
      for (;;) {
        const { a, b } = [body, `${body}
<!-- auto:end -->`].map(sectionOf).find((x) => x.a !== -1) ?? { a: -1 };
        if (a === -1) break;
        body = body.slice(0, a) + body.slice(b).replace(/^[^\n]*/, '');
      }
      if (!body.trim()) continue;
      m = { ...m, file: '', name: '', desc: '', body };   // its name is no match: only what a person wrote
    }
    docs++;
    const name = `${m.file} ${m.name}`.toLowerCase(), desc = m.desc.toLowerCase(), body = m.body.toLowerCase();
    let strong = true, every = true;
    const got = [], parts = terms.map((t, i) => {
      const s = (has(name, t, cut(t)) ? 3 : 0) + (has(desc, t, cut(t)) ? 2 : 0);
      const b = Math.min(2, count(body, t, cut(t)));
      if (!s) strong = false;
      if (!s && !b) every = false; else { got.push(t); df[i]++; }
      return s + b;
    });
    if (!parts.some((p) => p)) continue;
    const d = local(m.modified).slice(0, 10);   // the date its hit line shows
    // A note's date is its last change: written in September and edited since,
    // a September search left it out, and the miss read as no record.
    if ((since && d < since) || (until && d > until)) { outside++; continue; }
    got.forEach((t) => held.add(t));
    add({ ...m, kind: 'note', ...(hand && { file: 'handoff.md', desc: 'the hand-written part of the handoff' }) }, parts, strong ? 5 : every ? 2 : 0);
  }
  // An entry by what was asked, then what it changed and ran (and its branch),
  // then the reply: a reply that names everything must not outrank the request.
  for (const e of terms.length ? told(dirs, { since, until, failed }) : []) {
    docs++;
    const asked = e.asked.toLowerCase(), did = [...e.changed, ...e.ran].join('\n').toLowerCase(), branch = e.branch.toLowerCase(), answered = e.answered.toLowerCase();
    let strong = true, every = true;
    const parts = terms.map((t, i) => {
      // A branch is named on every entry of its work: below a file or command that names the word.
      const s = (has(asked, t, cut(t)) ? 3 : 0) + (has(did, t, cut(t)) ? 2 : has(branch, t, cut(t)) ? 1 : 0) + Math.min(2, count(answered, t, cut(t)));
      if (!has(asked, t, cut(t))) strong = false;
      if (!s) every = false; else { held.add(t); df[i]++; }
      return s;
    });
    if (parts.some((p) => p)) add({ ...e, kind: 'journal', modified: Date.parse(e.at.replace(' ', 'T')) }, parts, strong ? 5 : every ? 2 : 0);
  }
  const w = df.map((n) => 1 + Math.log((docs + 1) / (n + 1))), avg = w.reduce((a, x) => a + x, 0) / (w.length || 1);
  // A long entry or note says more of everything: its rank falls with its length (a pasted request, the big handoff). A phrase
  // typed as is, in the entry's text, earns a bonus; the marker between a turn's text blocks is a space.
  const flat = (x) => x.toLowerCase().normalize('NFC').replace(/[\s⁣]+/g, ' '), phrase = terms.length > 1 && flat(query).trim();
  for (const h of hits) {
    const long = h.kind === 'journal' ? h.asked.length / 200 : h.body.length / 1000;   // a note's body is longer than a request: it counts from 1,000 characters
    h.rank = (h.parts.reduce((a, p, i) => a + p * w[i], 0) + h.bonus * avg) / (1 + 0.5 * Math.log(Math.max(1, long)));
    if (phrase && flat((h.kind === 'journal' ? [h.asked, h.answered, ...h.changed, ...h.ran] : [h.name, h.desc, h.body]).join('\n')).includes(phrase)) h.rank += 4 * avg;
  }
  return Object.assign(hits.sort((a, b) => b.rank - a.rank || b.modified - a.modified), { outside, missing: terms.filter((t) => !held.has(t)).map((t) => terms.as.get(t)) });
}

// What a [[link]] may name: a memory's file name without `.md`, or its `name:`.
const names = (ms) => ms.flatMap((m) => [m.file.replace(/\.md$/, ''), m.name].filter(Boolean));

// handoff.md past this is hard to read, for people and for Claude (audit: 89 to 204 KB in real projects, +25 to 35 KB a week).
const HANDOFF_WARN = 64 * 1024;
export function handoffBig(dir) {
  let n = 0; try { n = statSync(join(dir, 'handoff.md')).size; } catch { return null; }
  return n > HANDOFF_WARN ? `handoff.md is ${Math.round(n / 1024)} KB (over ${HANDOFF_WARN / 1024} KB). To trim it: delete the finished topics from the part you wrote by hand, above the automatic log; the journal keeps every exchange, so nothing is lost from search` : null;
}
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
  const big = handoffBig(dir); if (big) lines.push(`  needs attention: ${big}`);
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
    : h.held?.length ? `snapshots: ok, last ${local(h.lastOk)}, but they skip ${h.held.join(', ')}: ${HELD}`
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

// forget --purge: drop the days that held a forgotten entry from every snapshot, then expire the reflog and collect, so no
// old commit keeps the text. The current files stay; the next snapshot adds them back without the entry.
// shortcut: a purged day loses its older versions whole, not just the entry; upgrade to a line filter if that is missed.
const rewrite = (work) => {
  // filter-branch refuses a repository with unstaged changes, and a store always has some (notes edited since the last snapshot):
  // it rewrites a bare copy, which is fetched back over the branches (the work tree and its files stay as they are), and the
  // index is reset to the new HEAD so it holds no old blob.
  // The snapshot hook takes no lock but git's own, and reads a fresh config.lock (nothing here writes config) as busy: the purge
  // holds that one for its whole run, and gives way to a commit already in flight, whose work the stale copy would overwrite.
  const g = join(projectsRoot(), '.git'), lock = join(g, 'config.lock'), busy = new Error('a snapshot is being taken; try again in a moment');
  if (['index.lock', 'HEAD.lock'].some((f) => existsSync(join(g, f)))) throw busy;
  try { writeFileSync(lock, '', { flag: 'wx', mode: 0o600 }); } catch (e) { throw e.code === 'EEXIST' ? busy : e; }
  // A run that was killed left its copy, the full unscrubbed history, behind; holding the lock, no other run is using one.
  try { for (const n of readdirSync(g)) if (n.startsWith('pm-purge-')) rmSync(join(g, n), { recursive: true, force: true }); } catch {}
  // The copy sits in the repository's own .git, which no snapshot commits; the OS temp folder was outside the store.
  const tmp = mkdtempSync(join(g, 'pm-purge-')), copy = join(tmp, 'copy.git');
  try {
    git('clone', '-q', '--mirror', '--no-hardlinks', projectsRoot(), copy);
    work(copy);
    git('fetch', '-q', '--update-head-ok', '--force', copy, '+refs/heads/*:refs/heads/*');
    git('reset', '-q');
    for (const ref of git('for-each-ref', '--format=%(refname)', 'refs/original/').split('\n').filter(Boolean)) git('update-ref', '-d', ref);
    git('reflog', 'expire', '--expire=now', '--all'); git('gc', '-q', '--prune=now');
  } finally { rmSync(tmp, { recursive: true, force: true }); try { unlinkSync(lock); } catch {} }
};
// A fast-export stream without the M and D lines of `paths`; data blocks are skipped by their length, so their text is never read as a line.
const dropPaths = (buf, paths) => {
  const out = [], gone = new Set(paths);
  // git quotes a path with odd bytes: "..." with \ooo octal escapes.
  const plain = (s) => s[0] !== '"' ? s : Buffer.from(s.slice(1, -1).replace(/\\(?:([0-7]{3})|(.))/g, (_, o, c) => o ? String.fromCharCode(parseInt(o, 8)) : ({ n: '\n', t: '\t' })[c] ?? c), 'latin1').toString();
  let at = 0;
  while (at < buf.length) {
    let e = buf.indexOf(10, at); if (e < 0) e = buf.length - 1;
    const line = buf.subarray(at, e + 1), t = line.toString().slice(0, -1), d = /^data (\d+)$/.exec(t);
    at = e + 1;
    if (d) { out.push(line, buf.subarray(at, at + +d[1])); at += +d[1]; continue; }
    const p = /^M \d+ \S+ (.*)$/.exec(t)?.[1] ?? /^D (.*)$/.exec(t)?.[1];
    if (p === undefined || !gone.has(plain(p))) out.push(line);
  }
  return Buffer.concat(out);
};
const purge = (dir, days) => {
  const paths = days.flatMap((d) => tracked(dir, `journal/${d}.md`));
  rewrite((copy) => execFileSync('git', ['-C', copy, 'fast-import', '--force', '--quiet'], { ...FAST, input: dropPaths(execFileSync('git', ['-C', copy, 'fast-export', '--all', '--signed-tags=strip'], QUIET_FAST), paths) }));
};

// rescan: today's redaction rules over what is already saved (notes, journal, handoff, every snapshot): counts and places, never a
// value. --apply --yes backs up first, then writes [redacted] over each hit and rewrites the history. Markers already in the
// text are set aside, so a second run finds nothing new.
const REMOVED = '***REMOVED***';
const scrub = (s) => {
  const p = s.replaceAll(REMOVED, '[redacted]'), t = redact(p), n = t.split('[redacted]').length - p.split('[redacted]').length;
  return n > 0 ? [t, n] : [s, 0];
};
// A git fast-export stream with every text blob, commit and tag message scrubbed and its length prefix recomputed; a blob that is
// not UTF-8 stays as it is. shortcut: file names in the stream are not scanned; a secret in a file name stays.
const walk = (buf) => {
  const out = [], dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }), changed = new Set(), files = new Set();
  let at = 0, hits = 0, blobs = 0, commits = 0, hit = false, blob = false, mark = null;
  while (at < buf.length) {
    let e = buf.indexOf(10, at); if (e < 0) e = buf.length - 1;
    const line = buf.subarray(at, e + 1), t = line.toString(), d = /^data (\d+)\n$/.exec(t);
    at = e + 1;
    if (!d) {
      if (/^(?:blob\n|commit |tag |reset )/.test(t)) { if (t.startsWith('commit')) { commits += hit; hit = false; } blob = t === 'blob\n'; mark = null; }
      const m = /^mark :(\d+)\n$/.exec(t), mm = /^M \d+ :(\d+) (.*)\n$/.exec(t);
      if (m && blob) mark = m[1];
      if (mm && changed.has(mm[1])) { hit = true; files.add(mm[2]); }
      out.push(line); continue;
    }
    const body = buf.subarray(at, at + +d[1]); at += +d[1];
    let to = body, n = 0;
    try { const [s, c] = scrub(dec.decode(body)); if (c) { to = Buffer.from(s); n = c; } } catch {}
    if (n) { hits += n; if (blob) { blobs++; changed.add(mark); } else hit = true; }
    out.push(Buffer.from(`data ${to.length}\n`), to);
  }
  return { out: Buffer.concat(out), hits, blobs, commits: commits + hit, files };
};
// shortcut: the whole history is read into one buffer (1 GiB cap) and only branches come back from the rewrite, so a hand-made tag keeps old text; upgrade to streaming or fetch all refs if that is hit.
const FAST = { maxBuffer: 1 << 30, timeout: 300_000 }, QUIET_FAST = { ...FAST, stdio: ['ignore', 'pipe', 'ignore'] };   // git warns about a ref that names a blob
// restore keeps the note it replaces under a ref that names a blob, which fast-export skips.
const blobRefs = () => git('for-each-ref', '--format=%(objecttype) %(objectname) %(refname)').split('\n').map((l) => l.split(' ')).filter((p) => p[0] === 'blob').flatMap(([, sha, ref]) => {
  try { const text = git('cat-file', 'blob', sha), [to, c] = scrub(text); return c ? [{ ref, text, to, c }] : []; } catch { return []; }
});
const rescan = (stores, apply, yes) => {
  const root = projectsRoot(), found = [];
  for (const dir of stores) for (const sub of ['', 'journal']) {
    let names = []; try { names = readdirSync(join(dir, sub)); } catch {}
    for (const n of names.filter((x) => x.endsWith('.md') || (!sub && x === 'handoff.md.prev'))) {
      const f = join(dir, sub, n); let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }   // a folder named x.md, or a file that cannot be read
      const [to, c] = scrub(text);
      if (c) found.push({ dir, f, text, to, c });
    }
  }
  let hist = null, kept = [];
  if (!unsnapped()) try { hist = walk(execFileSync('git', gitArgs('fast-export', '--all', '--signed-tags=strip'), QUIET_FAST)); kept = blobRefs(); }
  catch (e) { return no(`the snapshots could not be read (${reason(e.stderr ? { message: String(e.stderr).trim() } : e)}); nothing changed`); }
  const nf = found.reduce((a, x) => a + x.c, 0), nh = (hist?.hits ?? 0) + kept.reduce((a, x) => a + x.c, 0), s = (n) => (n === 1 ? '' : 's');
  const lines = [`files now: ${nf} secret${s(nf)} in ${found.length} file${s(found.length)}${found.length ? `: ${more(found.map((x) => `${relative(root, x.f).replace(/\\/g, '/')} (${x.c})`), 20)}` : ''}`,
    hist ? `snapshots: ${nh} secret${s(nh)} in ${hist.blobs} saved version${s(hist.blobs)} of ${hist.files.size} file${s(hist.files.size)}, in ${hist.commits} snapshot${s(hist.commits)}${kept.length ? `, and ${kept.length} kept copies of replaced notes` : ""}${hist.files.size ? `: ${more([...hist.files], 20)}` : ''}` : 'snapshots: none to scan'];
  if (!nf && !nh) return { ok: true, lines: [...lines, 'nothing found; nothing changed'] };
  if (!apply) return { ok: true, lines: [...lines, 'nothing has been changed (dry run); rescan --apply --yes redacts them'] };
  const backup = join(configDir(), `project-memory-rescan-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const warn = ['Before you go on, revoke or rotate each secret with the service that issued it. Rewriting does not take back a copy made elsewhere.',
    'This rewrites your memory history and cannot be undone: every snapshot that held a secret gets a new ID.',
    `First a backup is made at ${backup}. The backup still holds the secrets, on purpose. Delete it when you have checked the result; it is not deleted for you.`,
    "Copies this cannot clean: Claude Code's own conversation files, other copies of this folder, and synced folders. Delete old copies, or they bring the old text back."];
  if (!yes) return { ok: true, lines: [...warn, ...lines, 'nothing has been changed; add --yes to go on'] };
  const g = join(root, '.git');
  if (['index.lock', 'HEAD.lock', 'config.lock'].some((f) => existsSync(join(g, f)))) return no('a snapshot is being taken; try again in a moment; nothing changed');
  mkdirSync(join(backup, 'files'), { recursive: true, mode: 0o700 });
  console.log(warn.join('\n'));   // before the rewrite: a failure or a timeout must not lose where the backup is
  if (hist) git('bundle', 'create', join(backup, 'snapshots.bundle'), '--all');
  for (const x of found) { const to = join(backup, 'files', relative(root, x.f)); mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, x.text, { mode: 0o600 }); }
  kept.forEach((x) => writeFileSync(join(backup, 'files', `kept-${basename(x.ref)}.md`), x.text, { mode: 0o600 }));
  const out = [];
  let left = 0;
  // Files first: a snapshot taken while the history is rewritten then commits redacted text.
  for (const dir of new Set(found.map((x) => x.dir))) {
    const r = withLock(dir, () => found.filter((x) => x.dir === dir).map((x) => replaceIfUnchanged(x.f, x.text, x.to)));
    if (!r) { out.push(`${dir} is busy; its files were not changed, run again`); left++; } else if (r.includes('conflict')) { out.push(`a file in ${dir} changed while this ran; run again for it`); left++; }
  }
  try {
    for (const x of kept) git('update-ref', x.ref, execFileSync('git', gitArgs('hash-object', '-w', '--stdin'), { input: x.to, encoding: 'utf8' }).trim());
    if (nh) rewrite((copy) => execFileSync('git', ['-C', copy, 'fast-import', '--force', '--quiet'], { ...FAST, input: walk(execFileSync('git', ['-C', copy, 'fast-export', '--all', '--signed-tags=strip'], QUIET_FAST)).out }));
  } catch (e) { return { ok: false, lines: [...out, `the snapshots could not be rewritten (${reason(e.stderr ? { message: String(e.stderr).trim() } : e)}); backup: ${backup}`] }; }
  const after = nh && walk(execFileSync('git', gitArgs('fast-export', '--all', '--signed-tags=strip'), QUIET_FAST)).hits + blobRefs().length;
  out.push(`redacted ${nf} in files and ${nh} in the snapshots; ${after ? `${after} still found in the snapshots` : 'the snapshots hold none now'}`, `backup: ${backup}`);
  return { ok: !left && !after, lines: out };
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
  const blocks = [];
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
      // --all prints a block per project that has the memory; without it the first.
      if (lines.length) { blocks.push([join(dir, f), ...lines.slice(0, max), ...(lines.length > max ? [`  and ${lines.length - max} older; --limit N shows more`] : []), ...moved, `  a change: git -C "${real(projectsRoot())}" --literal-pathspecs show <commit> -- ${tracked(dir, f).map((p) => `"${p}"`).join(' ')}`]); if (!everywhere) break; }
    }
  } catch (e) { return no(`no snapshots to read: ${gitWhy(e)}`); }
  if (blocks.length) return { ok: true, lines: blocks.flat() };
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
  mkdirSync(dir, { recursive: true, mode: 0o700 });
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
export function promote(dir, file, { force = false } = {}) {
  const to = sharedStore(), src = join(dir, file), dst = join(to, file);
  if (isShared(dir)) return no(existsSync(src) ? `${file} is in the shared store already` : `${file} is not in the shared store: promote moves a project memory into it, so drop --shared`);
  // Nor the journal's pointer: promoted, the next Stop wrote it again, and it was in both stores (audit C-1).
  if (isIndex(file) || file === 'handoff.md' || file === 'journal.md') return no('only a memory is shared, not an index, the handoff or the journal');
  if (!existsSync(src)) return no(`no ${src}`);
  if (!statSync(src).isFile()) return no(`${src} is a folder, not a memory`);
  if (existsSync(dst)) return no(`the shared store has a ${file} already: rename one, or merge them by hand`);
  mkdirSync(to, { recursive: true, mode: 0o700 });
  // Project, then shared: whatever takes both locks takes them in this order.
  const r = withLock(dir, () => withLock(to, () => {
    const text = raw(src);
    if (text === null) return `${src} went away meanwhile; nothing moved`;
    let home = null, homeText = null, line = null;
    // Its line by the file it names: on Windows one written `(Casey.md)` names casey.md.
    const its = (x) => { const t = target(x); return !!t && (t === file || same(join(dir, t), src)); };
    // Not through a string if it is no UTF-8: the shared copy would hold U+FFFD, and the original be deleted.
    try { utf8Only(src, text); } catch (e) { return e.message; }
    // Every project reads the shared store: a secret copied there is read by all of them and kept in its git history.
    if (!force && holdsSecret(text)) return `${file} holds what looks like a key, token or password, and every project reads the shared store; nothing moved. Remove it, or promote --force to copy it as it is`;
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
  // fine: true (ok), false (PROBLEM) or 'note' (a state that is allowed but not good news).
  const say = (fine, text) => { lines.push(`${fine === 'note' ? 'note   ' : fine ? 'ok     ' : 'PROBLEM'} ${text}`); if (!fine) bad++; };
  // What is installed and what ran, never what settings.json says (but the two values read below): that file
  // can hold the user's keys, and the plugin directory holds a plugin that
  // reads it. The Stop hook logs each run in .stop-ran (memory-tier.mjs).
  const id = installedId(), runs = stopRuns();
  if (id) say(true, `installed as ${id}`);
  // No install record: added from claude.ai (`project-memory@synced`), or wired by hand.
  else if (runs.length) say(true, `the hooks run from ${runs.at(-1).from} (no install record: added from claude.ai, or wired by hand)`);
  else say(false, `not installed: the project-memory plugin is not installed, and its hooks have never run. The user's fix: claude plugin marketplace add zdraveski/project-memory, then claude plugin install ${PLUGIN}`);
  // Auto-update of this plugin's marketplace, as Claude Code keeps it in known_marketplaces.json (autoUpdate: true once switched on; a
  // GitHub marketplace other than the official one is off until then). A folder marketplace is the developer's own: not said.
  { const m = id && plugins('known_marketplaces.json')?.[id.split('@')[1]];
    if (m?.source?.source === 'github') say(true, m.autoUpdate === true ? 'marketplace auto-update is on: Claude Code fetches new versions at startup' : 'marketplace auto-update is off: new versions arrive only after you update by hand. To turn it on: /plugin, Marketplaces, project-memory, Enable auto-update'); }
  // Two runs for one reply, seconds apart: two wirings answered one Stop.
  const twice = runs.slice(-10).find((r, i, rs) => i > 0 && twin(r, rs[i - 1]));
  // Two enabled plugins of one name run one's hooks only (Claude Code leaves
  // the other's out): a second run is hooks added to settings.json by hand.
  if (twice) say(false, `the Stop hook ran twice for one reply (${local(twice.at)}): project-memory's hooks are wired twice, so every hook runs twice. The user's fix: remove the project-memory hooks added to settings.json by hand (the plugin wires its own); if a second copy is installed under another name, uninstall it`);
  const gone = isOff(site);
  if (gone) say(!gone.unread, offText(gone));
  // The enforce hook fails open, so a broken copy would be silent: run the copy the plugin runs. Before the early return below.
  const root = pluginRoot();
  // A copy with no hooks.json at all is not one doctor can judge (the Stop checks below name a plugin that wires nothing).
  if (root && existsSync(join(root, 'hooks', 'hooks.json'))) say(...enforceHook(root));
  // Auto memory turned off: the hooks do nothing, so nothing below applies.
  const am = autoMemory();
  if (am.off) { say(true, `auto memory is off (${am.why}): the hooks save and brief nothing until it is on again. Not seen by doctor: --settings, --bare, safe mode, server-managed settings`); return { ok: !bad, lines }; }
  const big = handoffBig(site); if (big) say(true, big);
  { const k = (n) => `${Math.round(n / 1000)}k`; say(true, `compaction window ${k(WINDOW)} of the model's ${k(MODEL_WINDOW)}: Claude Code compacts at ${k(COMPACTS_AT * WINDOW)}, the memory reminder comes at ${k(TRIGGER * WINDOW)}`); }
  // The one setting doctor reads (never printed but for its presence): the hooks keep the default folder, and a note in the moved one is
  // never tiered, snapshotted or briefed.
  if (typeof json(join(configDir(), 'settings.json'))?.autoMemoryDirectory === 'string') say(false, 'the autoMemoryDirectory setting is set, and project-memory does not follow it: notes in that folder are not tiered, snapshotted or briefed (the hooks work on the default memory folder). Remove the setting to use project-memory');
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
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); say(true, 'git on PATH'); } catch { say('note', 'git is not installed: everything works except bringing back an old version of a note. Installing Git (git-scm.com) turns that on'); }
  // A repack Windows could not finish leaves an index with no pack: harmless,
  // but git warns of each one on every command the snapshot runs.
  const pack = join(projectsRoot(), '.git', 'objects', 'pack');
  let packs = []; try { packs = readdirSync(pack); } catch {}
  const orphans = packs.filter((f) => f.endsWith('.idx') && !packs.includes(f.replace(/\.idx$/, '.pack')));
  if (orphans.length) say(true, `${orphans.length} pack index file(s) in ${pack} have no pack (a repack that could not finish): harmless, but git warns of each on every command; the user can delete them: ${orphans.join(', ')}`);
  // A killed forget --purge leaves a full copy of the history, forgotten text included, in .git.
  try { for (const n of readdirSync(join(projectsRoot(), '.git'))) if (n.startsWith('pm-purge-') && Date.now() - statSync(join(projectsRoot(), '.git', n)).mtimeMs > LOCK_STALE) say(false, `${join(projectsRoot(), '.git', n)} is a copy of the snapshot history, with text you may have forgotten, left by a killed purge. The user's fix: run forget <word> --purge again (it removes the copy first), or delete that folder`); } catch {}
  const snap = snapshots();
  say(snap.startsWith('snapshots: failing') || snap.includes('but they leave out') ? false : /^snapshots: (off|none recorded yet)|but they skip/.test(snap) ? 'note' : true, snap);
  return { ok: !bad, lines };
}

// Whether the plugin copy at `at` has the PreToolUse group and an enforce hook that starts, exits 0 and prints nothing: [fine, text].
function enforceHook(at) {
  const file = join(at, 'enforce-hook.mjs');
  if (!existsSync(file)) return [false, `${file} is missing: the enforce hook cannot run. The user's fix: claude plugin update ${PLUGIN}`];
  if (!json(join(at, 'hooks', 'hooks.json'))?.hooks?.PreToolUse?.length) return [false, `hooks.json in ${at} has no PreToolUse group: the enforce hook is not wired. The user's fix: claude plugin update ${PLUGIN}`];
  if (!json(join(at, 'hooks', 'hooks.json'))?.hooks?.SubagentStop?.length) return [false, `hooks.json in ${at} has no SubagentStop group: subagent reports are not saved. The user's fix: claude plugin update ${PLUGIN}`];
  try {
    const out = execFileSync(process.execPath, [file], { input: '{}', encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
    return out ? [false, `the enforce hook printed output for an empty call (${clip(out, 80)}): it must print nothing`] : [true, 'the enforce hook runs and is wired (PreToolUse)'];
  } catch (e) { return [false, `the enforce hook failed an empty call (exit code ${e.status ?? e.code}): ${file}`]; }
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
  if (!opt) return no('incognito needs --session <id>: the /project-memory:incognito command passes it, and nothing was marked');
  if (!session) return no(`incognito NOT applied: "${clip(opt, 100)}" is not a session id; nothing was marked`);
  if (!path) return no(`incognito NOT applied: no conversation ${session} on this machine; nothing was marked`);
  const dir = storeOf({ transcript_path: path }), s = tag(session);
  let got;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
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
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (replaceIfUnchanged(marker, raw(marker), JSON.stringify({ t: Date.now() })) === 'conflict') return no('memory off NOT applied: the marker was changed meanwhile; try again');
      return { ok: true, lines: [`memory is off in this project (${dir}): nothing is saved, tiered or snapshotted here until memory on. Off stops adding; it doesn't hide: search and show still answer. ${STILL}`] };
    }
    if (!was) return { ok: true, lines: ['memory is already on in this project'] };
    if (!was.unread) appendFileSync(join(dir, OFF_PERIODS), `${was.since ?? statSync(marker).mtimeMs} ${Date.now()}\n`);
    unlinkSync(marker);
    return { ok: true, lines: [`memory is on in this project again (${dir}). What was said while it was off stays out of the journal and the handoff.`] };
  } catch (e) { return no(`memory ${off ? 'off' : 'on'} NOT applied: ${reason(e)}${off ? '' : "; memory stays off"}`); }
}

// What the rule in a note would have caught: every git command of the last 30 local days in the folders' conversations
// (the sub-agents' files too), read-only. A line longer than REPLAY_SEG is a tool result, passed over.
const REPLAY_SEG = 8 << 20, pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function replay(here, args, all, label, failed) {
  const w = args.slice(1).join(' ');
  if (args[0] !== 'replay' || !w) return { ok: false, lines: ['enforce takes status, or replay <note> [--all]', USAGE] };
  if (!chunk) return { ok: false, lines: ['replay needs journal.mjs, which did not load'] };
  const p = /\.md$/i.test(w) && existsSync(w) && statSync(w).isFile() ? w : join(here, onDisk(here, basename(w).replace(/(\.md)?$/i, '.md')));
  let text; try { text = readFileSync(p, 'utf8'); } catch { return { ok: false, lines: [`no note ${w} in ${here}`] }; }
  const r = ruleOf(text);
  if (!r) return { ok: false, lines: [`${p} has no enforce: block`] };
  if (r.bad) return { ok: false, lines: [`the rule in ${p} is bad: ${r.bad}`] };
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 30);
  let entries = []; try { if (all) entries = readdirSync(projectsRoot(), { withFileTypes: true }); } catch { return { ok: false, lines: ['no projects folder'] }; }
  const folders = all ? entries.filter((e) => e.isDirectory() && e.name !== '_shared').map((e) => join(projectsRoot(), e.name)) : [dirname(here)];
  const found = []; let checked = 0, matched = 0;
  const jsonl = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(d, e.name)); } catch { return []; } };
  for (const folder of folders) {
    let subs = []; try { subs = readdirSync(folder, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(folder, e.name)); } catch {}
    if (process.stderr.isTTY) process.stderr.write(`reading ${folder}\n`);
    const name = label(join(folder, 'memory'));
    if (isOff(join(folder, 'memory'))) continue; // memory off: that project's commands are not copied into this conversation
    for (const [file, sub] of [...jsonl(folder).map((f) => [f, false]), ...subs.flatMap((d) => jsonl(join(d, 'subagents')).map((f) => [f, true]))]) {
      try {
        if (statSync(file).mtimeMs < from) continue;
        const s = tag(sub ? basename(dirname(dirname(file))) : basename(file, '.jsonl'));
        if (hushed(join(folder, 'memory'), s) !== false) continue; // incognito, or the list unread: not printed
        commandsOf(file, chunk, REPLAY_SEG, (c) => {
          if (!(c.t >= from)) return;
          checked++;
          const h = hits(r.rule, c.command);
          if (h.on) matched++;
          if (h.hit) found.push({ t: c.t, name, s, sub, command: c.command });
        });
      } catch (e) { failed.push({ path: file, code: e.code }); }
    }
  }
  found.sort((a, b) => a.t - b.t);
  const by = {}; for (const f of found) by[f.name] = (by[f.name] || 0) + 1;
  return { ok: true, lines: [...found.map((f) => `${local(f.t)}  ${f.name}  ${f.s}${f.sub ? '  [subagent]' : ''}  ${clip(f.command, 160)}`),
    `checked ${pl(checked, 'git command')}, ${matched} are git ${r.rule.on}, ${pl(found.length, 'hit')} in ${pl(new Set(found.map((f) => f.s)).size, 'session')}, ${pl(Object.keys(by).length, 'project')}`,
    ...(found.length ? [`hits by project: ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(', ')}`] : []),
    'Read each hit. A hit is a catch only if you agree the command broke the lesson.'] };
}

// Each rule note with the hits the live log holds for it in the last 30 local days, and what the log cannot say.
function enforceStatus(here) {
  const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 30);
  const { notes } = tally(here, from.getTime()), n = (x) => x.main + x.sub;
  const off = autoMemory().off || isOff(here);
  return { ok: true, lines: [...(off ? ['memory is off here: watch is paused'] : []),
    ...(notes.length ? notes.map((x) => x.bad ? `${x.file}  bad rule: ${x.bad}` : n(x) ? `${x.file}  ${pl(n(x), 'hit')} in 30 days (${x.main} main, ${x.sub} subagent), last ${local(x.last)}` : `${x.file}  no hits in 30 days`) : [`no enforce: rules in ${here}`]),
    'To see the commands, run `memory enforce replay <note>`.'] };
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
  const unknown = argv.find((a, i) => a.startsWith('--') && !valued.has(argv[i - 1]) && !valued.has(a) && !['--all', '--shared', '--yes', '--force', '--same', '--purge', '--apply', '--help'].includes(a));
  if (unknown) { console.log(`unknown option ${unknown}; help lists the options`); return 1; }
  // A value is never an option, nor missing: `forget --key --store X` took "--store" for the key, and a last --key was dropped,
  // so the words alone said what went (audit C-7). --rev says what it takes itself.
  // An empty --conversation (an unset variable in quotes) is none given: forget took it for "every conversation".
  const bare = argv.find((a, i) => valued.has(a) && a !== '--rev' && !(a === '--session' && i === argv.length - 1) && !valued.has(argv[i - 1]) && (i + 1 >= argv.length || argv[i + 1].startsWith('--') || (a === '--conversation' && argv[i + 1] === '')));
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
  // A leading ~ is the home folder: only a POSIX shell expands it, PowerShell and cmd pass it as typed (SKILL.md writes it so).
  const store = opt('--store') && resolve(opt('--store').replace(/^~(?=[\\/]|$)/, homedir()));
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
  // A short request answers the reply before it: the conversation's previous entry (not a subagent's report), its key and its reply's end.
  const short = (e) => e.asked.trim().length <= SHORT_ASK;
  const replyTo = (all, e) => {
    if (!short(e)) return [];
    const same = all.filter((x) => x.t === e.t && !x.key.startsWith('subagent-')).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const p = same[same.findIndex((x) => x.key === e.key) - 1], tail = p && p.answered.split(BLOCK).join('').replace(/\s+/g, ' ').trim();
    return tail ? [`     Reply to key ${clip(p.key, Infinity)}: ${tail.length > BEFORE ? `…${tail.slice(-BEFORE).replace(/^[\uDC00-\uDFFF]/, '')}` : tail}`] : [];
  };
  const full = (e, conv = join(projectsRoot(), `${e.t}.jsonl`)) => (e.answered !== '[private]' && existsSync(conv) ? [`     Full conversation: ${conv}`] : []);
  // Words that say nothing of which memory ("what did I do") with a range: the range's listing.
  if (cmd === 'search' && args.length && (words(args.join(' ')).length || !(range.since || range.until))) {
    const q = args.join(' '), terms = words(q, true), found = search(scope, q, { ...range, failed });
    const out = found.outside ? [`${found.outside} note${found.outside === 1 ? ' matches' : 's match'} outside the range (a note's date is its last change); search without --since/--until`] : [];
    // One long request asked again and again (a prompt a script sends, a retry)
    // is one hit with a count: its copies filled the list (recall test, 2026-10-29).
    const groups = [], like = new Map();
    for (const h of found) {
      const k = h.kind === 'journal' && sameKey(h.asked).length >= SAME_MIN ? sameKey(h.asked) : null;
      if (k !== null && like.has(k)) like.get(k).push(h);
      else { groups.push([h]); if (k !== null) like.set(k, groups.at(-1)); }
    }
    const shown = groups.slice(0, n > 0 ? n : 10), find = new RegExp(terms.map((t) => (isVer(t) ? verRe(t).source : plain(t) ? (forms(t, terms.as.get(t) !== t && terms.as.get(t)) ? starts(t, terms.as.get(t)).source : t) : alone(t).source)).join('|'), 'giu');
    // NFC, as the scoring reads it: a decomposed "é" scored the entry, and its stretch must show too.
    const nfc = (v) => clip(v, Infinity).normalize('NFC');
    const unmark = (a) => a.split(BLOCK).join('');
    const entry = (h, also, low) => {
      const hold = low ? [] : [['Answered', unmark(h.answered)], ['Changed', h.changed.join(', ')], ['Ran', h.ran.join(' · ')]].filter(([, v]) => nfc(v).search(find) !== -1);
      const ds = [h, ...also].map((x) => x.day).sort(), at = nfc(unmark(h.answered)).search(find);
      // Redacted before it is cut: a stretch must not cut a secret in two. The
      // copies' keys are named: a forget of the one shown left them (review).
      // No Result when the reply's stretch already starts at its start.
      return [`${String(h.score).padStart(3)}  journal   ${head(h)}`, `     key: ${clip(h.key, Infinity)}`, `     Asked: ${clip(h.asked, HIT_ASK)}`,
        ...(h.answered && (low || !(at !== -1 && at <= HIT_SPAN)) ? [`     Result: ${result(h.answered)}`] : []),
        ...hold.map(([k, v]) => `     ${k}: ${around(nfc(v), find, Math.floor(HIT_MORE / hold.length))}`),
        ...(also.length ? [`     ${also.length} more like this, ${ds[0]}..${ds.at(-1)}: ${more(also.map((x) => clip(x.key, Infinity)), 5)}; --same takes them all`] : [])];
    };
    const wider = rest.includes('--all') ? '' : '; --all searches every project';
    // A miss while the first import runs is not yet a miss: what is left to import is counted only then (summary() reads every day file).
    const importing = shown.length || !terms.length ? 0 : scope.reduce((t, d) => { try { return t + (summary(d).left || 0); } catch { return t; } }, 0);
    let journals = 0;   // the short form counts journal hits only, not the notes above them
    r = { ok: true, lines: !terms.length ? [`nothing to search for: "${q}" has no word that says which memory`]
      : shown.length ? [...shown.flatMap(([h, ...also]) => h.kind === 'journal' ? entry(h, also, journals++ >= LOW_FROM) : [`${String(h.score).padStart(3)}  ${isShared(h.dir) ? 'shared ' : ''}${h.where.padEnd(9)} ${local(h.modified).slice(0, 10)}  ${h.path}`,
        `     ${clip(h.desc || '(no description)', 200)}`, ...(h.superseded ? [`     replaced by ${h.superseded}: read that one`] : []),
        ...(h.links.length ? [`     links: ${more(h.links, 5)}`] : [])]), ...(found.missing.length ? [`no note or entry holds: ${found.missing.join(', ')}`] : []), ...out,
        // A hit's date, and what was not shown or not searched.
        `${shown.length} of ${groups.length} match(es) in ${where}${groups.length > shown.length ? '; --limit N shows more' : ''}${wider}${shown.some(([h]) => h.kind === 'journal') ? "; show '<key>' prints an entry whole" : ''}`, AGAIN]
      : [...out, importing ? `no match yet for "${q}" in ${where}${span && ` ${span}`}: the journal is still importing ${importing} older conversation${importing === 1 ? '' : 's'}, so search again in a few minutes${wider}`
        : `nothing matches "${q}" in ${where}${span && ` ${span}`}${wider}`] };
  } else if (cmd === 'show' && args.length) {
    // An entry whole, by the key its hit printed: a day file is 150 KB, and read
    // for one entry, the wrong conversation's was taken (recall test, 2026-10-29).
    const es = told(scope, { failed }), got = args.map((k) => es.find((e) => e.key === k)), seen = new Set();
    const whole = (e) => [head(e), `     key: ${clip(e.key, Infinity)}`, ...replyTo(es, e),
      ...[['Asked', e.asked], ['Answered', e.answered.split(BLOCK).join('')], ['Changed', e.changed.join(', ')], ['Ran', e.ran.join(' · ')]].filter(([, v]) => v).map(([k, v]) => `     ${k}: ${clip(v, Infinity)}`),
      `     Day file: ${e.path}`, ...full(e)];
    // --same: every entry asking what this one asked, the copies a hit counts.
    const alike = (e) => (rest.includes('--same') ? es.filter((x) => sameKey(x.asked) === sameKey(e.asked)) : [e]).filter((x) => !seen.has(x) && seen.add(x));
    r = { ok: got.every(Boolean), lines: got.flatMap((e, i) => e ? alike(e).flatMap((x) => whole(x)) : [`no journal entry has the key ${args[i]} in ${where}${rest.includes('--all') ? '' : '; --all looks in every project'}`]) };
  } else if (cmd === 'search' && (range.since || range.until)) {
    // What was asked on those days, newest first: "what did we do last week".
    const es = told(scope, { ...range, failed }).filter((e) => !e.key.startsWith('subagent-')).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)), shown = es.slice(0, n > 0 ? n : 30);
    const all = shown.some(short) ? told(scope, { failed }) : [];   // the reply before a short request may be on an earlier day
    const dropped = [...new Set(args.join(' ').toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((t) => STOP.has(t)))];
    r = { ok: true, lines: [...(dropped.length ? [`ignored filler words: ${dropped.join(', ')}`] : []), ...es.length ? [...shown.flatMap((e) => [`${head(e)}  ${clip(e.asked, 200)}`, ...replyTo(all, e)]), `${shown.length} of ${es.length} journal entries in ${where}${es.length > shown.length ? '; --limit N shows more' : ''}`]
      : [`no journal entry ${span} in ${where}`]] };
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
        // The journal no longer holds it (forgotten before) but the snapshots may: the days whose versions held every word go.
        // Plain words only: a key, conversation or date range that matched nothing must not widen into every day holding the words.
        // shortcut: words are looked up as plain text in any case (git folds ASCII letters only), per day; a day holding them in different entries is purged too.
        if (yes && terms.length && !named.length && !conversation && !range.since && !range.until && rest.includes('--purge') && /^\[project-memory\]/m.test(read(join(projectsRoot(), '.git', 'config')) ?? '')) {
          try {
            const days = terms.map((t) => new Set(tracked(here, 'journal').flatMap((at) => git('log', '--all', '-i', '--format=', '--name-only', '-S' + t, '--', at).split('\n')).map((p) => p.split('/').pop().replace(/\.md$/, '')).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d))));
            const hit = [...days[0]].filter((d) => days.every((s) => s.has(d)));
            if (hit.length) { purge(here, hit); r.lines = [`the journal of ${here} no longer holds it; purged the journal of ${more(hit, 6)} from the snapshots`]; }
          } catch (e) { r = no(`the snapshots could not be purged (${reason(e.stderr ? { message: String(e.stderr).trim() } : e)})`); }
        }
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
        let purged = null;
        if (ours && got && rest.includes('--purge')) {
          try { purge(here, [...new Set(tried.map((e) => e.day))]); purged = 'purged from the snapshots too'; }
          catch (e) { purged = `the snapshots could not be purged (${reason(e.stderr ? { message: String(e.stderr).trim() } : e)}); the old snapshots still hold the text: run the same forget command again with --purge`; }
        }
        r = !got ? no(`${here} is busy (another hook holds it); try again`)
          // Past LOOK (a range's), the count, not every line.
          : { ok: true, lines: [...(gone.length > LOOK ? [] : gone.map(line)), ...(old.length && purged === null ? [`the snapshots still hold the journal of ${more(old, 6)}: forget --purge removes it from them, or deleting ${join(projectsRoot(), '.git')} removes them, and every older version of every memory with them`] : []),
            // As PRIVACY.md says it: forget empties project-memory's files, and said nothing of Claude Code's own (audit C-6).
            ...(gone.length ? [`Claude Code still keeps these exchanges in its own conversation files (the .jsonl files in ${projectsRoot()}): forget does not change them`] : []),
            `removed ${gone.length}${gone.length === tried.length ? '' : ` of ${tried.length}`} from ${here}${purged ? `; ${purged}` : ''}`] };
      }
      r.lines.splice(-1, 0, ...again);
      if (lost.length) { r.lines.splice(-1, 0, ...lost); r.ok = false; }
    } catch (e) { if (!e.code) throw e; r = no(`${join(here, 'journal')} could not be listed (${e.code}); nothing removed`); }
  } else if (cmd === 'enforce') r = args[0] === 'status' ? enforceStatus(here) : replay(here, args, rest.includes('--all'), project, failed);
  else if (cmd === 'rescan') r = rescan(every(), rest.includes('--apply'), rest.includes('--yes'));
  else if (cmd === 'incognito') r = incognito(opt('--session'));
  else if (cmd === 'off' || cmd === 'on') r = projectSwitch(here, cmd === 'off');
  else if (cmd === 'status') {
    const sharedNames = names(memories(sharedStore()));
    const am = autoMemory();
    r = { ok: true, lines: [...(am.off ? [`auto memory is off (${am.why}): nothing is saved or briefed`] : []), ...scope.flatMap((d) => status(d, sharedNames)), snapshots()] };
  } else if (cmd === 'history' && file) r = history(scope, file, rest.includes('--all'), n > 0 ? n : undefined);
  else if (cmd === 'restore' && file) r = restore(here, named(here, file), { rev: opt('--rev'), force: rest.includes('--force') });
  else if (cmd === 'promote' && file) r = promote(here, onDisk(here, file), { force: rest.includes('--force') });
  else if (cmd === 'doctor') r = doctor(here);
  // The usage, after why: a misspelt command, or one with no word after it,
  // printed the usage alone.
  else r = { ok: !cmd || cmd === 'help', lines: [...(cmd && cmd !== 'help' ? [/^(?:search|show|history|restore|promote)$/.test(cmd) ? `${cmd} needs a word after it` : `no command "${cmd}"`] : []), USAGE] };
  // A day that could not be read or written: what it holds is missing from, or
  // still in, the lines above. Before the last line of a search or a forget,
  // which is its count, as the skill says. Once: a forget reads a day twice.
  r.lines.splice(r.lines.at(-1) === AGAIN ? -2 : cmd === 'search' || cmd === 'forget' ? -1 : r.lines.length, 0, ...new Set(failed.map((f) => `could not ${f.write ? 'write' : 'read'} ${f.path}: ${f.code}`)));
  // A --session no transcript has: the store came from the folder this runs in, and status reported it in silence (audit C-10).
  if (opt('--session') !== undefined && cmd !== 'incognito' && !store && !rest.includes('--shared') && !rest.includes('--all') && !(session && transcriptOf(session))) r.lines.unshift(`no conversation ${clip(opt('--session'), 100)} on this machine, so this is the store of the folder this runs in: ${here}`);
  // A note's file name or [[link]] can hold a secret the model wrote: read-only listings scrub what they print.
  console.log(r.lines.map(redact).join('\n'));
  // A forget that failed anywhere fails: exit 0 read as all gone.
  return r.ok && !(cmd === 'forget' && failed.length) ? 0 : 1;
}

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
// Not process.exit(): on macOS a pipe is written asynchronously, and exiting
// cut a 3-entry search at 8 KB (CI, 2026-10-29).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
