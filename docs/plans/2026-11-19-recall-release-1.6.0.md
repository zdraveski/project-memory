# project-memory 1.6.0, the recall release: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. One agent builds, in
> one session, with one review per PR. The house rule "proportionate process" overrides
> subagent-driven development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved memory get read: measure its use, show with numbers that it helps, bring
recall to the moments where it pays, and close the holes a new user would fall into.

**Architecture:** The work stays in the existing files: the CLI in `memory.mjs`, the conversation
reader in `handoff-log.mjs`, the journal in `journal.mjs`, the save after a reply in
`memory-tier.mjs`. Three new files: `recall-eval.mjs` (a developer tool like `bench.mjs`),
`recall-error.mjs` (one small fail-open hook, built only if its gate passes) and
`docs/limitations.md`. A journal entry is built from the conversation file only, so a backfill
gives the same entry as the live save.

**Tech Stack:** Node 22+, ES modules, no dependencies, no network. Tests are plain `*.test.mjs`
files run with `node`. The `claude` CLI (2.1.269 or newer) is used by the evals only.

**Spec:** `docs/specs/2026-11-19-recall-release-1.6.0-design.md`. Read it whole before task 1.
"Spec 3a" below points into it. The design is decided, do not reopen it. Where a task says "read
first", what is found can change a detail: then the spec is corrected in the same PR.

## Global Constraints

- Node 22 or newer. No network. No dependencies.
- The journal comes from the conversation file only: no item reads a plan file or any other file
  from disk to build an entry.
- A hook fails open: on any error, timeout or unknown input it prints nothing and exits 0.
- A hook never puts saved text into the conversation: a date and a key, nothing else.
- Every new message is plain words. A message that reports a problem ends with `Next:` and one
  step. Every new message is pinned by a test with the exact text from the spec.
- Test fixtures are made up. A real conversation file is read to learn its shape, never copied.
- Every new delete lists first, deletes only with `--yes`, and never deletes a conversation file.
- `Plan` is the last field of a journal entry. The entry marker (`<!-- j:... -->`) is not changed.
- Every `claude plugin eval` run passes `--no-publish`.
- Limits, copied from the spec: a plan 50,000 characters (`J_TEXT`), a path 300 (`J_PATH`); memory
  use 7 days; error signature 300 then 120 characters, ignored under 20, journal look-back 90 days;
  format check: newest file over 20 KB, last 2 MB, at least 5 records of a kind.
- House rules: `git commit -s`, explicit paths in `git add`, `node check.mjs` green before each
  push, no work in `~/.claude/hooks` or `~/.claude/hooks-live`, no mutation or fuzz run on GitHub
  unless KIRE says run, a PR is done only when CI is green on the three systems, merging and
  releasing need KIRE's word.

## Review Focus

Each line is pinned by a test in the task named.

1. **A forgotten entry comes back after `erase`.** `erase` must keep the forget list, or the next
   save rebuilds the forgotten entry from the conversation file. Task 9.
2. **`forget` misses a word that is only in a plan.** The user pasted a password into a plan, asks
   to forget it, and the entry is not found. Task 5.
3. **The hook's error text and the saved journal tail end differently**, so the live hook never
   matches what the replay matched. Task 10.
4. **A project on an unplugged drive is listed as dead** and its memory is deleted. Task 8.
5. **A new user with months of old conversations never gets the welcome**, because the first save
   imports old days before the "new computer" check runs. Task 12.

## PRs

| PR | Task | Branch | Spec |
|---|---|---|---|
| 1 | Memory use in `status` and `doctor` | `1.6.0-memory-use` | 1 |
| 2 | Eval suite | `1.6.0-evals` | 2 |
| 3 | Relative dates | `1.6.0-relative-dates` | 3a |
| 4 | Search filters | `1.6.0-search-filters` | 3b |
| 5 | Approved plans | `1.6.0-plans` | 4a |
| 6 | MCP writes, Code Mode, rewound turns | `1.6.0-other-writes` | 4b |
| 7 | Format check and Claude Code versions | `1.6.0-format-check` | 6 |
| 8 | `clean` for dead stores | `1.6.0-clean` | 8 |
| 9 | `erase` | `1.6.0-erase` | 7d |
| 10 | Error recall, after its gate (task 10a) | `1.6.0-error-recall` | 5 |
| 11 | Plain-word messages | `1.6.0-plain-words` | 7b |
| 12 | Welcome line and `docs/limitations.md` | `1.6.0-welcome` | 7a, 7c |
| 13 | Release | `1.6.0-release` | Release |

The order is fixed: 9 uses helpers from 8; 11 rewords what 1 to 10 added; 12 writes down what 6 and
10 found. If KIRE asks for fewer PRs, 3+4, 5+6 and 8+9 can each go as one.

## Before task 1

- [ ] Read `reports/RESUME-1.6.0.md` in KIRE's project folder, then the spec, then this plan.
- [ ] Check the weekly usage (the command is in the RESUME). At 97% or more: save state, start nothing.
- [ ] Claim the topic at the top of the project's `handoff.md`.
- [ ] Clone `https://github.com/zdraveski/project-memory` fresh into this session's scratchpad.
      Run `node check.mjs` once to see it green before any change.

## The loop for every PR

1. Branch from `master` (or from the previous branch when earlier PRs are not merged yet; then
   retarget this PR to `master` before the parent merges with `--delete-branch`).
2. Tests first, then the code. `node <suite>.test.mjs` for the suite in hand, `node check.mjs`
   before each push.
3. Grep the callers of every function whose behavior changes.
4. When a source line changes that a hand mutant finds by its text, fix the find-text in
   `mutants/*.mjs` in the same commit. Grep the old text there. Do not start a mutation run.
5. `git add <paths>`, `git commit -s`, one change per commit, the attribution line last.
6. Push, open the PR, `gh run watch <id> --exit-status --interval 30`.
7. One review of the PR's diff (`/ponytail:ponytail-review`), fix what it finds.
8. Merge with a merge commit only when the RESUME says KIRE gave the word. Then delete the branch.
9. One line in the RESUME's log, with the local time (`date +%H:%M`).

---

### Task 1: Memory use in `status` and `doctor`

**Files:**
- Modify: `memory.mjs` (new `use` and `useLine` next to `status`, line 407; `status` and `doctor` call them)
- Modify: `skills/memory/SKILL.md` (the `status` row names the line)
- Test: `memory.test.mjs`

**Interfaces:**
- Produces: `use(dir, { now = Date.now() } = {}) -> { searches, opened, notes, used, conversations }`
  (all numbers) and `useLine(u) -> string`.

**Read first:** `commandsOf` and `tally` in `enforce.mjs` (they already read shell commands out of
conversation files in pieces) and `chunk` in `journal.mjs`. Reuse one of them.

- [ ] **Step 1: Write the failing tests.** A temp project with four conversation files: A holds
  one `Bash` call whose command runs `memory.mjs search` twice and `memory.mjs" show` once, one
  `Read` of `<store>/journal/2026-11-18.md`, and one `memory.mjs search` in a record dated 9 days
  before `now`; B holds a `PowerShell` call with one `memory.mjs' search` and a `Read` of
  `<store>/feedback-x.md`; C holds a prompt and a reply only; D is like B but its file time is 10
  days before `now`.

```js
const u = use(store, { now });
ok(u.searches === 3 && u.opened === 2 && u.notes === 1, 'two searches in one command count twice; a journal day read is an entry opened');
ok(u.used === 2 && u.conversations === 3, 'the old file and the old record are not counted');
ok(useLine(u) === 'memory use, last 7 days: 3 searches, 2 entries opened, 1 note read, in 2 of 3 conversations');
ok(useLine({ searches: 1, opened: 1, notes: 1, used: 1, conversations: 1 }) === 'memory use, last 7 days: 1 search, 1 entry opened, 1 note read, in 1 of 1 conversation');
ok(useLine({ searches: 0, opened: 0, notes: 0, used: 0, conversations: 9 }) === 'memory use, last 7 days: none in 9 conversations');
ok(useLine({ searches: 0, opened: 0, notes: 0, used: 0, conversations: 0 }) === 'memory use, last 7 days: no conversations');
r = await cli('status'); ok(/^memory use, last 7 days: /m.test(r.stdout));
r = await cli('doctor'); ok(/^note +memory use, last 7 days: /m.test(r.stdout));
```

  Also: a `Read` of a shared-store note counts as a note read; a `ctx_execute` whose `code` holds
  `memory.mjs search` counts; a conversation file with a broken last line does not throw.

- [ ] **Step 2:** Run `node memory.test.mjs`. It fails at the first new check.
- [ ] **Step 3: Implement `use` and `useLine`.** Count per spec 1: a search or `show` is each match
  of `/memory\.mjs["']?\s+(search|show)\b/g` in a shell command; parse only lines that hold
  `memory.mjs`, or `"name":"Read"` together with `memory`. Compare paths with slashes normalized
  and, on Windows, without letter case.
- [ ] **Step 4:** Add the line as the last line of each project's `status` block and as a `'note'`
  in `doctor`. Run the suite: green.
- [ ] **Step 5: Measure.** Time `node memory.mjs status` on the largest project of this PC before
  and after. More than 2 seconds slower: add the per-file cache from spec 1 with its own test.
  Put both times in the PR body.
- [ ] **Step 6:** Commit, push, PR.

### Task 2: Eval suite

**Files:**
- Create: `evals/<case>/prompt.md` and `evals/<case>/graders/skill.md` for the four cases of spec 2a
- Create: `recall-eval.mjs`, `recall-eval.test.mjs`, `evals/answers/cases.json`
- Modify: `.gitignore` (`evals/results/`), `CONTRIBUTING.md` (how to run both, what it costs)
- Modify: whatever lists the suites (`check.mjs`, the CI workflow), so `recall-eval.test.mjs` runs
  like the other suites. `mutate.mjs` is not extended: this is a developer tool.

**Interfaces:**
- Produces, exported from `recall-eval.mjs`:
  `seed(day) -> [{ day, asked, answered, changed, ran }]`,
  `grade(c, answer) -> boolean` with `c = { name, question, pattern, flags?, absent? }`,
  `searched(events) -> boolean`, `answerOf(events) -> { text, cost, turns, session }`,
  `table(rows) -> string`. `events` are the parsed lines of `--output-format stream-json`.

**Read first:** `claude plugin eval --help` and the official "plugin evals" page (ask the
claude-code-guide agent); the note `project-recall-test-method.md` in the project's memory folder;
`record` and `write` in `journal.mjs`; how `bench.mjs` is treated by `deploy.mjs` and the release
archive (treat `recall-eval.mjs` the same).

- [ ] **Step 1: Spike, before any code.** Check the weekly usage. Create only
  `evals/asks-about-last-week/` and run:
  `claude plugin eval . --no-publish --trust-plugin --case asks-about-last-week --runs 1 --model sonnet --max-cost-usd 0.50 --json <scratchpad>/spike.json`.
  Write three answers into the PR body: did it run on Windows without a shell grant (the exact
  refusal if not), did the memory skill load, what did it cost. If it is refused here too, the four
  cases still ship (they run on Linux and macOS), and the README will say they were not run on
  Windows.
- [ ] **Step 2: Write the failing tests** in `recall-eval.test.mjs`:

```js
ok(grade({ pattern: '4317' }, 'We picked port 4317 because 3000 was taken.'));
ok(!grade({ pattern: '4317' }, ''));
ok(grade({ pattern: 'UTC|time ?zone', flags: 'i' }, 'closeDay used utc.'));
ok(grade({ pattern: 'Stripe|PayPal|Adyen|Braintree|Mollie', flags: 'i', absent: true }, 'We never chose one.'));
ok(!grade({ pattern: 'Stripe|PayPal|Adyen|Braintree|Mollie', flags: 'i', absent: true }, 'Probably Stripe.'));
ok(seed('2026-11-19').map((e) => e.day).join() === '2026-11-17,2026-11-11,2026-11-11,2026-11-14,2026-10-30');
ok(seed('2026-11-16').map((e) => e.day)[1] === '2026-11-11', 'on a Monday the previous week is still 9 to 15 November');
ok(searched([toolUse('Bash', { command: 'node "x/memory.mjs" search port' })]));
ok(searched([toolUse('Skill', { skill: 'project-memory:memory' })]));
ok(searched([toolUse('Read', { file_path: 'C:/p/memory/journal/2026-11-17.md' })]));
ok(!searched([toolUse('Read', { file_path: 'C:/p/src/app.js' })]));
ok(JSON.parse(readFileSync('evals/answers/cases.json', 'utf8')).length === 6);
```

  Also: `answerOf` reads `result`, `total_cost_usd`, `num_turns` and the session id from made-up
  stream lines; `table` prints one row per case with the columns case, with, without, searched,
  cost; `node recall-eval.mjs --self-check` exits 0 and starts no session.

- [ ] **Step 3:** Run it: fails. Implement the five functions and `cases.json` with the six cases
  and the seeded entries of spec 2b, word for word.
- [ ] **Step 4: Implement the run** (spec 2b, steps 1 to 7): one temp project per session; seed
  through the journal's writer; `--plugin-dir` and the `--settings` file; 4 sessions at a time;
  stop at `--max-usd` with exit 2; clean up in a `finally`. Refuse a project folder outside
  `os.tmpdir()`. Before the first paid session, run `memory.mjs search port --store <dir>` on one
  seeded store and stop with an error if it finds nothing.
- [ ] **Step 5: One paid check.** `node recall-eval.mjs --plugin . --case port --runs 1`. Confirm:
  the "with" answer holds 4317, the seeded entries are still in the store after the session's own
  save, the clean-up left no `memory` folder, the cost. From the cost, set the `--runs` the full run
  can afford under 10 USD (3, else 2, else 1) and write it into `CONTRIBUTING.md`.
- [ ] **Step 6: Write the four trigger cases** with the frontmatter and grader of spec 2a. Grader
  patterns in single quotes, no backslashes.
- [ ] **Step 7:** `.gitignore`, `CONTRIBUTING.md`. Commit, push, PR. The full runs and the README
  numbers belong to task 13.

### Task 3: Relative dates

**Files:**
- Modify: the file that holds `isDay` (grep it) for `dayOf`; `memory.mjs` (the `--since`/`--until`
  check, `USAGE` at line 6); `skills/memory/SKILL.md`
- Test: the suite of the file that holds `dayOf`, and `memory.test.mjs`

**Interfaces:**
- Produces: `dayOf(word, today = local().slice(0, 10), end = false) -> 'YYYY-MM-DD' | null`.
  Task 4 and task 10 use it.

- [ ] **Step 1: Write the failing tests.**

```js
const T = '2026-11-19';                                  // a Thursday
ok(dayOf('2026-10-01', T) === '2026-10-01');
ok(dayOf('today', T) === T && dayOf('0d', T) === T);
ok(dayOf('yesterday', T) === '2026-11-18');
ok(dayOf('7d', T) === '2026-11-12' && dayOf('2w', T) === '2026-11-05');
ok(dayOf('last-week', T) === '2026-11-09' && dayOf('last-week', T, true) === '2026-11-15');
ok(dayOf('last-week', '2026-11-16') === '2026-11-09', 'on a Monday');
ok(dayOf('last-week', '2026-11-15') === '2026-11-02' && dayOf('last-week', '2026-11-15', true) === '2026-11-08', 'on a Sunday');
ok(dayOf('1d', '2026-03-30') === '2026-03-29', 'the day after the clock change');
ok(dayOf('1d', '2026-03-01') === '2026-02-28' && dayOf('1d', '2028-03-01') === '2028-02-29');
ok(dayOf('LAST-WEEK', T) === '2026-11-09' && dayOf('Yesterday', T) === '2026-11-18');
for (const bad of ['', '7', 'd', '-1d', '1.5d', '7 d', '3651d', '0w', '521w', 'last week', 'tomorrow', '2026-02-30'])
  ok(dayOf(bad, T) === null, bad);
```

  CLI: `search --since 7d` gives the hits `search --since <that date>` gives, with the first line
  `since <date> (7d)`; with both words the first line is
  `since <date> (last-week), until <date> (last-week)`; a date prints no such line;
  `search --since soon` prints
  `--since takes a date like 2026-10-01, or 7d, 2w, today, yesterday, last-week` and exits 1 (the
  same text with `--until`); `forget --since 1d` prints the `since` line before its list and deletes
  nothing without `--yes`.

- [ ] **Step 2:** Run both suites: fail.
- [ ] **Step 3: Implement `dayOf`** on calendar dates (`Date.UTC` of the three numbers, minus
  days), never on local hours. A date is accepted only when `isDay` accepts it.
- [ ] **Step 4:** Resolve `--since` (with `end = false`) and `--until` (with `end = true`) once,
  where the options are checked today, so every command that takes them gets the dates. Print the
  resolved line. Update `USAGE` and the skill's table with one example: "last week" is
  `search <words> --since last-week --until last-week`.
- [ ] **Step 5:** Old tests and hand mutants that match the old "takes a date like" text: update.
  Suites green. Commit, push, PR.

### Task 4: Search filters

**Files:**
- Modify: `memory.mjs` (`valued` at 1092 gets `--project`; `table` at 1106: `search` gets
  `--conversation`, `--notes`, `--journal`; the place where `--store`, `--shared` and `--all` are
  resolved; `search` at 1167 and 1217; `USAGE`); `skills/memory/SKILL.md`
- Test: `memory.test.mjs`

**Interfaces:**
- Produces: `projectStore(name, stores) -> { dir } | { many: [{ cwd, dir }] } | { none: true }`,
  where `stores` is the list `--all` reads.

- [ ] **Step 1: Write the failing tests.** Two projects whose conversations started in `<tmp>/w/app`
  and `<tmp>/w/App-old`, each with a journal entry and a note that hold the word `port`.

```js
ok(projectStore('app', all).dir === appStore, 'the last folder name, whole, wins');
ok(projectStore('APP', all).dir === appStore);
ok(projectStore('old', all).dir === oldStore, 'no folder is named old: any part of the path');
ok(projectStore('w', all).many.length === 2);
ok(projectStore('zzz', all).none === true);
r = await cli('search', 'port', '--project', 'w');
ok(r.code === 1 && /^--project w matches 2 projects:$/m.test(r.stdout) && r.stdout.includes('--store '));
r = await cli('search', 'port', '--project', 'zzz');
ok(r.code === 1 && r.stdout.trim() === '--project zzz matches no project: search --all names them');
for (const o of ['--store', '--shared', '--all']) { /* with --project app */ ok(r.code === 1 && r.stdout.trim() === `--project cannot go with ${o}`); }
r = await cli('search', 'port', '--notes', '--conversation', tag);
ok(r.code === 1 && r.stdout.trim() === '--conversation searches the journal: drop --notes');
```

  Also: `search port --conversation <tag>` lists only that conversation's entries and no note;
  the full session id works where the tag works; `--journal` lists no note; `--notes` lists no
  journal entry; `--notes --journal` equals no option; `status --project app` prints the block of
  that project.

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. `--conversation` reuses the matching
  `forget --conversation` has (line 1226). `--project` resolves only among the stores `--all`
  reads. A start folder is split on both `/` and `\`.
- [ ] **Step 4:** `USAGE`, the skill's table (one example: "in the app project" is
  `search <words> --project app`). Suite green. Commit, push, PR.

### Task 5: Approved plans

**Files:**
- Modify: `handoff-log.mjs` (the turn reader gives `plan`), `journal.mjs` (`FIELDS`, `entryOf` 67,
  `render` 95, `parseDay` 110, `holds` 401), `memory.mjs` (`search` ranking, `show`, `head` 1154),
  `skills/memory/SKILL.md` (the `show` row)
- Test: `handoff-log.test.mjs`, `journal.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces: a turn's `plan` and an entry's `plan`, both a string, `''` when there is none.

- [ ] **Step 1: Get two real samples, before any code.** In the build session, tell KIRE in one
  line: "I'll show a two-line dummy plan twice: approve the first, reject the second." Call
  `EnterPlanMode` and `ExitPlanMode` (deferred tools, load with ToolSearch) twice. Then read this
  session's own conversation file for the `ExitPlanMode` records. If KIRE is away, try
  `claude -p "<a small planning task>" --permission-mode plan --output-format stream-json --verbose --model sonnet`
  in a temp folder first. Write down, shape only, in the PR body: where the plan text is (spec 4a
  gives the three places to look, in order) and what tells an approved plan from a rejected one.
  If the text is in none of the three: no `Plan` line is built, the gap goes to
  `docs/limitations.md` (task 12), and this task ships only the reader that leaves `plan` empty.
- [ ] **Step 2: Write the failing tests,** with made-up fixtures in the shape found.

```js
// journal.test.mjs
const e = { ...base, changed: ['a.js'], ran: ['npm test'], plan: 'Step 1: add a README. Step 2: link it.' };
ok(render(e).endsWith('\n**Plan:** Step 1: add a README. Step 2: link it.'), 'Plan is the last line');
ok(!render({ ...e, plan: '' }).includes('**Plan:**'));
ok(parseDay(render(e))[0].plan === e.plan);
ok(parseDay(render({ ...e, changed: [], ran: [] }))[0].plan === e.plan, 'with no Changed and no Ran');
ok(parseDay(render({ ...e, plan: '' }))[0].plan === '');
ok(holds({ ...e, plan: 'the code word is tangerine' }, 'tangerine'), 'forget finds a word that is only in a plan');
ok(parseDay(V153_REWRITE)[0].plan === e.plan, 'a day file rewritten by 1.5.3 still reads back');
```

  `V153_REWRITE` is made once, by hand: `git show v1.5.3:journal.mjs` into the scratchpad, run its
  `parseDay` then `render` over a new day file that holds a plan and a prose line, paste the output
  into the test.

```js
// handoff-log.test.mjs
ok(turnsOf(approved)[0].plan === 'Step 1: add a README. Step 2: link it.', 'squeezed to one line');
ok(turnsOf(rejected)[0].plan === '' && turnsOf(answeredWithChanges)[0].plan === '');
ok(turnsOf(privateTurn)[0].plan === '');
ok(!turnsOf(withSecret)[0].plan.includes(SECRET), 'redacted like Asked');
ok(turnsOf(huge)[0].plan.length <= 50000);
// memory.test.mjs
r = await cli('search', 'tangerine'); ok(/ · plan approved$/m.test(r.stdout));
r = await cli('show', key);           ok(/^\*\*Plan:\*\* /m.test(r.stdout));
r = await cli('forget', 'tangerine'); ok(r.stdout.includes(key), 'Review Focus 2');
```

  Also: the entry built by the live save and the entry built by `backfill` from the same fixture
  render to the same text; `rescan` finds and redacts a secret that is only in a plan; `incognito`
  sweeps an entry with a plan; a date-only listing ends the entry's line with ` · plan approved`.

- [ ] **Step 3:** Run the three suites: fail.
- [ ] **Step 4: Implement.** Grep every place that lists the four fields (`asked`, `answered`,
  `changed`, `ran`) and decide for each: `FIELDS`, `render`, the `parseDay` pattern, `holds`,
  `entryOf`, the search ranking (rank like `answered`), `show`, `rescan`, anything that copies an
  entry field by field. The plan text passes through the same redact, squeeze and cut as `asked`.
- [ ] **Step 5:** Suites green, `node check.mjs`. Commit (reader, journal, CLI: three commits),
  push, PR.

### Task 6: MCP writes, Code Mode, rewound turns

**Files:**
- Modify: `handoff-log.mjs` (`editedFile`, maybe `ranOf`)
- Test: `handoff-log.test.mjs`

**Interfaces:**
- Consumes: nothing new. Produces: no new name; `editedFile(b)` and `ranOf(b)` read more tools.

- [ ] **Step 1: Write the failing tests for MCP writes.** `NONE` is what `editedFile` gives today
  for a tool it does not know.

```js
ok(editedFile({ name: 'mcp__filesystem__write_file', input: { path: 'C:/w/a.txt', content: 'x' } }) === 'C:/w/a.txt');
ok(editedFile({ name: 'mcp__plugin_a_b__Edit_file', input: { filePath: 'a.txt' } }) === 'a.txt', 'any letter case');
ok(editedFile({ name: 'mcp__notes__save', input: { destination: 'n.md' } }) === 'n.md');
ok(editedFile({ name: 'mcp__filesystem__edit_file', input: { path: 'a.txt', edits: [], dryRun: true } }) === NONE);
ok(editedFile({ name: 'mcp__x__write', input: { path: 'a.txt', dry_run: true } }) === NONE);
ok(editedFile({ name: 'mcp__filesystem__read_file', input: { path: 'a.txt' } }) === NONE);
ok(editedFile({ name: 'mcp__notes__create_note', input: { title: 'x' } }) === NONE, 'no path');
ok(editedFile({ name: 'mcp__x__save', input: { file: { a: 1 } } }) === NONE, 'not a string');
ok(editedFile({ name: 'mcp__x__update_doc', input: { filePath: '' } }) === NONE);
ok(editedFile({ name: 'write_file', input: { path: 'a.txt' } }) === NONE, 'not an MCP tool');
```

  Also: a refused or failed MCP write stays out of `Changed` the way a refused `Edit` does; a path
  of 400 characters is cut at 300.

- [ ] **Step 2:** Run: fail. Implement the rule of spec 4b in `editedFile`. Green. Commit.
- [ ] **Step 3: Code Mode, observe first.** In a temp folder, with
  `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1`:
  `claude -p "List the files here, then write hello.txt with one line." --output-format stream-json --verbose --model sonnet`.
  Read the conversation file. Then one of the three branches of spec 4b, each with its test on a
  made-up fixture of the shape seen: inner calls recorded (pin that `Changed` and `Ran` are
  filled); only `REPL` recorded (`ranOf` reads `input.code`, cut like a command); cannot be turned
  on (nothing built). Note the branch for task 12. Commit.
- [ ] **Step 4: Rewound turns.** Read the shape of the conversation file named in the RESUME
  ("the rewind sample") around the two prompts that share one parent. Build a made-up fixture of
  that shape. Tests:

```js
const ts = turnsOf(rewound);
ok(ts.length === 2, 'the undone exchange and the one that replaced it are both read');
ok(new Set(ts.map(keyOf)).size === 2, 'no entry twice');
```

  and after a save followed by a backfill the day file holds each entry once. Mark the undone
  entry (`**Undone:** rewound <time>`, after `Plan`) only if a record field shows the rewind for
  certain; otherwise note for task 12 that undone turns stay in the journal. Commit, push, PR.

### Task 7: Format check and Claude Code versions

**Files:**
- Modify: `handoff-log.mjs` (`READS`, `formatCheck`), `journal.mjs` (`VERSIONS`, `sawVersion`, the
  call in `write` 559), `memory.mjs` (`doctor` 875)
- Test: `handoff-log.test.mjs`, `journal.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces: `READS: [{ kind, field, need, lost }]`;
  `formatCheck(file, { tail = 2 * 1024 * 1024 } = {}) -> { version, turns, missing: [{ kind, field, need, lost }] }`;
  `VERSIONS = '.versions'`; `sawVersion(dir, day, version) -> void`. Task 9 deletes `VERSIONS`.

**Read first:** `turns()` and everything it calls in `handoff-log.mjs`, to make `READS` the true
list. Starting list: needed on user and assistant records: `type`, `uuid`, `timestamp`,
`sessionId`, `message.role`, `message.content`; needed on tool calls and results: `name`, `input`,
`id`, `tool_use_id`. Optional: `gitBranch` (lost: the branch), `cwd` (the project's folder),
`version` (the Claude Code version), `message.usage` (token counts in the handoff),
`message.model` (the model name), `parentUuid`, `isSidechain`. Also check how the snapshots treat
a store's dot files; `.versions` follows `.health`.

- [ ] **Step 1: Write the failing tests.** `good` is a made-up conversation file over 20 KB with at
  least 5 prompts and 5 replies.

```js
ok(formatCheck(good).missing.length === 0 && formatCheck(good).turns >= 5 && formatCheck(good).version === '2.1.328');
const m = formatCheck(without(good, 'assistant', 'message.content')).missing;
ok(m.length === 1 && m[0].field === 'message.content' && m[0].need === true);
ok(formatCheck(without(good, 'user', 'gitBranch')).missing[0].need === false);
ok(formatCheck(fourRecordsOnly).missing.length === 0, 'under 5 records of a kind proves nothing');
sawVersion(dir, '2026-11-18', '2.1.328'); sawVersion(dir, '2026-11-18', '2.1.328'); sawVersion(dir, '2026-11-19', '2.1.328');
ok(readFileSync(join(dir, VERSIONS), 'utf8') === '2026-11-18 2.1.328\n2026-11-19 2.1.328\n');
sawVersion(dir, '2026-11-19', '2.1 && rm'); ok(!readFileSync(join(dir, VERSIONS), 'utf8').includes('rm'), 'only /^[0-9A-Za-z.+-]{1,40}$/ is saved');
```

  `doctor`, exact texts from the table in spec 6: the `ok` line; the `PROBLEM` line for a missing
  needed field, ending with the `Next:` sentence; the same `PROBLEM` when the tail holds prompts
  and replies and no turn comes out; the `note` for a missing optional field; the `note`
  `conversation files: none large enough to check yet`; and a `note` with the text
  `Claude Code versions seen here: 2.1.328 since 2026-11-18, 2.1.327 since 2026-11-15`
  (newest three, each with its first day). A save through `write` adds the line under the same
  lock; a failed write of `.versions` never fails the save.

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. `formatCheck` reads the tail with the reader
  `turns()` uses and drops the first, cut line. **Step 4:** Suites green. Commit (check, versions:
  two commits), push, PR.

### Task 8: `clean` for dead stores

**Files:**
- Modify: `store.mjs` (`mountRoot`), `memory.mjs` (`sizeOf`, `removeTree`, `dead`, the `clean`
  command, `doctor`, `valued`/`table`: `clean: ['--yes']`, `USAGE`), `skills/memory/SKILL.md`
- Test: `store.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces: `mountRoot(path, platform = process.platform) -> string`;
  `sizeOf(path) -> number` (bytes, 0 when missing); `removeTree(path) -> void` (throws with the
  path when it cannot delete); `dead(stores, exists = existsSync) -> { dead: [{ dir, cwd, bytes, last }], unknown: number }`.
  Task 9 uses `sizeOf` and `removeTree`.

- [ ] **Step 1: Write the failing tests.**

```js
ok(mountRoot('C:\\Users\\x\\app', 'win32') === 'C:\\');
ok(mountRoot('\\\\nas\\share\\proj\\a', 'win32') === '\\\\nas\\share\\');
ok(mountRoot('/Volumes/Backup/proj', 'darwin') === '/Volumes/Backup');
ok(mountRoot('/mnt/d/proj', 'linux') === '/mnt/d');
ok(mountRoot('/media/kim/usb/proj', 'linux') === '/media/kim/usb');
ok(mountRoot('/run/media/kim/usb/proj', 'linux') === '/run/media/kim/usb');
ok(mountRoot('/home/kim/proj', 'linux') === '/' && mountRoot('/mnt', 'linux') === '/');
// dead(): `exists` is injected, so no real drive is needed
ok(d.dead.map((x) => x.dir).join() === goneStore, 'the folder is gone and its drive is there');
ok(!listed(aliveStore), 'the folder exists');
ok(!listed(unpluggedStore) && d.unknown >= 1, 'Review Focus 4: the drive is missing, so it is left alone');
ok(!listed(noConversationStore) && !listed(noCwdStore), 'cannot tell is never dead');
ok(!listed(twoStartsOneAlive), 'dead only when none of its start folders exists');
ok(!listed(sharedStore) , 'the shared store is never listed');
```

  CLI, exact texts from spec 8: the `doctor` note
  `N memory folders belong to projects whose folder is gone (X MB, last write YYYY-MM-DD): clean lists them`
  and no such line when there is none; `clean` lists each dead store and ends with the two lines
  of the spec, and the `memory` folder is still there; `clean --yes` prints
  `deleted N memory folders, X MB. The conversation files stay.`, the `memory` folder is gone and
  every `.jsonl` beside it is still there; `clean` with nothing dead prints one line and exits 0;
  `clean --all` is refused by the option table.

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. `dead` checks the newest conversation file's
  start folder first and reads the others only when that one is gone. `clean --yes` deletes under
  `withLock`. **Step 4:** Suites green. Commit (helpers, `clean`: two commits), push, PR.

### Task 9: `erase`

**Files:**
- Modify: `memory.mjs` (the `erase` command, `valued`/`table`: `erase: ['--yes']`, `USAGE`),
  `skills/memory/SKILL.md` (a row, per spec 7d), `README.md` (an "Uninstall" section)
- Test: `memory.test.mjs`

**Interfaces:**
- Consumes: `sizeOf`, `removeTree` (task 8), `VERSIONS` (task 7), `withLock`, and the existing
  code that cuts the automatic part of `handoff.md`.

**Read first, and write the result into the PR body as a table (path, what it is, class):** grep
every path the plugin writes: each `join(projectsRoot(), ...)`, each dot-file constant in every
module, the snapshots folder and how `memory-tier.mjs` makes it, `purge` in `memory.mjs`. Give
each one class: saved content (delete), state or log (delete), "do not save" mark (keep: off
switches, the forget list, incognito marks). Pick a sure sign that the snapshots folder is the
plugin's, one that folders made by 1.5.x already carry.

- [ ] **Step 1: Write the failing tests.** A temp home where every hook has run once and the user
  has forgotten one entry, turned one project off and gone incognito in one conversation.

```js
r = await cli('erase');
ok(r.code === 0 && /^erase would delete what project-memory saved on this computer:$/m.test(r.stdout));
ok(/^  journals +\d+ projects? +[\d.]+ [KM]B$/m.test(r.stdout) && /^  saved history +1 folder +[\d.]+ [KM]B /m.test(r.stdout));
ok(r.stdout.includes('It keeps your conversations, Claude\'s notes, shared notes, the off switches and the list of what you asked to forget.'));
ok(r.stdout.trimEnd().endsWith('Then: erase --yes') && existsSync(join(store, 'journal')), 'nothing deleted without --yes');
r = await cli('erase', '--yes');
ok(r.code === 0 && /^erased [\d.]+ [KM]B\. Kept: conversations, notes, shared notes, off switches, the forget list\.$/m.test(r.stdout));
ok(leftUnder(projectsRoot()).every((f) => KEPT.some((k) => k.test(f))), 'only conversations, notes, shared notes and do-not-save marks are left');
ok(readFileSync(join(store, 'handoff.md'), 'utf8').includes('my own line'), 'hand-written handoff lines stay');
// Review Focus 1
await stop(payload);                                   // the plugin saves again: the journal is rebuilt
ok(!journalText(store).includes(FORGOTTEN_WORD), 'a forgotten entry does not come back after erase');
ok(isOff(offStore), 'an off project is still off');
```

  Also: a read-only file inside the snapshots folder is deleted (`chmodSync(f, 0o444)` first); a
  path that cannot be deleted (patch `rmSync` with the suite's `meanwhile` helper to throw `EBUSY`
  for one path) is listed and the exit code is 1; a `.git` under the projects folder that the
  plugin did not make is left, with the line
  `not removed: <path> was not made by project-memory`; a `handoff.md` that holds only the
  automatic part is removed and its pointer line leaves `MEMORY.md`; `erase --all` is refused by
  the option table; `erase` on an empty home prints one line and exits 0.

- [ ] **Step 2:** Run: fail. **Step 3:** Implement per spec 7d, each store under its lock.
- [ ] **Step 4:** The skill row: Claude runs `erase`, shows the list, and runs `erase --yes` only
  after the user says yes. README "Uninstall": turn the plugin off, `erase`, what stays.
- [ ] **Step 5:** Suite green. Commit, push, PR.

### Task 10a: The gate for error recall (no PR)

**Files:**
- Create, on the branch `1.6.0-error-recall`, not pushed yet: `recall-error.mjs` with `signature`
  only, and `recall-error.test.mjs`
- Create, outside the repo: a throwaway replay script in the scratchpad;
  `reports/error-recall-replay-1.6.0.md` in KIRE's project folder

**Interfaces:**
- Produces: `signature(text) -> string | null`.

- [ ] **Step 1: Write the failing tests.**

```js
const a = signature("Exit code 1\nError: Cannot find module 'C:\\work\\shop\\src\\price.js' imported from C:\\work\\shop\\test\\price.test.js:14\n");
const b = signature("Exit code 1\nError: Cannot find module '/home/kim/shop/src/price.js'   imported from /home/kim/shop/test/price.test.js:207\n");
ok(a !== null && a === b, 'another folder, another line number, other spacing: the same signature');
ok(a !== signature("Exit code 1\nError: Cannot find module 'C:\\work\\shop\\src\\cart.js' imported from C:\\work\\shop\\test\\cart.test.js:14\n"));
ok(signature('Exit code 1') === null, 'under 20 characters');
ok(signature('x'.repeat(5000) + ' the tail that matters is here').length <= 120 && !/\n/.test(a));
ok(signature('') === null && signature(undefined) === null);
```

- [ ] **Step 2:** Run: fail. Implement per spec 5, step 2. Green.
- [ ] **Step 3: Replay.** A script that imports `signature` and `entries` (from `journal.mjs`),
  reads the journals of every project for the last 30 days, and lists each failed command whose
  signature matches an earlier failed command of another conversation in the same project. It
  prints counts and writes the hits to a scratchpad file. Nothing is committed.
- [ ] **Step 4: Decide by the rule of spec 5.** Fewer than 5 hits: park. Otherwise read up to 20
  hits spread over the range, mark each useful or not with one line in
  `reports/error-recall-replay-1.6.0.md`. At least half useful: go to task 10. Less: one change to
  the signature rule, one more replay. Still less: park, drop the branch, write the numbers into
  the report and the RESUME, and go to task 11.

### Task 10: Error recall (only if 10a passed)

**Files:**
- Modify: `recall-error.mjs`, `recall-error.test.mjs`, `hooks/hooks.json` (a `PostToolUseFailure`
  entry, matcher `Bash|PowerShell`, timeout 5, the same shape as the `enforce-hook.mjs` entries),
  `README.md`, `skills/memory/SKILL.md`, whatever lists the suites
- Test: `recall-error.test.mjs`

**Interfaces:**
- Consumes: `signature` (10a), `entries` (`journal.mjs`), `storeOf`, `isOff`, `tag` (`store.mjs`),
  the `.nudge` folder path the way `compact-gate.mjs` builds it.
- Produces: `seen(dir, sig, { session, today }) -> { day, key } | null`;
  `line(payload) -> string | null`; the file run as a hook reads the payload from stdin like
  `enforce-hook.mjs` and prints one JSON line or nothing.

**Read first:** `enforce-hook.mjs` (the model for a fast fail-open hook); how incognito and private
entries are marked; the Claude Code changelog for the version that added `PostToolUseFailure`;
`claude plugin validate` on the branch.

- [ ] **Step 1: Write the failing tests.** A store with a journal entry of conversation X, 7 days
  old, whose `Ran` holds `npm test → failed: <tail>`, and a payload from conversation Y whose
  `error` ends with the same tail.

```js
const out = JSON.parse(await hook(payload));
ok(out.hookSpecificOutput.hookEventName === 'PostToolUseFailure');
ok(out.hookSpecificOutput.additionalContext === `project-memory: the same error was hit on ${day} in another conversation. Before trying again, read what was done then: memory skill, show "${key}"`);
ok(!/tangerine/.test(JSON.stringify(out)), 'no word of the old entry is in the line');
ok(await hook(payload) === '', 'once per error and conversation');
ok(await hook({ ...payload, session_id: X }) === '', 'the same conversation is not a hit');
for (const p of [{ ...payload, is_interrupt: true }, { ...payload, error: 'Command timed out after 2m 0s' }, { ...payload, tool_name: 'Read' }]) ok(await hook(p) === '');
ok(await hook(payload, { PROJECT_MEMORY_ERROR_RECALL: '0' }) === '');
ok(await hookRaw('not json') === '' && lastExit === 0, 'fails open');
// Review Focus 3: PAIR is the live payload and the journal line of one real failure (step 3), text made up
ok(signature(PAIR.payload.error) === signature(PAIR.journalTail));
```

  Also nothing is printed when: memory is off for the project; the conversation is incognito; the
  old entry is forgotten; the old entry is private; the old entry is 91 days old; the entry's key
  does not match `/^[\w.:-]+$/`. With two old hits the newest is named.

- [ ] **Step 2:** Run: fail. Implement, in the order of spec 5 steps 1 to 5, the cheapest checks
  first. Green.
- [ ] **Step 3: Live check.** Deploy nothing. In a temp project, two headless sessions with
  `--plugin-dir <branch>` and the installed plugin disabled by `--settings`: each is asked to run
  a command that fails the same way. The second must receive the line (it is in the stream as hook
  output). Save the payload shape of that failure and the journal line of the first as the fixture
  `PAIR`, with made-up text. If the pair's signatures differ, fix `signature` so both agree and
  replay once more (10a step 3).
- [ ] **Step 4: Measure.** `node recall-error.mjs < payload.json` on the largest store of this PC:
  under 300 ms. Slower: read fewer days first, newest day files first, stop at the first hit.
- [ ] **Step 5:** README: what the line is, `PROJECT_MEMORY_ERROR_RECALL=0`, the Claude Code
  version that has the hook, and that an older version ignores it (checked how: say it). Skill: one
  line, "when a hook says the same error was hit before, run `show` with that key before trying
  again". Commit, push, PR.

### Task 11: Plain-word messages

**Files:**
- Modify: `memory.mjs` (texts in `doctor` and in every refusal), `mutants/*.mjs` (find-texts),
  `skills/memory/SKILL.md` and `README.md` where they quote a changed text
- Test: `memory.test.mjs`

- [ ] **Step 1: Make the table first.** List every `say(false, ...)` and `say('note', ...)` in
  `doctor` and every line the CLI prints before it returns 1. For each: old text, new text, by the
  rules of spec 7b. The table is the PR body.
- [ ] **Step 2: Write the failing test** that walks every `doctor` problem case the suite already
  builds, plus the ones tasks 1 to 10 added:

```js
for (const [name, out] of problemCases) {
  const lines = out.split('\n').filter((l) => /^PROBLEM/.test(l));
  ok(lines.length > 0 && lines.every((l) => /\bNext: \S/.test(l)), `${name}: every PROBLEM line names the next step`);
  ok(!/\b(backfill|payload|transcript|Stop hook|PreToolUse|SessionStart|PreCompact)\b/.test(out), `${name}: no word from the code`);
}
```

- [ ] **Step 3:** Run: fail. Change the texts, then the tests and the hand mutants that match old
  texts (grep each old text in `*.test.mjs` and `mutants/`). Text only: no behavior changes, no
  exit code changes. Green. Commit, push, PR.

### Task 12: Welcome line and `docs/limitations.md`

**Files:**
- Modify: `memory-tier.mjs` (the `--stop` path, lines 765 to 800), `README.md` (a link)
- Create: `docs/limitations.md`
- Test: `memory-tier.test.mjs`

**Interfaces:**
- Produces: `welcome(payload, fresh) -> string | null`. `fresh` is read at the start of `--stop`,
  before the journal import and before anything is written.

**Read first:** the `--stop` path from its first line to where `systemMessage` is written; what
writes `.stop-ran`; how the reload notice is joined. Use `grep -a` on `memory-tier.mjs`.

- [ ] **Step 1: Write the failing tests.** `TEXT` is the welcome text of spec 7a, word for word.

```js
ok((await stop(freshHome, stopPayload)).systemMessage === TEXT, 'the first save on a new computer');
ok(!('systemMessage' in await stop(freshHome, stopPayload)), 'never again');
ok(!('systemMessage' in await stop(homeWithJournal, stopPayload)) && existsSync(join(nudges, 'welcome')), 'a 1.5.x user never sees it, and the check is not repeated');
ok((await stop(freshHomeWithOldConversations, stopPayload)).systemMessage === TEXT, 'Review Focus 5: old conversations are imported in this same save');
for (const ev of ['SubagentStop', 'StopFailure']) ok(!('systemMessage' in await stop(fresh(), { ...stopPayload, hook_event_name: ev })) && !existsSync(marker));
ok(!('systemMessage' in await stop(fresh(), stopPayload, { off: true })) && !existsSync(marker), 'not while memory is off; it shows after it is turned on');
ok((await stop(fresh(), stopPayload, { reloadDue: true })).systemMessage === TEXT + '\n' + RELOAD_NOTICE);
```

  Also: an incognito conversation gets no welcome; two saves at the same moment print it once (the
  marker is made with the `wx` flag, the loser prints nothing).

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. Order of the check: the marker
  `.nudge/welcome` first (one `existsSync`, the usual case), then the "new computer" probe of spec
  7a. Not new: write the marker, print nothing. New: write the marker, print. Green. Commit.
- [ ] **Step 4: Write `docs/limitations.md`** from the list in spec 7c, with what tasks 5, 6 and
  10 really found (plans, Code Mode, rewound turns, error recall built or parked), the three limits
  of the memory-use count, and the journal sizes of this PC. Link it from the README. Commit, push,
  PR.

### Task 13: Release

**Files:**
- Modify: `.claude-plugin/plugin.json`, `.bestpractices.json`, `CHANGELOG.md`, `README.md`

**Read first:** the log in `reports/RESUME-1.5.3.md` for the exact release and deploy commands;
the v1.4.3 release notes as the model.

- [ ] **Step 1:** `/ponytail:ponytail-review` over `v1.5.3..master`. Fix every finding in small
  PRs. Re-review only the fixes.
- [ ] **Step 2: Eval runs.** Check the weekly usage first. The trigger cases:
  `claude plugin eval . --no-publish --trust-plugin --model sonnet --max-cost-usd 3 --json <path>`.
  The answer cases twice: `node recall-eval.mjs --plugin <clean v1.5.3 checkout> --json <path>` and
  `node recall-eval.mjs --plugin . --json <path>`. Put the numbers in the README as spec 2 says:
  date, model, Claude Code version, runs, every failed case named.
- [ ] **Step 3:** Version 1.6.0 in the two JSON files, the changelog, one commit. PR, green on the
  three systems.
- [ ] **Step 4: Stop here until KIRE says release.** Then merge, tag `v1.6.0`, publish
  "project-memory 1.6.0" with notes written for people, deploy with `deploy.mjs` from a fresh clone
  at the tag, run `doctor`.
- [ ] **Step 5:** Update the RESUME, the handoff and the memory note `project-1-6-0-roadmap`.

---

## Spec coverage

| Spec | Task |
|---|---|
| 1 Memory use | 1 |
| 2a Trigger cases, 2b Answer cases | 2, numbers in 13 |
| 3a Relative dates, 3b Filters | 3, 4 |
| 4a Approved plans | 5 |
| 4b MCP writes, Code Mode, rewound turns | 6 |
| 5 Error recall and its gate | 10a, 10 |
| 6 Format check, versions | 7 |
| 7a Welcome, 7c Limitations | 12 |
| 7b Plain words | 11 |
| 7d `erase` | 9 |
| 8 Dead stores | 8 |
| Release | 13 |

## Not checked when this plan was written

- The helper names in the test sketches (`turnsOf`, `stop`, `hook`, `without`, `leftUnder`,
  `toolUse`, `keyOf`) are placeholders: use what each suite already has, or add a small local
  helper. The assertions and the exact texts are the contract.
- Line numbers are from v1.5.3 (366c983) and move as PRs merge.
- How the suites fix "today", how hand mutants can be checked without a full run, what writes
  `.stop-ran`, how the snapshots folder can be told apart: each is a "read first" in its task.
