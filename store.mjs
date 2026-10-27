// Where a session's memory lives, and how its writers stay out of each other's
// way. Our hooks take the lock; Claude Code's own Edit and Write tools do not,
// so a write the model makes during a pass can only be detected --
// replaceIfUnchanged -- never prevented.
import { mkdirSync, rmdirSync, rmSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

export const projectsRoot = () => join(homedir(), '.claude', 'projects');
export const same = (a, b) => (process.platform === 'win32'
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
  : resolve(a) === resolve(b));

// The project folder Claude Code chose holds the transcript, and its `memory`
// is the store whatever the cwd is now: a session that moved into another
// project's folder wrote that project's handoff. A transcript anywhere else (a
// test, a payload without one) falls back to the cwd's slug, as before.
// Resolved: `<projects>/../x.jsonl` passed the check and named a store outside
// it. A path that is no string (a malformed payload) threw, and the Stop hook with it.
export function storeOf(payload = {}) {
  const t = typeof payload.transcript_path === 'string' && resolve(payload.transcript_path);
  if (t && same(dirname(dirname(t)), projectsRoot())) return join(dirname(t), 'memory');
  return join(projectsRoot(), String(payload.cwd || process.cwd()).replace(/[^A-Za-z0-9]/g, '-'), 'memory');
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

// Every store once: one reached by two paths (a junction back to another
// project's store) is one brain, tiered and reported once; a junction whose
// target is gone is none.
export function allStores() {
  const root = projectsRoot(), seen = new Set();
  let all = []; try { all = readdirSync(root); } catch {}
  return all.map((p) => join(root, p, 'memory')).filter((d) => {
    let real; try { real = realpathSync(d); } catch { return false; }
    if (seen.has(real) || !existsSync(join(d, 'MEMORY.md'))) return false;
    seen.add(real);
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
  const t = text.replace(/^﻿/, '');
  const end = t.startsWith('---') ? t.indexOf('\n---', 3) : 0;
  const head = end === -1 ? t : t.slice(0, end);
  // A value stays on its line: an emptied `superseded-by:` took the next line
  // as its value. \r too, for a file saved CRLF.
  const get = (re) => ((head.match(re) || [])[1] || '').trim();
  const superseded = get(/^[ \t]*superseded-by:[ \t]*"?(.*?)"?[ \t\r]*$/m);
  return {
    name: get(/^name:[ \t]*"?(.*?)"?[ \t\r]*$/m),
    // YAML-escaped quotes stay escaped otherwise: a recovered pointer read `\"gaps\"`.
    desc: get(/^description:[ \t]*"?(.*?)"?[ \t\r]*$/m).replace(/\\"/g, '"'),
    type: get(/^[ \t]*type:[ \t]*(\w+)/m),
    tier: superseded ? 'archive' : get(/^[ \t]*tier:[ \t]*(\w+)/m),
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
export const gitArgs = (...a) => ['-C', projectsRoot(), '-c', 'core.longpaths=true', '-c', 'commit.gpgsign=false',
  '-c', `core.hooksPath=${join(projectsRoot(), '.git', 'no-hooks')}`, ...a];

// git's reason for a failure: stderr's first line that is not a warning -- a
// repack Windows could not finish leaves an .idx with no .pack, and git warns
// of it on every command (2026-10-27) -- else the message's, which only says
// which command failed.
export const gitWhy = (e) => (e.code === 'ENOENT' ? 'git is not installed'
  : String(e.stderr || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('warning:')) || String(e.message).split('\n')[0]);

// A file's text, or null when there is none: what replaceIfUnchanged compares.
export const raw = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

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
const STEP = 25;
// The codes Windows gives while another program holds a path or a delete is still settling.
export const BUSY = ['EPERM', 'EBUSY', 'EACCES'];

// Run fn holding the store's lock: `mkdir` either creates the folder or fails,
// on NTFS as anywhere. Returns fn's result, or null when the lock stayed busy.
// ponytail: two hooks that both find a dead lock can both take it over in the
// same instant; that needs a killed hook first, and costs one merged write.
export function withLock(dir, fn) {
  const lock = join(dir, '.lock');
  for (const until = Date.now() + LOCK_WAIT; ;) {
    try { mkdirSync(lock); break; }
    catch (e) {
      // The last holder's rmdir still settling: the same codes a rename retries.
      if (e.code !== 'EEXIST' && !BUSY.includes(e.code)) throw e;
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
  writeFileSync(tmp, next);
  try {
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
