// Where a session's memory lives, and how its writers stay out of each other's
// way. Our hooks take the lock; Claude Code's own Edit and Write tools do not,
// so a write the model makes during a pass can only be detected --
// replaceIfUnchanged -- never prevented.
import { lstatSync, mkdirSync, rmdirSync, rmSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, readdirSync, realpathSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHmac, randomBytes } from 'node:crypto';

// Claude Code's folder: ~/.claude, or CLAUDE_CONFIG_DIR when that is set
// (read by its fixed name). Under it, the hooks wrote nothing and said nothing.
// Resolved: a relative one put a root of its own under each hook's cwd (1.3.1 audit C-3).
export const configDir = () => resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'));
export const projectsRoot = () => join(configDir(), 'projects');
// A keyed fingerprint of raw text for dedup keys and proof-of-life lines: an unsalted hash of a short prompt that is just a
// password falls to a dictionary run. The salt is a random per-machine file in the projects folder (never snapshotted, 0600);
// when it cannot be kept, a one-off salt: keys then differ between runs, and nothing else breaks.
export const keyed = (text, n) => {
  const f = join(projectsRoot(), '.hash-salt');
  let salt = ''; try { salt = readFileSync(f, 'utf8'); } catch {}
  if (salt.length < 32) { salt = randomBytes(32).toString('hex'); try { mkdirSync(projectsRoot(), { recursive: true, mode: 0o700 }); writeFileSync(f, salt, { mode: 0o600, flag: 'wx' }); } catch { try { salt = readFileSync(f, 'utf8') || salt; } catch {} } }
  return createHmac('sha256', salt).update(String(text)).digest('hex').slice(0, n);
};
// What a Stop could not save, `<projects>/<this><project folder>`: memory-tier writes it, the briefing and status read it. One
// name for the three: spelt in four places, a change to one would have left the warning silent (release review).
export const HANDOFF_FAILED = '.handoff-failed-';
// A journal write's failure its own folder would not take (journal/.failed is in it), `<projects>/<this><project folder>`:
// journal.mjs writes it, the briefing and status read it, beside journal/.failed (audit H-F4).
export const JOURNAL_FAILED = '.journal-failed-';
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
export function startCwd(t) {
  if (!started.has(t)) {
    let cwd = null;
    try {
      // 64 KB at a time up to 4 MB: a first cwd can come after a long skill listing (1.3.2).
      // Each look starts 4 KB before the new chunk, so a cwd cut by the chunk edge is whole.
      const fd = openSync(t, 'r'), buf = Buffer.alloc(65536);
      try {
        let head = Buffer.alloc(0);
        for (let at = 0; at < 4_194_304 && !cwd; at += buf.length) {
          const n = readSync(fd, buf, 0, buf.length, at);
          if (!n) break;
          const from = Math.max(0, head.length - 4200);
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
// A transcript as .forgotten, .imported and .checked name it: `<folder>/<session>`.
// Compared through pathKey: a payload spelt the folder `c--x`, the disk `C--x`.
export const transcriptKey = (p) => `${basename(dirname(p))}/${basename(p, '.jsonl')}`;
// A project turned off (memory off): a marker in its store, {"t": ms}. A dotfile, so the snapshot's .gitignore leaves it out.
export const PROJECT_OFF = '.project-off';
// null when the project is on; else {since} (null when the marker does not read). A marker that cannot be stat'ed counts as
// there, with {unread: code}: guessing "on" would write into a project the user turned off.
export function isOff(dir) {
  const f = join(dir, PROJECT_OFF);
  try { lstatSync(f); } catch (e) { return e.code === 'ENOENT' || e.code === 'ENOTDIR' ? null : { since: null, unread: e.code || 'error' }; }
  try { const t = JSON.parse(readFileSync(f, 'utf8')).t; return { since: Number.isFinite(t) ? t : null }; } catch { return { since: null }; }
}
// When a project was off, one `<from ms> <to ms>` a line (memory on adds it). A transcript runs on while the marker is there, and
// its Stops and the import come later: a turn asked inside a period is never written. Tested on what a turn's own time says.
export const OFF_PERIODS = '.off-periods';
export function wasOff(dir) {
  const periods = listOf(raw(join(dir, OFF_PERIODS))).map((l) => l.split(' ').map(Number));
  // A turn of unknown time (NaN: its record had no timestamp) is placed in none, so it is kept out once the project has been off.
  return (t) => Number.isNaN(t.ms) ? periods.length > 0 : periods.some(([from, to]) => t.ms >= from && t.ms <= to);
}
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

// git for the snapshot repo, whatever the user's own git config says: a global
// commit.gpgsign failed every snapshot, a global hooks path ran the user's
// hooks on it, and on Windows a path past 260 characters was skipped with only
// a warning. The hooks path names a folder that does not exist: no hooks.
// Line endings as written, too: Git for Windows sets core.autocrlf=true for
// the whole machine, and a CRLF note came back from a restore with LF ones.
// Names as the disk spells them: macOS git composes them (NFC) by default, so a café named decomposed was a snapshot's
// composed one and `history` of it answered with a path the disk never had (audit C-8).
// Every git spawn takes its args here, so the caller's repo-locating variables (git's own `rev-parse --local-env-vars` list) go here too, by name:
// they beat -C (a Stop hook under a pre-commit hook committed into the user's repo). PATH, HOME, GIT_EXEC_PATH and the like stay.
const LOCAL_GIT_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX',
  'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE', 'GIT_SHALLOW_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT'];
export const gitArgs = (...a) => (LOCAL_GIT_ENV.forEach((k) => delete process.env[k]), ['-C', projectsRoot(),'-c', 'core.longpaths=true', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'core.precomposeunicode=false',
  // Ours whoever created it: one made from an elevated shell or under sudo failed every snapshot with "dubious ownership" (1.3.1 audit C-2).
  '-c', `safe.directory=${projectsRoot().replace(/\\/g, '/')}`,
  '-c', `core.hooksPath=${join(projectsRoot(), '.git', 'no-hooks')}`, ...a]);

// A failure's reason, as stored for status and the briefing: the message's first line, with a refused write's `<path>.tmp<pid>` cut from
// it (status printed it as a leftover file).
export const reason = (e) => redact(String(e?.message).split('\n')[0].replace(/\.tmp\d+/g, ''));
// git's reason for a failure: stderr's first line that is not a warning -- a
// repack Windows could not finish leaves an .idx with no .pack, and git warns
// of it on every command (2026-10-27) -- else the message's, which only says
// which command failed (reason()). The stderr line loses a temp file's name too.
export const gitWhy = (e) => redact((e.code === 'ENOENT' && String(e.syscall).startsWith('spawn') ? 'git is not installed'
  : String(e.stderr || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('warning:')) || reason(e)).replace(/\.tmp\d+/g, ''));

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
      let stale = false;
      // Either way: a lock dated in the future (a clock set back) was never stale.
      // Age only, not a dead owner's pid: a waiter can read the owner of a lock being released, and took the next
      // holder's live lock (1.3.3).
      try { stale = Math.abs(Date.now() - statSync(lock).mtimeMs) > LOCK_STALE; } catch {}
      // A killed hook's lock, whatever it left: a file, a folder with something
      // in it. One still there when the wait is up throws, so the pass that
      // fails says so in .health: busy every turn was silence.
      if (stale) {
        // Taken by renaming it away, which only one waiter's rename wins: two that both saw it stale
        // used to both delete it, the second deleting the first's new lock (audit #4).
        // shortcut: while a late waiter has a fresh lock renamed away, a third waiter can mkdir one (two holders),
        // or the holder can finish and the put-back revive a lock nobody holds (30 s of skipped work). Needs a
        // killed hook and three waiters within microseconds; guard the takeover with a .lock.takeover mkdir if seen.
        const dead = `${lock}.dead.${process.pid}.${Math.random().toString(36).slice(2)}`;   // not Date.now: a test steps the clock
        try {
          renameSync(lock, dead);
          // What we renamed may be a lock another waiter made in between: put it back.
          let fresh = false; try { fresh = Math.abs(Date.now() - statSync(dead).mtimeMs) <= LOCK_STALE; } catch {}
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
// The conversations marked private, by tag (handoff-log.mjs's hushed() writes and reads them): in a store.
export const QUIET = '.private-sessions';
// The conversations held with auto memory off, kept the same way beside the projects.
export const OFF = '.memory-off';

// Secrets live here, a leaf both store and handoff-log import (no import cycle).
// A secret pasted into a message is never written: the snapshots would keep it
// for good. A key or token is known by its issuer's prefix, or by the word
// before it; anything in <private>...</private> goes whole. Before clipping,
// so no half of a key is left behind.
// A value that is plainly code, not a secret: a type (`password: string`),
// a reference (`${DB_PASSWORD}`, `$(cat f)`, `process.env.X`), a call or an
// index with no digit (`jwt.sign(payload`, `request.form[`), a path of two
// parts or more. 25 of 35 ordinary lines were cut; but a value with a `_` or
// a `.` in it is no code (correct_horse_battery_staple, Summer.Sunshine), and
// a looser rule let those through.
// A member whose last name is the secret's own word (`user.password`,
// `this.apiKey`, `settings.SECRET_KEY`) is a reference to one, not one.
const code = (v) => /^\$[{(]|^(?:process\.env[.[]|os\.environ|os\.getenv|System\.getenv|ENV\[)/.test(v)
  || (!/\d/.test(v) && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(v) && /(?:pass|secret|token|key|pwd|auth|cred)\w*$/i.test(v))
  || /^(?:string|number|boolean|str|int|bytes|any|unknown|null|undefined|none|true|false|object|bool|float|char|optional|secretstr)$/i.test(v)
  || (!/\d/.test(v) && (/^[A-Za-z_$][\w$.]*[([]/.test(v) || /^(?:\/|~\/|[A-Za-z]:[\\/])[^\s/\\]+[\\/]/.test(v)));
// A command's argument that is no secret itself: a reference ($TOKEN,
// ${TOKEN}, $(cat pw): the shell expands it) or a path (~/.ssh/id_ed25519,
// ./pw.txt, /etc/x/y, certs/key.pem). Cut, the word a search would find was
// lost (review, 2026-10-29). Not a number: after --password or TOKEN= it is a
// PIN (R34).
const arg = (v) => /^\$[{(A-Za-z_]|^~|^\.{1,2}[\\/]|^\/[^\s/]+\/|[\\/][^\s\\/]*\.[A-Za-z]\w{0,7}$/.test(v);
// A variable's name that holds a secret: one of its _-parts is the word (not
// KEYBOARD or MONKEY), and it doesn't name a file (KEY_FILE, PUBLIC_KEY_PATH).
const named = (n) => {
  const ps = n.toUpperCase().split('_');
  return ps.some((p) => /^(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD)$/.test(p)) && !/^(?:FILE|PATH|DIR|NAME|ID)$/.test(ps.at(-1));
};
// A number under a count's name (TOKEN_LIMIT, MAX_TOKEN, SECRET_PORT): no
// secret, as only a count-like whole part says (R34).
const counted = (n, v) => /^\d+$/.test(v) && n.toUpperCase().split('_').some((p) => /^(?:LIMIT|MAX|MIN|SIZE|COUNT|LEN|TTL|TIMEOUT|BYTES|PORT)$/.test(p));
// A .env name that holds a secret: its last `_`-part is the word (SIGNING_KEY, DB_PASSWORD). One whose word comes first names
// something else (KEY_ALGORITHM, TOKEN_URL, SECRET_BACKEND); a name with SECRET or PASSWORD anywhere the setting rule reads anyway.
const envNamed = (n) => /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|AUTH|CREDENTIALS?)$/.test(n);
// A YAML child's value under a secret's key, whose own name says nothing: a secret has a digit or a symbol, a PIN too (not a
// name such as `apiKey`, `tls-cert` or `production`); under `tokens:` a token's length too, 16 or more with a letter and a digit
// (not a colour, `blue-500`, a model's name or a count).
const yamlSecret = (v, tok) => (tok ? v.length >= 16 && /\d/.test(v) && /[A-Za-z]/.test(v) : /[\d!@#$%^&*+=?~]/.test(v));
const SECRETS = [
  // From the first opener to the last closer: nested, the text after the inner
  // closer was saved. Self-closed or unclosed, to the end.
  [/<\s*private(?![-_\w])(?:[^>]*>(?:[\s\S]*<\s*\/\s*private\s*>|[\s\S]*)|[^>]*$)/gi, '[private]'],
  // PGP's says PRIVATE KEY BLOCK.
  // Bounded: `-----BEGIN ` then `PRIVATE KEY ` repeated took 20 s a megabyte.
  [/-----BEGIN [A-Z ]{0,40}PRIVATE KEY[A-Z ]{0,40}-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY[A-Z ]{0,40}-----|$)/g, '[redacted]'],
  // sk-... (Anthropic, OpenAI); sk_live_, pk_test_, rk_live_ (Stripe).
  [/(?<![A-Za-z0-9])(?:sk|rk|pk)(?:-|_(?:live|test|prod)_)[A-Za-z0-9_-]{20,}/g, '[redacted]'],
  [/(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[\w-]{22,}/g, '[redacted]'],
  // Vendor tokens by prefix (1.4.1): GitLab (all kinds, routable ones with dots), Stripe-style ElevenLabs, Square, Facebook, Plaid, Salesforce, Dropbox, Twitter's bearer (before the Bearer rule),
  // AWS Bedrock, Google refresh, Firebase, Azure AD and DevOps, and the AI keys (HF org, Fireworks, Cerebras, Tavily, Pinecone, LangSmith, Voyage).
  [/\bgl(?:pat|dt|rt|cbt|ft|imt|agent|oas|soat|ptt)-[\w.-]{20,}|\bAC[0-9a-f]{32}:[0-9a-f]{32}\b|\bGR1348941[\w-]{20,}|\b_gitlab_session=[\w-]{20,}|(?<![A-Za-z0-9])sk_[a-f0-9]{48}\b|\bsq0(?:atp|csp)-[\w-]{22,}|\bEAA[A-Za-z][\w-]{50,}|\baccess-(?:sandbox|development|production)-[0-9a-f-]{36}|\b00D[A-Za-z0-9]{12,15}![\w.-]{40,}|(?<![\w.])sl\.(?:u\.)?[\w-]{60,}|(?<![A-Za-z0-9])A{15,}[A-Za-z0-9%_-]{40,}|\bABSK[A-Za-z0-9+/=]{100,}|\bbedrock-api-key-[A-Za-z0-9+/=_-]{40,}|(?<![\w/])1\/\/0[\w-]{40,}|\bAAAA[\w-]{7}:APA91b[\w-]{100,}|(?<![\w-])[\w-]{3}8Q~[\w.~-]{30,}|(?<![\w/+.=-])(?=[a-z0-9]{0,51}\d)(?=[a-z0-9]{0,51}[a-z])[a-z0-9]{52}(?![\w/+.=-])|\bapi_org_[A-Za-z]{20,}|\bfw_[A-Za-z0-9]{24}\b|\bcsk-[a-z0-9]{48}\b|\btvly-[A-Za-z0-9]{32}\b|\bpcsk_[A-Za-z0-9]{50,}|\blsv2_(?:pt|sk)_[0-9a-f]{32}_[0-9a-f]{10}\b|(?<![A-Za-z0-9])pa-(?=[\w-]{0,42}\d)[\w-]{43}(?![\w-])/g, '[redacted]'],
  // Vendor tokens by prefix, part 2 (1.4.1 D): Terraform, Vault batch, Doppler, Pulumi, DigitalOcean, Heroku, Render, Supabase, Neon, Cloudflare, Brevo, Mailchimp, Resend, Notion,
  // Bitbucket, JFrog, Sentry, Grafana, New Relic, Honeycomb, 1Password, OpenShift, CircleCI, Buildkite, SonarQube, Sourcegraph, Cargo, Figma, JetBrains, Mapbox.
  [/\b[A-Za-z0-9]{14}\.atlasv1\.[\w-]{60,}|\bhvb\.[\w-]{100,}|\bdp\.(?:pt|st|sa|ct|scim|audit)\.[A-Za-z0-9]{40,}|\bpul-[0-9a-f]{40}\b|\bdo[opr]_v1_[a-f0-9]{64}|\bHRKU-[\w-]{30,}|(?<![A-Za-z0-9])rnd_[A-Za-z0-9]{32}\b|\bsb_secret_[\w-]{20,}|\bnapi_[a-z0-9]{50,}|\bv1\.0-[0-9a-f]{24}-[0-9a-f]{146}\b|\bcf(?:ut|k)_[A-Za-z0-9]{40,}|\bxkeysib-[0-9a-f]{64}-[A-Za-z0-9]{16}|\b[0-9a-f]{32}-us\d{1,2}\b|(?<![\w-])re_(?=[A-Za-z0-9_-]{0,40}\d)(?=[A-Za-z0-9_-]{0,40}[a-z])[A-Za-z0-9_-]{30,}(?![\w-])|\bapi-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bsecret_[A-Za-z0-9]{43}\b|\bATBB[\w=-]{28,}|\bAKCp[A-Za-z0-9]{60,}|\bcmVmd[A-Za-z0-9]{50,}|\bsntryu_[0-9a-f]{64}|\bglsa_[A-Za-z0-9]{32}_[0-9a-f]{8}\b|\beyJrIjoi[A-Za-z0-9+/=]{60,}|\bNR(?:AK|II|JS|SP|XX)-[A-Za-z0-9]{20,}|\bhc[abx]ik_[a-z0-9]{26}\b|\bops_eyJ[\w+/=-]{100,}|\bA3-[A-Z0-9]{6}-[A-Z0-9]{11}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}\b|\bsha256~[\w-]{43}|\bCCIPAT_[A-Za-z0-9]{22}_[0-9a-f]{40}|\bbkua_[0-9a-f]{40}|\bsq[pua]_[0-9a-f]{40}\b|\bsgp_(?:[0-9a-f]{16}_)?[0-9a-f]{40}\b|\bcio[A-Za-z0-9]{32}\b|\bfigd_[\w-]{40,}|\bperm:[A-Za-z0-9+/=._-]{40,}|\bpk\.eyJ[\w-]{10,}\.[\w-]{10,}/g, '[redacted]'],
  [/\bxox[abeprs]-[A-Za-z0-9-]{10,}|\bxapp-[A-Za-z0-9-]{10,}/g, '[redacted]'],
  // AWS keys, long-lived and STS.
  [/(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{35}/g, '[redacted]'],
  [/(?<![A-Za-z0-9_]|eyJ-)eyJ[A-Za-z0-9_-]{10,300}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  // An unsigned JWT, or one with its signature cut: two eyJ parts (1.4.1 D).
  [/(?<![A-Za-z0-9_]|eyJ-)eyJ[A-Za-z0-9_-]{10,300}\.eyJ[A-Za-z0-9_-]{10,}\.?/g, '[redacted]'],
  // With a digit in it, or 32 characters or more: "Basic implementation/approach" and "Bearer authentication-header" were prose,
  // and were cut; a long one with no digit (1 in 400 random ones) was kept (audit #7). A hidden character after the word, as
  // redact() sees the raw text, does not hide the value. The long one has no . or /, so "basic tests/integration/x.rb" is kept.
  [/\b(Bearer|Basic|Token)[\s\p{Default_Ignorable_Code_Point}]+(?=[A-Za-z0-9._~+/=-]{0,200}\d|[A-Za-z0-9_~+=-]{32})[A-Za-z0-9._~+/=-]{20,}/giu, '$1 [redacted]'],
  // GitLab, npm and Hugging Face tokens; a Slack webhook is its own secret.
  [/\bglpat-[A-Za-z0-9_-]{20,}|\bnpm_[A-Za-z0-9]{36}\b|\bhf_[A-Za-z0-9]{30,}/g, '[redacted]'],
  // PyPI, Stripe webhooks, SendGrid, Google OAuth, Groq, xAI, Shopify,
  // DigitalOcean, Notion, Atlassian, Vault, Docker; and a PEM key in base64
  // (kubeconfig's client-key-data).
  [/\bpypi-AgE[A-Za-z0-9_-]{20,}|\bwhsec_[A-Za-z0-9+/=]{20,}|\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}|\bGOCSPX-[A-Za-z0-9_-]{20,}|\bya29\.[A-Za-z0-9_-]{20,}|\bgsk_[A-Za-z0-9]{20,}|\bxai-[A-Za-z0-9]{20,}|\bshp(?:at|ca|pa|ss)_[A-Fa-f0-9]{32}|\bdop_v1_[a-f0-9]{64}|\bntn_[A-Za-z0-9]{20,}|\bATATT[A-Za-z0-9_=-]{20,}|\bhvs\.[A-Za-z0-9_-]{20,}|\bdckr_pat_[A-Za-z0-9_-]{20,}|\bpplx-[A-Za-z0-9]{40,}|(?<!\d)\d{8,10}:AA[\w-]{33}\b|\blin_api_[A-Za-z0-9]{30,}|\bPMAK-[A-Za-z0-9-]{40,}|\br8_[A-Za-z0-9]{30,}|\bsbp_[a-f0-9]{40}\b|\bdapi[a-f0-9]{32}\b|\bsntrys_[A-Za-z0-9+/=_-]{20,}|\bSK[0-9a-f]{32}\b|\bkey-[0-9a-f]{32}\b|\bsk\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|LS0tLS1CRUdJTi[A-Za-z0-9+/=]{20,}|\brubygems_[A-Za-z0-9]{40,}|\bnfp_[A-Za-z0-9]{30,}|\bfo1_[A-Za-z0-9_-]{30,}|\bpscale_(?:pw|tkn|oauth)_[A-Za-z0-9._-]{30,}|\btskey-(?:auth|api|client)-[A-Za-z0-9-]{20,}|\bglc_[A-Za-z0-9+/=]{30,}|\bxox[cd]-[A-Za-z0-9%+/=_-]{10,}|\bAGE-SECRET-KEY-[A-Z0-9]{20,}|\b[MNO][A-Za-z0-9_-]{23,27}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b|(?<![\w/+=.-])(?=[A-Za-z0-9+/]{0,39}[A-Z])(?=[A-Za-z0-9+/]{0,39}[a-z])(?=[A-Za-z0-9+/]{0,39}\d)(?=[A-Za-z0-9+/]{0,39}[/+])[A-Za-z0-9+/]{40}(?![\w/+=.-])/g, '[redacted]'],
  [/(hooks\.slack\.com\/services\/)[A-Za-z0-9/]+/g, '$1[redacted]'],
  [/(discord(?:app)?\.com\/api\/webhooks\/)[\w-]+(?:\/[\w-]+)?/g, '$1[redacted]'],
  // Webhooks whose path is the secret: Teams, Zapier, IFTTT, Mattermost (26 characters).
  [/((?:\.webhook\.office|\boutlook\.office)(?:365)?\.com\/webhook(?:b2)?\/)[^\s\"'<>]+|(hooks\.zapier\.com\/hooks\/catch\/\d+\/)[\w-]+|(maker\.ifttt\.com\/trigger\/[^/\s]+\/with\/key\/)[\w-]+|(\/hooks\/)(?=[a-z0-9]{0,25}\d)(?=[a-z0-9]{0,25}[a-z])[a-z0-9]{26}\b/g, (m, a, b, c, d) => `${a ?? b ?? c ?? d}[redacted]`],
  // Sidekiq Enterprise's gem server: the user:password in the URL, or in the BUNDLE_ setting.
  [/(\/\/)[^\s:@/]{1,100}:[^\s@]{1,200}(?=@gems\.contribsys\.com)|(\bBUNDLE_GEMS__CONTRIBSYS__COM[=:][ \t]*[\"']?)[^\s\"']+|(\bgems\.contribsys\.com[ \t]+)[^\s\"']+/g, (m, a, b, c) => `${a ?? b ?? c}[redacted]`],
  // A session cookie logs anyone in: a Cookie / Set-Cookie header's name=value pairs (nothing after them), and curl's -b / --cookie value (not a jar file).
  // An Authorization value with no scheme word: 20+ characters with a digit. And redis-cli's -a password.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?)(?=[A-Za-z0-9._~+/=-]{0,200}\d)[A-Za-z0-9._~+/=-]{20,}/gi, '$1[redacted]'],
  // Authorization: Basic with a short credential (8+ base64 characters), as the rule above wants 20 and a digit. A word in lower case is prose.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?basic[ \t]+)([A-Za-z0-9+/=]{8,200})/gi, (m, pre, v) => (/^[a-z]+$/.test(v) ? m : `${pre}[redacted]`)],
  // 1.4.1 D: any other scheme (SSWS, Splunk, ApiKey, Negotiate, NTLM, Digest...): its credential, as long and with a digit as the Bearer rule wants.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?[A-Za-z][\w-]{1,30}[ \t]+)(?=[A-Za-z0-9._~+/=-]{0,300}\d|[A-Za-z0-9_~+=-]{32})[A-Za-z0-9._~+/=-]{20,}/gi, '$1[redacted]'],
  // A Digest, Hawk or OAuth1 header's response, mac, signature and token values; an AWS Signature V4's Signature; and OAuth1's signature anywhere.
  [/(\bauthorization["']?[ \t]*[:=][ \t]*["']?(?:Digest|Hawk|OAuth|AWS4-HMAC-SHA\d+)\b)([^\n]{0,1000})/gi, (m, pre, rest) => pre + rest.replace(/\b(response|mac|signature|oauth_(?:token|token_secret|signature|verifier|consumer_secret))(["']?=["']?)[^"',\s]{6,}/gi, '$1$2[redacted]')],
  [/(\boauth_(?:signature|verifier|token_secret)["']?[ \t]*[:=][ \t]*["']?)[^"'&,\s]{6,}/gi, '$1[redacted]'],
  // A webhook's signature header (X-Hub-Signature-256: sha256=...).
  [/(\b(?:x-[\w-]{0,30}|stripe-)signature(?:-256)?["']?[ \t]*[:=][ \t]*["']?(?:sha\d+=|t=\d+,v\d=)?)[A-Za-z0-9+/=]{40,}/gi, '$1[redacted]'],
  [/(\bredis-cli\b[^\n|;&]{0,200}?\s-a[ \t]+["']?)(?:(?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|[^\s"']+)/g, '$1[redacted]'],
  // The curl rule first: the header rule reads to the next quote, which may be the one that opens a -b value.
  [/(\bcurl\b[^\n|;&]{0,300}?\s(?:-b|--cookie)[ =]+["']?)((?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|[^\s"']+)/g, (m, pre, v) => (v.includes('=') ? `${pre}[redacted]` : m)],
  [/((?:^|[\s'"])(?:set-)?cookie["']?[ \t]*:[ \t]*["']?)[\w.%!#$&*+^~-]{1,100}=[^\s;'"]*(?:;[ \t]*[\w.%!#$&*+^~-]{1,100}=[^\s;'"]*)*/gim, '$1[redacted]'],
  // Docker's config.json: "auth" is base64 of user:password.
  [/("auth"[ \t]*:[ \t]*")(?=[A-Za-z0-9+/]{0,300}[\d=+/])[A-Za-z0-9+/]{20,300}={0,2}(?=")/g, '$1[redacted]'],
  // A signed URL's signature is the credential (Azure SAS, S3, GCS).
  [/([?&](?:sig|X-Amz-Signature|X-Goog-Signature)=)[^&\s]{16,}/gi, '$1[redacted]'],
  [/([?&](?:key|code|auth|authorization|access_token|token)=)(?=[^&\s"']{0,200}\d)[^&\s"']{12,}/gi, '$1[redacted]'],
  // The password in a URL: postgres://user:it@host, redis://:it@host (no
  // user), one with an @ in it (to the last one). Not a query: a port
  // before `?user=me@x` was cut as a password.
  // A token alone as a URL's user (git clone https://<token>@github.com/…): long, with a digit (1.3.1 audit B-6).
  [/(\/\/)(?=[A-Za-z0-9_-]{0,200}\d)[A-Za-z0-9_-]{30,200}@/g, '$1[redacted]@'],
  [/\b([a-z][a-z0-9+.-]{1,20}:\/\/[^\s:@/]{0,100}:)(?!\d{1,5}[/?#])[^\s"'<>]{1,2000}@/gi, '$1[redacted]@'],
  // curl -u user:it, --user user:it, quoted too, to the closing quote (review, 2026-11-01). Not `docker run -u 1000:1000`, a user
  // and group.
  [/((?:^|\s)(?:-[uU]|--(?:proxy-)?user)[ =]+["']?(?!\d+:\d+(?![^\s'"]))[^\s:'"]{1,100}:)(?:(?<="[^\s:'"]{1,100}:)[^"\n]{1,200}(?=")|(?<='[^\s:'"]{1,100}:)[^'\n]{1,200}(?=')|(?<=:)"[^"\n]{1,200}(?=")|(?<=:)'[^'\n]{1,200}(?=')|[^\s'"]{1,200})/g, '$1[redacted]'],
  // --password it (--token, --client-secret); docker login, az login, sshpass
  // and twine take it as -p it. Not --no-password, whose next word is the
  // command's own; nor "the --token flag", in prose.
  // Quoted, as a value with symbols or blanks must be, to its closing quote: the opening quote refused, each was kept (e2e audit,
  // 2026-11-01). A quoted one may start with `-`; a bare one that does is the next option (review, 2026-11-01).
  [/(--(?!no-|ask-)(?:[a-z]+-){0,3}(?:password|passwd|token|secret|passphrase|api-?key|access-key|oauth2-bearer|requirepass|masterauth|pass|private-key|mnemonic)[ =]["']?|\b(?:(?:docker|podman|az|oc)\s+login|sshpass|twine\s+upload|mongo(?:sh|dump|restore|export|import)?)\b[^\n|;&]{0,200}?\s-p\s+["']?|\b(?:zip|mosquitto_(?:pub|sub|rr)|ldap(?:search|modify|add|delete|compare))\b[^\n|;&]{0,200}?\s-[Pw]\s+["']?|\b(?:requirepass|masterauth)[ \t]+["']?(?=[^\s"']{4})|\bssh-keygen\b[^\n|;&]{0,200}?\s-N\s+["']?)(?!(?:flag|option|argument|parameter|value|field|setting)s?\b)((?<=")(?:[^"\n\\]|\\.){1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|(?!-)[^\s"']{3,2000})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  // redis-cli AUTH [user] pass: both words, each quoted or bare; the user name is no secret worth the parsing (1.3.1 fix
  // review: `> out.txt`, `2>/dev/null`, a quoted pass with a blank and CRLF each kept the password). Two words, not to the
  // end: clip() joins lines first, and the rest of the entry went with it. Not an AUTH already [redacted]: clip() redacts
  // until nothing changes, and each pass took two more words. Only options between redis-cli and AUTH: prose ("redis-cli needs
  // AUTH before") lost two words. Kept only when every word reads as a path or variable: a pass then `./check.sh` was kept.
  // shortcut: a password hand-wrapped onto the next line without `\` slips through clip(); a backslash wrap is caught.
  // Each option one way only (-[\w-]+, not -{1,2}): read two ways, a line of --options took 2^n tries and stalled the Stop.
  // A blank may be a `\` line wrap; an option's value may be quoted. A value never starts with `=`, which is also a blank
  // here (two readings again), and at most 40 options: `-a redis-cli` repeated made each redis-cli a fresh start.
  [/(\bredis-cli(?:(?:[ \t]|\\\r?\n)+-[\w-]+(?:(?:[ \t=]|\\\r?\n)+(?:"[^"\n]*"|'[^'\n]*'|[^\s|;&<>"'=-])\S*)?){0,40}(?:[ \t]|\\\r?\n)+AUTH\s+)(?!\[redacted\])(?!(?:flag|option|argument|parameter|value|field|setting)s?\b)((?:"[^"\n]*"|'[^'\n]*'|[^\s"'|;&<>]+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|[^\s"'|;&<>]+))?)/g,
    (m, pre, v) => (v.split(/\s+/).every(arg) ? m : `${pre}[redacted]`)],
  // 1.4.1 D: a token a vendor's command takes as a flag or word: doctl -t, netlify --auth, ngrok add-authtoken, cargo login, httpie -a / --auth, composer config, bundle config.
  [/(\bdoctl\b[^\n|;&]{0,200}?\s(?:-t|--access-token)[ =]["']?|\bnetlify\b[^\n|;&]{0,200}?\s--auth[ =]["']?|\bngrok\s+(?:config\s+)?(?:add-)?authtoken\s+["']?|\bcargo\s+login\s+(?:--registry[ =]\S+\s+)?["']?|\bhttps?(?=[ \t])[^\n|;&]{0,200}?\s(?:-a|--auth)[ =]+["']?|\bcomposer\s+config\s+(?:-[\w-]+\s+){0,3}(?:(?:github-oauth|gitlab-oauth|gitlab-token|bearer)\.[\w.-]+\s+|http-basic\.[\w.-]+\s+[^\s"']+\s+)["']?)((?<=")[^"\n]{1,2000}(?=")|(?<=')[^'\n]{1,2000}(?=')|(?!-)[^\s"']{3,2000})/g, (m, pre, v) => (arg(v) || /^[^:]*:\$/.test(v) ? m : `${pre}[redacted]`)],
  // bundle config of a gem source's credential, with or without `set` and `--global`: a dotted name, then user:password or a token.
  [/(\bbundle\s+config\s+(?:set\s+)?(?:--?[\w-]+\s+){0,3}[\w-]+(?:\.[\w-]+)+\s+["']?)(?!-)([^\s"']{10,2000})/g, (m, pre, v) => (arg(v) || code(v) ? m : `${pre}[redacted]`)],
  [/(\boathtool\b[^\n|;&]{0,100}?\s["']?)(?!-)[A-Za-z0-9=]{12,}\b/g, '$1[redacted]'],
  // A keyword before a long key with no colon: `secret <base64>`, `key <40 hex>`, `private key <64 hex>` (the name alone is too common, so the value must read as a key).
  [/((?<![A-Za-z0-9])(?:secret|key|private[ _-]?key|token)(?:[ _-]?(?:key|access[ _-]?key))?[ \t]+(?:is[ \t]+)?["']?)(?=[A-Za-z0-9+/]{0,200}\d)(?=[A-Za-z0-9+/]{0,200}[A-Za-z])([A-Za-z0-9+/]{32,200}={0,2})(?![\w+/=-])/gi, (m, pre, v) => (/^[0-9a-f]+$/i.test(v) || (/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) ? `${pre}[redacted]` : m)],
  // Vendor names that precede a key in a setting or a variable (Cloudflare, Datadog, Algolia, Mapbox, Honeycomb, PagerDuty's routing key): 32 characters or more with a digit.
  [/(\b(?:cloudflare|datadog|algolia|mapbox|honeycomb|routing)[\w.-]{0,30}[ \t]*[:=][ \t]*["']?)(?=[A-Za-z0-9_-]{0,100}\d)[A-Za-z0-9_-]{32,}/gi, '$1[redacted]'],
  // Key literals: a seed phrase, a Bitcoin WIF, a Solana keypair array, a base64 private key with no header, sops and ansible-vault blobs, PuTTY's private lines.
  [/\b((?:seed[ _-]?(?:phrase|words?)|mnemonic|recovery[ _-]phrase)["']?[ \t]*[:=]?[ \t]*["']?)(?:[a-z]{3,8}[ \t]+){11,23}[a-z]{3,8}\b/gi, '$1[redacted]'],
  [/(?<![A-Za-z0-9])[5KL][1-9A-HJ-NP-Za-km-z]{50,51}(?![A-Za-z0-9])/g, (m) => (/\d/.test(m) && /[A-Z]/.test(m) && /[a-z]/.test(m) ? '[redacted]' : m)],
  // shortcut: a list of 32 or more numbers under 256 is taken for a Solana keypair, so a long byte array in code is cut too; narrow it if that is ever a problem.
  [/\[\s*(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*){31,}(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*\]/g, '[redacted]'],
  [/(?<![A-Za-z0-9+/])(?:MII[A-Z][A-Za-z0-9+/]{200,}|MHcCAQEEI[A-Za-z0-9+/]{60,}|MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/]{40,})={0,2}/g, '[redacted]'],
  [/\bENC\[AES256_GCM,[^\]\n]{20,2000}\]/g, '[redacted]'],
  [/(\$ANSIBLE_VAULT;[\d.]{1,10};AES256[ \t]*\r?\n?)(?:[0-9a-f]{20,}\r?\n?)+/g, '$1[redacted]'],
  [/(\bPrivate-Lines:[ \t]*\d{1,3}(?:\\n|[\s\\])*)(?:[A-Za-z0-9+/=]{16,}(?:\\n|[\s\\])*)+/g, '$1[redacted]'],
  // The key of a signing or encryption call in code: hmac.new(b"..."), createHmac("sha256", "..."), bytes.fromhex("<hex>"), Fernet(b"..."), and AWS's "AWS4" + secret.
  [/(\bhmac\.(?:new|HMAC)\(\s*(?:key\s*=\s*)?b?["']|\bcreateHmac\(\s*["'][\w-]{1,20}["']\s*,\s*["']|\b(?:bytes\.fromhex|fromhex|unhexlify|a2b_hex)\(\s*b?["']|\bFernet\(\s*b?["'])((?:(?!["']).){8,200})(?=["'])/gi, (m, pre, v) => (arg(v) || code(v) || /\$\{/.test(v) ? m : `${pre}[redacted]`)],
  [/(["']?AWS4["']?[ \t]*\+[ \t]*["']?)[A-Za-z0-9+/]{30,}/g, '$1[redacted]'],
  // A secret as a command's argument, which the journal's Ran field keeps (P1
  // hunt, 2026-10-29): `aws configure set` of a secret, key or token; a
  // SetEnvironmentVariable or setx of one; htpasswd -b's password, after its
  // file (none with -n) and user, before any redirect (-n prints, so one
  // follows: `> .htpasswd` was taken for the password); an exported name whose
  // word is a key's; gh secret set's body; an npm registry's _authToken.
  // Quoted values here and below to the closing quote, as above (review, 2026-11-01).
  [/(\baws\s+configure\s+set\s+(?:--[\w-]+(?:[ =](?!-)\S{1,100})?\s+){0,5}[\w.-]{0,100}(?:secret|key|token)[\w.-]{0,100}\s+["']?)(?!-)(?:(?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']{1,2000})/gi, '$1[redacted]'],
  [/(SetEnvironmentVariable\(\s*["']([^"'\n]{1,100})["']\s*,\s*["'])([^"'\n]{1,2000})/gi, (m, pre, name, v) => (named(name) && !arg(v) && !counted(name, v) ? `${pre}[redacted]` : m)],
  [/(\bhtpasswd(?:\s+-[A-Za-z]+(?:\s+\d+)?)*?\s+-[A-Za-z]*b[A-Za-z]*(?:\s+-[A-Za-z]+(?:\s+\d+)?)*\s+(?:[^\s<>-]\S*\s+)?[^\s<>]+\s+)(?!\d*>)[^\s;|&<>]+/g, '$1[redacted]'],
  // The name read whole, then judged: as words in one pattern, KEY_ repeated
  // took 28 s. PowerShell's `$env:NAME = …` too, in any case, as export's is (e2e audit, 2026-11-01).
  [/((?:\b(?:export\s+([A-Za-z_]\w{0,100})=|setx[ \t]+([A-Za-z_]\w{0,100})[ \t]+)|\$env:([A-Za-z_]\w{0,100})[ \t]*=[ \t]*)["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"';|&]{1,2000})/gi, (m, pre, a, b, c, v) => (named(a ?? b ?? c) && !arg(v) && !code(v) && !counted(a ?? b ?? c, v) ? `${pre}[redacted]` : m)],
  // A .env line at a line's start (e2e audit, 2026-11-01): only its own shape, an upper-case name with no blank before `=`, whose
  // last part is the secret's word (envNamed). Any `name = value` was read as one, and Python's `key = item.name`, `CACHE_KEY =
  // "x"` and `TOKEN_URL=https://…` were cut (review, 2026-11-01). Its close relatives too: a compose list item's `- NAME=…`, cmd's
  // `set NAME=…`, and one after a shell's `&&`, `||`, `;` or `|` (an inline variable before a command).
  [/((?:^[ \t]*(?:-[ \t]+)?|(?:&&|\|\||[;|])[ \t]*)(?:(?:export|set|SET)[ \t]+)?([A-Z][A-Z0-9_]{0,100})=(?:\$?["'])?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"';|&]{1,2000})/gm, (m, pre, n, v) => (envNamed(n) && !arg(v) && !code(v) && !counted(n, v) ? `${pre}[redacted]` : m)],
  // A Kubernetes env entry, `- name: NAME` then `value: …` on the next line, judged by the name as a .env line is (review,
  // 2026-11-01).
  [/(-[ \t]+name:[ \t]*["']?([A-Za-z_][A-Za-z0-9_]{0,100})["']?[ \t]*\r?\n[ \t]+value:[ \t]*["']?)((?<=")[^"\n]{1,200}(?=")|(?<=')[^'\n]{1,200}(?=')|[^\s"']{1,2000})/g,
    (m, pre, n, v) => (envNamed(n.toUpperCase()) && !arg(v) && !code(v) && !counted(n, v) ? `${pre}[redacted]` : m)],
  [/(\bgh\s+secret\s+set\b[^\n|;&]{0,200}?\s(?:--body|-b)[ =]["']?)([^\s"']{1,2000})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  [/((?<![A-Za-z0-9])_auth(?:Token)?[ =]["']?)([^\s"']{1,2000})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  // `mysql -pIT`: the password glued to the flag. Case kept: -P is the port.
  // In the mysql command only: `; find . -print` after it was cut. 7z as a command, not a `*.7z` file name before -print.
  [/((?:\b(?:mysql|mysqldump|mysqladmin|mariadb)|(?<![\w.*])7za?)\b[^\n|;&]{0,200}?\s-p)[^\s-][^\s]{2,}/g, '$1[redacted]'],
  // The same with a line break, a here-string or a non-ASCII blank between the flag and the value; a plain blank is mysql asking for the password, and what follows is a database name.
  [/(\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]{0,200}?\s-p(?:[ \t]*<<<[ \t]*|[^\S \t\r\n]+)["']?)(?![-<])((?<=")[^"\n]{3,2000}(?=")|(?<=')[^'\n]{3,2000}(?=')|[^\s"']{3,2000})/g, (m, pre, v) => (arg(v) ? m : `${pre}[redacted]`)],
  // -p'x' with no command before it, and an HTML password input.
  [/((?:^|[\s;|&])-p)(?:"[^"\n]{3,2000}"|'[^'\n]{3,2000}')/g, '$1[redacted]'],
  [/(<input\b[^>]{0,200}?\btype=["']?password["']?[^>]{0,200}?\bvalue=["']?)[^"'>\s]{1,2000}/gi, '$1[redacted]'],
  // "my password is IT": one with a digit or a symbol, as a password has --
  // "the password is hashed" names none.
  // Also "the password for the prod db is IT", "the api key is IT", and
  // "password IT" with no verb, when IT has a letter and a digit.
  [/\b((?:password|passwd|passphrase|api[ _-]?key|token|secret)(?:\s{1,5}(?:for|of|to)\s{1,5}[^.,;:\n]{1,40}?)?\s{1,5}(?:is|was)\s{1,5})["']?(?=\S*[0-9!@#$%^&*_+=-])[^\s"',;]{3,}[^\s"',;.]/gi, '$1[redacted]'],
  [/\b((?:password|passwd)\s{1,3})(?=[^\s"',;]{0,200}\d)(?=[^\s"',;]{0,200}[A-Za-z])[^\s"',;:]{6,}/gi, '$1[redacted]'],
  // SQL: `WITH PASSWORD 'x'`, `PASSWORD('x')`, `IDENTIFIED [WITH plugin] BY 'x'`; the value quoted, to its closing quote (1.3.2).
  [/(\b(?:password(?:\s{1,5}\(?|\()|identified\s{1,5}(?:with\s{1,5}\w{1,40}\s{1,5})?by)\s{0,5})(["'])([^"'\n]{1,200})(?=\2)/gi, (m, pre, q, v) => (arg(v) || code(v) ? m : `${pre}${q}[redacted]`)],
  // XML: `<password>x</password>` (the tag's name ends in the word), and `<add key="DbPassword" value="x"/>` (1.3.2).
  [/(<[\w.:-]{0,40}(?:password|passwd|pwd|secret|apikey|token)(?=[\s>])[^>]{0,100}>(?:<!\[CDATA\[)?)([^<\n]{3,500})(?=<)/gi, (m, pre, v) => (arg(v) || code(v) ? m : `${pre}[redacted]`)],
  [/(\bkey=["'][\w.-]{0,40}(?:password|passwd|pwd|secret|apikey|token)["']\s{1,5}value=["'])[^"'\n]{3,500}/gi, '$1[redacted]'],
  // Windows: PowerShell's ConvertTo-SecureString "x" and `$pw = "x"`, `net use Z: \\host\share x`, `schtasks /rp x` (1.3.2).
  [/(\bConvertTo-SecureString\s{1,5}(?:-String\s{1,5})?)("[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"'-]\S{0,200})/gi, (m, pre, v) => (arg(v.replace(/^["']/, '')) ? m : `${pre}[redacted]`)],
  [/(\$(?:pw|pwd|pass|passwd|password|passphrase|secret|token|apikey|\w{1,40}(?:password|secret|token|apikey))[ \t]{0,5}=[ \t]{0,5})("[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"';|&]{1,200})/gi, (m, pre, v) => (arg(v.replace(/^["']/, '')) || code(v) ? m : `${pre}[redacted]`)],
  [/(\bnet\s{1,5}use\s{1,5}(?:[A-Za-z]:\s{1,5})?\\\\\S{1,200}\s{1,5})(?![/*])(?:"[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"']{1,200})/gi, '$1[redacted]'],
  [/(\bschtasks\b[^\n|;&]{0,300}?\s\/rp\s{1,5})(?!\*)(?:"[^"\n]{1,200}"|'[^'\n]{1,200}'|[^\s"']{1,200})/gi, '$1[redacted]'],
  // The word can end a longer name, glued (PGPASSWORD=, dbPassword, clientSecret,
  // stripeApiKey) or not (DB_PASSWORD=, AWS_SECRET_ACCESS_KEY=), and the value
  // can sit on the next line (YAML). `pwd` needs its own start. Bounded, so no
  // input backtracks. Not a bare `token`: "input_tokens: 863324" is a count.
  // `pass` alone too (DB_PASS=, pass:), and a key's data. Not a value that
  // is plainly code: `password: string`, `token = jwt.sign(payload`,
  // `secret: process.env.JWT_SECRET`, `${DB_PASSWORD}`, a path.
  // Each child of a YAML parent key that names a secret (`passwords:\n  admin: X\n  root: Y`, `secrets:\n  db: X`): only the
  // parent's name says what they are (e2e audit, 2026-11-01). Only the lines indented under it, and only a value that looks like a
  // secret (yamlSecret): read on to any indented line, the siblings after it were cut (GitHub Actions' runs-on, Helm's username),
  // and so were names and settings under it (OpenAPI's `type: apiKey`, design tokens) (review, 2026-11-01). A child a line, each
  // line read once: linear.
  [/^([ \t]*)((?:password|passwd|passphrase|secret|(token)|(?:api|account|private|secret)[ _-]?key|access[ _-]key)s?[ \t]*:[ \t]*\r?\n)((?:\1[ \t]+[\w.-]{1,40}[ \t]*:[^\n]{0,500}(?:\n|$))+)/gim,
    (m, ind, head, tok, block) => ind + head + block.replace(/^([ \t]+[\w.-]{1,40}[ \t]*:[ \t]*["']?)([^\s"',;]{6,})/gm, (x, pre, v) => (yamlSecret(v, tok) && !code(v) && !arg(v) ? `${pre}[redacted]` : x))],
  // The same in JSON: each string in an object under a key that names a secret (`"secrets": {"db": "…"}`), judged as a YAML child
  // is (review, 2026-11-01). An object of one level only, read to its first `}`, bounded.
  [/("(?:password|passwd|passphrase|secret|(token)|(?:api|account|private|secret)[ _-]?key|access[ _-]key)s?"[ \t]*:[ \t]*\{)([^{}]{0,2000})\}/gi,
    (m, head, tok, body) => `${head}${body.replace(/("[\w.-]{1,40}"[ \t]*:[ \t]*")([^"\n]{6,200})(?=")/g, (x, pre, v) => (yamlSecret(v, tok) && !code(v) && !arg(v) ? `${pre}[redacted]` : x))}}`],
  // A value is never a key (a name and a colon with more after it: blanks then a value on its line, or a line break then an
  // indented child): taken for the parent's value, the child after it was kept (`secret:\n  password: X`, `secret: password: X`;
  // e2e audit, 2026-11-01). Only that shape: a value ending in `:` before a blank or at its line's end was taken for a key, and
  // a password such as `"Tr0ub4dor&3:"` or `Tr0ub4dor3:` was kept (review rounds 1 and 2, 2026-11-01).
  // A quoted value goes whole, blanks and all, as in a command; it is never a key. Unquoted, a value ends at its first blank
  // (`password: p@ss w0rd` keeps all of it: `p@ss` is under 6), since prose follows a value as often as a second word does.
  // An Azure connection string's SharedAccessKey too, not its SharedAccessKeyName (e2e audit, 2026-11-01).
  [/((?:password|passwd|passphrase|secret|(?:access|auth|refresh|api|session)[_-]?token|(?:api|account|private|secret|preshared)[ _-]?key|identitytoken|registrytoken|access[ _-]key|(?:access|auth|subscription)key(?!name)|(?:auth|subscription)[ _-]key|sharedaccesskey(?!name)|key-data|(?<![A-Za-z0-9])pwd|(?<![A-Za-z0-9])pass(?![a-z]))[A-Za-z0-9_]{0,40}(?:\[[\w.-]{0,40}\])*\\*["']?\]?\s{0,20}[:=\uFF1A]\s{0,20}(?:[|>][+-]?[ \t]*\r?\n[ \t]*|&\w{1,40}[ \t]+|\[[ \t]*(?=["']))?(?:\\*["']|\$'|\{)?)((?<=\\")(?:(?!\\")[^\n]){6,2000}(?=\\")|(?<=")(?![\r\n])(?:[^"\\]|\\.){6,2000}(?:"[ \t]*\+[ \t]*"(?:[^"\\]|\\.){0,2000})*(?=")|(?<=')[^'\n]{6,2000}(?=')|(?<=\{)[^}\n"':{]{6,500}(?=\})|(?![\w.-]{1,40}:(?:[ \t]+\S|[ \t]*\r?\n[ \t]+[\w.-]))(?:[^\s"',;]|[,;](?=[^\s"',;])){6,})/gi, (m, pre, v) => (code(v) ? m : `${pre}[redacted]`)],
  // A bare `token=` or `token:` whose value has a letter: a key, not a count.
  [/((?<![A-Za-z0-9])tokens?[ \t]{0,20}[:=\uFF1A]\s{0,20}["']?)(?![\w.-]{1,40}:(?:[ \t]+\S|[ \t]*\r?\n[ \t]+[\w.-]))(?=[^\s"',;]{0,200}[A-Za-z])([^\s"',;]{6,})/gi, (m, pre, v) => (code(v) ? m : `${pre}[redacted]`)],
];
const redactRaw = (s) => SECRETS.reduce((t, [re, to]) => t.replace(re, to), s);
// A backslash line wrap is joined first (it cuts a secret in two), then the raw rules run, then the same rules on a folded copy of that:
// look-alike letters, marks and hidden characters gone (NFKD, no marks, no Default_Ignorable), and an entity, a \u00XX or a %XX that
// spells printable ASCII decoded. Text with no secret is returned as written.
// shortcut: homoglyphs from another script (Cyrillic o for Latin o) are not folded; there is no safe map, add one if one is ever seen used.
const fold = (s) => s.normalize('NFKD').replace(/\p{M}|\p{Default_Ignorable_Code_Point}/gu, '')
  .replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(quot|apos));/gi, (m, d, h, n) => { const c = n ? (n.toLowerCase() === 'quot' ? 34 : 39) : parseInt(d ?? h, d ? 10 : 16); return c > 31 && c < 127 ? String.fromCharCode(c) : m; })
  .replace(/\\{1,8}u00([2-7][0-9a-f])|%([2-7][0-9a-f])/gi, (m, a, b) => String.fromCharCode(parseInt(a ?? b, 16)));
export const redact = (s) => {
  const u = s.replace(/\\\r?\n[ \t]*/g, ''), r = redactRaw(u), f = fold(r), g = f === r ? r : redactRaw(f);
  return g === f ? (r === u ? s : r) : g;   // the folded text only when its pass found a secret the raw one missed
};
