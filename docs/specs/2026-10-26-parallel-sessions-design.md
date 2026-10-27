# Memory hooks: parallel sessions, mid-turn compaction, startup line

2026-10-26. Status: design approved in chat; this spec is for review.

## Why

The owner runs several Claude Code sessions at once, on different projects and
sometimes on the same one. The hooks were built for one session at a time, and
two of their assumptions no longer hold in the current Claude Code.

What was measured, not guessed (probes run against the real hooks under a
throwaway HOME, and against the 111 transcripts kept since 2026-09-13):

| Finding | Evidence |
|---|---|
| A Stop rewrites every store, not its own | `memoryDirs()` walks all 16; one global `.tiered.json` stamp |
| Tiering overwrites a fresh edit | 120 memories added while 60 tiering runs hit the store: 74 lost their hand-written pointer (a recovered machine line in the archive took its place) |
| handoff.md loses turns | 8 sessions of one project ending a turn at once, 5 rounds: 22 of 40 turns missing |
| Shared files are read-modify-write | `.tiered.json`, `.compact-nudge.json`, the one git index |
| The store is found from `cwd` | a session that moves into another project's folder writes that project's handoff |
| PreCompact blocking is not honoured | 2026-10-03 18:18, one project: `auto`, 767,072 tokens, last message `tool_use`, `precomputed: true`, 71 ms. The gate, replayed on that transcript, says "deferred" (exit 2). It compacted anyway, and no in-flight note was written |
| The nudge cannot fire in time | it fires at 0.95 x 800k = 760k; Claude Code compacts at ~767k. Turn growth above 300k: p50 18k, p75 46k, p90 148k. No nudge in any kept transcript |
| Stop hook latency | 69 real runs: p50 1.07 s, p90 3.8 s, max 20 s; a memory change re-tiers all 16 stores (885 ms vs 204 ms quiet) |
| Tests litter TEMP | 1,202 folders (63.5 MB): a killed mutant throws before its cleanup line |

## Goals

1. Any number of sessions, on any mix of projects, lose no memory pointer and
   no handoff turn, and never write another project's store.
2. A compaction mid-turn, honoured gate or not, still gives the session back
   what was in flight.
3. The memory nudge lands before the compaction.
4. A new session learns, in one line, where the last one stopped, whether
   another session is working in the same project, and whether the memory
   machinery is failing.

Non-goals: offsite backup (owner declined), prompt-time recall of archived
memories (27 interactive prompts, none matched an unopened archived memory),
memory dedupe (0 near-duplicate descriptions among 193), creating MEMORY.md in
a handoff-only store (the startup line covers it).

## Constraints

- The hooks are live for every running session. All work happens in a git
  worktree on branch `parallel-sessions`; the live checkout changes once, at
  the end, after every suite passes.
- Windows: a rename over a file another process holds open fails (EPERM).
- No dependencies. Node built-ins only, as now.
- Claude Code's own Edit/Write tools write MEMORY.md and memory files and do
  not take our lock. Only our own hooks can be serialised; the model's writes
  can only be detected.

## Design

### 1. One store per session, found from the transcript — `store.mjs` (new)

The session's store is `<dirname(transcript_path)>/memory` when the transcript
sits directly under `~/.claude/projects/<slug>/`: that is the project folder
Claude Code chose, whatever the cwd is now. Otherwise (tests, odd payloads) it
falls back to today's cwd slug. One function, `storeOf(payload)`, used by
handoff-log, compact-gate and memory-tier.

`store.mjs` also holds the two concurrency primitives:

- `withLock(dir, fn)`: `mkdir <store>/.lock` is the lock (atomic on NTFS).
  Busy: wait in 25 ms steps up to 2 s, then give up (`null`) — the next turn
  redoes the work. A lock older than 30 s is a killed process's and is taken
  over. The lock covers only the read-merge-write, never git or a transcript
  read. A junction-aliased store resolves to the same folder, so it shares the
  lock.
- `replaceIfUnchanged(path, expected, next)`: write a temp file, re-read the
  target, and rename only if it still equals `expected` (what this pass was
  computed from). Otherwise drop the temp file and return `'conflict'`. A
  rename that fails with EPERM/EBUSY is retried 3 times, 50 ms apart.

### 2. memory-tier.mjs

- `--stop` tiers the session's own store only, and only when that store's
  fingerprint (its `.md` files minus handoff.md, plus the date) differs from
  `<store>/.tiered`. A session with no store does nothing after the handoff
  and the nudge. A manual run (no `--stop`) still walks every store, each
  under its own lock.
- `tier()` runs under the store lock, and writes both indexes with
  `replaceIfUnchanged` against the text it read. A conflict means the model
  edited the index during the pass: its edit wins, the pass is dropped, the
  stamp is not written, the next turn redoes it.
- A pass that would only reorder lines leaves the file alone. The index is
  re-rendered with the archive line last and the model appends below it, so
  every new memory used to cost a rewrite, and each rewrite is a moment the
  model's next edit can be lost in.
- Orphan grace: a memory file with no pointer and an mtime under 2 minutes old
  is left alone — the model writes the file, then adds its pointer seconds
  later. Older orphans are recovered as now.
- Snapshot: `git add -A` stays repo-wide (a commit may carry another store's
  change; that is what a snapshot is). A fresh `index.lock` is another
  session's commit: `busy`, not a failure — no stamp, retry next turn. An
  `index.lock` older than 10 minutes is a dead process's: removed, then the
  snapshot runs.
- Health: each pass writes its store's problems (missing targets, over budget,
  a store that throws) to `<store>/.health`, or removes it when clean. Snapshot outcomes go to `~/.claude/projects/.snapshot-health`
  (`{ lastOk, failures, error }`). `ponytail:` a lost update on that one
  counter costs a miscount of one, not a missed warning.
- `--pause <ms>` sleeps between computing a pass and writing it. Test-only,
  like `--now`; it makes the edit-during-a-pass race deterministic.

### 3. handoff-log.mjs

- `handoff()` runs its read-merge-write under the store lock.
- Entries carry the session: `- **asked** 2026-10-26 13:05 [f08cf3a4]: …`.
  The tag is optional when parsing, so every existing entry still reads (as
  session `''`). Kept: the last 10 per session, for the 3 most recent
  sessions — a session in parallel work keeps the same depth it had alone.
- Nudge detection: the tag is matched in the first 200 characters, not only
  at position 0, both in `asked()` and where it freezes a turn's answer.
  Claude Code may wrap a Stop reason ("Stop hook feedback: …"); no real nudge
  record survives to show which.
- `--print` branches on `payload.source`:
  - `compact`: first the in-flight recovery (section 4), then this session's
    entries only (the newest ten if it has none of its own), then a line for
    each of the newest two other sessions whose transcript changed in the
    last 30 minutes (not the entry's time: that is the ask's, and a session an
    hour into one prompt read as ended).
  - `startup`: at most five lines. Those other sessions: "Another session is
    working here: 13:05 [f08cf3a4] …". If there is none, the newest entry
    under 7 days old: "Last session here ended 13:05 on: …". Then
    `<store>/.health` problems, snapshots failing 3+ times in a row, and the
    hooks' own health: the newest other transcript's last finished turn
    (`end_turn`) is newer than `~/.claude/projects/.stop-ran`, which every
    Stop touches once the handoff has loaded ("Memory hooks look stopped"; no
    file is not knowing, and says nothing), or its last 512 KB holds 50+
    messages and no model reply with usage ("cannot read"). A project with no
    `handoff.md` is not judged. Nothing when there is nothing to say.

### 4. compact-gate.mjs

- `recover(payload)`, called by `--print` on `compact`: reads the session's
  transcript with the existing `state()`. SessionStart runs before any new
  assistant message, so the last one is the one the compaction cut. If it did
  not end its turn (`stop_reason !== 'end_turn'`), it builds the in-flight
  note with
  the existing `state()` — ask, last words, tasks still running with output
  files, files edited — and prints it first. Print only: the next Stop would
  drop a written note anyway, and printing needs no lock. A note the gate
  wrote into the file holds the same facts and is never printed: it is not
  an entry.
- Notes carry the session tag, so a parallel session's note is never taken for
  this one's.
- The gate stays as the first line of defence; its comments say it is not
  relied on.
- `TRIGGER` 0.95 → 0.85: 680k, ~87k before Claude Code's ~767k, which covers
  ~85 % of measured turns.
- Nudge state: one file per session under `~/.claude/projects/.nudge/`,
  holding the context size it was given at; files older than 7 days are
  pruned when one is written. No shared read-modify-write left.

### 5. Settings

One change: the SessionStart entry's matcher `compact` → `startup|compact`.

### 6. Tests leave nothing behind

`harness.mjs` gets `tempDir(prefix)`, which deletes the folder on process exit
— assertion failures included. `tempHome()` and every `mkdtempSync` in the
tests, soak, break and mutate use it.

## Data on disk

| Path | Owner | Written |
|---|---|---|
| `<store>/.lock/` | our hooks, one at a time | during a read-merge-write |
| `<store>/.tiered` | that store's sessions | after a clean pass |
| `<store>/.health` | that store's sessions | when a pass finds problems |
| `~/.claude/projects/.snapshot-health` | any session | after a snapshot attempt |
| `~/.claude/projects/.nudge/<session>` | that session | when nudged / re-armed |

All are ignored by the snapshot repo (it tracks only `*/memory/*.md`). The old
`.tiered.json` and `.compact-nudge.json` are deleted at rollout.

## Error handling

Unchanged rule: a hook never fails the session. Lock timeout, conflict, busy
git, a failed rename — each skips the work for this turn and leaves no stamp,
so the next turn redoes it. What persists becomes a `.health` line, which is
the only route to the owner's eyes (Stop stdout is shown to nobody).

## Testing

Each change: failing check first, in the existing `ok()` style, then the code,
then a mutant in `mutate.mjs` that the check kills.

- `store.test.mjs` (new): two processes contending for one lock never overlap;
  a stale lock is taken over; a held lock times out to `null`;
  `replaceIfUnchanged` returns `'conflict'` and leaves the target alone;
  `storeOf` prefers the transcript's project folder and falls back to cwd.
- memory-tier.test: an index edited during a `--pause`d pass keeps the edit;
  `--stop` from project A leaves project B's store byte-identical, mtimes
  included; a 1-minute-old orphan is not recovered, a 3-minute-old one is; a
  fresh `index.lock` is `busy` and stamps nothing, a 15-minute-old one is
  cleared and the commit lands; `.health` appears with a problem and goes
  with it. Existing `--stop` checks move to per-store stamps.
- handoff-log.test: tagged and untagged entries merge; 3 sessions x 12 turns
  keep 10 each; a 4th session drops the oldest session; `--print compact`
  shows only its session plus an "also working here" line; `startup` shows
  the recent line, nothing for a 10-day-old entry, and the health lines; a
  nudge behind a prefix is not an ask; 8 sessions ending a turn at once lose
  nothing.
- compact-gate.test: compaction mid-turn → the note is printed, with a task
  from an earlier turn and the files edited; at a turn boundary → no note;
  this session's note already present → not repeated; another session's note
  → this one still gets its own.
- soak: the tiering race probe becomes a check — no hand-written pointer
  replaced while a writer adds 120 memories the way the model does (file, then
  pointer). The handoff race probe is deterministic with the lock, so it lives
  in handoff-log.test (0 of 40 lost).
- Gate before merge: every suite, `mutate.mjs` (all killed), the soak, the
  break harness, and `memory-tier.mjs --dry-run` over the real stores.

## Rollout

1. All of the above green in the worktree.
2. Fast-forward the live `master` to `parallel-sessions`.
3. Settings matcher change; delete `.tiered.json` and `.compact-nudge.json`.
4. Watch the next live turns: handoff entry tagged, per-store stamp written,
   Stop hook timings in `stop_hook_summary`.
5. Remove the worktree.
