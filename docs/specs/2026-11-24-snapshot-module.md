# Snapshot module (1.6.0 step 16)

Amended 2026-11-25 after the audit `reports/Audit of 1.6.0 plans 2026-11-25.md` (findings 4, 6, 7, 13).

Status: approved by the maintainer, 2026-11-24, in the architecture review's
candidate #3. There were two rounds of questions, and every answer was "yes"
to the recommendation. A later session builds it from
`docs/plans/2026-11-24-1.6.0-step-16-snapshot-module.md`.

Words are used as in `GLOSSARY.md`. The binding decision is
`docs/adr/0002-plugin-owns-git-cleanup-and-one-busy-rule.md`.

## Why

Measured on master at ad20f3e (v1.5.7):

- **Two modules run git, with two wrappers.**
  - `memory-tier.mjs` takes the snapshot. Its wrapper is `gitIn` and `git` at
    `:401-402`, with a 30 s timeout. The snapshot itself runs from `:392` to
    `:590`.
  - `memory.mjs` runs history, restore, purge, rescan and doctor. Its wrapper is
    `gitAs`, `git` and `gitBytes` at `:460-463`, with a 60 s timeout. Two of its
    calls run with `FAST` (300 s).
  - Only `gitArgs` and `gitWhy` (`store.mjs:352`, `:364`) are shared.
- **There are three different answers to "is the repo busy".**
  - The snapshot checks index, HEAD, config, packed-refs and refs/heads/*
    locks, and deletes any older than 10 minutes (`memory-tier.mjs:430-441`).
  - Purge's `rewrite` checks the index and HEAD locks, then holds `config.lock`
    for its whole run (`memory.mjs:499-503`, on purpose, as its comment says).
  - Rescan checks three locks (`:602`).
  - Restore checks none (`:728-740`).
- **Git's own automatic clean-up is never turned off.** Nothing sets `gc.auto`.
  After a snapshot's commit, git may start `gc --auto` detached, and it takes
  none of the locks purge checks. That is the CI failure PR #230 covers with a
  retry ("unable to mark recent objects").
- **The health record is written once and read in four places, and each reader
  handles a missing or broken file its own way.**
  - The writer is `snapshotHealth` (`memory-tier.mjs:607-627`). It treats a
    broken file as `{}`, so the counts start again.
  - `owed()` (`:628`) reads it as "nothing owed".
  - `snapshots()` (`memory.mjs:413-427`, for status and doctor) says "none
    recorded yet".
  - The startup line (`handoff-log.mjs:940-945`) stays silent.
  - MISSED and HELD live in `handoff-log.mjs:572-574`.
- **The tests need real git and a fake HOME.** `memory-tier.test.mjs` (2,569
  lines, 60 spawns), `memory-doctor.test.mjs` (2,001 lines) and
  `memory-switch.test.mjs` all spawn hooks or the CLI against a real repo. None
  of them can call up "busy", "timed out" or "git not installed" on demand.

## The module: `src/snapshot.mjs`

**What it owns.** The repo at the projects root: taking a snapshot, snapshot
health, history, restore, purge and the history rewrite behind rescan, and
whether the repo is busy.

**How it runs git.** Every git call goes through one seam. The plugin uses real
git there. The module's direct tests use a scripted stand-in that returns a
chosen exit, output or error. Two adapters make the seam worth having.

**What moves in, as it is:**
- From `memory-tier.mjs`: `snapshot()`, `snapshotHealth()`, `owed()`,
  `gitignore()`, the `held` and `missed` lists, and the lock sweep.
- The seam also carries what `memory-tier`'s `main` sets (`:672-673`): the git
  timeout and the batch size, passed in, and an exported `reset()` that empties
  `held` and `missed`. `GIT_TIMEOUT`, `BATCH` and `GIT_LOCK_STALE` are at
  `:32-34`.
- From `store.mjs`: `gitArgs`, `gitWhy` and `LOCAL_GIT_ENV`.
- From `memory.mjs`, the git half of:
  - history: `ever`, `unsnapped`, and the log reads in `history`.
  - restore: `hash-object` and `update-ref`.
  - purge and `rewrite`.
  - rescan: `fast-export`, the backup bundle, `for-each-ref`, and
    `update-ref`.
  - doctor: `git --version`.
- From `handoff-log.mjs`: `MISSED`, `HELD`, and the read of `.snapshot-health`
  in `health()`.

**What stays out:**
- Secret detection (`holdsSecret`, `redact`) stays in `store.mjs`. The module
  calls it.
- The CLI's wording and argument handling stay in `memory.mjs`.
- The per-store `.health` file stays where it is. It belongs to candidate #4.

**Health.**
- One reader parses `.snapshot-health` and says whether it could be read.
- In PRs A and B, every display shows exactly what it shows today: status,
  doctor, the startup line and the tier hook. The move changes only where the
  parsing lives.

**Imports.** Node built-ins and `store.mjs` only.

## PR C: one busy rule, and the plugin runs git's clean-up

This is the only change in behaviour, so it has failing tests first.

1. **One busy rule.** A single answer to "is the repo busy", used before every
   git write: the snapshot, purge, rescan and restore. It checks:
   - the index, HEAD, config and packed-refs locks, and refs/heads/*.lock;
   - git's `gc.pid` (new).

   The snapshot keeps its rule that a lock older than 10 minutes is stale. Purge
   keeps holding `config.lock` for its whole run, so a snapshot started
   meanwhile sees it as busy.

   **What users will notice:** restore refuses while a snapshot or purge runs,
   with the same "try again in a moment" wording. Purge and rescan also refuse
   on a packed-refs or branch lock.
2. **The plugin owns clean-up.**
   - `gitArgs` sets `-c gc.auto=0`, so no plugin git call starts a detached
     clean-up.
   - At the end of a snapshot that committed, the snapshot runs
     `gc --auto --no-detach` itself (by then it already runs in the
     background), with `-c gc.auto=6700` (git's default) after the zero. With
     `gc.auto=0` left on that call, `gc --auto` does nothing. While it runs,
     `gc.pid` exists, so purge sees busy and waits its turn.
   - When PR C has landed, the retry from #230 (`memory.mjs:515-517`, inside
     `rewrite()`) can go, in its own commit. No hand mutant covers it, so it is
     dropped only after a run of the automatic mutants (`--auto-lines`) on those
     lines shows nothing else needs it.

## Tests

- **PRs A and B:** every existing suite passes with no assertion changes on the
  three systems. Imports change (`gitArgs` and `gitWhy` in `store.test.mjs`,
  `memory-doctor.test.mjs` and two hand mutants), and the tests that copy `src`
  files into temp trees get `snapshot.mjs` added to their lists.
- **`test/snapshot.test.mjs`, in-process with the scripted git:**
  - How errors map: ENOENT means off, ETIMEDOUT means in parts, the lock
    messages mean busy, and anything else means failed.
  - A damaged index is rebuilt once.
  - Health: counts after failures and after success, held and missed, a
    missing file, and a broken file.
  - The busy rule: each lock file, `gc.pid`, and stale versus fresh (PR C).
  - Purge refuses while busy (PR C).
- **History rewriting** (`clone --mirror`, `fast-export`, `fast-import`, `gc`)
  keeps real git in the existing suites. A stand-in can't fake it in a useful
  way.
- PR C adds an end-to-end test with real git: a detached `gc` (started by hand,
  or simulated with `gc.pid`) and a purge. The purge reports busy and does not
  crash.

## Docs

- `docs/how-it-works.md`: the snapshot section names `snapshot.mjs` (PR A).
- `PRIVACY.md` and the README: restore's new "busy" refusal (PR C), if they
  describe restore's behaviour.
- `GLOSSARY.md` (six names) and ADR 0002 come with this spec.

## Not checked

- Whether `gc --auto --no-detach` on a large projects root slows the background
  tidy-up noticeably. PR C measures the tidy timing line (`doctor` shows it)
  before and after.
- The race in `snapshotHealth`'s read-modify-write. It is marked as a known
  shortcut at `memory-tier.mjs:603`, and it stays one. Two Stops at once already
  meet at git's index lock.
- Restore's `update-ref` race with a snapshot. Git's ref lock already guards it.
  PR C's busy check makes it explicit.
