# Briefing module (1.6.0 step 18)

Amended 2026-11-25 after the audit `reports/Audit of 1.6.0 plans 2026-11-25.md` (findings 2, 4, 5, 8, 9, 13).

Status: approved by the maintainer, 2026-11-25, in round 2 of the
architecture review (candidate #1, with #2 folded in). There were two rounds
of questions, and every answer was "yes" to the recommendation. A later
session builds it from `docs/plans/2026-11-25-1.6.0-step-18-briefing-module.md`.

Words are used as in `GLOSSARY.md`. The binding decision is
`docs/adr/0003-no-import-loops-in-src.md`.

## Why

Measured on master at 6cf58fd (v1.5.8):

- **`src/handoff-log.mjs` is two modules in one file.** It is 1,260 lines with
  52 exports. It writes the handoff (`handoff()` at `:757`), and it builds the
  briefing (`print()` at `:1128-1213`, with `fit`, `shared` at `:1063`,
  `journalLine` at `:1115`, `health` at `:919` and the size limits `SAY`,
  `BRIEF` and `EXCHANGES` at `:1090-1096`).
- **That makes an import loop.** `journal.mjs:8` and `compact-gate.mjs:37`
  import from `handoff-log.mjs`, and the briefing needs both of them. So
  `handoff-log.mjs` loads them at run time instead:
  `journal.firstDay` at `:1116` and `compact-gate.recover` at `:1199`. The
  comment at `:1217-1219` records an "unsettled top-level await" failure that
  this loop already caused once.
- **The handoff reads the journal's file format.** The check for a fork copy
  (`copy()`, `:855-862`) opens `journal/<day>.md` and searches for
  `<!-- j:<id> t:`. Only `journal.mjs` should know that marker
  (`MARK` at `:35`, written at `:95`). A change to it would break the handoff
  silently.
- **The briefing tests only run as a spawned hook.** `print()` is not exported.
  `test/handoff-log.test.mjs` (4,232 lines) runs `--print` 34 times, and about
  1,000 to 1,200 of its lines are briefing tests.

Steps 15, 16 and 17 already move the transcript reading, the privacy lists, the
snapshot health read, `edited` and the run-record reads out of this file. None
of them touches the briefing or the journal marker. The step 15 spec says the
two run-time imports stay. This step removes them.

## What changes

1. **`src/briefing.mjs` builds the briefing.** It holds `print`, `journalLine`,
   `shared`, `BRIEF`, `EXCHANGES`, the recent and age logic, and what is left of
   `health()` after steps 16 and 17. **`fit` and `SAY` are not moved here.**
   Step 15 put them in `src/text.mjs`, so the hooks of steps 4 to 7 can use
   `fit` without loading the briefing, which loads the handoff, the journal and
   compact-gate. `briefing.mjs` imports `fit` and `SAY` from `text.mjs`, and
   imports `handoff-log.mjs`, `journal.mjs`, `compact-gate.mjs` and the step 15
   to 17 modules statically. Nothing in `src/` imports it except `brief.mjs`.
2. **`briefing.mjs` answers `--print`.** `brief.mjs` stays the guard: it keeps
   the off switch, the Node version line, the timing and the "Memory briefing
   failed" line, and imports `briefing.mjs` instead of `handoff-log.mjs`.
   `handoff-log.mjs`'s `main` keeps only the Stop path. The off and private
   checks at the top of `main` (`handoff-log.mjs:1223-1245`: `isOff`, `offLine`,
   `memoryOff` and `off`) are shared by `--print` and Stop, so both mains keep
   them, built on `privacy.mjs`.
3. **`stalled` stays in `handoff-log.mjs`.** It says the handoff stopped being
   written, which is a fact about the handoff file that doctor also reads
   (`memory.mjs:56`). The briefing imports it.
4. **The journal answers the fork-copy question.** `journal.mjs` gets
   `keptUnder(dir, day, id)`, which returns the transcript key an exchange is
   kept under, or null. It uses `MARK`. `handoff()` has three callers:
   - `memory-tier.mjs:757` and `:758` already load the journal guarded and pass
     `sink` (`:751-758`). They pass `keptUnder` the same way.
   - `compact-gate.mjs:298` imports the journal statically, which makes no loop,
     and passes `keptUnder`.
   - `handoff-log.mjs:1242` is the command-line Stop path. It passes none. No
     hook uses it (`hooks/hooks.json` runs only `brief`, `compact-gate`,
     `enforce-hook` and `memory-tier`); the tests and `tools/fuzz.mjs:521` do.
     The fork-copy tests that use it move to run through `memory-tier --stop`.
     The builder checks that `tools/fuzz.mjs:521` asserts nothing about fork
     copies, and that nothing else runs the path.

   `handoff-log.mjs` never imports the journal. If the journal fails to load, the
   exchange is "not a copy", which is what happens today when the day's file is
   missing.
5. **A check keeps it that way.** `src/` has 13 run-time imports at 337077d.
   Eleven are guards, so a broken file cannot stop a hook: `brief.mjs` (2),
   `enforce-hook.mjs` (1), `memory.mjs:63` (1), `memory-tier.mjs` (6, at `:692`
   to `:786`) and `timing.mjs:60` (1, loading `store.mjs`, which does not import
   it). Those stay. The two in `handoff-log.mjs` dodge a loop. `tools/check.mjs`
   builds the import graph of `src/` from both kinds of import and fails on any
   loop. That is the rule: a run-time import is allowed as a guard, never to get
   around a loop.

## Behaviour

Everything the user sees stays word for word the same, with one exception:
the fork-copy check now matches only a real marker line (`MARK` is anchored),
where `indexOf` also matched the marker typed inside a prompt. To hit the old
behaviour someone has to type a full marker with the same turn id, so this ships
here with one test rather than as its own patch fix.

## Tests

- The briefing tests move as they are into `test/briefing.test.mjs`. The only
  change in them is the script they run, and only for `--print` runs.
  - `HOOK` (`test/handoff-log.test.mjs:13`) has 45 uses. Many are Stop-path
    runs that stay on `handoff-log.mjs`. Only the `--print` runs move to
    `src/briefing.mjs`.
  - The `--print` runs of `handoff-log.mjs` elsewhere are retargeted too:
    `compact-gate.test.mjs` (2), `journal.test.mjs` (3),
    `memory-switch.test.mjs` (1), `memory-tier.test.mjs` (2),
    `tools/fuzz.mjs:733` and `:751`, and `tools/survive.mjs:41`.
  - `timing.test.mjs:101` and `tools/bench.mjs:112-113` already run
    `brief.mjs --print`, the guard. They stay as they are.
  - Tests that copy `src` files into temp trees get `briefing.mjs` (and
    `journal.mjs` for a copied `compact-gate.mjs`) added to their lists:
    `test/memory-tier.test.mjs:632` and `:1557`, and
    `test/handoff-log.test.mjs:565` and `:3062`. The broken-starter test
    (`test/handoff-log.test.mjs:2518`) stubs `briefing.mjs` instead of
    `handoff-log.mjs`.
  - No assertion changes.
- The briefing mutants move from `tools/mutants/handoff-log.mjs` into
  `tools/mutants/briefing.mjs`. Since PR #239 the tools derive their file lists
  from `src/`, so `briefing.mjs` needs a `suites` entry in `tools/mutate.mjs`
  (`tools/check.mjs` fails without it) and its import. The `brief.mjs` suite
  points at the new test file.
- `keptUnder` gets in-process tests in `test/journal.test.mjs`: a marker under
  another key, under the same key, a missing day file, and a marker typed inside
  a prompt (not a match).
- No new in-process briefing tests in this step.

## Not in this step

- One hook runner for the five entry points (candidate #4): the fail-open rules
  differ on purpose.
- Moving the context-window numbers out of `compact-gate` (candidate #5).
- Any change to what the briefing says or how long it is.

## Order

After step 17, before step 3. The 1.6.0 order is
15, 16, 17, 18, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14. Line numbers here are from
6cf58fd. The builder maps them again once step 17 has merged, because steps 15
to 17 move code out of the same file.
