// Where a session's memory lives, and how its writers stay out of each other's
// way. Our hooks take the lock; Claude Code's own Edit and Write tools do not,
// so a write the model makes during a pass can only be detected --
// replaceIfUnchanged -- never prevented.
import { mkdirSync, rmdirSync, rmSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, readdirSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

// Claude Code's folder: ~/.claude, or CLAUDE_CONFIG_DIR when that is set
// (read by its fixed name). Under it, the hooks wrote nothing and said nothing.
export const configDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const projectsRoot = () => join(configDir(), 'projects');
// A transcript where Claude Code keeps them, `<projects>/<folder>/<id>.jsonl`.
// Resolved: `<projects>/../history.jsonl` passed, and was read as a session's.
export const inProjects = (t) => same(dirname(dirname(resolve(t))), projectsRoot());
export const same = (a, b) => (process.platform === 'win32'
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
  : resolve(a) === resolve(b));
// Auto memory turned off (CLAUDE_CODE_DISABLE_AUTO_MEMORY): the hooks do
// nothing. They recorded and briefed all the same. Off in settings
// (autoMemoryEnabled) they cannot see: the plugin reads no settings file.
// A switch in the environment is on as Claude Code reads one: 1, true, yes, on.
export const envOn = (v) => /^(1|true|yes|on)$/i.test(v || '');
export const memoryOff = () => envOn(process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY);

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
function startCwd(t) {
  if (!started.has(t)) {
    let cwd = null;
    try {
      const fd = openSync(t, 'r'), buf = Buffer.alloc(65536);
      const n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
      const m = buf.toString('utf8', 0, n).match(/"cwd":"((?:[^"\\]|\\.){1,4096})"/);
      if (m) cwd = JSON.parse(`"${m[1]}"`);
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
// shortcut: a repository path long enough for Claude Code to shorten its
// folder name with a hash gets the long name here; build that if one turns up.
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
    return repo && !same(repo, cwd) ? join(projectsRoot(), slugOf(repo), 'memory') : join(dirname(t), 'memory');
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
export const POINTER = /^- \[[^\]]*\]\(([^)/\\:]+)\)/;
export const ARCHIVE = 'MEMORY-archive.md';
// A line for a memory no index names, from its file name and description. One
// builder for tiering and promote: promote's kept the brackets of
// `[draft] plan.md`, and POINTER never read its line back. The hook is the
// description's first 140 characters, each one billed at every session start,
// and never half an emoji: a cut through one wrote U+FFFD into the index.
export const pointerLine = (file, desc) =>
  `- [${file.replace(/\.md$/, '').replace(/-/g, ' ').replace(/[[\]]/g, '')}](${file}) — ${desc.slice(0, 140).replace(/[\uD800-\uDBFF]$/, '')}`;

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
// A transcript as .forgotten, .imported and .checked name it: `<folder>/<session>`.
// Compared through pathKey: a payload spelt the folder `c--x`, the disk `C--x`.
export const transcriptKey = (p) => `${basename(dirname(p))}/${basename(p, '.jsonl')}`;
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
export function front(text) {
  // The frontmatter only: a note that quotes `tier: archive` in its body (one
  // about the format) is not archived by it. Unclosed, it is all frontmatter.
  const t = text.replace(/^\uFEFF/, '');
  const end = t.startsWith('---') ? t.indexOf('\n---', 3) : 0;
  const head = end === -1 ? t : t.slice(0, end);
  // A value stays on its line: an emptied `superseded-by:` took the next line
  // as its value. `.` stops before a \r, for a file saved CRLF, and get()
  // trims: a lazy value before `[ \t\r]*$` was quadratic, and a description of
  // 16,000 spaces cost every tier pass 1.4 s. Nor two runs of blanks side by
  // side below (`[ \t]+-?[ \t]*`, `[ \t]+#`), for the same reason.
  const get = (re) => ((head.match(re) || [])[1] || '').trim();
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
  const superseded = scalar(get(/^[ \t]*superseded-by:[ \t]*(.*)$/m), true) || block('superseded-by')[0] || '';
  const desc = get(/^description:[ \t]*(.*)$/m);
  return {
    name: scalar(get(/^name:[ \t]*(.*)$/m)),
    desc: /^[>|][-+]?$/.test(desc) ? block('description').join(' ') : scalar(desc),
    type: get(/^[ \t]*type:[ \t]*["']?(\w+)/m).toLowerCase(),
    tier: superseded ? 'archive' : get(/^[ \t]*tier:[ \t]*["']?(\w+)/m).toLowerCase(),
    superseded,
    // A date alone is that day here: read as UTC midnight, it printed as the
    // day before anywhere west of Greenwich.
    modified: Date.parse(get(/^[ \t]*modified:[ \t]*(\S+)/m).replace(/^(\d{4}-\d\d-\d\d)$/, '$1T00:00')),
  };
}

// git for the snapshot repo, whatever the user's own git config says: a global
// commit.gpgsign failed every snapshot, a global hooks path ran the user's
// hooks on it, and on Windows a path past 260 characters was skipped with only
// a warning. The hooks path names a folder that does not exist: no hooks.
// Line endings as written, too: Git for Windows sets core.autocrlf=true for
// the whole machine, and a CRLF note came back from a restore with LF ones.
export const gitArgs = (...a) => ['-C', projectsRoot(), '-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
  '-c', `core.hooksPath=${join(projectsRoot(), '.git', 'no-hooks')}`, ...a];

// git's reason for a failure: stderr's first line that is not a warning -- a
// repack Windows could not finish leaves an .idx with no .pack, and git warns
// of it on every command (2026-10-27) -- else the message's, which only says
// which command failed.
export const gitWhy = (e) => (e.code === 'ENOENT' && String(e.syscall).startsWith('spawn') ? 'git is not installed'
  : String(e.stderr || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('warning:')) || String(e.message).split('\n')[0]);

// A file's text, or null when there is none: what replaceIfUnchanged compares.
export const raw = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
// A list file's lines, trimmed (an editor's CRLF, a space left after one), none blank.
export const listOf = (text) => (text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

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
const STEP = 25;           // ms between tries for a held lock: a freed one is taken within 25 ms, 80 tries in LOCK_WAIT
// The codes Windows gives while another program holds a path or a delete is still settling.
export const BUSY = ['EPERM', 'EBUSY', 'EACCES'];

// Run fn holding the store's lock: `mkdir` either creates the folder or fails,
// on NTFS as anywhere. Returns fn's result, or null when the lock stayed busy.
// ponytail: two hooks that both find a dead lock can both take it over in the
// same instant; that needs a killed hook first, and costs one merged write.
export function withLock(dir, fn) {
  const lock = join(dir, '.lock');
  let refused = 0;
  for (const until = Date.now() + LOCK_WAIT; ;) {
    try { mkdirSync(lock); break; }
    catch (e) {
      // The last holder's rmdir still settling: the same codes a rename retries.
      if (e.code !== 'EEXIST' && !BUSY.includes(e.code)) throw e;
      // Refused with no lock there, again and again: a folder that takes no new
      // entries, not a holder. Read as busy, every turn waited 2 s and saved
      // nothing, unseen.
      refused = e.code !== 'EEXIST' && !existsSync(lock) ? refused + 1 : 0;
      if (refused > 8) throw e;
      let stale = false;
      // Either way: a lock dated in the future (a clock set back) was never stale.
      try { stale = Math.abs(Date.now() - statSync(lock).mtimeMs) > LOCK_STALE; } catch {}
      // A killed hook's lock, whatever it left: a file, a folder with something
      // in it. One still there when the wait is up throws, so the pass that
      // fails says so in .health: busy every turn was silence.
      if (stale) {
        try { rmSync(lock, { recursive: true, force: true }); continue; }
        catch (err) { if (Date.now() > until) throw err; }
      }
      if (Date.now() > until) return null;
      sleep(STEP);
    }
  }
  try { return fn(); } finally { try { rmdirSync(lock); } catch {} }
}

// Write `next` over `path` only while the file still holds `expected`, the text
// the caller computed from (null: the file did not exist). Returns true when
// written, false when the file already says `next`, and 'conflict' when someone
// else wrote it first -- their write is kept.
export function replaceIfUnchanged(path, expected, next) {
  const read = () => raw(path);
  if (read() === next) return false;
  const tmp = `${path}.tmp${process.pid}`;
  try {
    // Inside the try: a write cut short (a full disk) left its half-copy of
    // the handoff or a journal day, where forget never reaches.
    writeFileSync(tmp, next);
    for (let i = 0; ; i++) {
      // ponytail: the check and the rename are two calls; an edit landing in
      // the gap between them (well under a millisecond) is the race left.
      if (read() !== expected) return 'conflict';
      try { renameSync(tmp, path); return true; }
      catch (e) {
        // Windows refuses a rename over a file another program holds open.
        if (i >= 3 || !BUSY.includes(e.code)) throw e;
        sleep(50);
      }
    }
  } finally { try { unlinkSync(tmp); } catch {} }
}
