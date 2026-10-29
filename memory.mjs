#!/usr/bin/env node
// What a person, or the model, asks of the memory the hooks keep: find a
// memory, see a store's state, take one back from the snapshots, share one with
// every project, check the hooks are wired. The hooks write on their own; this
// writes only when told to, under the same lock.
const USAGE = `node memory.mjs <command> [--store <dir> | --shared]
  search <terms...> [--since D] [--until D] [--all] [--limit N]
                                          memories (name, description, then body; archive included)
                                          and the journal (asked, then changed and ran, then answered),
                                          ranked, a request asked many times once. D is YYYY-MM-DD; dates with
                                          no terms list those days' requests
  show <key...> [--all]                   journal entries whole, by the key a search hit prints
  forget <words...> [--since D] [--until D] [--conversation TAG] [--yes]
                                          the journal entries holding every word: listed; with --yes removed
  status [--all]                          index size, hot/archived, problems, dangling [[links]],
                                          the memories changed in the last 7 days
  history <memory> [--all]                the snapshots that changed it
  restore <memory> [--rev <commit>] [--force]   back from the snapshots, with its index line
  promote <memory>                        move it to the shared store, for every project
  doctor                                  wiring, live copy, Stop hook, locks, git
The store is this session's own (outside a session: the cwd's project, or the nearest
folder above it with one) unless --store or --shared says otherwise. After --, every
word is a term, one that starts with -- too.`;
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs';
import { join, relative, basename, dirname, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { storeOf, sharedStore, isShared, projectsRoot, withLock, replaceIfUnchanged, budgetOf, POINTER, ARCHIVE, LOCK_STALE, raw, gitWhy, gitArgs, front, allStores, pathKey, same, configDir, memoryOff } from './store.mjs';
import { MISSED, sectionOf, parse, transcripts, stalled, lastTurn, GRACE, edited, local, clip } from './handoff-log.mjs';
// Loaded apart, as memory-tier loads it: a journal.mjs that will not load (or
// a copy without it) costs search the journal, said in its output, never doctor
// or restore. Imported statically, deploy.mjs would not start without it
// (handoff-log's deploy gate test, 2026-10-28).
let entries, forget, summary;
try { ({ entries, forget, summary } = await import('./journal.mjs')); }
catch (e) {
  entries = (dirs, { failed = [] } = {}) => { failed.push({ path: 'journal.mjs', code: String(e.message).split('\n')[0] }); return []; };
  summary = () => null;
  forget = (dir, terms, o) => ({ matched: entries([dir], o), removed: [] });
}

const OVERFLOW = /\s*<!-- overflow -->$/;

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
// the entry that is that file is its name; case is never folded here: on
// Linux Alpha.md and alpha.md are two notes, and a folded match restored the
// other one. A name that opens nothing is kept as typed.
const onDisk = (dir, file) => {
  try {
    const names = readdirSync(dir);
    if (names.includes(file)) return file;
    const st = statSync(join(dir, file), { bigint: true });   // throws when it opens nothing
    return names.find((n) => { try { const s = statSync(join(dir, n), { bigint: true }); return s.ino === st.ino && s.dev === st.dev; } catch { return false; } }) ?? file;
  } catch { return file; }
};
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

// Every memory in a store: what its frontmatter says, its [[links]], and which
// index names it.
export function memories(dir) {
  let files; try { files = readdirSync(dir); } catch { return []; }
  // By the file each line opens, as tiering counts them: on Windows (Kase.md)
  // is kase.md's. One listing for the store: read once a line, a 5 MB index
  // hung status for good.
  const listed = new Set(files), low = new Map();
  for (const f of files) low.set(f.toLowerCase(), [...(low.get(f.toLowerCase()) ?? []), f]);
  const id = (p) => { const s = statSync(p, { bigint: true }); return `${s.dev}:${s.ino}`; };
  const opens = (t) => {
    if (listed.has(t) || !low.has(t.toLowerCase())) return t;
    try { const me = id(join(dir, t)); return low.get(t.toLowerCase()).find((n) => { try { return id(join(dir, n)) === me; } catch { return false; } }) ?? t; } catch { return t; }
  };
  const hot = new Set([...new Set(targets(read(join(dir, 'MEMORY.md'))))].map(opens)), cold = new Set([...new Set(targets(read(join(dir, ARCHIVE))))].map(opens));
  return files.filter((f) => f.endsWith('.md') && !f.startsWith('MEMORY')).flatMap((file) => {
    const path = join(dir, file);
    const text = read(path);
    if (text === null) return [];
    const end = text.startsWith('---') ? text.indexOf('\n---', 3) : -1;
    const head = end === -1 ? '' : text.slice(0, end);
    const { name, desc, type, modified: stamp, superseded } = front(head);
    let mtime = 0; try { mtime = statSync(path).mtimeMs; } catch {}
    return [{
      file, path, dir, name, desc, type, superseded,
      body: end === -1 ? text : text.slice(text.indexOf('\n', end + 1) + 1),
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
const words = (q) => [...new Set(q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2 && !STOP.has(t)))];
const alone = (t) => new RegExp(`(?<![\\p{L}\\p{N}])${t}(?![\\p{L}\\p{N}])`, 'gu');
const count = (hay, t) => (t.length > 2 ? hay.split(t).length - 1 : (hay.match(alone(t)) ?? []).length);
const has = (hay, t) => (t.length > 2 ? hay.includes(t) : alone(t).test(hay));
// What a journal hit prints: its request to HIT_ASK characters, and of the
// reply, files and commands only the stretches that hold a search word, HIT_SPAN
// either side, HIT_MORE in all. The top 3 printed whole were 30 KB, and the line
// that answered the question was lost in them (recall test, 2026-10-29).
const HIT_ASK = 400, HIT_SPAN = 80, HIT_MORE = 800;
function around(text, find, room) {
  const spans = [];
  for (const m of text.matchAll(find)) {
    const a = Math.max(0, m.index - HIT_SPAN), b = Math.min(text.length, m.index + m[0].length + HIT_SPAN);
    if (spans.length && a <= spans.at(-1)[1]) spans.at(-1)[1] = b; else spans.push([a, b]);
  }
  const s = (spans[0][0] ? '…' : '') + spans.map(([a, b]) => text.slice(a, b)).join(' … ') + (spans.at(-1)[1] < text.length ? '…' : '');
  return s.length > room ? s.slice(0, room - 1) + '…' : s;
}

// Ranked, not grepped: a name says more than a description, a description more
// than a passing mention. Every term in the name or description is the strong
// match; every term somewhere in the body is a weak one, or a month-long log
// that mentions everything outranked the memory named for the thing ("deploy
// checklist", 2026-10-27).
// `outside`: the notes that match but are dated out of the range.
export function search(dirs, query, limit = 8, { since, until, failed } = {}) {
  const terms = words(query), hits = [];
  let outside = 0;
  for (const dir of terms.length ? dirs : []) for (const m of memories(dir)) {
    // A log the startup line prints, and the journal's pointer: neither is a memory.
    if (m.file === 'handoff.md' || m.file === 'journal.md') continue;
    const name = `${m.file} ${m.name}`.toLowerCase(), desc = m.desc.toLowerCase(), body = m.body.toLowerCase();
    let score = 0, strong = true, every = true;
    for (const t of terms) {
      const s = (has(name, t) ? 3 : 0) + (has(desc, t) ? 2 : 0);
      const b = Math.min(2, count(body, t));
      if (!s) strong = false;
      if (!s && !b) every = false;
      score += s + b;
    }
    if (!score) continue;
    const d = local(m.modified).slice(0, 10);   // the date its hit line shows
    // A note's date is its last change: written in September and edited since,
    // a September search left it out, and the miss read as no record.
    if ((since && d < since) || (until && d > until)) { outside++; continue; }
    hits.push({ ...m, kind: 'note', score: score + (strong ? 5 : every ? 2 : 0) });
  }
  // An entry by what was asked, then what it changed and ran (and its branch),
  // then the reply: a reply that names everything must not outrank the request.
  for (const e of terms.length ? entries(dirs, { since, until, failed }) : []) {
    const asked = e.asked.toLowerCase(), did = [e.branch, ...e.changed, ...e.ran].join('\n').toLowerCase(), answered = e.answered.toLowerCase();
    let score = 0, strong = true, every = true;
    for (const t of terms) {
      const s = (has(asked, t) ? 3 : 0) + (has(did, t) ? 2 : 0) + Math.min(2, count(answered, t));
      if (!has(asked, t)) strong = false;
      if (!s) every = false;
      score += s;
    }
    if (score) hits.push({ ...e, kind: 'journal', modified: Date.parse(e.at.replace(' ', 'T')), score: score + (strong ? 5 : every ? 2 : 0) });
  }
  return Object.assign(hits.sort((a, b) => b.score - a.score || b.modified - a.modified).slice(0, limit), { outside });
}

// What a [[link]] may name: a memory's file name without `.md`, or its `name:`.
const names = (ms) => ms.flatMap((m) => [m.file.replace(/\.md$/, ''), m.name].filter(Boolean));

export function status(dir, sharedNames = []) {
  const ms = memories(dir), main = read(join(dir, 'MEMORY.md'));
  const lines = [`${dir}${isShared(dir) ? '  (shared by every project)' : ''}`];
  if (main === null && !ms.length) return [...lines, '  no store here yet'];
  const n = (w) => ms.filter((m) => m.where === w).length;
  lines.push(`  index ${Buffer.byteLength(main ?? '')} / ${budgetOf(dir)} B · ${n('hot')} hot · ${n('archived')} archived` +
    (n('unindexed') ? ` · ${n('unindexed')} with no pointer yet` : ''));
  const health = (read(join(dir, '.health')) ?? '').trim();
  if (health) lines.push(...health.split('\n').map((h) => `  needs attention: ${h}`));
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
  // Failing from the first write, it has no day to show: the failure is the news.
  if (j?.first || j?.failed) lines.push(`  journal: ${j.first ? `${j.days} days since ${j.first}, ${(j.bytes / 1048576).toFixed(1)} MB` : 'no days yet'}` + (j.left > 0 ? `; importing ${j.left} older conversations` : '') + (j.failed ? `; last write failed: ${j.failed}` : ''));
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
    if (!f || !f.endsWith('.md') || f === 'handoff.md' || f.startsWith('MEMORY')) continue;
    if (!last.has(f)) last.set(f, st);                 // git lists the newest first
    if (st === 'A') born.add(f);
  }
  const of = (want) => [...last].filter(([f, st]) => want(f, st)).map(([f]) => f.replace(/\.md$/, ''));
  return [['added', of((f, st) => st !== 'D' && born.has(f))], ['edited', of((f, st) => st !== 'D' && !born.has(f))], ['deleted', of((f, st) => st === 'D')]]
    .filter(([, xs]) => xs.length).map(([w, xs]) => `${w} ${more(xs, 6)}`).join(' · ');
}

function snapshots() {
  let h = null; try { h = JSON.parse(readFileSync(join(projectsRoot(), '.snapshot-health'), 'utf8')); } catch {}
  if (!h) return 'snapshots: none recorded yet';
  if (h.off) return `snapshots: off, ${h.off}: everything else works, but an old version of a note cannot be brought back`;
  return h.failures ? `snapshots: failing, ${h.failures} in a row (${h.error}); last ok ${h.lastOk ? local(h.lastOk) : 'never'}. ` +
    `The user's fix: run git -C "${projectsRoot()}" status in a terminal to see git's own message; if git says the repository is damaged, rename its .git folder and the next reply starts a new history`
    : h.missed?.length ? `snapshots: ok, last ${local(h.lastOk)}, but they leave out ${h.missed.join(', ')}: ${MISSED}`
    : `snapshots: ok, last ${local(h.lastOk)}`;
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
const git = (...a) => execFileSync('git', gitArgs('--literal-pathspecs', ...a), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, timeout: 60_000 });
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

export function history(dirs, file, everywhere = false) {
  const verb = { A: 'added', M: 'changed', D: 'deleted' };
  try {
    for (const dir of dirs) {
      // No renames: a link that sorts first moves every path to it, and an R line was no change.
      const out = git('log', '--no-renames', '--format=@%h %ad%x09%s', '--date=format:%Y-%m-%d %H:%M', '--name-status', '--', ...tracked(dir, file));
      const lines = [];
      let head = null;
      for (const l of out.split('\n')) {
        if (l.startsWith('@')) head = l.slice(1).split('\t');
        // The first snapshot took in what was already there: not when it was written.
        else if (head && verb[l[0]]) { lines.push(`  ${head[0]}  ${head[1] === 'memory: first snapshot' ? 'in the first snapshot' : verb[l[0]]}`); head = null; }
      }
      // The command that shows a change, with the path git tracks: a junctioned
      // store's own path shows nothing, and PowerShell expands no `~`.
      const moved = !isShared(dir) && !file.startsWith('MEMORY') && existsSync(join(sharedStore(), file)) ? [`  promoted: it is in ${sharedStore()} now`] : [];
      if (lines.length) return { ok: true, lines: [join(dir, file), ...lines, ...moved, `  a change: git -C "${real(projectsRoot())}" --literal-pathspecs show <commit> -- ${tracked(dir, file).map((p) => `"${p}"`).join(' ')}`] };
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
  const path = join(dir, file);
  if (existsSync(path) && !force) return no(`${path} exists; restore --force replaces it with the snapshot`);
  // Deleted here by a promote: brought back, it would be in both stores, loaded twice, drifting apart.
  // Not an index: every store has its own, and a deleted one read as promoted.
  if (!isShared(dir) && !file.startsWith('MEMORY') && existsSync(join(sharedStore(), file)) && !force) return no(`${file} was promoted: it is in ${sharedStore()}; restore --force brings a second copy back here`);
  // A commit's name, or one counted back from it (abc123^, HEAD~2): anything
  // else reached git as an option, and `--format=...` wrote git's own output
  // into the note.
  // No `..` either: `A..B:path` is a range, and git showed it as an empty note.
  if (rev !== undefined && !/^[\w^~]{1,80}$/.test(rev)) return no(`--rev takes a commit from history, like abc1234: not "${rev}"`);
  // The first path that has it (tracked): the error is the first path's.
  let from, text, failure;
  for (const at of tracked(dir, file)) {
    from = rev;
    try {
      if (!from) {
        // HEAD read once: a snapshot committed between two reads of it (another
        // window deleting the note) failed the restore.
        try { const head = git('rev-parse', '--short', 'HEAD').trim(); git('cat-file', '-e', `${head}:${at}`); from = head; }
        catch { const gone = git('log', '-1', '--format=%h', '--diff-filter=D', '--', at).trim(); from = gone ? `${gone}^` : 'HEAD'; }
      }
      try { text = git('cat-file', '-p', `${from}:${at}`); }
      // The commit history names as "deleted" no longer has it: the version it
      // deleted is the one before. Neither there: the error is the commit's own.
      catch (e) {
        if (!rev) throw e;
        try { text = git('cat-file', '-p', `${rev}^:${at}`); } catch { throw e; }
        from = `${rev}^`;
      }
      failure = null; break;
    } catch (e) { failure ??= `no snapshot of ${at} at ${from || 'HEAD'}: ${gitWhy(e)}`; }
  }
  if (failure) return no(failure);
  let line = null;
  if (!file.startsWith('MEMORY')) {
    for (const idx of ['MEMORY.md', ARCHIVE]) {
      const t = tracked(dir, idx).map((at) => { try { return git('cat-file', '-p', `${from}:${at}`); } catch { return ''; } }).join('\n');
      line = t.split(/\r?\n/).find((l) => target(l) === file)?.replace(OVERFLOW, '') ?? null;
      if (line) break;
    }
  }
  mkdirSync(dir, { recursive: true });
  const r = withLock(dir, () => {
    const cur = raw(path);
    if (cur !== null && !force) return `${path} appeared meanwhile; nothing written`;
    // Already that version: "restored" here told the model a bad version was gone.
    if (cur !== null && cur.replace(/^\uFEFF/, '') === text) return `${path} already matches ${from}: nothing to restore; history lists older versions, --rev <commit> picks one`;
    // What --force replaces is kept in the repo, not lost: no snapshot may hold it yet.
    let kept = '';
    if (cur !== null) { try { kept = `; what it replaced is kept: git -C "${real(projectsRoot())}" cat-file -p ${execFileSync('git', gitArgs('hash-object', '-w', '--stdin'), { input: cur, encoding: 'utf8' }).trim()}`; } catch {} }
    // Or one the disk refuses (a name Windows cannot hold, from a store synced from Linux).
    const w = put(path, cur, text);
    if (failed(w)) return `${path} could not be written (${w.slice(8)}); nothing restored`;
    if (w === 'conflict') return `${path} changed meanwhile; nothing written`;
    if (file.startsWith('MEMORY')) return `restored ${path} from ${from}${kept}`;
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
  if (file.startsWith('MEMORY') || file === 'handoff.md') return no('only a memory is shared, not an index or the handoff');
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
    for (const p of [join(dir, 'MEMORY.md'), join(dir, ARCHIVE)]) {
      const t = raw(p), l = t?.split(/\r?\n/).find(its);
      if (l) { home = p; homeText = t; line = l.replace(OVERFLOW, ''); break; }
    }
    line ??= `- [${file.replace(/\.md$/, '').replace(/-/g, ' ')}](${file}) — ${front(text).desc || 'promoted'}`;
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
    const wh = home ? put(home, homeText, homeText.split(/\r?\n/).filter((x) => !its(x)).join('\n')) : false;
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
// second run seconds later, and both read as hooks wired twice.
const TWICE = 2000;
const twin = (r, p) => r.s && r.s === p.s && (r.e ?? 'Stop') === 'Stop' && (p.e ?? 'Stop') === 'Stop' && !r.h === !p.h &&
  Math.abs(Date.parse(r.at) - Date.parse(p.at)) < TWICE;

export function doctor() {
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
    if (Date.now() - end > GRACE) say(false, `Claude finished a reply at ${local(end)}, but project-memory has not saved after any reply: its Stop hook is not running. The user's fix: restart Claude Code; if this line stays, check that Node.js is installed (node --version)`);
    else say(true, "waiting for Claude's first reply: project-memory saves each time Claude finishes one");
  } else {
    // The newest conversation, and the newest other than this one, which is
    // the one the startup briefing judges: checked on the newest alone, the
    // two disagreed when this window saved and another did not.
    const ts = transcripts(sessionStore(), '', session && transcriptOf(session)), s = [ts[0], ts.find((t) => t.s !== session.slice(0, 8))].flatMap((t) => stalled(t, false));
    say(!s.length, s[0] || `the Stop hook last ran ${local(statSync(ran).mtime)}${runs.length ? ` (from ${runs.at(-1).from})` : ''}`);
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

// Node names the script by its real path: compared with the path it was
// given, a run through a symlink (a dotfiles ~/.claude, macOS's /var) did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // The command is the first word that is no option or an option's value, so
  // `--store X search foo` searches; none (the skill run with no arguments,
  // just `--session <id>`) is status.
  // `--store=X` as `--store X`: the equals form was dropped, and the command ran on the cwd's store.
  // After `--` every word is a term: `search -- --no-verify` printed the usage.
  const given = process.argv.slice(2), cut = given.includes('--') ? given.indexOf('--') : given.length;
  const argv = given.slice(0, cut).flatMap((a) => { const m = a.match(/^(--(?:store|rev|limit|session|since|until|conversation))=([\s\S]*)$/); return m ? [m[1], m[2]] : [a]; });
  const valued = new Set(['--store', '--rev', '--limit', '--session', '--since', '--until', '--conversation']);
  // One it does not know is refused: dropped, `--from 2026-10-27` searched for
  // "2026", and `--after=2026-10-28` listed what came before it.
  const unknown = argv.find((a, i) => a.startsWith('--') && !valued.has(argv[i - 1]) && !valued.has(a) && !['--all', '--shared', '--yes', '--force'].includes(a));
  if (unknown) { console.log(`unknown option ${unknown}`); process.exit(1); }
  const at = argv.findIndex((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
  const cmd = at === -1 ? 'status' : argv[at], rest = argv.filter((_, i) => i !== at);
  const opt = (n) => { const i = rest.indexOf(n); return i === -1 ? undefined : rest[i + 1]; };
  // A session id names a file: anything but an id's characters is ignored.
  if (/^[\w-]{1,100}$/.test(opt('--session') || '')) session = opt('--session');
  const args = [...rest.filter((a, i) => !a.startsWith('--') && !valued.has(rest[i - 1])), ...given.slice(cut + 1)];
  // Another store is a memory folder under the projects root: promote and
  // restore write where it points, and one anywhere else was written there.
  const store = opt('--store') && resolve(opt('--store'));
  if (store && !(basename(store) === 'memory' && same(dirname(dirname(store)), projectsRoot()))) {
    console.log(`--store takes a memory folder in ${projectsRoot()} (search names them): not ${store}`);
    process.exit(1);
  }
  // Days compare as text: `--since yesterday` would match no day, and say nothing matched.
  for (const o of ['--since', '--until']) if (rest.includes(o) && !/^\d{4}-\d\d-\d\d$/.test(opt(o) ?? '')) { console.log(`${o} takes a date like 2026-10-01`); process.exit(1); }
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
  // A memory is named by its file, with or without `.md`; never by a path.
  const file = args[0] && basename(args[0]).replace(/(\.md)?$/, '.md');
  let r;
  // What the model reads back: a hit's lines stay short (a 13-link hit was a
  // quarter of its output), and a miss says where it looked in one line.
  const where = scope.length <= 2 ? scope.join(' and ') : `${scope.length} stores`, n = Number(opt('--limit'));
  // An entry's line; under --all, with the project it is from: forget and --store need it.
  const head = (e) => `${e.at}  conversation ${clip(e.s, 100)}${e.branch ? ` · branch ${clip(e.branch, 100)}` : ''}${rest.includes('--all') ? ` · project ${basename(dirname(e.dir))}` : ''}`;
  // Words that say nothing of which memory ("what did I do") with a range: the range's listing.
  if (cmd === 'search' && args.length && (words(args.join(' ')).length || !(range.since || range.until))) {
    const q = args.join(' '), terms = words(q), found = search(scope, q, Infinity, { ...range, failed });
    const out = found.outside ? [`${found.outside} note${found.outside === 1 ? ' matches' : 's match'} outside the range (a note's date is its last change); search without --since/--until`] : [];
    // One request asked again and again (a prompt a script sends, a retry) is
    // one hit with a count: its copies filled the list (recall test, 2026-10-29).
    const groups = [], like = new Map();
    for (const h of found) {
      const k = h.kind === 'journal' ? h.asked.toLowerCase().replace(/\s+/g, ' ').trim() : null;
      if (k !== null && like.has(k)) like.get(k).push(h);
      else { groups.push([h]); if (k !== null) like.set(k, groups.at(-1)); }
    }
    const shown = groups.slice(0, n > 0 ? n : 10), find = new RegExp(terms.map((t) => (t.length > 2 ? t : alone(t).source)).join('|'), 'giu');
    const entry = (h, also, conv = join(projectsRoot(), `${h.t}.jsonl`)) => {
      // Redacted before it is cut: a stretch must not cut a secret in two.
      const hold = [['Answered', h.answered], ['Changed', h.changed.join(', ')], ['Ran', h.ran.join(' · ')]].map(([k, v]) => [k, clip(v, Infinity)]).filter(([, v]) => v.search(find) !== -1);
      const ds = [h, ...also].map((x) => x.day).sort();
      return [`${String(h.score).padStart(3)}  journal   ${head(h)}`, `     key: ${clip(h.key, Infinity)}`, `     Asked: ${clip(h.asked, HIT_ASK)}`,
        ...hold.map(([k, v]) => `     ${k}: ${around(v, find, Math.floor(HIT_MORE / hold.length))}`),
        ...(existsSync(conv) ? [`     Full conversation: ${conv}`] : []),
        ...(also.length ? [`     ${also.length} more like this, ${ds[0]}..${ds.at(-1)}`] : [])];
    };
    r = { ok: true, lines: !words(q).length ? [`nothing to search for: "${q}" has no word that says which memory`]
      : shown.length ? [...shown.flatMap(([h, ...also]) => h.kind === 'journal' ? entry(h, also) : [`${String(h.score).padStart(3)}  ${isShared(h.dir) ? 'shared ' : ''}${h.where.padEnd(9)} ${local(h.modified).slice(0, 10)}  ${h.path}`,
        `     ${clip(h.desc || '(no description)', 200)}`, ...(h.superseded ? [`     replaced by ${h.superseded}: read that one`] : []),
        ...(h.links.length ? [`     links: ${more(h.links, 5)}`] : [])]), ...out,
        // A hit's date, and what was not shown or not searched.
        `${shown.length} of ${groups.length} match(es) in ${where}${groups.length > shown.length ? '; --limit N shows more' : ''}${rest.includes('--all') ? '' : '; --all searches every project'}`]
      : [...out, `nothing matches "${q}" in ${where}${span && ` ${span}`}${rest.includes('--all') ? '' : '; --all searches every project'}`] };
  } else if (cmd === 'show' && args.length) {
    // An entry whole, by the key its hit printed: a day file is 150 KB, and read
    // for one entry, the wrong conversation's was taken (recall test, 2026-10-29).
    const es = entries(scope, { failed }), got = args.map((k) => es.find((e) => e.key === k));
    const whole = (e, conv = join(projectsRoot(), `${e.t}.jsonl`)) => [head(e), `     key: ${clip(e.key, Infinity)}`,
      ...[['Asked', e.asked], ['Answered', e.answered], ['Changed', e.changed.join(', ')], ['Ran', e.ran.join(' · ')]].filter(([, v]) => v).map(([k, v]) => `     ${k}: ${clip(v, Infinity)}`),
      `     Day file: ${e.path}`, ...(existsSync(conv) ? [`     Full conversation: ${conv}`] : [])];
    r = { ok: got.every(Boolean), lines: got.flatMap((e, i) => e ? whole(e) : [`no journal entry has the key ${args[i]} in ${where}${rest.includes('--all') ? '' : '; --all looks in every project'}`]) };
  } else if (cmd === 'search' && (range.since || range.until)) {
    // What was asked on those days, newest first: "what did we do last week".
    const es = entries(scope, { ...range, failed }).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)), shown = es.slice(0, n > 0 ? n : 30);
    r = { ok: true, lines: es.length ? [...shown.map((e) => `${head(e)}  ${clip(e.asked, 200)}`), `${shown.length} of ${es.length} journal entries in ${where}${es.length > shown.length ? '; --limit N shows more' : ''}`]
      : [`no journal entry ${span} in ${where}`] };
  } else if (cmd === 'forget') {
    // A blank term is in every entry: `forget "" --yes` would empty the journal.
    const conversation = opt('--conversation'), yes = rest.includes('--yes'), terms = args.filter((a) => a.trim());
    // Not "delete the journal folder": the backfill's lists live in it, and
    // without them it rebuilds the journal from the transcripts, forgotten entries too.
    if (!terms.length && !range.since && !range.until && !conversation) r = no('forget needs words, a date range or --conversation; to forget the whole journal, use --since 1970-01-01 --yes (deleting the journal folder rebuilds it from the conversations still on disk)');
    else {
      const got = forget(here, terms, { ...range, conversation, apply: yes, failed }), m = got?.matched ?? [], gone = got?.removed ?? [];
      // Under --yes, what went, a turn recorded since the look included: a day
      // that kept changing under the write keeps its entries, and listed with
      // the rest they read as gone.
      const shown = (yes ? gone : m).slice(0, 20).map((e) => `${e.at}  conversation ${e.s}  ${clip(e.asked, 120)}`);
      // A day before today is in the snapshots already (memory-tier commits a
      // day once it closes), when there are snapshots.
      const old = existsSync(join(projectsRoot(), '.git')) ? [...new Set(gone.filter((e) => e.day !== local().slice(0, 10)).map((e) => e.day))] : [];
      r = !got ? no(`${here} is busy (another hook holds it); try again`)
        : !yes ? { ok: true, lines: [...shown, `${m.length} entr${m.length === 1 ? 'y' : 'ies'} would go; run again with --yes to remove them`] }
        : { ok: true, lines: [...shown, `removed ${gone.length}${gone.length === m.length ? '' : ` of ${m.length}`}`, ...(old.length ? [`the snapshots still hold the journal of ${more(old, 6)}: deleting ${join(projectsRoot(), '.git')} removes them, and every older version of every memory with them`] : [])] };
    }
  } else if (cmd === 'status') {
    const sharedNames = names(memories(sharedStore()));
    r = { ok: true, lines: [...scope.flatMap((d) => status(d, sharedNames)), snapshots()] };
  } else if (cmd === 'history' && file) r = history(scope, file, rest.includes('--all'));
  else if (cmd === 'restore' && file) r = restore(here, onDisk(here, file), { rev: opt('--rev'), force: rest.includes('--force') });
  else if (cmd === 'promote' && file) r = promote(here, onDisk(here, file));
  else if (cmd === 'doctor') r = doctor();
  else r = { ok: !cmd || cmd === 'help', lines: [USAGE] };
  // A day the search could not read: what it holds is missing from the lines
  // above. Before a search's last line, which is its count, as the skill says.
  r.lines.splice(cmd === 'search' || cmd === 'forget' ? -1 : r.lines.length, 0, ...failed.map((f) => `could not read ${f.path}: ${f.code}`));
  console.log(r.lines.join('\n'));
  // Not process.exit(): on macOS a pipe is written asynchronously, and exiting
  // cut a 3-entry search at 8 KB (CI, 2026-10-29).
  process.exitCode = r.ok ? 0 : 1;
}
