# Contributing

project-memory is plain Node.js with no dependencies. Start with
[How it works](docs/how-it-works.md), then the design documents in
[`docs/specs/`](docs/specs/).

## Tests

Each suite builds a throwaway home folder and never touches your `~/.claude`:

```
node store.test.mjs
node compact-gate.test.mjs
node handoff-log.test.mjs
node memory-tier.test.mjs
node memory.test.mjs
node journal.test.mjs
```

CI runs all six on Linux, macOS and Windows, with Node 20 and 24.

Beyond the suites:

- `node check.mjs` is the quick check for every edit. Every file parses, no
  file imports a name it never uses, and every mutant's find-text is in its
  file once; then the suites of the files changed since the last commit run
  in `--mutant` mode, in UTC and in New York time (GitHub's machines run in
  UTC, where a test of local midnight once checked nothing), and the mutants
  on the changed lines run. Then it lists changed code lines no mutant
  covers, and after a change to a hook's code it fuzzes for 20 seconds.
  Seconds for most files, a minute or two after a change to `memory.mjs` or
  `store.mjs`. CI runs it on every push, where nothing has changed and it
  takes a second. To run it before every commit of yours:
  `printf '#!/bin/sh\nexec node check.mjs\n' > .git/hooks/pre-commit`.
  TypeScript's checker (`tsc --checkJs`) was tried on the hooks: 49 reports
  with strict mode off, 775 with it on, no bug among them, so it is not used.
- `node fuzz.mjs [seconds]` sends random, hostile conversations and notes
  through the real hooks (a BOM, CRLF, half an emoji, a quoted `forget`,
  `<private>` text, a clock moving between time zones) and checks what must
  hold whatever they hold: every hook exits cleanly, no private text is
  written, a `<private-session>` conversation leaves nothing, every note
  keeps its text and one index line, a second Stop with nothing new changes
  nothing, and no turn is listed twice. With the time-zone fix and the
  quoted-forget fix taken back out, it found each within two minutes. A
  failing round prints its seed: `node fuzz.mjs --seed N` replays it, and it
  becomes a test. CI fuzzes a minute on every job; run ten before a release.
- `node mutate.mjs [text...]` breaks one rule at a time and expects a suite to
  fail: all mutants, or those whose label contains one of the texts. Every mutant
  must be killed. The mutants are in `mutate.mjs`, grouped by source file
  with the suite that must catch them; each is a label and a pair, the text
  to find and what to put in its place. A change to a line a mutant targets
  needs the mutant updated too. Each suite runs with `--mutant`, which skips
  its slow blocks (a held lock waited out, a race, a big fixture, a clock;
  `quick` in `harness.mjs`); a mutant only those blocks kill is marked
  `{ full: true }` and runs its whole suite. The full run took 65 minutes on
  a 4-core Windows machine (2026-10-29), half of it the ~200 mutants
  `memory.test.mjs` checks. `--changed a,b` runs only the groups whose source
  or suite is among those files; `--shard i/n` runs every n-th mutant from
  the i-th. The last line names every mutant that survived.
- `node deploy.mjs` runs only the mutants of the files changed since the live
  copy's commit; every one when that commit is unknown, when `store.mjs`,
  `harness.mjs` or `mutate.mjs` changed, or under `--full`. Run it with
  `--full` before a version release.
- The `mutate` workflow on GitHub splits the mutants across 17 machines
  (GitHub Free runs 20 jobs at once). Every push to `master` runs the
  changed files' mutants, by the deploy's rule; started by hand (Actions >
  mutate > Run workflow), it runs all of them in about 7 minutes. Once a run
  covering the commit passes, `node deploy.mjs --mutants-checked-on-github`
  skips the local run. The deploy never asks GitHub itself: nothing here
  goes online.
- `node memory-tier.soak.mjs [store]` copies a store (by default the largest
  on the machine) to a temp folder, then simulates a month of new notes and
  sessions ending at the same moment.
- `node memory-tier.break.mjs [store]` breaks a copy of a store in 14 ways
  and checks that no line is lost.
- `node bench.mjs [runs]` times each hook on copies of the machine's largest
  transcript and store.

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
- Add a test with the change, and a mutant for any new rule.
- Don't run the `claude` command, read a credential or Claude Code's
  `settings.json`, copy the whole environment, or connect to anything. The
  plugin directory's security scan holds a plugin that does, and it reads
  every file, tests included.
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
- **Processes.** `process.exit()` can cut a pipe's output short on macOS:
  set `process.exitCode`.

## Sending a change

Open a pull request against `master`. Run `node check.mjs` first, and
`node mutate.mjs` if you changed a rule; CI runs the suites and a minute of
fuzz on every platform. Have the change reviewed from its diff alone, by
someone (or an agent) who has not heard why you made it. Leave the version
number alone, and describe the change under an `## Unreleased` heading at
the top of `CHANGELOG.md` (add the heading if it isn't there), in plain
words for someone who uses the plugin.

## Releasing

The maintainer's steps:

1. Bump `version` in `.claude-plugin/plugin.json`, and turn `## Unreleased`
   in `CHANGELOG.md` into the version's heading.
2. Run `claude plugin validate . --strict`. It should find nothing to report.
3. Run `node fuzz.mjs 600`, and review the whole repository, not just the
   last change.
4. Push to `master`, start the `mutate` workflow by hand (every mutant), and
   wait for it and CI to pass on every job.
5. Tag the commit `vX.Y.Z`, push the tag, and publish a GitHub release.

## The author's setup

The author keeps this repository at `~/.claude/hooks` and runs the hooks from
a checked copy. `node deploy.mjs` runs only on `master` with nothing
uncommitted. It runs the six suites, the mutation check, the soak and the
break harness, then compares a dry run of the tidy-up with the live copy's,
and copies the plugin to `~/.claude/hooks-live`, which also serves as a local
marketplace the plugin is installed from. It doesn't run the validator or the
benchmark. None of this is needed to use or to change the plugin.
