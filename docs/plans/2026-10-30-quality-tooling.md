# Quality Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch more bugs before release: automatic mutants on every code line, a fuzz that reaches what it misses today and reports failures shrunk, CI on current Node versions, a real Windows lock test, a coverage map, and a faster memory-tier suite.

**Architecture:** New tools beside the old ones, no dependencies: `automut.mjs` makes mutants that `mutate.mjs` and `check.mjs` run; `coverage.mjs` reads Node's own coverage files; `fuzz.mjs` splits a round into generated steps and their execution, so it can shrink a failure, and gains new kinds of step; `fuzz-faults.cjs` is a preload that fails file calls. `memory-tier.mjs` gets a `main()` like `memory.mjs`'s.

**Tech Stack:** Node.js 22+ ES modules, `node:assert`, `node:child_process`, `NODE_V8_COVERAGE`; GitHub Actions; PowerShell on Windows for the real lock.

**Spec:** `docs/specs/2026-10-30-quality-tooling-design.md`

## Global Constraints

- Plain Node.js 22 and newer (KIRE raised the floor from 20 on 2026-10-30), no dependencies. Plugin code never goes online; workflows may use `gh` and GitHub's actions.
- No hook changes behavior, except to fix a bug a new check finds: then a test, a mutant and its own commit.
- The six suites stay the suites; new tools carry an inline self-check (as `check.mjs` checks `changedLines`).
- GitHub runs use 17 machines; the limit is 20 jobs at once, 5 of them macOS. Start runs without asking.
- Test first; `node check.mjs` green before every commit; one change a commit; stage files by name, never `git add -A`.
- No token-like secret literal in any file: build secret-shaped values from pieces at run time.
- Bash heredocs mangle backslashes on this machine: write scripts to files.
- Commit messages end with the session's Co-Authored-By line.

## Decisions this plan makes (beyond the spec)

- Parts run in this order: A (Task 1), F (Task 2), B (Task 3), C (Tasks 4-8), D (Tasks 9-15), E (Task 16). F sits with A because both touch `test.yml`.
- Fuzz seeds from before Task 9 need not replay after it: the step list changes what a seed makes.
- Automatic mutants carry `edit: { at, from, to }` instead of a find-text; `mutate.mjs`'s `run()` applies an edit at its offset and reports `MUTATION DID NOT APPLY` when the text there differs.
- `STILLBORN` mutants and ignored ones are listed in the last line's counts, never as survivors.

## Review Focus

1. A regular expression, string or template holding `<`, `&&`, `!` or `===` (`FORGETS`, `PRIVATE`, `'<private>'`). Expected: no automatic mutant inside it. Test: Task 4 self-check, `no mutant inside a literal`.
2. A fault aimed at a path outside the fuzz home, such as Node loading the plugin's own `.mjs` files. Expected: the hook loads and runs. Test: Task 12 start-up check, `faults stay under their root`.
3. A daylight-saving instant that isn't one (a slip in the date arithmetic). Expected: the fuzz stops and says the list is wrong. Test: Task 11 start-up check.
4. `main()` of memory-tier called twice in one process. Expected: the same output as two separate processes, no state carried over. Test: Task 16, `two in-process calls match two processes`.
5. Lines added above an automatic mutant. Expected: its id is unchanged, so the ignore list still matches. Test: Task 4 self-check, `an id survives an edit elsewhere`.

---

### Task 1: Node 22 as the floor, CI on current Node versions and actions, and the release review

**Files:**
- Modify: `.github/workflows/test.yml`, `.github/workflows/mutate.yml`, `.github/workflows/fuzz.yml`
- Modify: `CONTRIBUTING.md` (line 20 "CI runs all six ... Node 20 and 24", and Releasing step 3)
- Modify: `README.md:38-41` ("Node.js 20 or newer", twice), `docs/how-it-works.md:665,671,699`
- Modify: `CHANGELOG.md` (an `## Unreleased` entry at the top)

**Interfaces:**
- Produces: the newest major tags of `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` (Task 15 uses the last).

- [ ] **Step 1: Look up the newest majors**

Run: `gh api repos/actions/checkout/releases/latest --jq .tag_name`, the same for `actions/setup-node` and `actions/upload-artifact`.
Expected: three tags such as `v5.x.y`; use their major (`@v5`).

- [ ] **Step 2: Change the matrix and the actions**

`test.yml` matrix becomes an `include` list of seven: `ubuntu-latest` with 22, 24, 26; `windows-latest` and `macos-latest` with 24 and 26. Every workflow's `checkout` and `setup-node` use the majors from Step 1. `mutate.yml` and `fuzz.yml` stay on Node 24.

- [ ] **Step 3: Update the docs**

README and `docs/how-it-works.md` say "Node.js 22 or newer" wherever they said 20 (the "Tested on" line names Node 22, 24 and 26). `CHANGELOG.md` gets, under `## Unreleased`: "project-memory now needs Node.js 22 or newer. Node 20 reached its end of life in April 2026 and gets no more security fixes; if `node --version` says v20, install the current LTS from nodejs.org." In CONTRIBUTING the CI line names the seven jobs, and Releasing step 3 adds: "Have every change since the last tag reviewed from its diff alone, by a reviewer who hasn't seen the work (a fresh agent will do), and fix what it confirms."

- [ ] **Step 4: Verify on GitHub**

Run: `node check.mjs`, commit, push. Then `gh run list -L 3` and `gh run view <test run> --json jobs --jq '.jobs[].name'`.
Expected: seven test jobs green; `gh run view <id> --log | grep -c "Node.js 20 is deprecated"` prints 0.

- [ ] **Step 5: Commit** (before Step 4's push)

```bash
git add .github/workflows/test.yml .github/workflows/mutate.yml .github/workflows/fuzz.yml CONTRIBUTING.md README.md docs/how-it-works.md CHANGELOG.md
git commit -m "Node 22 or newer; CI on 22, 24 and 26 on Linux, 24 and 26 elsewhere; current actions; a review before each release"
```

### Task 2: The real Windows lock, where locks work

**Files:**
- Modify: `memory-tier.test.mjs` (after the held-memory check, ~line 560)
- Modify: `.github/workflows/test.yml` (job-level `env`)

**Interfaces:**
- Consumes: the PowerShell holder from commit 4a79a9c (`git show 4a79a9c:memory-tier.test.mjs`, lines 544-563).

- [ ] **Step 1: Write the block**

In full mode only (`!quick`) and on `win32` only: store `proj-six` set up as `proj-five` is (a committed note, then a change that makes the next Stop run a pass), hold its `a.md` from PowerShell with no sharing (4a79a9c's holder, reporting `held refused NTFS` or `failed ...`), check that `readFileSync` of it fails with `EBUSY`, `EPERM` or `EACCES`, run a Stop, release, run a Stop, and assert:

```js
ok(existsSync(stamp('proj-six')) && !existsSync(join(six, '.health')), 'a memory another program really holds open for one Stop leaves no lasting alarm');
```

When the hold isn't real: with `process.env.REAL_LOCKS === '1'`, fail with `a real lock was asked for and this machine does not hold one (PowerShell: <said>)`; without it, print `skip: this machine does not hold a file another program opened` and go on.

- [ ] **Step 2: Run it here**

Run: `node memory-tier.test.mjs` (full mode) on this PC, then `REAL_LOCKS=1 node memory-tier.test.mjs`.
Expected: both pass; no skip line.

- [ ] **Step 3: Set REAL_LOCKS in CI**

`test.yml`, job level: `env: { REAL_LOCKS: "${{ matrix.os == 'windows-latest' && '1' || '' }}" }`.

- [ ] **Step 4: Verify on GitHub**

Run: `node check.mjs`, commit, push; then a mutate run by hand (`gh workflow run mutate.yml --ref master`).
Expected: the Windows test jobs pass with no skip line in their log; the mutate run passes and its log shows the skip line from the full-mode control.

- [ ] **Step 5: Commit** (before Step 4's push)

```bash
git add memory-tier.test.mjs .github/workflows/test.yml
git commit -m "memory-tier test: a real Windows lock again, required in CI's Windows jobs, skipped where locks don't hold"
```

### Task 3: The coverage map

**Files:**
- Create: `coverage.mjs`
- Modify: `CONTRIBUTING.md` (a bullet under "Beyond the suites")

**Interfaces:**
- Produces: `export function report(covDir: string, repo: string, files: string[]): string[]` (lines to print); CLI `node coverage.mjs [--suites] [--fuzz <seconds>]` (no flag: `--suites`).

- [ ] **Step 1: Write the self-check first**

At the bottom of `coverage.mjs`, run at load: write one synthetic coverage file to a temp folder (one script whose function `never` has a range with `count: 0` at offset of line 3 of a 5-line source written beside it), and assert:

```js
assert.ok(report(tmp, srcDir, ['x.mjs']).some((l) => /x\.mjs: ~\d+% of the code ran; 1 function\(s\) never ran: never@3/.test(l)));
```

- [ ] **Step 2: Run it to see it fail**

Run: `node coverage.mjs --help`. Expected: fails, `report` not defined.

- [ ] **Step 3: Implement**

`report` merges every `*.json` in `covDir` by file (`result[].url` under `repo`, basename in `files`), adds counts per range, prints per file the share of bytes outside never-run ranges, the never-run functions as `name@line` (anonymous ones as `(anonymous)@line`), and the first lines of never-run blocks longer than 40 characters. The CLI makes a temp folder, sets `NODE_V8_COVERAGE` to it for each child, runs the six suites (full mode, one after another) and/or `fuzz.mjs <seconds>`, then prints `report(...)` for the six plugin files. The logic is the session's `scratchpad/fuzzcov.mjs`.

- [ ] **Step 4: Run it**

Run: `node coverage.mjs --fuzz 60`, then `node coverage.mjs --suites`.
Expected: lines for six files; under fuzz, `compact-gate.mjs` near 46% (today's figure).

- [ ] **Step 5: Commit**

```bash
git add coverage.mjs CONTRIBUTING.md
git commit -m "coverage.mjs: what the suites and the fuzz reach, from Node's own coverage"
```

### Task 4: automut.mjs, the automatic mutants

**Files:**
- Create: `automut.mjs`

**Interfaces:**
- Produces:
  - `export function mask(src: string): string`: same length, strings, template text (not `${...}` code), regular expression literals and comments replaced by spaces, line breaks kept.
  - `export function mutants(file: string, src: string, lines?: Set<number>): Mutant[]`, in source order, where `Mutant = { id: string, label: string, op: string, line: number, at: number, from: string, to: string }`.
  - `export function ignored(text: string | null): Map<string, string>`: id to reason, from `automut-ignore.txt`.
  - `export const OPS = ['equality', 'boundary', 'logic', 'boolean', 'not', 'number', 'condition', 'statement']`.

- [ ] **Step 1: Write the self-check**

At the bottom of `automut.mjs`, assertions run at load:

```js
// no mutant inside a literal
assert.equal(mutants('t.mjs', "const re = /a<b&&!c===d/; const s = '<private> && !x';\n").length, 0);
// each operator, once
const ops = (s) => mutants('t.mjs', s).map((m) => `${m.op} ${m.from}->${m.to}`);
assert.deepEqual(ops('if (a === b) f();\n'), ['condition (a === b)->(!(a === b))', 'equality ===->!==']);
assert.deepEqual(ops('log.push(x);\n'), ['statement log.push(x);->void 0;']);
assert.deepEqual(ops('x = a < 3 && !y;\n'), ['boundary <-><=', 'number 3->4', 'logic &&->||', 'not !y->y']);
assert.deepEqual(ops('const f = (a) => a >= 10 ?? true;\n'), ['boundary >=->>', 'boolean true->false']);
// an id survives an edit elsewhere
const one = mutants('t.mjs', 'x = a === b;\n')[0].id, two = mutants('t.mjs', '// new\n\nx = a === b;\n')[0].id;
assert.equal(one, two);
// the label
assert.match(mutants('t.mjs', 'x = a === b;\n')[0].label, /^auto equality t\.mjs:1 === -> !==$/);
```

- [ ] **Step 2: Run it to see it fail**

Run: `node automut.mjs`. Expected: fails, `mutants` not defined.

- [ ] **Step 3: Implement**

`mask` is a single pass with a state machine: code, `'...'`, `"..."`, template text with a stack of `${` depths, `//` and `/* */` comments, and regex literals. A `/` starts a regex when the previous significant character is one of ``( , = : [ ! & | ? { } ; + - * % < > ~ ^`` or the line's start, or the previous word is `return`, `typeof`, `case`, `do`, `else`, `in`, `of`, `new`, `delete`, `void`, `throw`, `yield` or `await`; a class `[...]` inside it can hold `/`. `mutants` runs each operator's pattern on the masked text (`(?<![=!<>])===?(?!=)` style guards so `=>`, `<<`, `>>`, `>>>`, `!=`-pairs, `??` and `?.` are left alone; numbers `\b[0-9]\b` not followed by `.`, `_`, `x`, `e` or a digit; `condition` only when the `if (`'s closing parenthesis is on the same line; `statement` only for a line whose masked text is one call, `name(...)` or `a.b(...)`, ending `);` with balanced parentheses, not starting with `return`, `const`, `let`, `var`, `if`, `for`, `while`, `throw` or `}`), skips lines outside `lines` when given, and edits the real text at the same offset. `id` = first 12 hex of `sha256([file, op, line.trim(), nthOnLine, nthCopyOfLine].join('\0'))`; `label` = `auto ${op} ${file}:${line} ${from} -> ${to}` with `from` and `to` cut to 40 characters.

- [ ] **Step 4: Run it**

Run: `node automut.mjs && node -e "import('./automut.mjs').then(({mutants}) => console.log(mutants('handoff-log.mjs', require('fs').readFileSync('handoff-log.mjs','utf8')).length))"`
Expected: the self-check passes; a count in the hundreds for `handoff-log.mjs`.

- [ ] **Step 5: Commit**

```bash
git add automut.mjs
git commit -m "automut.mjs: eight operators on code only, stable ids, an ignore list"
```

### Task 5: mutate.mjs runs automatic mutants

**Files:**
- Modify: `mutate.mjs` (the block after `export const suites`, ~lines 922-1000)
- Create: `automut-ignore.txt` (empty, with a header comment line `# <id> <reason>: a harmless automatic mutant, one a line`)

**Interfaces:**
- Consumes: `mutants`, `ignored` from Task 4.
- Produces: flags `--auto` (all automatic mutants of the table's source files, `hooks/hooks.json` excepted), `--auto-lines <file>:<n>,<n>;<file>:<n>`, and `--list` (print the selected jobs' labels, one a line, and run nothing); statuses `STILLBORN` and `IGNORED`; last line `N of M mutant(s) survived: ...; K stillborn, I ignored` (or `all M mutants killed; K stillborn, I ignored`). Task 6 and Task 7 call these flags.

- [ ] **Step 1: Write the check first**

In `check.mjs`'s inline asserts (beside `changedLines`'), find `n`, the first line of `store.mjs` containing ` === `, spawn `mutate.mjs --list --auto-lines store.mjs:<n>`, and assert its output includes the line `auto equality store.mjs:<n> === -> !==` and no line twice.

- [ ] **Step 2: Run it to see it fail**

Run: `node check.mjs`. Expected: fails on the new assert.

- [ ] **Step 3: Implement**

Jobs from `--auto`/`--auto-lines` get `{ name, testName, label, edit: { at, from, to }, id, auto: true, full: false }`; ones whose edited text equals a hand mutant's applied text are dropped; ids in `automut-ignore.txt` become `IGNORED` without running; ids listed there with no mutant are printed as `stale ignore: <id>`. In `run()`, an edit applies at `at` when `src.slice(at, at + from.length) === from`, else `MUTATION DID NOT APPLY`; before the suite, `spawnSync(process.execPath, ['--check', mutatedFile])` failing gives `STILLBORN`. The job order is the table's order then the automatic mutants' source order, before sharding.

- [ ] **Step 4: Run it**

Run: `node check.mjs`, then `node mutate.mjs --auto-lines store.mjs:<n>`.
Expected: check passes; the mutate run prints its mutants as killed or survived and the new last line.

- [ ] **Step 5: Commit**

```bash
git add mutate.mjs automut-ignore.txt check.mjs
git commit -m "mutate.mjs: --auto and --auto-lines run automatic mutants; stillborn and ignored ones counted apart"
```

### Task 6: check.mjs gates the changed lines

**Files:**
- Modify: `check.mjs` (steps 5 and 6, ~lines 106-127; the header comment's list)

**Interfaces:**
- Consumes: `--auto-lines` from Task 5.

- [ ] **Step 1: Write the check first**

Inline assert on a helper `autoArg(touchedByFile: Map<string, Set<number>>): string` that builds the `--auto-lines` value:

```js
assert.equal(autoArg(new Map([['a.mjs', new Set([3, 4])], ['b.mjs', new Set([11])]])), 'a.mjs:3,4;b.mjs:11');
```

- [ ] **Step 2: Run it to see it fail**

Run: `node check.mjs`. Expected: fails, `autoArg` not defined.

- [ ] **Step 3: Implement**

After the hand mutants on the changed lines, unless `--no-auto` is given: count the automatic mutants on the changed lines of the table's source files, print `     N automatic mutant(s) on the changed lines ...`, run `mutate.mjs --auto-lines <autoArg(...)>`, and fail the step on any `SURVIVED`, `TIMED OUT` or `MUTATION DID NOT APPLY` line. Update the header comment's numbered list.

- [ ] **Step 4: Run it on a real edit**

Change one comparison in `store.mjs` in the working tree (no commit), run `node check.mjs`, then revert the edit.
Expected: the automatic step runs and reports; with the edit reverted, `check passed`.

- [ ] **Step 5: Commit**

```bash
git add check.mjs
git commit -m "check.mjs: the automatic mutants on the changed lines must die; --no-auto skips them"
```

### Task 7: The automatic mutants on GitHub

**Files:**
- Modify: `.github/workflows/mutate.yml` (a `workflow_dispatch` input `auto`, boolean, default false; the shard step)
- Modify: `CONTRIBUTING.md` (the mutate bullet, `check.mjs` bullet, Releasing step 4)

**Interfaces:**
- Consumes: `--auto` from Task 5. `.github/plan-mutants.mjs` needs no change: a run by hand already gets every machine and `changed` empty.

- [ ] **Step 1: Wire the input**

The shard step gets `AUTO: ${{ inputs.auto && '1' || '' }}` in its `env` and runs `node mutate.mjs --shard i/n ${AUTO:+--auto} ...`; a push has no inputs, so `AUTO` is empty there.

- [ ] **Step 2: Update CONTRIBUTING**

The mutate bullet describes `--auto`, `--auto-lines`, `STILLBORN`, `automut-ignore.txt`; the `check.mjs` bullet adds the automatic step and `--no-auto`; Releasing step 4 adds "with `auto` on, once the first triage (Task 8) is done".

- [ ] **Step 3: Verify on GitHub**

Run: `node check.mjs`, commit, push, then `gh workflow run mutate.yml --ref master -f auto=true`.
Expected: 17 shards run; the log's last lines give killed, survived, stillborn and ignored counts. The run may fail on survivors: that is Task 8's input.

- [ ] **Step 4: Commit** (before Step 3's push)

```bash
git add .github/workflows/mutate.yml CONTRIBUTING.md
git commit -m "mutate workflow: an auto input runs the automatic mutants on 17 machines"
```

### Task 8: The first full run, triaged

**Files:**
- Modify: the suites (`*.test.mjs`) that need a test, `automut-ignore.txt`

- [ ] **Step 1: Collect the survivors**

From Task 7's run: `gh run view <id> --log | grep SURVIVED`, grouped by source file, files ordered by survivor count, largest first. Record the totals (mutants, killed, survived, stillborn) in the handoff note.

- [ ] **Step 2: Checkpoint**

A file with more than 60 survivors: stop and report the counts per file to KIRE before triaging it.

- [ ] **Step 3: Triage one file**

For each survivor: run it alone (`node mutate.mjs --auto-lines <file>:<line>`) to confirm; then either write a test in that file's suite that fails on the mutant (watch it fail, then pass on the real code), or add `<id> <reason>` to `automut-ignore.txt` when no test could tell it from the real code. A bug in the code found this way is fixed in its own commit with a test and a hand mutant, as in the bug hunt.

- [ ] **Step 4: Verify the file**

Run: `node mutate.mjs --auto-lines <file>:<all its lines>` (or `--auto` with the file's group via `--changed <file>`).
Expected: no survivor in that file.

- [ ] **Step 5: Commit, one per file**

```bash
git add <file>.test.mjs automut-ignore.txt
git commit -m "<file>: tests for the automatic mutants that lived; harmless ones listed with why"
```

- [ ] **Step 6: The gate**

When every file is done: `gh workflow run mutate.yml --ref master -f auto=true`. Expected: success, no survivor.

### Task 9: The fuzz as generated steps, shrunk failures, and the whole story

**Files:**
- Modify: `fuzz.mjs`

**Interfaces:**
- Produces (every later fuzz task adds step types and rules through these):
  - `generate(seed: number): { steps: Step[], meta: object }`, all randomness spent here.
  - `execute(steps: Step[], meta: object): Promise<{ found: string[], story: string[] }>`
  - `kindOf(problem: string): string`: numbers, ids and marks replaced by `#` (`/ASK\w+|OLD\w+|ZQX\w+|[0-9a-f]{6,}|\d+/g`).
  - `shrink(steps: Step[], meta: object, kind: string, { replays = 200, ms = 120_000 } = {}): Promise<Step[]>`
  - `shrinkWith(exec: (steps) => Promise<string[]>, steps: Step[], kind: string, opts): Promise<Step[]>`: the core of `shrink`, given an executor (the self-check passes a fake one).
  - `Step` is `{ type, ... }` with today's types: `note`, `index`, `old`, `session`, `turn`, `stop`, `stops` (several at once), `gate`, `cli`, `forgetKey`, `settle`.

- [ ] **Step 1: Write the self-checks**

Run at start, before any round:

```js
assert.equal(kindOf('ASK123f0n4 is in handoff.md 0 times'), '# is in handoff.md # times');
// shrink keeps a step list only while the same kind fails (a fake executor: fails when steps 2 and 5 are both there)
assert.deepEqual((await shrinkWith(fakeExec, [0, 1, 2, 3, 4, 5, 6], 'boom')).sort(), [2, 5]);
```

`shrinkWith(exec, steps, kind)` is the core `shrink` uses, taking an executor.

- [ ] **Step 2: Run it to see it fail**

Run: `node fuzz.mjs 5`. Expected: fails, `kindOf` not defined.

- [ ] **Step 3: Implement**

Move every `r()` call into `generate`; `execute` does what `round` does today with the decided content. On a failing round (not `--keep-going`, not `--no-shrink`): `shrink`, then print `shrunk to N of M steps:` and the shrunk round's story. With `--keep-going`: print each failing round's problems and its story, up to 60 lines. When `GITHUB_STEP_SUMMARY` is set, append `- seed N: <first problem>` per failing round.

- [ ] **Step 4: Run it**

Run: `node fuzz.mjs 60`; then in a scratch copy of the repo apply the hand mutant `a forgotten exchange read again goes back into handoff.md` (its pair in `mutate.mjs`) to `handoff-log.mjs` and run `node fuzz.mjs 120` there.
Expected: 60 s holds here; the scratch copy fails and prints `shrunk to N of M steps:` with N under 10 and the forget-by-key step among them.

- [ ] **Step 5: Commit**

```bash
git add fuzz.mjs
git commit -m "fuzz: a round as generated steps; a failure shrunk to the steps that matter; the story from --keep-going too"
```

### Task 10: The fuzz reaches the compaction gate and the nudge

**Files:**
- Modify: `fuzz.mjs`

**Interfaces:**
- Consumes: `MODEL_WINDOW`, `WINDOW`, `TRIGGER` exported by `compact-gate.mjs`; Task 9's step types.

- [ ] **Step 1: Write the rules first**

Rules, as `problems.push` lines: gate exit code expected from the step's size and mid-turn state (`2` exactly when `trigger === 'auto'`, mid-turn, `size >= 200_000` and `size < 0.9 * MODEL_WINDOW`); a `**cut mid-turn**` note in handoff.md after a gate over 90% on a cut turn, naming every launch id not yet done; no such note for a conversation whose turn has ended and stopped since; a nudge (the Stop's stdout `additionalContext` with the nudge tag) at most once per conversation between dips under `TRIGGER * WINDOW`, never in a `<private-session>` conversation, and on the first Stop of a plain turn past it.

- [ ] **Step 2: Run against today's generator**

Run: `node fuzz.mjs 30`. Expected: holds (nothing reaches the new rules yet).

- [ ] **Step 3: Generate it**

Each reply's `usage.input_tokens` from `[1_000, 199_000, 500_000, Math.ceil(TRIGGER * WINDOW) + 1_000, Math.ceil(0.95 * MODEL_WINDOW)]`, sizes only growing within a cycle and falling back after a gate that let a compaction through; 20% of turns cut mid-way (last record an assistant `tool_use` with `stop_reason: 'tool_use'`, no answer), forget turns among them as often as others, half of those after a background launch whose result text matches the gate's `LAUNCH` pattern, with a later `<task-id>` notice; after a cut turn the gate runs 70% of the time, with the size over 90% in 40% of those; hook runs get an env without `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`, `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`.

- [ ] **Step 4: Run it, and put F1 back**

Run: `node fuzz.mjs 120`; `node coverage.mjs --fuzz 60`; then in a scratch copy reverse `76ff9c1`'s change to `compact-gate.mjs` and run `node fuzz.mjs 300` there.
Expected: holds here; `compact-gate.mjs` at least 80%; the scratch copy fails within 5 minutes on this PC with private text in handoff.md. If it doesn't, raise the rates of cut forget turns and gates after them, not the minutes.

- [ ] **Step 5: Commit**

```bash
git add fuzz.mjs
git commit -m "fuzz: reply sizes and turns cut mid-way reach the gate's deferral, its note and the nudge"
```

### Task 11: Daylight saving, the year's end, and collisions

**Files:**
- Modify: `fuzz.mjs`

**Interfaces:**
- Produces: `const INSTANTS = [{ at: '2026-10-30T08:00:00Z' }, { at: '2026-10-25T00:20:00Z', zone: 'Europe/Berlin' }, { at: '2026-11-01T08:20:00Z', zone: 'America/Los_Angeles' }, { at: '2026-03-29T00:20:00Z', zone: 'Europe/Berlin' }, { at: '2026-03-08T09:20:00Z', zone: 'America/Los_Angeles' }, { at: '2026-04-04T13:20:00Z', zone: 'Pacific/Chatham' }, { at: '2026-09-26T13:20:00Z', zone: 'Pacific/Chatham' }, { at: '2026-12-31T23:20:00Z' }]` (a `zone` marks a daylight-saving change 40 minutes after `at`).

- [ ] **Step 1: Write the start-up check**

For each instant with a `zone`: the zone's UTC offset (from `Intl.DateTimeFormat(..., { timeZone, timeZoneName: 'longOffset' })`) at `at + 39 min` differs from `at + 41 min`; otherwise exit 1 with `fuzz: <at> is no daylight-saving change in <zone>: the instant list is wrong`.

- [ ] **Step 2: Run it**

Run: `node fuzz.mjs 5`. Expected: passes the check (if one fails, fix the instant, not the check).

- [ ] **Step 3: Generate it**

The round's clock starts at a picked instant; turns 1 to 40 minutes apart (1 to 90 from the default instant, as today). With a 20% chance a turn's time is searched minute by minute up to 24 hours ahead for one whose local minute in its Stop's zone equals an earlier turn's local minute in that turn's Stop's zone (another zone first); the story says `collides with <mark>`. In a round with a collision, the forget-by-key step picks a turn another collides with half the time, and the Stops after it use the colliding turn's zone half the time: coincidences are what this is for.

- [ ] **Step 4: Run it, and put F5 back**

Run: `node fuzz.mjs 120`; then in the scratch copy with `c59deeb` reversed, `node fuzz.mjs 300`.
Expected: holds here; the scratch copy fails within 5 minutes.

- [ ] **Step 5: Commit**

```bash
git add fuzz.mjs
git commit -m "fuzz: rounds across daylight-saving changes and the year's end; turns placed to collide by minute"
```

### Task 12: Disk faults and killed hooks

**Files:**
- Create: `fuzz-faults.cjs`
- Modify: `fuzz.mjs`

**Interfaces:**
- Produces: `FUZZ_FAULTS=<seed>:<rate>:<root>` read by `fuzz-faults.cjs` at load; it wraps `openSync`, `readFileSync`, `writeFileSync`, `appendFileSync`, `renameSync`, `unlinkSync`, `mkdirSync`, `rmdirSync`, `rmSync`, `readdirSync` of `node:fs`, then calls `require('node:module').syncBuiltinESMExports()`. A call fails when its first path argument resolves under `root` and the seeded stream (mulberry32 from `seed`, one draw per wrapped call) is under `rate`: with `EBUSY`, `EPERM` or `EACCES`, and for writes also `ENOSPC`, as an `Error` with that `code`.

- [ ] **Step 1: Write the start-up check**

`faults stay under their root`: spawn `node --require fuzz-faults.cjs -e "<write a file in a temp root, then one outside it>"` with rate 1. Expected: the write under the root throws one of the four codes; the write outside succeeds; the plugin's `.mjs` files still import (`await import('./store.mjs')` in the same script).

- [ ] **Step 2: Run it to see it fail**

Run: `node fuzz.mjs 5`. Expected: fails, `fuzz-faults.cjs` missing.

- [ ] **Step 3: Implement the preload and the steps**

`fuzz-faults.cjs` as in Interfaces. In `fuzz.mjs`: 15% of Stop, gate and CLI runs are faulted (`--require <repo>/fuzz-faults.cjs` and `FUZZ_FAULTS`, seed from the round and the step, rate from `[0.02, 0.1, 0.3]`), never the forget-by-key step nor the settling Stops; 10% of Stops are killed after 5 to 300 ms (`child.kill()`), then every `.lock` under the fuzz home is dated `LOCK_STALE + 1000` ms back (`LOCK_STALE` imported from `store.mjs`). Rules: a faulted hook exits 0 (the gate 0 or 2), a faulted command 0 or 1, and none prints a stack trace; no secret in its output; no note changed; after settling, no `.handoff-failed-*` and no `journal/.failed`; no `*.tmp<digits>` file named in `MEMORY.md` or in `status`'s output.

- [ ] **Step 4: Run it**

Run: `node fuzz.mjs 120`.
Expected: holds. A failure is a finding: replay it, and decide with the spec's anti-goals whether it is a bug (fix it in its own commit) or a rule the design breaks (bring it to KIRE).

- [ ] **Step 5: Commit**

```bash
git add fuzz-faults.cjs fuzz.mjs
git commit -m "fuzz: disk faults from a preload under the fuzz home only, and Stops killed mid-way"
```

### Task 13: Queued messages, memory-off, the journal's import, and secret shapes

**Files:**
- Modify: `fuzz.mjs`

**Interfaces:**
- Consumes: `queuedText()`, `off()` and the redaction patterns in `handoff-log.mjs` (read them for the record shape, the mark and the shapes).

- [ ] **Step 1: Tighten the import rule first**

The `old` marks' rule becomes "in the journal exactly once" (unless private).

- [ ] **Step 2: Run it to see it fail**

Run: `node fuzz.mjs 60`. Expected: fails with `OLD... is in the journal 0 times`, which is today's gap.

- [ ] **Step 3: Generate it**

Make the older conversation one the journal's import takes in (find why `importOne` never runs today: `candidates()`, `ours()` and `due()` in `journal.mjs`). Add queued messages mid-turn (string or blocks; 30% with `<private>` text registered as a secret). Turn 10% of conversations off the way the plugin marks memory-off, mid-way; rule as `off()` and the docs define it. One secret per shape the redaction knows, built from pieces at run time and registered; beside them near-misses (`process.env.API_KEY`, `user.password`, `correct_horse_battery_staple`) with no rule but no crash.

- [ ] **Step 4: Run it**

Run: `node fuzz.mjs 120`; `node coverage.mjs --fuzz 60`.
Expected: holds; `importOne`, `queuedText`, `off` and the `code` rule no longer listed as never run.

- [ ] **Step 5: Commit**

```bash
git add fuzz.mjs
git commit -m "fuzz: queued messages, memory-off conversations, the journal's import exactly once, every secret shape"
```

### Task 14: More of the CLI, and the briefing

**Files:**
- Modify: `fuzz.mjs`

**Interfaces:**
- Consumes: `memory.mjs help` for the syntax of `history`, `restore`, `promote`, `doctor`; the briefing's size limit in `handoff-log.mjs`.

- [ ] **Step 1: Write the rules first**

After `restore`, the note's text equals one of the texts the round gave it; after `promote`, `projects/_shared/memory` has the note once and one index line for it; every command exits 0 or 1, no stack, no secret; the briefing is within its limit and holds the newest plain exchange of the last conversation when handoff.md lists it.

- [ ] **Step 2: Generate it**

A step that edits a note between Stops (the round records each text); then `history <note>`, `restore <note> ... --yes`, `promote <note> --yes`, `doctor`, each once per round with a 40% chance.

- [ ] **Step 3: Run it**

Run: `node fuzz.mjs 120`; `node coverage.mjs --fuzz 60`.
Expected: holds; `memory.mjs` at least 70%.

- [ ] **Step 4: Commit**

```bash
git add fuzz.mjs
git commit -m "fuzz: history, restore, promote and doctor; the briefing's size and newest exchange"
```

### Task 15: The fuzz workflow: the right machines, kept failures, and the acceptance run

**Files:**
- Modify: `.github/workflows/fuzz.yml`
- Modify: `CONTRIBUTING.md` (the fuzz bullet)

**Interfaces:**
- Consumes: `actions/upload-artifact` major from Task 1.

- [ ] **Step 1: The split**

The plan job's list: for `n` machines, `mac = n >= 3 ? 2 : 0`, `win = Math.ceil(n / 6)`, the rest `ubuntu-latest`; macOS and Windows first in the list. For 17: 2, 3, 12.

- [ ] **Step 2: Keep failures**

The fuzz step sets `FUZZ_KEEP: ${{ runner.temp }}/fuzz-kept`; a following step `if: failure()` uploads that folder as `fuzz-kept-${{ matrix.shard }}`.

- [ ] **Step 3: CONTRIBUTING**

The fuzz bullet lists the new steps (sizes and cut turns, instants and collisions, faults and kills, queued messages, memory-off, import, secret shapes, more CLI, the briefing), shrinking, `--no-shrink`, the machine split and the artifact.

- [ ] **Step 4: The acceptance run**

Run: `node check.mjs`, commit, push, `gh workflow run fuzz.yml --ref master -f machines=17 -f seconds=600`.
Expected: success, at least 9,000 rounds, no macOS job waiting for a slot (job start times within a minute of the plan job).

- [ ] **Step 5: Commit** (before Step 4's push)

```bash
git add .github/workflows/fuzz.yml CONTRIBUTING.md
git commit -m "fuzz workflow: 12 Linux, 3 Windows, 2 macOS; a failing round's files kept as an artifact"
```

### Task 16: memory-tier's suite in-process

**Files:**
- Modify: `memory-tier.mjs` (the entry code, ~lines 44-50 and 492-643)
- Modify: `harness.mjs` (add `capture`)
- Modify: `memory.test.mjs` (use `capture`), `memory-tier.test.mjs`
- Modify: `mutate.mjs` (mutants whose find-text moved)

**Interfaces:**
- Produces:
  - `export async function main(argv: string[], input?: string): Promise<number>` in `memory-tier.mjs`; the file's entry becomes `process.exitCode = await main(process.argv.slice(2), <stdin text when argv has --stop>)`, the same guard as `memory.mjs`.
  - `export async function capture(fn: () => unknown): Promise<{ out: string, value: unknown }>` in `harness.mjs`: `console.log` captured through `util.format`, then a UTF-8 round trip.

- [ ] **Step 1: Measure before**

Run: `node memory-tier.test.mjs --mutant` three times. Record the median.

- [ ] **Step 2: Write the test first**

In `memory-tier.test.mjs`: `two in-process calls match two processes`: `--dry-run` on the same store, twice through `main` and once through `spawnSync`, then a `--stop` through each; the outputs equal and the store ends the same.

- [ ] **Step 3: Run it to see it fail**

Run: `node memory-tier.test.mjs --mutant`. Expected: fails, `main` not exported.

- [ ] **Step 4: Implement**

Move `dry`, `PAUSE`, `now`, `stop`, the `--dir` handling and the stdin reads into `main`; every `process.exit(n)` becomes `return n` (the nudge path returns after its write completes); reset any module-level state at `main`'s start. The suite's helpers call `main` through `capture`, except for `--pause`, two Stops at once, the run through a symlink, the busy preload Stop, and checks of how the process exits. `memory.test.mjs`'s `run()` uses `capture`. Fix the mutants `check.mjs` reports as not applying.

- [ ] **Step 5: Verify**

Run: `node check.mjs`; `node mutate.mjs --changed memory-tier.mjs`; `node memory-tier.test.mjs --mutant` three times.
Expected: all pass; the median is at most 60% of Step 1's.

- [ ] **Step 6: Commit**

```bash
git add memory-tier.mjs harness.mjs memory.test.mjs memory-tier.test.mjs mutate.mjs
git commit -m "memory-tier: main() in-process for the suite, as memory.mjs; output captured in harness.mjs"
```
