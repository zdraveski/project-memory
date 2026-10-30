# Quality tooling: catching the next bugs before release

Status: design, not built. Parked 2026-10-30 for a later session. Builds on
1.2.2.

## Intent

The 1.2.2 bug hunt found five bugs: four by reading the code, two of those
privacy leaks, and one more by the new fuzz test. KIRE then asked what else
could be improved besides the fuzz, and for a spec and a plan to build later.
The aim is to find bugs before users do, and to keep the checks fast enough to
run on every change.

What we measured on 2026-10-30 says where the checks are blind today:

- **Mutants touch a third of the code.** The 883 hand-written mutants touch
  629 of 1,884 code lines (33%; a line counts when a mutant's find-text
  touches it). The other lines can change without the mutation check
  noticing.
- **The fuzz misses whole features.** In 60 seconds of fuzz (20 rounds,
  Windows), the share of code run was: `store.mjs` 86%, `handoff-log.mjs`
  77%, `journal.mjs` 69%, `memory-tier.mjs` 67%, `compact-gate.mjs` 46%,
  `memory.mjs` 39%. Never run at all: the compaction gate's deferral, note
  and nudge (every fuzz reply says 1,000 tokens and "turn ended"); the
  journal's import of older conversations; queued messages; memory-off
  conversations; the rule that tells code (`process.env.X`, `user.password`)
  from a secret; and the CLI's `restore`, `promote`, `history` and `doctor`.
  The code that records a failed write never ran either: the fuzz injects no
  disk faults and never kills a hook.
- **The fuzz's rules have holes.** An older conversation must be in the
  journal "at most once", so one never imported passes. The startup briefing
  is checked only for crashes and secrets.
- **Time is one fixed day.** Every round starts at 2026-10-30 08:00 UTC. No
  daylight-saving change is ever crossed. When clocks fall back, an hour
  repeats, and two turns of one conversation can share a local minute with
  no zone change at all: F5's family of bug. F5 itself turned up once in
  about 11,000 rounds, by luck.
- **Failures arrive without their story.** On GitHub (`--keep-going`) a
  failing round prints only its problems, not the steps that led there, and
  its files are lost with the machine. Shrinking a failing round to its few
  steps that matter was done by hand.
- **Machines are spread evenly but aren't equal.** Rounds per machine in 10
  minutes: Linux 629, macOS 412, Windows 227 (run 41108652638). GitHub runs at
  most 20 jobs at once for this account, at most 5 of them macOS (measured,
  run 41113088837); macOS jobs waited up to 12 minutes for a slot.
- **CI tests an old Node.** Node 20 and 24. Node 20 reached its end of life in
  April 2026; Node 26 is the new long-term line and isn't tested. GitHub warns
  that `actions/checkout@v4` and `actions/setup-node@v4` target Node 20.
- **Real Windows locks are no longer tested.** On GitHub's mutate machines a
  file held open by another program could still be read (PowerShell held it
  with no sharing, its own second open was refused, the drive was NTFS, and
  the next open from Node read it). The held-memory test now fakes the busy
  error with a preload (f97ac24), so nothing checks a real lock any more.
- **memory-tier's suite is slow.** One run starts ~154 Node processes; about
  half its time is Node starting (a bare start is 75 to 109 ms here).

Measured and fine, so not part of this work: the hooks' speed. With the
largest real conversation (70 MB) a Stop takes 177 ms at the median, 504 ms
when a note changed; startup 139 ms.

## Goals

1. Every code line can be broken by a mutant, made automatically, and every
   break that survives is either killed by a new test or written down as
   harmless, with the reason.
2. The fuzz reaches what it misses today (the list above), and its rules say
   what must hold there.
3. A fuzz failure arrives shrunk to the steps that matter and with its whole
   story, from GitHub too, with its files kept.
4. CI tests the Node versions people run.
5. A real Windows lock is tested again, where locks work.
6. Anyone can see what the suites and the fuzz reach: a coverage map.
7. memory-tier's suite runs in about half the time.

## Non-goals

- New features for users, the startup briefing's size, and the hooks' speed.
  KIRE decides those (see open decisions).
- Finding out why GitHub's mutate machines don't hold file locks.
- Running hooks inside the fuzz's own process to make it faster. In real use
  every hook is a fresh process; calls in one process can share state and
  hide a bug or invent one. The fuzz gets faster by using the right machines.
- Any dependency: no c8, no Stryker, no acorn. Node's built-in coverage
  (`NODE_V8_COVERAGE`) and a small masker do the work.

## Anti-goals: it fails even if it technically works when

- **The automatic mutants bury real gaps in noise.** If most survivors are
  harmless junk, nobody reads them. So the operators are chosen for signal,
  and numbers other than 0 to 9 are never changed (a timeout of 30,001 ms
  instead of 30,000 is junk).
- **`check.mjs` gets slow for a small edit.** The automatic mutants on the
  changed lines add about a minute for a typical edit, say how many they are
  before running, and `--no-auto` skips them.
- **A fuzz rule is loosened to make a round pass.** A failing rule is a bug or
  a wrong rule. A wrong rule changes only with the reason in the commit
  message, never quietly. A rule that the plugin's design really breaks (a
  failure file that is meant to stay, say) is brought to KIRE first.
- **Injected faults break Node itself.** A fault that hits Node loading the
  plugin's own files makes every round fail for nothing. Faults hit only
  files under the fuzz's throwaway home.
- **A token-like secret appears in the source.** GitHub's push protection
  and the plugin directory's scanner both read the source. Secret-shaped
  test values are put together from pieces when the fuzz runs.

## How it works

### A. CI and the release steps

- **The floor is Node 22** (KIRE, 2026-10-30: Node 20 reached its end of
  life). The README, `docs/how-it-works.md` and CONTRIBUTING say "Node.js 22
  or newer", and the next release's changelog says the floor moved and why.
- `test.yml` runs Linux on Node 22, 24 and 26, and Windows and macOS on 24
  and 26: seven jobs. The floor is tested on Linux.
- Every workflow uses the newest major release of `actions/checkout`,
  `actions/setup-node` and (new, for the fuzz) `actions/upload-artifact`,
  looked up when this is built. The run log no longer warns about Node 20.
- The release steps in CONTRIBUTING add a review of every change since the
  last tag, from the diff alone, by a reviewer who hasn't seen the work (a
  fresh agent will do). For 1.2.2 that step was skipped for F5.

### B. The coverage map

`node coverage.mjs [--suites] [--fuzz <seconds>]` runs the six suites, or the
fuzz for that long, or both, with `NODE_V8_COVERAGE` pointing at a temporary
folder that every child process inherits. It merges what all the processes
ran and prints, for each plugin file: the share of its code run, the
functions never run (name and line), and the first lines of the blocks never
run. It is the script that produced the numbers above, made permanent. It is
run by hand, before and after work on the fuzz or the tests; nothing runs it
automatically.

### C. Automatic mutants

**The operators.** Eight, each a small break that a test should notice:

| Operator | Before | After |
|---|---|---|
| equality | `===`, `!==` | `!==`, `===` |
| boundary | `<`, `<=`, `>`, `>=` | `<=`, `<`, `>=`, `>` |
| logic | `&&`, `\|\|` | `\|\|`, `&&` |
| boolean | `true`, `false` | `false`, `true` |
| not | `!x`, `!(...)` | `x`, `(...)` |
| small number | a decimal integer 0 to 9 | that number plus one |
| condition | `if (C)` with `C` on one line | `if (!(C))` |
| statement | a one-line call statement `f(...);` | `void 0;` |

**Where they apply.** Only in code: never inside a string, a template
literal's text, a regular expression or a comment. A small masker blanks
those out (same length, so offsets stay put); the operators match on the
masked text and edit the real text at the same offset. `=>`, `<<`, `>>`,
`>>>`, `!=`-forms already listed, `??` and `?.` are never touched. A regular
expression literal is told from a division by what comes before the `/` (an
operator, `(`, `,`, `=`, `:`, `[`, `!`, `&`, `|`, `?`, `{`, `}`, `;`, the
start of a line or a keyword such as `return`).

**Which files.** The source files in the mutant table (`mutate.mjs`'s
`suites`), each checked by the suite the table names: `store.mjs`,
`compact-gate.mjs`, `handoff-log.mjs`, `memory-tier.mjs`, `memory.mjs`,
`journal.mjs`, `deploy.mjs`. Not `hooks/hooks.json`. An automatic mutant that
makes exactly the edit of a hand-written one is left out.

**Identity.** Each automatic mutant has an id: the first 12 hex digits of the
SHA-256 of its file, operator, the trimmed text of its line, which match on
that line it is, and which copy of that line it is in the file. Editing other
lines doesn't change it. Its label: `auto <operator> <file>:<line> <before> -> <after>`.

**Harmless ones.** `automut-ignore.txt` lists the ids of survivors that are
harmless (no test could tell them apart from the real code), one a line, with
the reason: `<id> <reason>`. An id there whose mutant no longer exists is
reported, so the list doesn't rot.

**Running them.** `mutate.mjs --auto` adds every automatic mutant to the run;
`--auto-lines <file>:<n>,<n>;<file>:<n>` only those on the given lines.
Before a mutated file goes to its suite, `node --check` reads it. One that
doesn't parse is `STILLBORN`: counted and listed, neither a kill nor a
survivor. Sharding (`--shard i/n`) splits hand and automatic mutants alike,
in a fixed order, so every machine agrees on the list.

**In `check.mjs`.** After the hand mutants on the changed lines, the automatic
mutants on the changed lines run, and a survivor not in the ignore list fails
the check. `node check.mjs --no-auto` skips them.

**On GitHub.** The mutate workflow, started by hand, gets an `auto` input
(off by default). With it on, all 17 machines run the hand and the automatic
mutants. A push still runs only the changed files' hand mutants, as today.
Estimated: ~3,000 automatic mutants, about 20 to 30 minutes on 17 machines.

**The first run.** It is a report, not a gate: the survivors are triaged one
source file at a time, worst first. For each survivor: a real gap gets a test
in that file's suite that kills it; a harmless one goes in the ignore list
with its reason. One commit per file. A file with more than 60 survivors is a
checkpoint: report the counts to KIRE before going on. After the triage, a
full automatic run with no unexplained survivor joins the release steps.

### D. The fuzz

The round is split in two: `generate(seed)` makes the whole list of steps (all
content decided up front by the seeded generator), and `execute(steps)` runs
them and returns the problems and the story. `--seed N` still replays a
round. New kinds of steps and rules:

1. **Context sizes and turns cut mid-way.** Each reply's token count is picked
   from five sizes built from the gate's own constants (the fuzz imports
   `MODEL_WINDOW`, `WINDOW` and `TRIGGER` from `compact-gate.mjs`): 1,000;
   just under the 200,000 floor; between the floor and 90% of the window;
   past the nudge trigger but under 90%; and over 90%. Some turns stop
   mid-way: the last reply calls a tool and has no answer yet, sometimes
   after launching a background task (`running in background with ID: <id>
   ... Output is being written to: <path>.output`), later reported done
   (`<task-id><id></task-id>`). The fuzz runs its hooks without the
   environment variables that change the window (`CLAUDE_CODE_MAX_CONTEXT_TOKENS`,
   `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`,
   `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`). Rules:
   - The gate exits 2 exactly when the compaction is automatic, the turn is
     cut mid-way, and the size is at least the floor and under 90% of the
     window. Otherwise it exits 0.
   - Over 90% and cut mid-way, it writes a `**cut mid-turn**` note into
     handoff.md that names each background task launched and not yet done,
     and holds no private or forgotten text (the existing secret rule reads
     handoff.md). The note is gone once that conversation's next turn has
     ended and its Stop has run.
   - The Stop's memory nudge comes at most once per conversation until the
     size falls back under the trigger, never in a `<private-session>`
     conversation, and always on the first Stop of a plain turn past the
     trigger.
2. **Daylight saving, the year's end, and collisions.** A round starts at one
   of these instants (UTC), each 40 minutes before a change, with turns 1 to
   40 minutes apart:
   - 2026-10-30 08:00 (the default)
   - 2026-10-25 00:20: Berlin falls back at 01:00
   - 2026-11-01 08:20: Los Angeles falls back at 09:00
   - 2026-03-29 00:20: Berlin springs forward at 01:00
   - 2026-03-08 09:20: Los Angeles springs forward at 10:00
   - 2026-04-04 13:20: Chatham falls back at 14:00
   - 2026-09-26 13:20: Chatham springs forward at 14:00
   - 2026-12-31 23:20: the year ends at midnight UTC

   At start the fuzz checks each daylight-saving instant: its zone's offset a
   minute before differs from a minute after. If one doesn't, the fuzz stops
   and says the list is wrong. With a 20% chance a turn is placed on purpose
   so that its local minute, in the zone of its Stop, equals the local minute
   of an earlier turn of the same conversation in the zone of that turn's
   Stop (searched minute by minute up to 24 hours ahead; if none, a normal
   gap). The story says which turn it collides with.
3. **Disk faults.** A preload, `fuzz-faults.cjs`, loaded into a hook or
   command with `--require`, makes Node's sync file calls (`openSync`,
   `readFileSync`, `writeFileSync`, `appendFileSync`, `renameSync`,
   `unlinkSync`, `mkdirSync`, `rmdirSync`, `rmSync`, `readdirSync`) fail now
   and then with `EBUSY`, `EPERM` or `EACCES`, and writes also with
   `ENOSPC`. Only for paths under the root it is given, never elsewhere.
   `FUZZ_FAULTS=<seed>:<rate>:<root>` drives it; each call's fate comes from
   a seeded stream, so a replay fails the same calls. 15% of hook and
   command runs are faulted, at a rate of 0.02, 0.1 or 0.3. The forget-by-key
   step is never faulted. Rules: a faulted hook still exits 0 (the gate 0 or
   2), a faulted command 0 or 1, and none prints a stack trace; nothing private is written or printed; no note is
   changed. Then the round's last Stops run with no faults, and after them
   every normal rule holds, including no `.handoff-failed-*` and no
   `journal/.failed`.
4. **Killed hooks.** 10% of Stops are killed after 5 to 300 ms. Then any
   `.lock` folder left in a store is dated `LOCK_STALE` plus a second into
   the past (standing in for the 30 seconds a real wait would take), and the
   round goes on. After the last Stops every normal rule holds, and no
   leftover temp file (`<name>.tmp<pid>`) is listed as a note or has an
   index line.
5. **What the transcripts hold.** Queued messages (a prompt typed while
   Claude works, as a string or as blocks, sometimes with `<private>` text);
   conversations turned off with memory-off, in the way the plugin marks
   them; the older conversation on disk, now one the journal's import
   actually takes in, with the rule changed from "at most once" to "exactly
   once" unless it is private; and secrets in every shape the redaction
   knows, beside near-misses that are code (`process.env.API_KEY`,
   `user.password`) and must not crash anything.
6. **More of the CLI, and the briefing.** A step that edits a note between
   Stops, so it has history; then `history`, `restore`, `promote` and
   `doctor`. Rules: each exits 0 or 1 with no stack trace and prints nothing
   private; after `restore` the note's text is one of the texts it had; after
   `promote` the shared store has the note once with one index line. The
   startup briefing stays within its size limit and, when handoff.md lists
   the newest plain exchange of the last conversation, includes it.
7. **Shrinking.** A failing round is replayed with steps left out: halves,
   then quarters, down to single steps. A smaller list is kept when its
   problems still include the original first problem's kind (its text with
   numbers, ids and marks replaced by `#`). It stops after 200 replays or 120
   seconds and prints `shrunk to N of M steps:` with the steps.
   `--no-shrink` turns it off; `--keep-going` doesn't shrink.
8. **The story, from GitHub.** Every failing round prints its story, with
   `--keep-going` too, up to 60 lines. Under GitHub Actions, each failing
   seed and its first problem go to the run's summary. The fuzz workflow
   keeps failing rounds' files (`FUZZ_KEEP`) and uploads them as an artifact
   when the job fails.
9. **The machines.** The fuzz workflow puts 2 machines on macOS (none under 3
   machines), one in six on Windows (rounded up), and the rest on Linux: for
   17, that's 2 macOS, 3 Windows and 12 Linux. At today's rates that is
   about 9,050 rounds in 10 minutes instead of about 7,200, and no macOS job
   waits for a slot.

### E. memory-tier's suite in-process

`memory-tier.mjs` exports `main(argv, input)`, which does what running the
file does and returns the exit code, as `memory.mjs`'s `main` does. Running
the file (the hooks) behaves exactly as today. The suite calls `main` in its
own process wherever a separate process isn't the point: not for `--pause`,
two Stops at once, the run through a symlink, the busy preload Stop, or a
check on how the process exits. Output is captured the way `memory.test.mjs`
does it (through `util.format`, then a UTF-8 round trip), moved into
`harness.mjs` so both suites share it.

### F. The real Windows lock

A block in `memory-tier.test.mjs`, in full mode only (not `--mutant`) and on
Windows only, holds the memory file open from PowerShell with no sharing (the
4a79a9c code), then runs a Stop, lets go, runs another, and checks that no
lasting alarm is left. It first checks that the hold is real. With
`REAL_LOCKS=1` (set by `test.yml` on Windows jobs) a hold that isn't real
fails the suite with what PowerShell reported. Without it (a mutate machine,
someone else's PC) it prints `skip: this machine does not hold a file another
program opened` and goes on.

## Constraints

- Plain Node.js, no dependencies, Node 22 and newer. Plugin code never goes
  online; workflows may use `gh` and GitHub's actions.
- The six suites stay the suites. New tools carry an inline self-check, the
  way `check.mjs` checks `changedLines`, and no new suite file is added.
- No hook changes behavior except to fix a bug the new checks find. Each fix
  is its own commit, with a test and a mutant, as in the bug hunt.
- Mutant and fuzz runs on GitHub use 17 machines. The limit is 20 jobs at
  once, 5 of them macOS.
- Test first, `node check.mjs` green before each commit, one change a commit,
  files staged by name. Work on master as this week; deploy only after a
  green run, as CONTRIBUTING says.

## My calls (change any of these)

- The eight operators, and numbers changed only from 0 to 9.
- The ignore file's name and format: `automut-ignore.txt`, `<id> <reason>`.
- Mutated files are checked with `node --check` before their suite runs.
- The first automatic run reports, and gates only after the triage; the 60
  survivor checkpoint per file.
- The CI matrix: Linux 22, 24 and 26; Windows and macOS 24 and 26.
- The fuzz's sizes, instants, fault codes and rates (15% of runs; 0.02, 0.1
  or 0.3), and kills (10% of Stops, after 5 to 300 ms).
- Shrinking's limits: 200 replays or 120 seconds.
- The machine split: 2 macOS, one in six Windows, the rest Linux.
- The order of the parts: A, B, C, D, E, F (F with A in practice; see the
  plan). Each part works on its own.

## Left to the builder

- The masker's code, within the rules above.
- How memory-off is marked, and its exact rule, from `off()` in
  `handoff-log.mjs` and the docs.
- Why today's older conversation never reaches the journal's import, and the
  smallest change to the generator that makes it.
- The record shape of a queued message, from `queuedText()`.
- The secret shapes, from the redaction in `handoff-log.mjs`.
- The briefing's size limit, from `handoff-log.mjs --print`.
- Whether `.handoff-failed-*` is meant to clear on the next good write. If
  the design keeps it, bring it to KIRE rather than relax the rule.
- Which module-level state `memory-tier.mjs` keeps, and resetting it at the
  start of `main`.

## Decided by KIRE

- **The Node floor is 22** (2026-10-30), since Node 20 reached its end of
  life in April 2026.

## Open decisions for KIRE

1. **The startup briefing's size.** Up to ~9,500 characters (~2,400 tokens)
   at every start and after every compaction. Shorter costs recall.
2. **New features.** What's missing or annoying in daily use.

## How we'll know it works

- **Automatic mutants:** a full run lists every mutant as killed, stillborn
  or ignored with a reason; `check.mjs` fails on a survivor on a changed
  line.
- **Coverage:** under 60 seconds of fuzz, `compact-gate.mjs` goes from 46% to
  at least 80% and `memory.mjs` from 39% to at least 70%. Every function
  still never run is named, with why the fuzz can't reach it.
- **Old bugs found faster:** put back in a scratch copy, F1 (the compaction
  note quoting a forget) is found within 5 minutes of fuzz, and so is F5 (a
  forgotten minute hiding another turn), found once in ~11,000 rounds today.
- **The fuzz on GitHub:** one 17-machine, 10-minute run with every new kind
  of step has no false failure and at least 9,000 rounds.
- **CI:** seven jobs green, and no Node 20 warning in the log.
- **Speed:** `memory-tier.test.mjs --mutant` takes at most 60% of its time
  before, as the median of 3 runs before and 3 after on the same machine.
- **Real lock:** the Windows test jobs run the real-lock block and pass;
  `mutate.mjs` on GitHub prints the skip line and passes.
