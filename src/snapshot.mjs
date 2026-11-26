// The snapshot of the memories: the git repository at the projects root, taken in the background after a Stop (the .gitignore
// that keeps everything else out, the busy locks, the held notes, the health record) and the one place that builds a git
// command line for it (gitArgs, gitWhy). Moved here whole from memory-tier.mjs and store.mjs, as they were.
// Imports only Node and store.mjs (and privacy.mjs's isOff); git runs through `exec`, which a test replaces with a scripted stand-in.

import { chmodSync, readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync, statSync, realpathSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, relative, isAbsolute, basename, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { isOff } from './privacy.mjs';
import { projectsRoot, replaceIfUnchanged, raw, allStores, pathKey, same, local, reason } from './store.mjs';
import { redact, holdsSecret } from './secrets.mjs';

const GIT_LOCK_STALE = 10 * 60000;  // an index.lock this old outlived the git that made it
export const GIT_TIMEOUT = 30_000;  // a git that hangs (a prompt nobody sees) must not hold the Stop hook
export const BATCH = 1000;          // files a part of a first snapshot adds: ~6 s at Windows' ~6 ms a file, well inside GIT_TIMEOUT

// The one seam through which this module runs git: execFileSync's own signature, so a test passes a scripted stand-in
// (or nothing, for real git again). execFileSync is looked up at each call, as an import is, so a test that swaps it still reaches git.
let stand;
export const useGit = (f) => { stand = f; };
// The lock a purge holds is touched before each git it runs, so a live purge never reads as a stale lock to busy().
let held_ = null;
const exec = (...a) => { if (held_) try { const d = new Date(); utimesSync(held_, d, d); } catch {} return (stand ?? execFileSync)(...a); };
// What main() clears at each start: the lists a snapshot fills for snapshotHealth.
export const reset = () => { missed = []; held = []; };

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
  // git's own clean-up never starts by itself, detached, under a later command (it dropped objects under a purge, CI 2026-11-24): the snapshot runs it, below.
  '-c', 'gc.auto=0',
  // Ours whoever created it: one made from an elevated shell or under sudo failed every snapshot with "dubious ownership" (1.3.1 audit C-2).
  '-c', `safe.directory=${projectsRoot().replace(/\\/g, '/')}`,
  '-c', `core.hooksPath=${join(projectsRoot(), '.git', 'no-hooks')}`, ...a]);
// git's reason for a failure: stderr's first line that is not a warning -- a
// repack Windows could not finish leaves an .idx with no .pack, and git warns
// of it on every command (2026-10-27) -- else the message's, which only says
// which command failed (reason()). The stderr line loses a temp file's name too.
export const gitWhy = (e) => redact((e.code === 'ENOENT' && String(e.syscall).startsWith('spawn') ? 'git is not installed'
  : String(e.stderr || '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('warning:')) || reason(e)).replace(/\.tmp\d+/g, ''));

// Every store under the projects root, by every path that reaches one: the
// snapshot's .gitignore needs the junctions. Tiering walks allStores(), each
// store once -- the same store twice doubled every number reported about it.
const stores = (root) => readdirSync(root).map((p) => join(root, p, 'memory')).filter((d) => existsSync(join(d, 'MEMORY.md')));

// The corpus is months of lessons in one directory on one machine, with no copy
// anywhere -- the same shape as a store that once had no backup at all. A git repo tracking ONLY the memory markdown
// gives history and undo for the realistic failure: a bad edit, a stray glob, a
// deletion. It is not offsite; that half still needs somewhere to push to.
// git follows a junction as an ordinary directory, so a store reachable by two
// paths is committed twice -- 186 files became 372, and a restore could bring
// back the stale copy. allStores() already knows which paths are the same
// store; ignore every path that is not the resolved one.
const within = (base, p) => { const r = relative(base, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r); };
export function gitignore() {
  const root = projectsRoot(), real = realpathSync(root), elsewhere = new Set();
  const linked = stores(root)
    // Case-blind on Windows: a home dir spelt one way in USERPROFILE and another
    // on disk would otherwise read as fifteen junctions and ignore every store.
    // Against the root's real path: a symlinked ~/.claude, or macOS's /var, made
    // every store read as a link, and nothing was snapshotted.
    // A second path only when it leads to another folder in here: one linked to
    // a folder elsewhere (a synced folder) is that store's only path, and
    // ignored, it was never snapshotted (audit, 2026-10-28).
    // Two links to one folder elsewhere: the first is its path, as allStores()
    // takes it; tracked by both, every note was in the history twice.
    .filter((d) => {
      const r = realpathSync(d), k = pathKey(r);
      if (within(real, r)) return !same(r, join(real, d.slice(root.length + 1)));
      const twice = elsewhere.has(k); elsewhere.add(k); return twice;
    })
    .map((d) => `${d.slice(root.length + 1).replace(/\\/g, '/')}/`);
  // Not the handoff: it holds the last exchanges, and is kept only until newer
  // ones replace it. Committed, every version stayed in the history for good.
  // A journal day follows once it is over: today's file grows with every reply,
  // and each version would stay in the history. The line changes at midnight.
  const today = local().slice(0, 10);
  return ['*', '!*/', '!*/memory/*.md', '*/memory/handoff.md', '!*/memory/journal/*.md', `*/memory/journal/${today}.md`, '!.gitignore', ...linked].join('\n') + '\n';
}
// What this tool's .gitignore starts with: a repository that has it is one
// this tool made before it marked them.
const IGNORE_HEAD = '*\n!*/\n!*/memory/*.md\n';

// The one busy rule, asked before every git write (the snapshot, restore, purge, rescan). git's lock files a commit takes (the index,
// HEAD, the branch's, packed-refs, config) and gc.pid, which a git clean-up holds: a fresh one is another git's work in flight, so
// busy, not a failure -- the next turn retries. One older than ten minutes outlived the git that made it, and would refuse every
// write from now on: swept here, and not busy. Dated ahead of the clock is as old: it read as busy, uncounted, until the clock
// caught up. Gone meanwhile is gone. A purge holds config.lock for its whole run, so a snapshot started meanwhile reads busy.
export const BUSY = 'the git of the memory store is busy (a snapshot or clean-up); try again in a moment';
const GC_STALE = 12 * 3600000;   // git's own rule for a gc.pid
// gc.pid is "<pid> <host>": dead when its gc ran on this machine and the process is gone (EPERM: alive, another user's); else git's 12 hours.
const gcDead = (p, age) => {
  let m; try { m = /^(\d+) (\S+)\s*$/.exec(readFileSync(p, 'utf8')); } catch {}
  if (m && m[2] === hostname()) { try { process.kill(+m[1], 0); } catch (e) { if (e.code === 'ESRCH') return true; } }
  return age >= GC_STALE;
};
export function busy() {
  const g = join(projectsRoot(), '.git'), heads = join(g, 'refs', 'heads');
  let hs = []; try { hs = readdirSync(heads).filter((f) => f.endsWith('.lock')).map((f) => join(heads, f)); } catch {}
  let fresh = false, stuck = null;
  for (const l of [join(g, 'index.lock'), join(g, 'HEAD.lock'), join(g, 'config.lock'), join(g, 'packed-refs.lock'), join(g, 'gc.pid'), ...hs]) {
    let age; try { age = Math.abs(Date.now() - statSync(l).mtimeMs); } catch { continue; }
    if (l.endsWith('gc.pid') ? !gcDead(l, age) : age < GIT_LOCK_STALE) { fresh = true; continue; }
    // One that cannot be removed (held open on Windows) is busy, not a crash; the snapshot reads the error as the failure it was.
    try { unlinkSync(l); } catch (e) { if (e.code !== 'ENOENT') stuck = e; }
  }
  return stuck ?? fresh;
}

let held = [];     // notes left out of the commit for holding a secret: set by snapshot(), kept by snapshotHealth()
let missed = [];   // stores the snapshot cannot reach: set by snapshot(), kept by snapshotHealth(), emptied by main()
export function snapshot({ gitWait = GIT_TIMEOUT, batch = BATCH } = {}) {
  const root = projectsRoot();
  // The C locale: "nothing to commit" is matched below, in git's English. (Git
  // for Windows here prints English whatever LC_ALL says, so no check sees it.)
  // Set on this process, which git inherits: no copy of the environment is
  // handed on. Put back at the end: main() may run in a test's process.
  const lc = process.env.LC_ALL;
  process.env.LC_ALL = 'C';
  // A git that hangs (a prompt nobody sees) must not hold the Stop hook. `input`: stdin's text.
  const gitIn = (input, ...a) => exec('git', gitArgs(...a), { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: gitWait, maxBuffer: 256 << 20 });
  const git = (...a) => gitIn('', ...a);
  // A first snapshot taken in parts: the rest is still to add.
  const parts = join(root, '.git', 'project-memory-parts');
  try {
    const fresh = !existsSync(join(root, '.git'));
    const ignorePath = join(root, '.gitignore');
    // A new repository gets this tool's .gitignore first, then git: one cut off
    // between the two is still known for this tool's by it, and adopted below.
    // Marked only after the init, a cut-off one read as the user's for good.
    if (fresh) { replaceIfUnchanged(ignorePath, raw(ignorePath), gitignore()); git('init', '-q'); try { chmodSync(join(root, '.git'), 0o700); } catch {} }
    // Only a repository this tool made: one the user made there is theirs, and
    // its .gitignore, its lock, its index and its history are not this tool's.
    const ours = /^\[project-memory\]/m.test(raw(join(root, '.git', 'config')) ?? '');
    if (!ours && !(raw(ignorePath) ?? '').startsWith(IGNORE_HEAD)) return `off: ${root} is a git repository project-memory did not make, so it commits nothing there`;
    // An install from before the modes: its .git is still open to others, so the files are too. Tightened once, when found so.
    if (process.platform !== 'win32' && (statSync(join(root, '.git')).mode & 0o077)) {
      const to = (p, m) => { try { chmodSync(p, m); } catch {} };
      to(join(root, '.git'), 0o700); to(join(root, '.stop-ran'), 0o600);
      for (const d of allStores()) {
        to(join(d, 'journal'), 0o700); to(join(d, 'journal.md'), 0o600); to(join(d, 'handoff.md'), 0o600);
        let days = []; try { days = readdirSync(join(d, 'journal')); } catch {}
        for (const f of days) to(join(d, 'journal', f), 0o600);
      }
    }
    // Another git's work in flight is busy, not a failure -- the next turn retries (busy(), below).
    const b = busy();
    if (b instanceof Error) throw b;
    if (b) return 'busy';
    // Adopted after the sweep: a stale config.lock refused `git config`, and read
    // as busy, the history never started.
    if (!ours) git('config', 'project-memory.snapshots', 'true');
    // Everything is ignored except the memory markdown: this directory also
    // holds ~890 MB of session transcripts that must never be committed.
    // Recomputed each run and written when it differs: a junction created
    // after the repo existed would otherwise be double-tracked forever.
    const want = gitignore();
    const have = raw(ignorePath);
    // By rename: another session's `git add -A` reading it half written
    // would stage every transcript.
    if (have !== want) replaceIfUnchanged(ignorePath, have, want);
    // Whatever it ignores leaves the index, until a run has done it: done
    // only by the run that rewrote .gitignore, an untrack that run lost (a
    // busy index, a killed hook) was never retried, and handoff.md stayed in
    // every snapshot after. `--`: on Linux and macOS every project's folder
    // name starts with `-`, and read as an option.
    let offs = []; try { offs = readdirSync(root).filter((p) => isOff(join(root, p, 'memory'))).map((p) => `:(exclude,literal)${p}/memory`); } catch {}
    const applied = join(root, '.git', 'project-memory-ignored');
    const stage = () => {
      if (have !== want || raw(applied) !== want) {
        for (const l of want.split('\n').filter((x) => x && x !== '*' && !x.startsWith('!'))) git('rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', l);
        writeFileSync(applied, want, { mode: 0o600 });
      }
      // A history's first add, of every note at once, was killed at GIT_TIMEOUT on a large store (~6 ms a file on Windows,
      // 5,000 files): it left index.lock, and no snapshot ever started (audit H-F1). With no index yet, or after an add that
      // timed out, it goes in parts of `batch` files, a part a run, the indexes first so the first commit holds them as the
      // user wrote them. update-index, not `add --pathspec-from-file`: any git has it. Returns the files still to add.
      // A history that lost its index (deleted by hand): git read it as empty, and a part committed against it dropped
      // every other note from HEAD (review of #6). Rebuilt from HEAD first, as a damaged one is; with no HEAD, a first.
      if (!existsSync(join(root, '.git', 'index'))) {
        let head = true; try { git('rev-parse', '-q', '--verify', 'HEAD'); } catch (e) { if (e.status !== 1) throw e; head = false; }
        if (head) git('reset', '-q');
      }
      if (!existsSync(join(root, '.git', 'index')) || existsSync(parts)) {
        const todo = git('ls-files', '-z', '-o', '-m', '--exclude-standard', ...(offs.length ? ['--', '.', ...offs] : [])).split('\0').filter(Boolean)
          .sort((a, b) => /(^|\/)MEMORY[^/]*$/.test(b) - /(^|\/)MEMORY[^/]*$/.test(a));
        if (todo.length > batch) {
          gitIn(todo.slice(0, batch).join('\0'), 'update-index', '--add', '--remove', '-z', '--stdin');
          writeFileSync(parts, '', { mode: 0o600 });
          return todo.length - batch;
        }
        try { unlinkSync(parts); } catch {}
      }
      git('add', '-A', ...(offs.length ? ['--', '.', ...offs] : []));
      return 0;
    };
    // A damaged index (a crash or a full disk while git wrote it) failed every
    // snapshot after it, for good. It is only git's copy of the last commit
    // and the notes on disk: dropped and rebuilt from the commit, no note touched.
    // A note another window deleted between git's listing and its read is one
    // more try: read as busy, a cause that never goes away (a link to nothing)
    // would have hidden a history that never commits.
    let rest;
    try { rest = stage(); } catch (e) {
      const why = gitWhy(e);
      if (/index file (?:smaller than expected|corrupt)|bad (?:signature|index file)/.test(why)) {
        try { unlinkSync(join(root, '.git', 'index')); } catch {}
        try { git('reset', '-q'); } catch {}   // none before the first commit
        // Rebuilt from a commit that still tracks what is now ignored (a history
        // from before 1.1.0 whose untracking never landed): untracked again, or
        // `add -A` updated it, handoff.md and all.
        try { unlinkSync(applied); } catch {}
      } else if (!/^error: open\("[^"]*"\): No such file or directory/.test(why)) throw e;
      rest = stage();
    }
    // A store linked to a folder outside the root is in the history only if git
    // follows the link: Git for Windows follows a junction, git elsewhere keeps a
    // symlink as a link. Asked of git, not guessed by platform: unsaid, nothing
    // was snapshotted and doctor said ok (audit, 2026-10-28).
    const top = realpathSync(root);
    missed = allStores().filter((d) => {
      try { if (within(top, realpathSync(d))) return false; } catch { return false; }
      try { return !git('ls-files', '--', `${d.slice(root.length + 1).replace(/\\/g, '/')}/MEMORY.md`).trim(); } catch { return true; }
    });
    // The history is never rewritten, and the model's own Write tool saves a note no hook scrubs: one that holds a key, token or
    // password stays out of it (unstaged, so its last clean version stays) until the secret is gone. Told in .snapshot-health.
    held = [];
    const heldRaw = new Set();
    const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter((x) => /^[^/]+\/memory\/(?!handoff\.md$|journal\.md$)[^/]+\.md$/.test(x));   // not the journal or handoff: scrubbed as written
    // One git process for every staged blob (one per note took 14 s for 80 notes): the output is "<oid> blob <bytes>", the bytes, a newline, per
    // path, or "<path> missing", read by byte length because a note can hold UTF-8.
    const blobs = new Map(), lined = staged.filter((f) => !/[\n\r]/.test(f));   // a name with a line break would split cat-file's input: read by itself below
    if (lined.length) {
      const out = exec('git', gitArgs('cat-file', '--batch'), { input: lined.map((f) => `:${f}\n`).join(''), stdio: ['pipe', 'pipe', 'pipe'], timeout: gitWait, maxBuffer: 256 << 20 });
      let at = 0;
      for (const f of lined) {
        const eol = out.indexOf(10, at), line = out.toString('utf8', at, eol), head = line.split(' ');
        at = eol + 1;
        if (head.length === 3 && head[1] === 'blob' && /^\d+$/.test(head[2])) { const n = Number(head[2]); blobs.set(f, out.toString('utf8', at, at + n)); at += n + 1; }
        else if (!line.endsWith(' missing')) throw new Error(`cat-file reply out of step at ${redact(f)}`);   // a throw commits nothing; the path, not the line, which may be a note's text
      }
      if (at !== out.length) throw new Error('cat-file reply out of step');
    }
    // Only a path gone from the index (a staged deletion) falls back to the working file; a timeout or other failure throws, and a throw commits nothing.
    for (const f of staged.filter((x) => /[\n\r]/.test(x))) {
      try { blobs.set(f, git('show', `:${f}`)); } catch (e) { if (!/does not exist|not in the index/.test(String(e.stderr))) throw e; }
    }
    for (const f of staged) {
      // the staged blob is what a commit keeps, not the working file a session may have cleaned since the add
      const t = blobs.has(f) ? blobs.get(f) : raw(join(root, f));
      // Only the note's own name: the slug joins a folder named pk/sk/rk to the rest of the path into a key-like run.
      const cut = f.lastIndexOf('/') + 1, name = f.slice(cut);
      if (redact(name) !== name || (t !== null && holdsSecret(t))) { git('reset', '-q', '--', `:(literal)${f}`); held.push(f.slice(0, cut) + redact(name)); heldRaw.add(f); }
    }
    // Tracked files changed and not added, a held note (it stays modified, for good) not counted: what is still owed.
    const owed = () => git('diff', '--name-only', '-z', ...(offs.length ? ['--', '.', ...offs] : [])).split(' ').filter((x) => x && !heldRaw.has(x)).length;
    // Straight to the commit, which says so when nothing changed: a `git status`
    // first was one more git start on every snapshot, ~80-300 ms on this box.
    try {
      git('-c', 'user.email=memory@local', '-c', 'user.name=memory-tier',
        // Local time, not UTC: a snapshot stamped two hours behind the clock that
        // made it is a number that misleads whoever reads the log later.
        'commit', '-qm', `memory: ${fresh ? 'first snapshot' : local()}`);
    } catch (e) {
      if (/nothing (added )?to commit/.test(String(e.stdout))) return null;   // nothing changed
      // Another session's commit took what this one staged, and a file changed
      // again since: busy, and the next turn commits it. Read as a failure, it
      // counted against the history's health.
      // A held note alone is nothing to commit, not another session's commit.
      if (/no changes added to commit/.test(String(e.stdout))) { if (held.length) { let n = 1; try { n = owed(); } catch {} if (!n) return null; } return 'busy'; }
      throw e;
    }
    // git's clean-up, once a commit is made, in this process and waited for: with gc.auto=0 above it never runs on its own. 6700 loose
    // objects is git's own limit, after the 0 so it wins. Best effort: a failed or killed gc is not a failed snapshot.
    try { git('-c', 'gc.auto=6700', 'gc', '--auto', '--no-detach'); } catch {}
    // Changed since the add (another session's write, whose own snapshot went busy): still owed, or its pending mark is
    // cleared by this success and the file stays out of every snapshot until it changes again.
    // `diff --name-only`, not `status`: tracked files only, no scan of untracked ones (80-300 ms), and a path `add -A` can never add (nul.md) never shows.
    if (!rest) { try { rest = owed(); } catch {} }
    return rest ? `in parts: ${rest} file(s) still to add; each reply adds more` : fresh ? 'initialised' : 'committed';
  } catch (e) {
    // No git is a setup, not a failure: everything but the history works.
    // Only git's own start: a lock that vanished between two calls is ENOENT
    // too, and was recorded as "git is not installed".
    if (e.code === 'ENOENT' && String(e.syscall).startsWith('spawn')) return 'off: git is not installed';
    // Killed at its timeout: from the next run the history is taken in parts. Its lock stays, for GIT_LOCK_STALE: a git
    // that outlived the kill (a wrapper's child) may still hold it. No note is touched: git only reads them.
    if (e.code === 'ETIMEDOUT') { try { writeFileSync(parts, '', { mode: 0o600 }); } catch {} return `snapshot failed: git took longer than ${gitWait / 1000} s; the next replies take the history in parts`; }
    const why = gitWhy(e);   // git's reason, not a warning before it, nor 'Command failed'
    // This session runs two or three git commands, and another session's commit can
    // take a lock in a gap between them, or move HEAD under this one's: busy,
    // like the pre-check, not a failure the startup line would count. Only
    // that: a lock git may not create (Permission denied), or a dead one that
    // cannot be deleted, is a failure, and read as busy it stopped every
    // snapshot unseen.
    // Two sessions starting the history at once race `git init` too.
    // Only a lock another git holds, or a ref it moved: the same words with
    // "Permission denied" are a history that can never commit, and busy hid it.
    if (/\.lock'?: File exists|cannot lock ref '[^']*': is at |reference already exists|could not lock config file .*: File exists|cannot copy .* File exists/.test(why)) return 'busy';
    return `snapshot failed: ${why}`;
  } finally { if (lc === undefined) delete process.env.LC_ALL; else process.env.LC_ALL = lc; }
}

// ponytail: two sessions updating this counter at once can miscount by one;
// it only decides whether a warning shows.
// `pending`: a snapshot still owed (busy, failed, or in parts), which the next Stop retries though no note changed: the
// tidy-up is stamped whatever the snapshot did, or one that never went through redid the whole pass every Stop.
export function snapshotHealth(s) {
  const p = join(projectsRoot(), '.snapshot-health');
  const text = raw(p);
  let h = {}; try { h = JSON.parse(text) ?? {}; } catch {}
  const failed = typeof s === 'string' && s.startsWith('snapshot failed');
  const off = typeof s === 'string' && s.startsWith('off: ');
  const rest = typeof s === 'string' && s.startsWith('in parts: ') ? parseInt(s.slice('in parts: '.length), 10) : 0;
  // Busy is another commit in flight, until it lasts longer than any commit takes (GIT_LOCK_STALE): then it is counted.
  // Never counted, a lock renewed again and again (a git killed at its timeout each time) stopped every snapshot, unsaid.
  const since = h.busySince || new Date().toISOString(), stuck = s === 'busy' && Date.now() - Date.parse(since) > GIT_LOCK_STALE;
  const next = s === 'busy'
    ? { ...h, busySince: since, pending: true, ...(stuck && { failures: (h.failures ?? 0) + 1, error: `busy since ${local(since)}: another git holds the repository's lock` }) }
    : failed
    ? { lastOk: h.lastOk || null, failures: (h.failures || 0) + 1, error: s.slice('snapshot failed: '.length), pending: true }
    : off ? { lastOk: h.lastOk || null, failures: 0, off: s.slice('off: '.length) }
    : { lastOk: new Date().toISOString(), failures: 0, ...(rest && { partial: rest, pending: true }) };
  if (missed.length) next.missed = missed;
  if (held.length) next.held = held;
  // Through a temp file: one torn by a parallel Stop parsed as {}, and the owed snapshot and failure count were lost (audit D-5).
  try { replaceIfUnchanged(p, text, JSON.stringify(next)); } catch {}
}
export const owed = () => { try { return JSON.parse(readFileSync(join(projectsRoot(), '.snapshot-health'), 'utf8')).pending === true; } catch { return false; } };

// ---- the git half of the CLI, moved from memory.mjs as it was ----
// The snapshot repo is ~/.claude/projects and tracks each store by its real
// path: memory-tier.mjs ignores the junctions.
// Paths literal: git reads a path with * ? [ as a pattern, and `notes[1].md`
// matched other notes' history. A version is read with cat-file for the same
// reason: `git show rev:a*.md` took the argument for a pattern, printed
// nothing and succeeded, and restore wrote an empty note.
const gitAs = (encoding, a) => exec('git', gitArgs('--literal-pathspecs', ...a), { encoding, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, timeout: 60_000 });
export { git, gitBytes, real, tracked, ever, rewrite, FAST, unsnapped, missing };   // the CLI's way in; the lines above stay as they were in memory.mjs
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
  const g = join(projectsRoot(), '.git'), lock = join(g, 'config.lock'), wait = new Error(BUSY);
  if (busy()) throw wait;
  try { writeFileSync(lock, '', { flag: 'wx', mode: 0o600 }); } catch (e) { throw e.code === 'EEXIST' ? wait : e; }
  // A run that was killed left its copy, the full unscrubbed history, behind; holding the lock, no other run is using one.
  try { for (const n of readdirSync(g)) if (n.startsWith('pm-purge-')) rmSync(join(g, n), { recursive: true, force: true }); } catch {}
  // The copy sits in the repository's own .git, which no snapshot commits; the OS temp folder was outside the store.
  const tmp = mkdtempSync(join(g, 'pm-purge-')), copy = join(tmp, 'copy.git');
  held_ = lock;
  try {
    // -c writes it into the copy's config: its plain `git -C copy` runs and the fetch's upload-pack never see gitArgs' -c, and the
    // copy, deeper in .git, passed Windows' 260 characters first.
    git('clone', '-q', '--mirror', '--no-hardlinks', '-c', 'core.longpaths=true', projectsRoot(), copy);
    work(copy);
    git('fetch', '-q', '--update-head-ok', '--force', copy, '+refs/heads/*:refs/heads/*');
    git('reset', '-q');
    for (const ref of git('for-each-ref', '--format=%(refname)', 'refs/original/').split('\n').filter(Boolean)) git('update-ref', '-d', ref);
    git('reflog', 'expire', '--expire=now', '--all');
    git('gc', '-q', '--prune=now');   // no detached gc --auto can start under it now: gc.auto=0 (gitArgs)
  } finally { held_ = null; rmSync(tmp, { recursive: true, force: true }); try { unlinkSync(lock); } catch {} }
};
// shortcut: the whole history is read into one buffer (1 GiB cap) and only branches come back from the rewrite, so a hand-made tag keeps old text; upgrade to streaming or fetch all refs if that is hit.
const FAST = { maxBuffer: 1 << 30, timeout: 300_000 }, QUIET_FAST = { ...FAST, stdio: ['ignore', 'pipe', 'ignore'] };   // git warns about a ref that names a blob
// Why no snapshot can be read, in plain words, or '' when one can: git's own ("fatal: not a git repository", "cannot change
// to") read as a fault, and without git, restore offered to replace a note "with the snapshot" (audit C-3, C-4).
const unsnapped = () => {
  try { gitInstalled(); } catch { return 'git is not installed, so there are no snapshots: everything else works. Installing Git (git-scm.com) turns them on'; }
  // Nor a repository with no commit yet: a large first snapshot is taken in parts, over several replies.
  let head = false; try { head = existsSync(join(projectsRoot(), '.git')) && !!git('rev-parse', '--verify', '-q', 'HEAD'); } catch {}
  return head ? '' : 'no snapshots yet: project-memory takes the first at the end of a reply';
};
// git saying a snapshot does not hold a path, or there is no such commit.
const missing = (e) => /does not exist in|exists on disk, but not in|invalid object name|not a valid object name|unknown revision|bad revision/i.test(String(e?.stderr));

// The git commands the CLI (memory.mjs: history, restore, forget --purge, rescan, doctor) runs, each with the arguments and options it
// had there. The 60 s `git` and `gitBytes` read the snapshots; the fast-export and fast-import of a history rewrite take 300 s.
export const gitInstalled = () => exec('git', ['--version'], { stdio: 'ignore' });   // throws when git is not there
export const fastExport = () => exec('git', gitArgs('fast-export', '--all', '--signed-tags=strip'), QUIET_FAST);
export const fastExportOf = (copy) => exec('git', ['-C', copy, 'fast-export', '--all', '--signed-tags=strip'], QUIET_FAST);
export const fastImportTo = (copy, input) => exec('git', ['-C', copy, 'fast-import', '--force', '--quiet'], { ...FAST, input });
export const hashObject = (input, opts) => exec('git', gitArgs('hash-object', '-w', '--stdin'), { input, ...opts });

// The record snapshotHealth writes, as every reader sees it: `health` is the parsed file, `read` is whether the file could be read.
export const readHealth = () => { try { return { read: true, health: JSON.parse(readFileSync(join(projectsRoot(), '.snapshot-health'), 'utf8')) }; } catch { return { read: false, health: null }; } };

// Why a store is not in the snapshots, and the user's fix: moved from handoff-log.mjs.
export const MISSED = 'it is reached through a link to a folder outside ~/.claude/projects, and git does not follow that link, so no old version of a note there can be brought back. The fix: keep the folder in ~/.claude/projects and make the link the other way round';
// A held note is checked again at every snapshot, so removing the secret is all it takes.
export const HELD = 'it holds what looks like a key, token or password, so it stays out of the history. To release it: remove the secret from the note (or its file name, or delete the note); the next reply snapshots it';

// Pack index files with no pack, which a repack Windows could not finish leaves: harmless, but git warns of each on every command.
export const packOrphans = () => {
  const pack = join(projectsRoot(), '.git', 'objects', 'pack');
  let packs = []; try { packs = readdirSync(pack); } catch {}
  return { pack, orphans: packs.filter((f) => f.endsWith('.idx') && !packs.includes(f.replace(/\.idx$/, '.pack'))) };
};
