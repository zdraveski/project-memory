// Where a session's memory lives, and how its writers stay out of each other's
// way. Our hooks take the lock; Claude Code's own Edit and Write tools do not,
// so a write the model makes during a pass can only be detected --
// replaceIfUnchanged -- never prevented.
import { lstatSync, mkdirSync, rmdirSync, rmSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, readdirSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHmac, randomBytes } from 'node:crypto';
import { redact } from './secrets.mjs';

// Claude Code's folder: ~/.claude, or CLAUDE_CONFIG_DIR when that is set
// (read by its fixed name). Under it, the hooks wrote nothing and said nothing.
// Resolved: a relative one put a root of its own under each hook's cwd (1.3.1 audit C-3).
export const configDir = () => resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
export const projectsRoot = () => join(configDir(), 'projects');
// The page `memory page` writes: one file in Claude Code's folder, outside every project and every snapshot. It holds journal text,
// so it is 0600 in a 0700 folder, replaced whole (a temp file renamed), and dropPage removes it where the journal is forgotten.
export const pagePath = () => join(configDir(), 'project-memory', 'journal.html');
// A kill between the write and the rename leaves journal.html.<pid>.tmp, which holds journal text: every such file goes and the claims of page runs (dropPage only). The first error, or null.
function stray(dir) {
  let bad = null;
  try { for (const n of readdirSync(dir)) if (/^journal\.html\..+\.(tmp|reading)$/.test(n)) try { rmSync(join(dir, n)); } catch (e) { bad ??= e; } } catch {}
  return bad;
}
// A page run's claim on the text it read, made while it holds the stores' locks: dropPage (a forget, a sweep, off, incognito, rescan
// --apply --yes) deletes it, so the run sees that what it read may since have been forgotten and does not write. The path, or null.
export function claimPage() {
  const t = `${pagePath()}.${process.pid}.reading`;
  try { mkdirSync(dirname(t), { recursive: true, mode: 0o700 }); writeFileSync(t, '', { mode: 0o600 }); return t; } catch { return null; }
}
export function writePage(html) {
  const p = pagePath(), tmp = `${p}.${process.pid}.tmp`;
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  rmSync(tmp, { force: true }); // only this pid's: another live run's temp file is being written
  try { writeFileSync(tmp, html, { mode: 0o600, flag: 'wx' }); renameSync(tmp, p); }
  catch (e) { rmSync(tmp, { force: true }); throw e; }
  return p;
}
// Never throws: the hooks call it, and ignore what it returns. True when a page was there and is gone, false when none was, and the
// Error when something would not go (a file another program holds open, on Windows): the commands say so, the text is still on disk.
export function dropPage() {
  const p = pagePath(); let bad = stray(dirname(p)), there = true;
  try { lstatSync(p); } catch { there = false; }
  if (there) {
    try { rmSync(p, { force: true }); } catch (e) { bad ??= e; }
    if (!bad && existsSync(p)) bad = new Error('it is still there');
  }
  return bad ?? there;
}
// A keyed fingerprint of raw text for dedup keys and proof-of-life lines: an unsalted hash of a short prompt that is just a
// password falls to a dictionary run. The salt is a random per-machine file in the projects folder (never snapshotted, 0600);
// when it cannot be kept, a one-off salt: keys then differ between runs, and nothing else breaks.
export const keyed = (text, n) => {
  const f = join(projectsRoot(), '.hash-salt');
  let salt = ''; try { salt = readFileSync(f, 'utf8'); } catch {}
  if (salt.length < 32) { salt = randomBytes(32).toString('hex'); try { mkdirSync(projectsRoot(), { recursive: true, mode: 0o700 }); writeFileSync(f, salt, { mode: 0o600, flag: 'wx' }); } catch { try { salt = readFileSync(f, 'utf8') || salt; } catch {} } }
  return createHmac('sha256', salt).update(String(text)).digest('hex').slice(0, n);
};
// A transcript where Claude Code keeps them, `<projects>/<folder>/<id>.jsonl`.
// Resolved: `<projects>/../history.jsonl` passed, and was read as a session's.
export const inProjects = (t) => same(dirname(dirname(resolve(t))), projectsRoot());
export const same = (a, b) => (process.platform === 'win32'
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
  : resolve(a) === resolve(b));
// Auto memory turned off: the hooks do nothing. Claude Code reads it from CLAUDE_CODE_DISABLE_AUTO_MEMORY (1 off, 0 on, over any
// file) and else from the first autoMemoryEnabled in managed, project-local, project, then user settings. Only a boolean counts;
// a file that is not valid JSON is skipped. Not seen: --settings, --bare, safe mode, the registry, a plist, server-managed settings.
// A switch in the environment is on as Claude Code reads one: 1, true, yes, on.
export const envOn = (v) => /^(1|true|yes|on)$/i.test(v || '');
const MANAGED = process.platform === 'win32' ? 'C:/Program Files/ClaudeCode' : process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';
export function autoMemory({ managed = MANAGED, cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd() } = {}) {
  const env = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY;
  if (envOn(env)) return { off: true, why: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY' };
  if (/^(0|false|no|off)$/i.test(env || '')) return { off: false };
  let d = []; try { d = readdirSync(join(managed, 'managed-settings.d')).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => join(managed, 'managed-settings.d', f)); } catch {}
  for (const f of [...d, join(managed, 'managed-settings.json'), join(cwd, '.claude', 'settings.local.json'), join(cwd, '.claude', 'settings.json'), join(configDir(), 'settings.json')]) {
    let v; try { v = JSON.parse(readFileSync(f, 'utf8').replace(/^\uFEFF/, ''))?.autoMemoryEnabled; } catch { continue; }
    if (typeof v === 'boolean') return v ? { off: false } : { off: true, why: `autoMemoryEnabled is false in ${f}` };
  }
  return { off: false };
}
export const memoryOff = (o) => autoMemory(o).off;

const slugOf = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');

// The git repository a folder is in, as Claude Code finds it for memory: the
// nearest folder up with a `.git`, and for a worktree (whose `.git` is a file)
// the main repository. null: none. Nothing it reads can throw out of a hook:
// a `commondir` that was a folder made the Stop hook exit 1. A path that is
// no absolute one (`C:\x` on Linux) is in no repository: resolved, it was
// read against the hook's own folder, and a repository there named the store.
export function repoRoot(dir) {
  try {
    if (!isAbsolute(dir)) return null;
    for (let d = resolve(dir); ; d = dirname(d)) {
      let st = null; try { st = statSync(join(d, '.git')); } catch {}
      if (st?.isDirectory()) return d;
      if (st?.isFile()) return worktreeMain(d) ?? d;   // a submodule is its own
      if (dirname(d) === d) return null;
    }
  } catch { return null; }
}
// A worktree's main repository, checked as Claude Code checks it: the .git
// file names `<common>/worktrees/<name>`, whose `gitdir` names this .git back
// and whose `commondir` leads to <common>. Trusted unchecked, a .git file
// unpacked from an archive sent a session's handoff into another project's
// store. A bare repository's worktrees share the bare folder's memory.
function worktreeMain(d) {
  try {
    const g = (raw(join(d, '.git')) || '').match(/^gitdir:\s*(.+?)\s*$/m);
    if (!g) return null;
    const gd = resolve(d, g[1]);
    const common = (raw(join(gd, 'commondir')) || '').trim(), back = (raw(join(gd, 'gitdir')) || '').trim();
    // By real path: git records the worktree's, and one reached through a
    // junction or a link was taken for a stranger.
    const real = (x) => { try { return realpathSync(x); } catch { return resolve(x); } };
    if (!common || !back || basename(dirname(gd)) !== 'worktrees' || !same(real(resolve(gd, back)), real(join(d, '.git')))) return null;
    const main = resolve(gd, common);
    if (!same(dirname(dirname(gd)), main)) return null;
    return basename(main) === '.git' ? dirname(main) : main;
  } catch { return null; }
}

// The folder a session started in: the first cwd its transcript records.
// From its head only, once per process, by its text: a first record longer
// than the head (a large paste) is no JSON to parse there.
const started = new Map();
export function startCwd(t) {
  if (!started.has(t)) {
    let cwd = null;
    try {
      // 64 KB at a time up to 4 MB: a first cwd can come after a long skill listing (1.3.2).
      // Each look starts 12,300 bytes before the new chunk (4096 characters of 3 bytes and the key), so a cwd cut by the chunk edge is whole.
      const fd = openSync(t, 'r'), buf = Buffer.alloc(65536);
      try {
        let head = Buffer.alloc(0);
        for (let at = 0; at < 4_194_304 && !cwd; at += buf.length) {
          const n = readSync(fd, buf, 0, buf.length, at);
          if (!n) break;
          const from = Math.max(0, head.length - 12_300);
          head = Buffer.concat([head, buf.subarray(0, n)]);
          const m = head.toString('utf8', from).match(/"cwd":"((?:[^"\\]|\\.){1,4096})"/);
          if (m) cwd = JSON.parse(`"${m[1]}"`);
        }
      } finally { closeSync(fd); }
    } catch {}
    started.set(t, cwd);
  }
  return started.get(t);
}

// A session's store. Claude Code keeps one memory folder per git repository,
// shared by its worktrees and subfolders, and per folder outside one; the
// transcript goes by the folder the session started in. A session started in
// `repo/web` wrote its handoff to a `repo-web` folder Claude Code never loads.
// The folder it started in, read from the transcript, not the cwd now: a
// session that moved into another project's folder wrote that project's
// handoff. A transcript anywhere else (a test, a payload without one) falls
// back to the cwd. Resolved: `<projects>/../x.jsonl` passed the check and
// named a store outside it. A path that is no string threw, and the hook with it.
// A repository whose name is past 200 characters is not followed: Claude Code
// names its folder by the first 200 and a hash of the path, its runtime's, not
// one to make here, and every subfolder's folder starts with the same 200. The
// conversation's own folder, which Claude Code made, holds its handoff and
// journal. Under the whole long name, past the 255 characters a folder name
// can have, a session in a subfolder saved nothing, and the record of that
// failure, named after it, failed too (audit H-F11).
const CC_NAME = 200;
const repoFolder = (repo, t) => join(slugOf(repo).length > CC_NAME ? dirname(t) : join(projectsRoot(), slugOf(repo)), 'memory');
export function storeOf(payload = {}) {
  // As Claude Code takes it: a plain name of up to 64 letters, digits, - and
  // _, used as it is; any other is ignored. Slugged, `my_proj` named a folder
  // Claude Code never made, and nothing was saved.
  const named = process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  // Not `_shared`: that is every project's store, not one project's.
  if (named && /^[A-Za-z0-9_-]{1,64}$/.test(named) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|_shared)$/i.test(named)) return join(projectsRoot(), named, 'memory');
  const t = typeof payload.transcript_path === 'string' && resolve(payload.transcript_path);
  if (t && inProjects(t)) {
    // No cwd recorded yet (a session just started, or just cleared): the
    // payload's, which is where it started. Read as the transcript's folder,
    // the startup briefing of a subfolder's session read another store.
    const cwd = startCwd(t) || (typeof payload.cwd === 'string' && payload.cwd) || null, repo = cwd && repoRoot(cwd);
    return repo && !same(repo, cwd) ? repoFolder(repo, t) : join(dirname(t), 'memory');
  }
  const cwd = String(payload.cwd || process.cwd());
  return join(projectsRoot(), slugOf(repoRoot(cwd) || cwd), 'memory');
}

// Lessons that hold in every project. `_` is in no project's slug -- storeOf
// turns every other character into `-` -- so no session's own store is this one.
export const sharedStore = () => join(projectsRoot(), '_shared', 'memory');
export const isShared = (dir) => same(dir, sharedStore());

// Bytes of an index worth paying for at every session start. The shared
// store's is printed into every session of every project, on top of that
// project's own: a smaller ceiling.
export const BUDGET = 7000;
export const SHARED_BUDGET = 3000;
export const budgetOf = (dir) => (isShared(dir) ? SHARED_BUDGET : BUDGET);

// An index line: `- [Title](file.md) — hook`. The archive's own line in
// MEMORY.md is matched by its target, never its title. A file in the store,
// by its name: a web link was reported as a memory with no file on every
// startup, and `../../big.bin` was read whole by every Stop.
// A title may hold one level of [brackets] (`[Fix [WIP] x]`): unmatched, the line was prose and its note got a second
// pointer. The two branches start on different characters, so the match stays linear.
export const POINTER = /^- \[(?:[^[\]]|\[[^[\]]*\])*\]\(([^)/\\:]+)\)/;
export const ARCHIVE = 'MEMORY-archive.md';
// The two index files the plugin writes; any other MEMORY-*.md is a note.
export const isIndex = (f) => f === 'MEMORY.md' || f === ARCHIVE;
// A line for a memory no index names, from its file name and description. One
// builder for tiering and promote: promote's kept the brackets of
// `[draft] plan.md`, and POINTER never read its line back. The hook is the
// description's first 140 characters, each one billed at every session start,
// and never half an emoji: a cut through one wrote U+FFFD into the index.
export const pointerLine = (file, desc) =>
  `- [${redact(file).replace(/\.md$/, '').replace(/-/g, ' ').replace(/[[\]]/g, '')}](${file}) — ${redact(desc).slice(0, 140).replace(/[\uD800-\uDBFF]$/, '')}`;

// The listed name an index line's file opens, from one listing of the store,
// for tiering and the CLI alike: on Windows (Kase.md) is kase.md's. A name the
// folder lists is itself; another is the listed name it folds to only when it
// opens that very file: NTFS keeps the Kelvin sign and k apart, and a plain
// fold let one note's line replace another's.
export function opener(dir, listed) {
  const names = new Set(listed), low = new Map();
  for (const n of listed) low.set(n.toLowerCase(), [...(low.get(n.toLowerCase()) ?? []), n]);
  const id = (t) => { const s = statSync(join(dir, t), { bigint: true }); return `${s.dev}:${s.ino}`; };
  return (t) => {
    if (names.has(t) || !low.has(t.toLowerCase())) return t;
    let me; try { me = id(t); } catch { return t; }
    for (const n of low.get(t.toLowerCase()) ?? []) { try { if (id(n) === me) return n; } catch {} }
    return t;
  };
}

// Every store once: one reached by two paths (a junction back to another
// project's store) is one brain, tiered and reported once; a junction whose
// target is gone is none.
// A real path as a key: Windows spells one folder in any case.
export const pathKey = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
// A path's case folded where the disk ignores case (Windows, macOS): on Linux /home/USER is not /home/user.
export const foldCase = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
// A transcript as .forgotten, .imported and .checked name it: `<folder>/<session>`.
// Compared through pathKey: a payload spelt the folder `c--x`, the disk `C--x`.
export const transcriptKey = (p) => `${basename(dirname(p))}/${basename(p, '.jsonl')}`;
// The local date a project was turned off, for what is said to the user.
export const offSince = (o) => (o.since ? local(o.since).slice(0, 10) : 'an unknown date');
export function allStores() {
  const root = projectsRoot(), seen = new Set();
  let all = []; try { all = readdirSync(root); } catch {}
  return all.map((p) => join(root, p, 'memory')).filter((d) => {
    let real; try { real = realpathSync(d); } catch { return false; }
    if (seen.has(pathKey(real)) || !existsSync(join(d, 'MEMORY.md'))) return false;
    seen.add(pathKey(real));
    return true;
  });
}

// What a memory's frontmatter says. One reading for the tiering, the CLI and
// promote: three copies had drifted, and promote's had lost the unescape.
// `modified` is NaN when the memory has no stamp. A memory a newer one
// replaced (`superseded-by: <file>`) is archived, as `tier: archive` would.
// Where a note's frontmatter closes: the index of the newline before its closing ---, -1 when none
// opens or it never closes. Only a line of exactly --- opens or closes it, not ---- or ---x.
export const frontEnd = (t) => !/^---[ \t]*\r?\n/.test(t) ? -1 : ((i) => i === -1 ? -1 : i + 3)(t.slice(3).search(/\n---[ \t]*(?:\r?\n|$)/));
export function front(text) {
  // The frontmatter only: a note that quotes `tier: archive` in its body (one
  // about the format) is not archived by it. Unclosed, it is all frontmatter.
  const t = text.replace(/^\uFEFF/, '');
  const end = frontEnd(t);
  const head = !/^---[ \t]*\r?\n/.test(t) ? '' : end === -1 ? t : t.slice(0, end);
  // A value stays on its line: an emptied `superseded-by:` took the next line
  // as its value. `.` stops before a \r, for a file saved CRLF, and get()
  // trims: a lazy value before `[ \t\r]*$` was quadratic, and a description of
  // 16,000 spaces cost every tier pass 1.4 s. Nor two runs of blanks side by
  // side below (`[ \t]+-?[ \t]*`, `[ \t]+#`), for the same reason.
  const get = (re, from = head) => ((from.match(re) || [])[1] || '').trim();
  // The keys outside a `description: |` block: its text may quote `tier: archive`.
  const keys = head.replace(/^description:[ \t]*[>|][-+]?[ \t\r]*\n(?:[ \t]+\S.*\r?(?:\n|$))+/m, '');
  // A YAML block value (`description: >-`, a list under `superseded-by:`):
  // its indented lines. Read as the line itself, a hook said `>-`. CRLF too:
  // `.` stops at the \r, and only the first line was read (review, 2026-10-30).
  const block = (key) => (head.match(new RegExp(`^[ \\t]*${key}:(?:[ \\t]*(?:[>|][-+]?|[-+]))?[ \\t\\r]*\\n((?:[ \\t]+(?:-[ \\t]*)?\\S.*\\r?(?:\\n|$))+)`, 'm'))?.[1] ?? '')
    .split('\n').map((l) => l.trim().replace(/^-[ \t]*/, '')).filter(Boolean);
  // Valid YAML all: quoted either way, a `# comment` after it, any case
  // (`tier: "hot"`, `tier: Hot`). Read only bare, the pin aged out.
  // A value as YAML reads it: quotes only when they open and close the whole
  // value (`Use the "fast"` keeps both of its own), '' for ' in single
  // quotes, \" in double. A lone opening quote, with no other of its kind (a
  // value wrapped onto the next line), is dropped. A plain name or description
  // keeps a ` #`: Claude writes them unquoted, and "Fix issue #42" read as
  // "Fix issue"; a file name (`cut`) loses it. YAML's null (`null`, `~`, a
  // comment alone) is no value: `superseded-by: null` archived the note, and
  // `description: null` hid that it had none.
  const scalar = (v, cut = false) => {
    let m;
    if ((m = v.match(/^"((?:[^"\\]|\\.)*)"(?:[ \t]+#.*)?$/))) return m[1].replace(/\\(["\\])/g, '$1');
    if ((m = v.match(/^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/))) return m[1].replace(/''/g, "'");
    const p = (cut ? v.replace(/(?:^|[ \t])#.*$/, '') : v).trim().replace(/^(["'])(?![\s\S]*\1)/, '');
    return /^(?:null|Null|NULL|~|#(?:\s.*)?)$/.test(p) ? '' : p;
  };
  // An empty list or a "none" names no replacement; read as one, it archived the note for good (1.3.1 audit E-3).
  const superseded = (scalar(get(/^[ \t]*superseded-by:[ \t]*(.*)$/m), true) || block('superseded-by')[0] || '').replace(/^(?:\[[ \t]*\]|none|false|no)$/i, '');
  const desc = get(/^description:[ \t]*(.*)$/m);
  return {
    name: scalar(get(/^name:[ \t]*(.*)$/m)),
    desc: /^[>|][-+]?$/.test(desc) ? block('description').join(' ') : scalar(desc),
    type: get(/^[ \t]*type:[ \t]*["']?(\w+)/m, keys).toLowerCase(),
    // The whole word: `tier: hot-ish` read as hot.
    tier: superseded ? 'archive' : get(/^[ \t]*tier:[ \t]*["']?(\w+)(?=["']?[ \t]*(?:#|$))/m, keys).toLowerCase(),
    superseded,
    // A date alone is that day here: read as UTC midnight, it printed as the
    // day before anywhere west of Greenwich. A date, a space and a time is that time: cut at the space, it was midnight.
    modified: Date.parse(get(/^[ \t]*modified:[ \t]*(\d{4}-\d\d-\d\d \d\d:\d\d\S*|\S+)/m).replace(' ', 'T').replace(/^(\d{4}-\d\d-\d\d)$/, '$1T00:00')),
  };
}

// A failure's reason, as stored for status and the briefing: the message's first line, with a refused write's `<path>.tmp<pid>` cut from
// it (status printed it as a leftover file).
export const reason = (e) => redact(String(e?.message).split('\n')[0].replace(/\.tmp\d+/g, ''));
// A file's text, or null when there is none: what replaceIfUnchanged compares.
export const raw = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
// A list file's lines, trimmed (an editor's CRLF, a space left after one), none blank.
export const listOf = (text) => (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
// Text read the same in any width and without hidden characters: a fullwidth
// ＜private＞, or a zero-width space inside the tag, kept what it should hide.
// Every character Unicode says to show as nothing (Default_Ignorable_Code_Point): with the five zero-width ones alone, a soft
// hyphen, a left-to-right mark (an RTL keyboard's, or a paste's), a bidi control or a variation selector inside the tag kept it
// (e2e audit, 2026-11-01).
export const norm = (s) => s.normalize('NFKC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');

// Local time as `2026-10-27 01:07`, by hand: toLocaleString('sv-SE') loads
// ICU's locale data on its first call, 26-34 ms of a ~135 ms Stop (profiled
// 2026-10-27), for the same string (20,007 dates, DST changes included).
const pad = (n) => String(n).padStart(2, '0');
export const local = (t) => {
  const d = new Date(t || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const LOCK_WAIT = 2000;     // a hook that waits longer skips the turn; the next one redoes it
export const LOCK_STALE = 30_000;  // nothing held under the lock takes this long: a lock this old is a killed hook's
// A lock past LOCK_STALE either way: one dated in the future (a clock set back) is a killed hook's too. Throws when it is gone.
export const staleLock = (p) => Math.abs(Date.now() - statSync(p).mtimeMs) > LOCK_STALE;
export const STEP = 25;    // ms between tries for a held lock: a freed one is taken within 25 ms, 80 tries in LOCK_WAIT
// The codes Windows gives while another program holds a path or a delete is still settling.
export const BUSY = ['EPERM', 'EBUSY', 'EACCES'];
// What one hook run may still wait for locks, in all; null: each lock waits LOCK_WAIT of its own. A Stop takes up to four (its
// handoff, the journal's import, its store's tidy-up, the shared one's), and with another hook holding them it waited 8 s, not
// the 2 s documented (audit H-F2). A free lock is taken however little is left.
let left = null;
export const lockBudget = (on) => { left = on ? LOCK_WAIT : null; };

// Run fn holding the store's lock: `mkdir` either creates the folder or fails,
// on NTFS as anywhere. Returns fn's result, or null when the lock stayed busy.
export function withLock(dir, fn) {
  const lock = join(dir, '.lock'), owner = join(lock, 'owner'), t0 = Date.now();
  const token = `${process.pid}.${Math.random().toString(36).slice(2)}`;
  let refused = 0, held = false, signed = false;
  for (const until = t0 + Math.min(LOCK_WAIT, left ?? LOCK_WAIT); ;) {
    try { mkdirSync(lock, { mode: 0o700 }); held = true; try { writeFileSync(owner, token, { mode: 0o600 }); signed = true; } catch {} break; }
    catch (e) {
      // The last holder's rmdir still settling: the same codes a rename retries.
      if (e.code !== 'EEXIST' && !BUSY.includes(e.code)) throw e;
      // Refused with no lock there, again and again: a folder that takes no new
      // entries, not a holder. Read as busy, every turn waited 2 s and saved
      // nothing, unseen.
      refused = e.code !== 'EEXIST' && !existsSync(lock) ? refused + 1 : 0;
      if (refused > 8) throw e;
      let stale = false, gone = null;
      // Either way: a lock dated in the future (a clock set back) was never stale.
      try { stale = staleLock(lock); } catch {}
      // A killed hook's lock is taken at once, not after LOCK_STALE: waiting cost every Stop in the project 5 s and its turn
      // for 30 s (1.6.1). The owner read may be of a lock being released (1.3.3), so the takeover below checks it again. A pid
      // used again reads as alive: LOCK_STALE stays the fallback. shortcut: a pid is this machine's; a store shared with a
      // container or WSL could take a live lock there, upgrade if such a setup is supported.
      // Dead only if its token is still there after the check: a holder that let go and exited between our read and the
      // check reads as dead too, and the next holder's live lock was taken (two inside at once, 5 runs in 24 under load).
      if (!stale) { let o = ''; try { o = readFileSync(owner, 'utf8'); const pid = parseInt(o, 10); if (pid > 0) process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') try { if (readFileSync(owner, 'utf8') === o) gone = o; } catch {} } }
      // A killed hook's lock, whatever it left: a file, a folder with something
      // in it. One still there when the wait is up throws, so the pass that
      // fails says so in .health: busy every turn was silence.
      if (stale || gone) {
        // Taken by renaming it away, which only one waiter's rename wins: two that both saw it stale
        // used to both delete it, the second deleting the first's new lock (audit #4).
        // shortcut: while a late waiter has a fresh lock renamed away, a third waiter can mkdir one (two holders),
        // or the holder can finish and the put-back revive a lock nobody holds (30 s of skipped work). Needs a
        // killed hook and three waiters within microseconds; guard the takeover with a .lock.takeover mkdir if seen.
        const dead = `${lock}.dead.${process.pid}.${Math.random().toString(36).slice(2)}`;   // not Date.now: a test steps the clock
        try {
          renameSync(lock, dead);
          // What we renamed may be a lock another waiter made in between: put it back. A dead owner's lock is ours to
          // remove only while it still holds the token judged dead: no owner yet, or another one, is a new holder's.
          let fresh = !!gone; try { fresh = gone ? readFileSync(join(dead, 'owner'), 'utf8') !== gone : !staleLock(dead); } catch {}
          if (fresh) { try { renameSync(dead, lock); } catch {} }
          else try { rmSync(dead, { recursive: true, force: true }); } catch {}   // left over: sweepTemps takes it
          continue;
        }
        catch (err) { if (err.code === 'ENOENT') continue; if (Date.now() > until) throw err; }
      }
      if (Date.now() > until) break;
      sleep(STEP);
    }
  }
  if (left !== null) left = Math.max(0, left - (Date.now() - t0));
  if (!held) return null;
  // The disk may refuse the unlock for a moment (the codes a rename retries): a lock left behind stops every hook for LOCK_STALE.
  // Released only while it is still ours: a holder that outlived LOCK_STALE had it taken over, and removing it by path let a
  // third hook in beside the second (audit D-2).
  try { return fn(); } finally {
    let mine = !signed; try { mine = readFileSync(owner, 'utf8') === token; } catch {}
    if (mine) { try { unlinkSync(owner); } catch {} for (let i = 0; ; i++) { try { rmdirSync(lock); break; } catch (e) { if (!(BUSY.includes(e.code) || e.code === 'ENOTEMPTY') || i === 2) break; sleep(STEP); } } }
  }
}

// The temp copies replaceIfUnchanged leaves when its hook is killed between the write and the rename (`<file>.tmp<pid>`),
// in a store and its journal: one whose writer is gone, or older than a held lock can be (a pid used again). One can hold
// text forget then removed, where forget never reached (audit H-F3). The Stop and forget sweep them. Only this tool's
// names: what it writes there is `.md` (notes, indexes, days, handoff.md) or a dotfile (.facts, .forgotten, ...).
export function sweepTemps(dir) {
  for (const d of [dir, join(dir, 'journal')]) {
    let names = []; try { names = readdirSync(d); } catch {}
    for (const f of names) {
      // A stale lock renamed away by withLock whose waiter died before deleting it.
      if (d === dir && f.startsWith('.lock.dead.')) { try { rmSync(join(d, f), { recursive: true, force: true }); } catch {} continue; }
      const pid = Number((/^(?:.+\.md|\.[^.]+)\.tmp(\d+)$/.exec(f) || [])[1]);
      if (!pid) continue;
      // Signal 0 sends nothing: it asks whether the process is there.
      let gone = false; try { process.kill(pid, 0); } catch (e) { gone = e.code === 'ESRCH'; }
      try { if (gone || Math.abs(Date.now() - statSync(join(d, f)).mtimeMs) > LOCK_STALE) unlinkSync(join(d, f)); } catch {}
    }
  }
}

// Before a file is rewritten: one with a byte that is no UTF-8 (a note added in
// the Windows code page, as PowerShell 5.1's Add-Content writes, or UTF-16) was
// read as U+FFFD and written back, its letters gone for good. It is left as it
// is, and the write that needed it fails, so status says why. Every rewrite
// passes here: the index and handoff.md had no such guard (1.3.1 audit C-1).
const UTF8 = new TextDecoder('utf-8', { fatal: true });
export function utf8Only(file, text) {
  if (text?.includes('�')) try { UTF8.decode(readFileSync(file)); } catch { throw Object.assign(new Error(`${file} is not UTF-8 text, so it was left as it is; save it as UTF-8`), { code: 'not UTF-8' }); }
}

// Write `next` over `path` only while the file still holds `expected`, the text
// the caller computed from (null: the file did not exist). Returns true when
// written, false when the file already says `next`, and 'conflict' when someone
// else wrote it first -- their write is kept.
export function replaceIfUnchanged(path, expected, next) {
  const read = () => raw(path);
  if (read() === next) return false;
  utf8Only(path, expected);
  const tmp = `${path}.tmp${process.pid}`;
  try {
    // Inside the try: a write cut short (a full disk) left its half-copy of
    // the handoff or a journal day, where forget never reaches.
    writeFileSync(tmp, next, { mode: 0o600 });
    for (let i = 0; ; i++) {
      // ponytail: the check and the rename are two calls; an edit landing in
      // the gap between them (well under a millisecond) is the race left.
      if (read() !== expected) return 'conflict';
      try { renameSync(tmp, path); return true; }
      catch (e) {
        // Windows refuses a rename over a file another program holds open: a scanner or OneDrive sync
        // holds one longer than 150 ms, so there it waits up to 1 s (1.3.1 audit C-5).
        if (i >= (process.platform === 'win32' ? 8 : 3) || !BUSY.includes(e.code)) throw e;
        sleep(process.platform === 'win32' ? 125 : 50);
      }
    }
  } finally { try { unlinkSync(tmp); } catch {} }
}

// A session's short tag: enough to tell parallel sessions apart in one file.
export const tag = (id) => String(id || '').slice(0, 8);
