# Run records (1.6.0 step 17)

Amended 2026-11-25 after the audit `reports/Audit of 1.6.0 plans 2026-11-25.md` (findings 4, 5, 7, 13).

Status: approved by the maintainer, 2026-11-24. This is candidate #4 of the
architecture review, settled in two rounds of questions with "yes" to every
recommendation. A later session builds it from
`docs/plans/2026-11-24-1.6.0-step-17-run-records.md`. The two doctor fixes found
on the way are tasks 5 and 6 of `docs/plans/2026-11-24-1.5.8-privacy-fixes.md`.

Words are as in `GLOSSARY.md`.

## Why

Measured on master at ad20f3e (v1.5.7):

**Five status files cross module lines**, and each one's format is known on
both sides:

| Record | Written by | Read by |
|---|---|---|
| `.health` (store health) | `memory-tier.mjs:594-601` | `handoff-log.mjs:926`, `memory.mjs:358` |
| `.stop-ran` (Stop record) | `memory-tier.mjs:724-743` | `memory.mjs:815`, `:897-916`; `handoff-log.mjs:1022` (`stalled`, mtime only) |
| `.handoff-failed-<folder>` | `memory-tier.mjs:696`, `:763`, cleared `:761` | `handoff-log.mjs:930`, `memory.mjs:361` |
| `.journal-failed-<folder>`, `journal/.failed` | `journal.mjs:452-460`, cleared `:463` | `handoff-log.mjs:936`, `journal.mjs:462`, `:868` |
| `.deployed.json` (deploy record) | `tools/deploy.mjs:86` | `handoff-log.mjs:1046` (`edited`), `memory.mjs:122`, `:880-895` |

Claude Code's `installed_plugins.json` is read in `memory.mjs:110-119` and
`memory-tier.mjs:644`.

**There are three read helpers with different rules, plus inline copies.**
- `json()` (`memory.mjs:109`) returns null on any error and does not strip a
  BOM.
- `read()` (`memory.mjs:125`) strips a BOM.
- `raw()` (`store.mjs:368`) throws when a file exists but can't be read.
- The startup line and `enforce.mjs` use their own `try { readFileSync } catch {}`.

**Doctor re-derives facts with its own copies of the checks.** Two of those
copies are wrong. They are fixed in 1.5.8 (see below).

## Part 1: two fixes in 1.5.8

Each fix gets a failing test first, and both go in the existing 1.5.8 plan.

- **(d) Doctor reports a damaged deploy record as a problem.**
  - Today: when the live copy's `.deployed.json` exists but can't be parsed,
    `edited()` returns `[]`, and doctor prints "ok … matches what deploy.mjs
    checked" (`memory.mjs:880`).
  - `edited()`'s silence is deliberate for the startup line (comment at
    `handoff-log.mjs:1040-1043`), and it stays that way there.
  - Doctor itself must say PROBLEM.
- **(e) Doctor uses the store's stale-lock rule.**
  - `store.mjs:414` and `:428` call a lock stale when
    `Math.abs(now - mtime) > LOCK_STALE`.
  - Doctor (`memory.mjs:919`) has its own copy without `abs`, so it misses a
    lock dated in the future.
  - Fix: export the store's test as one function and have doctor call it. No
    third copy.

## Part 2: step 17, `src/run-records.mjs` (one PR, a pure move)

**What it owns.** It reads and writes these five run records:
- store health
- the Stop record
- the two failure records
- the deploy record

It also reads Claude Code's `installed_plugins.json`.

**One read rule:**
- A missing file is "none".
- A file that exists but can't be read or parsed is "damaged".
- A BOM is stripped.

`json()` and `read()` in `memory.mjs`, and the inline copies for these files,
go. `raw()` stays in `store.mjs` for the files it already serves.

**What users see doesn't change.** Each screen shows what it shows today:
doctor, status, the startup line and the tier hook. A "damaged" answer is
displayed exactly as that screen displays the file today. Showing damage more
widely is a later choice, not part of this step.

**Deploy uses it too.** `tools/deploy.mjs` writes the deploy record through the
module, so the format lives in one place.

**What moves in, as it is:**
- From `memory-tier.mjs`: `health()` and the Stop-record append and cut. The
  Stop record is written inline in `main` (`:724-743`), so it is first extracted
  into a function.
- From `journal.mjs`: `aside()`, `fault()`, `failures()` and `clear()`.
- From `handoff-log.mjs`: `edited()` with `hash` (which it needs, and which
  `tools/deploy.mjs:17` imports from there today, so deploy imports it from the
  new module), `unsaved()`, and the record reads in the startup line
  (`:921-941`).
- From `memory.mjs`: `stopRuns`, `deployedCommit` and `plugins()`, which reads
  both `installed_plugins.json` (`:113`, `:115`) and `known_marketplaces.json`
  (`:119`, `:862`). Both reads move; `marketplace()` stays and calls the module.
- From `store.mjs`: `HANDOFF_FAILED` and `JOURNAL_FAILED`.

The module cannot import `journal.mjs`, so it has its own constants for the
journal folder and `.failed`. A test checks they equal the journal's.

**What stays out:**
- `timing.mjs`, which is already one clean module with its own tests.
- Each file with a single owner: `.lock`, `.tiered`, `.facts`, `.nudge/`,
  `.enforce-log` and `.enforce.json`, `.hash-salt`, `journal/.looked` and
  `.imported`.
- The 1.6.0 session file, which stays in `recall.mjs` as the 1.6.0 design says.
- `.snapshot-health`, which belongs to the snapshot module (step 16).

**Imports.** Node built-ins and `store.mjs` only.

**Not part of this step:** turning doctor into a list of checks owned by each
module (review candidate #5). It's worth doing only once steps 15–17 have
landed.

## Tests

- Every existing suite passes with no assertion changes. Imports change, and
  four tests that copy `src` files into temp trees get `run-records.mjs` added
  to their lists (`test/memory-tier.test.mjs:632` and `:1557`,
  `test/handoff-log.test.mjs:565` and `:3062`).
- Since PR #239 the tools derive their file lists from `src/`. The new module
  needs a `suites` entry in `tools/mutate.mjs`, its import, and
  `tools/mutants/run-records.mjs`.
- `test/run-records.test.mjs` runs in-process. For each record it covers:
  absent, present, damaged (bad JSON, unreadable), with a BOM, and with CRLF
  line ends. It also covers the Stop record's cut at 8 KB to 20 lines.

## Docs

- `docs/how-it-works.md`: the module list.
- `GLOSSARY.md`: five names, added with this spec.
