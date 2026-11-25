# Privacy and transcript modules (1.5.8 fixes, 1.6.0 step 15)

Amended 2026-11-25 after the audit `reports/Audit of 1.6.0 plans 2026-11-25.md` (findings 1, 2, 3, 4, 5, 13).

Status: approved by the maintainer, 2026-11-24, in an architecture review and
four rounds of questions (all answered "yes" to the recommendation). Built by a
later session from the two plans:

- `docs/plans/2026-11-24-1.5.8-privacy-fixes.md`
- `docs/plans/2026-11-24-1.6.0-step-15-modules.md`

Words as in `GLOSSARY.md`. The binding decision is
`docs/adr/0001-privacy-decided-in-one-module.md`.

## Why

Measured on master at ad20f3e (v1.5.7):

- **The privacy rule is decided in five modules.** These are `handoff-log`,
  `journal`, `compact-gate`, `enforce` and `memory`. Each one reads the marker
  files and decides on its own what an unreadable file means.
  `enforce.mjs:194-208` holds a hand copy of `PRIVATE_SESSION`.
- **Transcript reading lives inside `handoff-log.mjs`** (1,264 lines), next to
  the handoff writer and the briefing. Three other modules parse records their
  own way.
  - There are 8 hand-written byte readers: `journal.mjs:213`, `:371`, `:525` and
    `:641`, `enforce.mjs:134` and `:165`, `store.mjs:139`, and
    `handoff-log.mjs:535`.
  - `compact-gate`, `journal` and `memory` import 18 to 26 names each from
    `handoff-log`. `handoff-log` imports `journal` (`:1120`) and `compact-gate`
    (`:1203`) back, which makes an import loop.
- **Most privacy tests start whole hooks.** `handoff-log.test.mjs` is 4,215 lines
  with 62 spawns, and most of it exercises turn parsing and privacy.

## Part 1: bug fixes in 1.5.8

These are three differences between the copies. They ship as a patch with PR #230,
each fix with a failing test first. Nothing else changes.

1. **The git-rule hook reads text the way the Stop hook does.**
   - Today `enforce.mjs` `privateTurn` tests the raw line and the typed text
     without `norm()`. A fullwidth `＜private-session＞`, or one with zero-width
     characters inside, goes unnoticed, so a git command in a private
     conversation is logged.
   - It also reads helper records (`isSidechain`), which `turns()` skips.
   - Fix: move `norm` from `handoff-log.mjs:188` to `store.mjs`, which the hook
     already imports, and re-export it from `handoff-log` so callers are
     untouched. `privateTurn` normalizes and skips sidechain records.
2. **An unreadable `.forgotten` hides everything in the handoff.**
   - `handoff-log.mjs:847` catches any read error and treats the list as empty,
     so a forgotten exchange comes back into `handoff.md`.
   - Fix: the same rule as `:1183`. A read error other than ENOENT puts none of
     the turns in.
3. **An unreadable `.off-periods` counts as off.**
   - `wasOff` (`store.mjs:263`) reads through `raw()`, which throws on a read
     error. The throw leaves `handoff-log.mjs:809` and `journal.mjs:142` with no
     stated rule.
   - The failing test comes first and shows what happens today. If the Stop
     already writes nothing and records the failure, the behaviour is safe: say
     so in a comment and in the test, and change no code. If anything is
     written, `wasOff` returns "every turn is inside" on a read error other than
     ENOENT.

## Part 2: 1.6.0 step 15, a pure move

Nothing a user sees changes. All existing checks pass with **no assertion
changes** after each pull request. The only new tests are direct tests of the
three new modules.

### `src/privacy.mjs`

**What it does.** It answers whether a turn or a conversation may be saved or
shown. It owns the formats of the marker files and both reads and writes them.

**What it covers.**
- private turn (`PRIVATE`)
- private conversation (`PRIVATE_SESSION` and `.private-sessions`)
- conversation switched off (`.memory-off`)
- project switched off (`.project-off`)
- off period (`.off-periods`)
- forgotten exchange (`journal/.forgotten`)

**What stays outside it.** `memoryOff()` (Claude Code's auto memory setting)
stays in `store.mjs`.

**What moves into it** from the files they're in today:
- From `handoff-log.mjs`: `PRIVATE`, `PRIVATE_SESSION`, `hushed`, `off`,
  `offLine`, `unreadable`, `FORGOTTEN` and `forgotten`.
- From `store.mjs`: `QUIET`, `OFF`, `PROJECT_OFF`, `isOff`, `OFF_PERIODS` and
  `wasOff`.
- **`unsay` and its `put` do not move.** `put` (`handoff-log.mjs:886`) writes
  handoff.md through `build`, `parse`, `sectionOf`, `render`, `keep` and `PREV`,
  and `handoff()` shares it. Privacy may import only `store.mjs`, so `unsay` and
  `put` stay in `handoff-log.mjs` as the handoff writer. Callers keep importing
  `unsay` from there.
- `norm` (in `store.mjs` after 1.5.8) and `listOf` stay in `store.mjs` as shared
  helpers.

**One rule.** A marker file that exists but cannot be read means private.
- Today `hushed()` returns `null` for "unknown" and every caller decides. After
  the move, the module's answers treat unknown as private.
- A caller that also records the failure, as the Stop hook does at
  `handoff-log.mjs:822`, `:827` and `:837`, still gets that the file was
  unreadable, so it can record it.
- No caller can ask for a fail-open answer.

**Behaviour that's kept on purpose, written next to the code:**
- `compact-gate.mjs:132` and `:150` use the looser `/<\s*private/i`. The
  compaction note hides any spelling, including `<private-session>` and
  `<privately>`. That is wider than the private-turn rule, and it stays that
  way.
- The retry differs between callers. `hushed` retries 3 times on busy errors.
  The git-rule hook makes one try, because its timeout is 5 s. Each caller says
  which it wants. The default stays 3.
- Each file is pruned differently. `.private-sessions` keeps the newest 999.
  `.memory-off` keeps tags still on disk plus the newest 100, up to 10,000.

**Cleanup inside the move.** The `try/catch` around `isOff` at
`compact-gate.mjs:395` can never catch anything, because `isOff` does not throw.
It goes.

**Imports.** Node built-ins and `store.mjs` only. It never imports
`handoff-log`, `journal` or `transcript`.

### `src/text.mjs`

**What it does.** It prints text safely. It is a leaf, built first in PR A
because `transcript.mjs` needs it, and so the hooks of steps 4 to 7 can print
without loading the briefing.

**What moves into it** from `handoff-log.mjs`:
- `clip` (with its memo, `clipped` and `clippedSize`), `cut`, `plain`,
  `defuse` and `fit`.
- `SAY`, because `fit` caps at it and the briefing's own check (`:1209`) uses it
  too. It is exported from here, so there is one number. `BRIEF` and `EXCHANGES`
  stay with the briefing.

**Imports.** Node built-ins and `store.mjs` only (`clip`, `cut` and `fit` call
`redact`). Checked at 337077d: `clip` needs `cut`; `cut` needs `defuse`; `fit`
needs `defuse` and `SAY`; `plain` and `defuse` need nothing. No name here needs
the handoff, the journal or the transcript.

### `src/transcript.mjs`

**What it does.** It reads a transcript. It offers two things and nothing more:

- **Records.** Parsed lines from a byte range, forward or backward, with helper
  records left out unless the caller asks for them. `compact-gate` and the
  git-rule hook use this level. The git-rule hook only wants lines that hold
  `git`, so a cheap filter on the raw line, applied before the line is parsed,
  is part of this level.
- **Turns.** Built on records: the ask, the reply, commands, files changed,
  picks from `AskUserQuestion`, and the private flags, which it gets from
  `privacy.mjs`. `handoff-log` and `journal` use this level.

**What moves into it** from `handoff-log.mjs`:
- `readTail`, `text`, `asked`, `prompt`, `own`, `unwrap`, `queuedText`,
  `toolAnswers`, `refused`, `editedFile`, `turns`, `promptBefore`, `goesOn`,
  `lastTurn` and `transcripts`.
- The record-reading names that `turns()` needs: `FORGETS`, `BARE`, `unquote`,
  `userText`, `nudged`, `NUDGE_TAGS` (with `NUDGE_TAG`, which `compact-gate`
  imports), and `TAIL`. The private helpers only these use move with them (for
  example `stick` and the `F_*` patterns, `QUOTES`, `ASKS_SECRET`, `LEAD`,
  `command`, `image`, `scan`).
- `tailOf`, `joined` and `BLOCK`, with `SAID` and `SAID_KEEP`. `turns()` and
  `handoff()` (`:794`) both use them, and `journal` and `memory` import `BLOCK`.
  They are exported from here.

`turns()` calls `clip` and `plain`, which it takes from `text.mjs`, and
`PRIVATE` and `PRIVATE_SESSION`, which it takes from `privacy.mjs`.

**The byte readers that move into it**, 7 of the 8, with each one's limits
unchanged:
- `handoff-log.mjs:535`: reads backwards 1 MB at a time, up to 256 MB.
- `journal.mjs:213`, `:371` and `:525`, and `past` at `:641-701`.
- `enforce.mjs:134` and `:165`: the `HEAD` read and its cache key.

`store.mjs:139` (`startCwd`) does **not** move. `storeOf` (`store.mjs:187`) calls
it, so moving it would make `store` import `transcript` and `transcript` import
`store`. It stays in `store.mjs` as the one byte reader left there.

**Imports.** Node built-ins, `store.mjs`, `privacy.mjs` and `text.mjs` only.

**What stays in `handoff-log.mjs`.** The handoff writer (`handoff`, `put`,
`unsay`, `build`, `render`, `keep`, `latest`, `shown`), the briefing, `parse`,
`sectionOf`, `MISSED`, `HELD`, `stalled`, `edited`, `hash`, `main` and the
formatting helpers. It imports `transcript.mjs`, `privacy.mjs` and `text.mjs`.
Moving the rest is not part of this step.

### Callers import directly

There are no re-exports from `handoff-log.mjs` of anything that moved.
- `compact-gate`, `journal`, `memory`, `enforce`, `memory-tier`, the tests and
  `tools/fuzz.mjs` import from `privacy.mjs` or `transcript.mjs`.
- The import loop ends: `handoff-log` keeps its dynamic imports of `journal`
  and `compact-gate`, and those two no longer import `handoff-log` for anything
  that moved. `journal` and `memory` still import `unsay` from `handoff-log`
  (and `compact-gate` takes `handoff` and others), so the loop remains until step
  18 moves the briefing out. The builder lists every remaining name in the PR.
- `brief.mjs` stays as it is.

### The git-rule hook (PR C, with a condition)

`enforce.mjs` drops its own byte readers and its copy of the pattern. It uses
records from `transcript.mjs` and the private-conversation check from
`privacy.mjs`.

**Condition.** `node tools/bench.mjs` keeps `'PreToolUse git'` within its ratio
of 7.
- If it fails, PR C keeps the hook's own reader and switches only to
  `privacy.mjs`, which is already done in PR A.
- The PR states both numbers, before and after.

## Tests

- **Every existing suite passes with no assertion changes** after each PR, on
  the three systems in CI. An import path may change in a test file, and four
  tests copy hand-listed `src` files into temp trees, so each gets the new
  modules added to its list: `test/memory-tier.test.mjs:632` and `:1557`, and
  `test/handoff-log.test.mjs:565` and `:3062`.
- **`test/privacy.test.mjs`, in-process.** A table over each source with three
  file states: absent, present, and unreadable. It also covers fullwidth and
  zero-width tags, the compaction note's looser check, and each list's pruning.
- **`test/transcript.test.mjs`, in-process.** Fixture records, read forward and
  backward, across each byte reader's chunk edge. It checks that helper records
  are skipped and that the turns match today's `turns()` output on the same
  fixtures.
- **`test/text.test.mjs`, in-process.** `clip` is stable and keeps its memo,
  `defuse` and `plain` on fixtures, `fit` caps at `SAY` and cuts per line.
- Since PR #239 the tools derive their file lists from `src/`. Each new module
  needs only a `suites` entry in `tools/mutate.mjs`, its import, and
  `tools/mutants/<name>.mjs` (`tools/check.mjs` fails without the entry).
- Trimming the spawned tests that these make redundant is a later step, not
  part of this one.

## Docs

- `docs/how-it-works.md`: the module list and who reads the transcript.
- `CONTRIBUTING.md`: "privacy goes through `privacy.mjs`" goes under the
  habits.
- `GLOSSARY.md` and ADR 0001 come with this spec.

## Not checked

- Whether `turns()` (`handoff-log.mjs:276-402`) has more privacy branches than
  `:358`. A grep at 337077d finds `PRIVATE` at `:341`, `:344` and `:378` too. The
  builder reads it in full before PR B.
- Whether `memory.mjs:1305` (a local `read` of `.forgotten`) also fails open. If
  it does, it's a fourth 1.5.8 fix, with a test first.
- The real startup cost of `privacy.mjs` with `store.mjs`. It is expected to be
  close to `enforce.mjs` today, which already imports `store.mjs`. PR A
  measures it.
