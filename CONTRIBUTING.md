# Contributing

project-memory is plain Node.js with no dependencies. Start with
[How it works](docs/how-it-works.md), then the design documents in
[`docs/specs/`](docs/specs/). Who decides what goes in is in
[GOVERNANCE.md](GOVERNANCE.md).

## Running from source

There is nothing to build. The hooks and the memory tool are JavaScript
files that Node.js runs as they are: no compiler, no bundler, no package
manager and no install step. You need:

- [Node.js](https://nodejs.org) 22 or newer. Nothing from npm.
- [Git](https://git-scm.com), to get the code and to run the tests, which
  check the snapshots. The plugin itself runs without it, with snapshots
  off.

To get the code and check it works:

```
git clone https://github.com/zdraveski/project-memory.git
cd project-memory
node tools/check.mjs
```

then the suites below (`node tools/suites.mjs` runs them all side by side). To try your copy in Claude Code, first remove
the plugin and its marketplace if you installed them from GitHub (both are
named `project-memory`), then add your folder as the marketplace:
`/plugin marketplace add <folder>`, then
`/plugin install project-memory@project-memory`.

Where things live:

- `src/`: the plugin itself, the hooks and the memory tool. This is the code that ships.
- `test/`: the test suites, their harness, and the soak and break runs.
- `tools/`: the developer tools (check, mutants, fuzzer, benchmarks, deploy). Not shipped.
- `docs/`: how it works, the specs and the plans.

## Tests

Each suite tests the file it is named after (`store.test.mjs` tests
`store.mjs`), builds a throwaway home folder and never touches your
`~/.claude`:

```
node test/store.test.mjs
node test/compact-gate.test.mjs
node test/handoff-log.test.mjs
node test/memory-tier.test.mjs
node test/memory-cli.test.mjs
node test/memory-doctor.test.mjs
node test/memory-switch.test.mjs
node test/journal.test.mjs
node test/recall.test.mjs
node test/recall-hook.test.mjs
node test/enforce.test.mjs
node test/enforce-hook.test.mjs
node test/timing.test.mjs
node test/page.test.mjs
node test/bench.test.mjs
```

A suite that passes ends with one line, `<suite>: <n> checks passed`. One
that fails stops at the first failed check, prints that check's message
(what it checks, and often what it got), and exits non-zero.

CI ([`test.yml`](.github/workflows/test.yml)) runs `node tools/check.mjs`,
every suite (`node tools/suites.mjs`, in parallel) and `node tools/survive.mjs` (which facts of a session the briefing after
a compaction still carries; it exits 1 if one is lost) on every pull request
and every push to `master`, in four test jobs (a pull request also gets one job that runs the mutants and fuzz on its changed lines):
Linux with Node 22, Windows with Node 22 and 24, and macOS with Node 26. A pull request
can't merge until the Linux 22, Windows 24 and macOS 26 jobs and the dco check pass (Windows 22, the oldest Node the README promises, is not required). Each job's log on GitHub shows the same lines as a run here.

Beyond the suites:

- `node tools/check.mjs` is the quick check for every edit. Every `.mjs` and `.json` file parses, no
  file imports a name it never uses, and the suites of the files changed since
  the last commit run in `--mutant` mode, in UTC and in New York time (GitHub's
  machines run in UTC, where a test of local midnight once checked nothing).
  `--full`, by hand, adds the rest: every mutant's
  find-text is in its file once, the mutants on the changed lines run,
  hand-written first, then the automatic ones (`--no-auto` skips those); a
  survivor fails the check, and so does a `tools/mutate.mjs` run that exits non-zero.
  Then it lists changed code lines no mutant covers, and after a change to a
  hook's code it fuzzes for 20 seconds.
  Seconds for most files, a minute or two after a change to `memory.mjs` or
  `store.mjs`. CI runs it in every job, where nothing has changed and it
  takes a few seconds. To run it before every commit of yours:
  `printf '#!/bin/sh\nexec node tools/check.mjs\n' > .git/hooks/pre-commit`.
  TypeScript's checker (`tsc --checkJs`) was tried on the hooks: 49 reports
  with strict mode off, 775 with it on, no bug among them, so it is not used.
- CI's `actionlint` job checks the workflow files themselves (and their
  `run:` scripts, through shellcheck) with a pinned, checksum-checked
  release, and its `zizmor` job scans them for unsafe patterns the same way.
  Both run on pushes to `master` only, not on pull
  requests. To run actionlint here: download actionlint from its GitHub releases and
  run `actionlint` in the repo.
- `node tools/fuzz.mjs [seconds] [--keep-going]` sends random, hostile
  conversations and notes through the real hooks and the CLI: a BOM, CRLF,
  half an emoji, `forget` in six spellings, `<private>` text, a clock moving
  between time zones, transcripts read in part, a half-written last line, a
  broken line, two conversations stopping at once, an older conversation for
  the journal to take in, the compaction gate, `status`, `search`, `show`,
  `forget` and `forget --key ... --yes`. It checks what must hold whatever
  they hold: every hook and command exits as it should and records no
  failure; no private or forgotten text is written, briefed or printed; a
  `<private-session>` conversation leaves nothing; every other exchange is
  in handoff.md once and in the journal once; every note keeps its text and
  one index line; repeating the last Stop settles. It found the time-zone
  duplicates of long conversations, a forgotten exchange still listed and
  `clip()` not giving the same twice (2026-10-30), and each old bug put back.
  It also sends replies of growing sizes and turns cut mid-way, clocks
  set to the year's end or a daylight-saving change, turns that collide on
  a minute after a move of zone, messages queued while Claude works,
  conversations held with auto memory off, an older conversation the
  journal takes in, secrets in the shapes
  `redact()` knows, more of the CLI (`history`, `restore`, `promote`,
  `doctor`) and the startup briefing.
  A failing round prints its seed and what happened, shrunk to the steps it
  still fails with (`--no-shrink` skips that): `node tools/fuzz.mjs --seed N`
  replays it, `FUZZ_KEEP=<folder>` keeps its files, and it becomes a test.
  Some Stops, gates and commands run under `tools/fuzz-faults.cjs`, a preload (a
  dev tool, not deployed) that makes disk calls under the round's temp home
  fail with EBUSY, EPERM, EACCES or ENOSPC from a seeded stream, and some
  Stops are killed part way; the hooks must degrade safely. Faulted runs of
  two Stops at once, and kills, are races: replay a seed a few times.
  The `fuzz` workflow, by hand, fuzzes ten
  minutes on each of 17 machines (12 Linux, 3 Windows, 2 macOS, so no macOS
  job waits for one of the account's 5 slots), and a failing machine uploads
  its kept files as the artifact `fuzz-kept-<machine>`: for a bug hunt; no
  release needs it.
- `node tools/coverage.mjs [--suites] [--fuzz <seconds>]` runs the suites
  and/or the fuzz under Node's own coverage and prints, for each of the nine
  plugin files, the share of its code that ran, the functions that never
  ran and the first lines of the larger blocks that never ran: where the
  fuzz cannot find a bug because it never goes. Nothing runs it
  automatically.
- `node tools/mutate.mjs [text...]` breaks one rule at a time and expects a suite to
  fail: all mutants, or those whose label contains one of the texts. Every mutant
  must be killed. The mutants are in `tools/mutants/`, one file per source file;
  the table in `tools/mutate.mjs` names the suite that must catch them. Each is a
  label and a pair, the text to find and what to put in its place. No change or
  release needs the mutants run or kept up to date: the tool stays for when
  someone asks. Each suite runs with `--mutant`, which skips its slow blocks (a held lock waited out, a race, a big fixture, a clock;
  `quick` in `harness.mjs`); a mutant only those blocks kill is marked
  `{ full: true }` and runs its whole suite. The full run took 65 minutes on
  a 4-core Windows machine (2026-10-29), half of it the ~200 mutants
  `memory-*.test.mjs` checks. `--changed a,b` runs only the groups whose source,
  suite or file in `tools/mutants/` is among those; `--shard i/n` runs every n-th mutant from
  the i-th. `--list` prints the selected labels and runs nothing. The last
  line names every mutant that survived.
  `--auto` adds the automatic mutants to the hand-written ones. `tools/automut.mjs`
  makes them from the code, with eight operators: equality, boundary, logic,
  boolean, not, number 0-9, condition and statement. Each has an id, printed
  as `[id]` on its result line. `--auto-lines <file>:<n>,<n>;<file>:<n>` runs
  only the automatic mutants on those lines; an empty or missing value
  selects none, and a malformed one exits 1. Label texts filter hand-written
  and automatic labels alike, and so do `--changed` and `--shard`. A mutant
  whose file does not parse is `STILLBORN`: counted apart, never a kill. One
  whose id is in `tools/automut-ignore.txt` is `IGNORED`; the file has a line
  `<id> <reason>` for each, and `#` lines are comments. An id listed there
  with no mutant prints `stale ignore: <id>`. The last line reads
  `all M mutants killed; K stillborn, I ignored`, or `N of M mutant(s)
  survived: ...; K stillborn, I ignored`. It exits 1 when any mutant run is
  not a kill: one that survived, one the clock cut off (`TIMED OUT`) and one
  whose find-text no longer matches once (`MUTATION DID NOT APPLY`,
  `FIND-TEXT NOT UNIQUE`) are all named there as survivors. A suite that
  fails unmutated stops the run with exit 1 too. A stillborn or ignored
  mutant never does.
- `node tools/deploy.mjs` skips the mutation check and trusts CI for the suites; with `--full` it runs every
  mutant here, about 65 minutes. `--tiering-change` skips the comparison of
  the tidy-up's dry run with the live copy's, for a change meant to alter tiering.
- The `mutate` workflow on GitHub, started by hand (Actions > mutate > Run
  workflow) only if someone asks, splits the mutants across 17 machines
  (GitHub Free runs 20 jobs at once). It runs all the hand-written ones in about
  20 minutes (2026-11), and with `auto` on, the automatic ones too.
- `node test/memory-tier.soak.mjs [store] [--days N]` copies a store (by default the largest
  on the machine) to a temp folder, then simulates 30 days (or N) of new notes and
  sessions ending at the same moment.
- `node test/memory-tier.break.mjs [store]` breaks a copy of a store in 13 ways
  (and runs one control with nothing broken) and checks that no line is lost
  and that a second run leaves `MEMORY.md` unchanged.
- `node tools/bench.mjs [runs]` times each hook on a made-up busy store (60 days of
  journal, 150 notes, a 50 MB conversation): p50 and p90, the time before the hook's
  first line and its largest phase. `--real` copies the machine's largest transcript
  and store instead, `--plugin <dir>` runs another checkout's hooks on the same store,
  `--json <path>` writes the numbers, and `--check` fails when a case is slower than its
  limit (`LIMITS` in `tools/bench.mjs`, a multiple of an empty `node -e` on the same machine);
  CI runs `node tools/bench.mjs --check 5`. `node tools/bench.mjs --live [--project <folder>|all]
  [--days <n>]` instead reads the hook durations Claude Code recorded in its own
  conversation files (read-only), this plugin's hooks beside the other plugins', with
  how much of each was inside the script.
- `node tools/recall-eval.mjs --plugin <dir> [--set file|prompt|error] [--without] [--runs N]
  [--case <name>] [--model sonnet] [--max-usd 20] [--json <path>]` is the eval of the
  1.6.0 pointers: headless `claude -p` sessions in throwaway projects whose journals hold
  made-up facts (`tools/recall-eval-cases.json`), with pointers and, with `--without`,
  with `PROJECT_MEMORY_RECALL=0`. It spends plan usage, so it never runs in CI. Every
  session runs under a new `CLAUDE_CONFIG_DIR` in the temp folder, deleted after; your
  `~/.claude` is never read or copied. Log in once with `claude setup-token`, save the
  token in a file only you can read, and set `PROJECT_MEMORY_EVAL_TOKEN_FILE` to it.
  `--self-check` runs the whole harness against a fake `claude` (CI runs it).

The soak, the break harness and the benchmark read your real notes and
transcripts only to copy them into a temp folder, and delete the copies when
they finish.

## Changing the code

- A hook must exit 0 whatever happens, and finish fast: it runs after every
  reply. The one deliberate exception is the compaction gate's exit 2, its
  request to wait.
- Write through `replaceIfUnchanged` under `withLock` (`store.mjs`), never
  straight to a file another process may be editing.
- Keep the numbers at the top of each file; the comments say why each is
  what it is.
- Add or update a test with every change to what the plugin does, however
  small. A change without one isn't merged.
- Don't run the `claude` command, read a credential, read anything from Claude Code's
  `settings.json` except the two values `PRIVACY.md` lists
  (`autoMemoryEnabled` and `autoMemoryDirectory`; never print the file), copy the whole environment, or connect to anything. The
  plugin directory's security scan holds a plugin that does, and it reads
  every file, tests included.
- Privacy goes through `privacy.mjs`; never copy the rule into a hook. A marker file that
  cannot be read means private, for every caller.
- Write the test first and watch it fail on the old code; before changing
  a rule, find every test and caller that uses it. One change a commit.

### What bit before

Read this before writing a rule or its test. Each line cost a bug or a
false test here.

- **Text.** A file may start with a BOM, and end its lines with CRLF, a lone
  CR, U+2028 or U+0085. A cut can leave half an emoji: written, it is
  U+FFFD, and it no longer matches what it was cut from. NTFS keeps the
  Kelvin sign and `k` apart; a case fold does not.
- **Paths.** Windows spells one folder in any case: compare through `same`
  or `pathKey`. Resolve before comparing: `<projects>/../x` is not in the
  projects folder. On macOS the cwd comes back as `/private/var` for
  `/var`. A path given may be relative, or reached through a link.
- **Time.** A day is the user's local day. GitHub's machines run in UTC,
  where local midnight and UTC midnight agree: a test of the difference
  sets `TZ` itself. The clock can move to another zone between two Stops,
  and every minute read again moves with it.
- **The user's words.** The skill quotes what is typed: `'forget'` and
  `"forget"` are `forget`. `<private>` comes in capitals, with attributes,
  or never closed; `<private-session>` marks the whole conversation.
- **Tests.** A word or a date a fixture uses may be one a later check
  searches for: pick one nothing else uses. A small transcript is read
  whole, and a rule that matters only on a partial read needs 600 KB before
  its turn. Output captured in-process skips the UTF-8 a pipe would apply.
  Wait for the event, not a fixed time.
- **Processes.** `process.exit()` can cut a pipe's output short on Linux and
  macOS: set `process.exitCode`.

## Sending a change

Open a pull request against `master`: nobody, the maintainer included, can
push to it directly. Sign off every commit
([below](#developer-certificate-of-origin)). Run `node tools/check.mjs` first; CI runs
the suites on every platform. The pull request merges only when its required
checks pass: the Linux 22, Windows 24 and macOS 26 test jobs and the sign-off check (`dco`). Have the
change reviewed from its diff alone, by someone (or an agent) who has not heard why you made it. Leave the
version number alone, and describe the change under an `## Unreleased`
heading at the top of `CHANGELOG.md` (add the heading if it isn't there), in
plain words for someone who uses the plugin. A change that saves, reads or
sends anything new updates `PRIVACY.md` and the
[security assessment](docs/security-assessment.md) in the same pull request.

## Developer Certificate of Origin

Every commit in a pull request must be signed off. By signing off, you
certify the [Developer Certificate of Origin](https://developercertificate.org):
that you wrote the change, or otherwise have the right to submit it under
this project's license (MIT). The sign-off is a line at the end of the
commit message, with your name and the email of the commit's author:

```
Signed-off-by: Your Name <you@example.com>
```

`git commit -s` adds it. To sign off commits you already made,
`git rebase --signoff master`, then force-push your branch. The `dco` check
([`dco.yml`](.github/workflows/dco.yml)) fails a pull request that has a
commit without a sign-off matching its author; merge commits don't need
one. Dependabot's pull requests, which only update the pinned GitHub
Actions, can't be signed off, so the check skips them and the maintainer
reviews them instead.

## Releasing

The maintainer's steps:

1. Bump `version` in `.claude-plugin/plugin.json`, and turn `## Unreleased`
   in `CHANGELOG.md` into the version's heading.
2. Run `claude plugin validate . --strict`. It should exit 0.
3. Have one reviewer who did not write the code review every change since the
   last tag, fix what it finds, and review only the fixes again.
4. Nothing to rerun before tagging: each pull request's CI already ran the
   suites, and the mutants and a short fuzz of its changed lines. Look at the
   last scheduled `fuzz` and `mutate` runs; a failure there is fixed first.
5. Merge through a pull request once its CI passes.
6. Tag the commit `vX.Y.Z`, push the tag, and publish a GitHub release with
   the version's changelog. The `release` workflow then attaches the
   `.tar.gz`, the `.zip` and `SHA256SUMS`, and signs their attestation:
   check that it passed and the three files are on the release.

## The author's setup

The author keeps this repository at `~/.claude/hooks` and runs the hooks from
a checked copy. `node tools/deploy.mjs` runs only on `master` with nothing
uncommitted. It checks that CI's `test` workflow passed on that exact commit (`--local-tests` runs the suites here instead), then runs the soak and the break harness
(with `--full`, the mutation check too), then compares a dry run of the tidy-up
with the live copy's, and copies the plugin to `~/.claude/hooks-live`, which also serves as a local
marketplace the plugin is installed from. It doesn't run the validator or the
benchmark. None of this is needed to use or to change the plugin.
