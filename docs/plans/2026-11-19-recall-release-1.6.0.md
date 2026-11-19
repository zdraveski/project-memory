# project-memory 1.6.0, the recall release: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. One agent builds, with
> one review per PR, in one session per PR (or per pair of small PRs): the RESUME carries the state
> from one session to the next. The house rule "proportionate process" overrides subagent-driven
> development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make saved memory get read: measure its use, show with numbers that it helps, bring
recall to the moments where it pays, and close the holes a new user would fall into.

**The goal, as a number (spec, "Why"):** in the eval of task 2, Claude runs a memory search in at
least 4 of 5 runs of each implicit case and in no run of the case that needs no memory. The
baseline is the same eval on v1.5.3. A missed target is written into the README and the release
notes, and KIRE decides whether to release.

**Architecture:** The work stays in the existing files: the CLI in `memory.mjs`, the conversation
reader in `handoff-log.mjs`, the journal in `journal.mjs`, the save after a reply in
`memory-tier.mjs`. Three new files: `recall-eval.mjs` (a developer tool like `bench.mjs`),
`recall-error.mjs` (one small fail-open hook, built only if its gate passes) and
`docs/limitations.md`. A journal entry is built from the conversation file only, so a backfill
gives the same entry as the live save. The reader for the two new entry lines (`Plan`, `Undone`)
ships first, alone, as 1.5.4 (task 0); 1.6.0 adds the writing.

**Tech Stack:** Node 22+, ES modules, no dependencies, no network. Tests are plain `*.test.mjs`
files run with `node`. The `claude` CLI (2.1.269 or newer) is used by the evals only.

**Spec:** `docs/specs/2026-11-19-recall-release-1.6.0-design.md`. Read it whole before task 0.
"Spec 3a" below points into it. The design is decided, do not reopen it. Spec and plan were revised
together after an audit (37 findings, all applied). Where a task says "read first", what is found
can change a detail: then the spec is corrected in the same PR.

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
- A delete never undoes a "do not save". `erase` and `clean` keep `.project-off`, `.memory-off`,
  `.off-periods`, the forget list, `.private-sessions`, `.hash-salt`, `.erased` and
  `.nudge/welcome` (the list is in spec 7d).
- A delete never follows a link: `lstat` first, a link is removed as a link, a real folder with
  Node's own `rmSync`, never with a walk written for this.
- A paid or headless test never touches the real memory: it runs with `CLAUDE_CONFIG_DIR` set to a
  new folder under the OS temp folder and refuses to start when that is not so.
- Text of a real conversation stays in local files: never in the repo, a fixture, a commit message
  or a PR body. A PR gets shapes and counts.
- The lines of a journal entry, in this order: the heading, `Asked`, `Answered`, `Changed`, `Ran`,
  then `Plan`, then `Undone`. The entry marker (`<!-- j:... -->`) is not changed.
- Every `claude plugin eval` run passes `--no-publish`.
- Limits, copied from the spec: a plan 50,000 characters (`J_TEXT`), a path 300 (`J_PATH`); memory
  use 7 days; error signature 300 then 120 characters, ignored under 20, journal look-back 90 days,
  an old entry counts only when its conversation's newest entry is at least one hour old; format
  check: newest finished file over 20 KB, last 2 MB, at least 5 records of a kind; eval caps:
  `--max-usd 8` for a run of the search set, 20 for the release run.
- House rules: `git commit -s`, explicit paths in `git add`, `node check.mjs` green before each
  push, no work in `~/.claude/hooks` or `~/.claude/hooks-live`, no mutation or fuzz run on GitHub
  unless KIRE says run, a PR is done only when CI is green on the three systems, merging and
  releasing need KIRE's word.

## Review Focus

Each line is pinned by a test in the task named.

1. **The journal comes back after `erase`.** The conversation files stay, so the save after the
   next reply imports them again, the forgotten entry with them. `erase` must write the `.erased`
   mark first and keep every "do not save" mark. Task 9.
2. **A delete goes through a link.** A store's `memory` or `journal` folder is a Windows junction
   to a folder elsewhere, and `clean` or `erase` deletes the files it points to. Tasks 8 and 9.
3. **The eval reads or writes the real memory.** Its seeding, its sessions or its clean-up run
   against the real projects folder. Task 2.
4. **`forget` misses a word that is only in a plan.** The user pasted a password into a plan, asks
   to forget it, and the entry is not found. Tasks 0 and 5.
5. **A project on an unplugged drive is listed as dead** and its memory is deleted. Task 8.
6. **The hook's error text and the saved journal tail end differently**, so the live hook never
   matches what the replay matched. Task 10.
7. **A new user with months of old conversations never gets the welcome**, because the first save
   imports old days before the "new computer" check runs. Task 12.

## PRs

| PR | Task | Branch | Spec | Size |
|---|---|---|---|---|
| 0 | Reader for `Plan` and `Undone`, released as 1.5.4 | `1.5.4-reader-first` | 4, "Reader first" | small |
| 1 | Memory use in `status` and `doctor` | `1.6.0-memory-use` | 1 | medium |
| 2 | Eval suite | `1.6.0-evals` | 2a, 2b | large |
| 2b | The wording that makes Claude search | `1.6.0-wording` | 2c | medium |
| 3 | Relative dates | `1.6.0-relative-dates` | 3a | small |
| 4 | Search filters | `1.6.0-search-filters` | 3b | medium |
| 5 | Approved plans | `1.6.0-plans` | 4a | medium |
| 6 | MCP writes, Code Mode, rewound turns | `1.6.0-other-writes` | 4b | medium |
| 7 | Format check and Claude Code versions | `1.6.0-format-check` | 6 | medium |
| 8 | `clean` for dead stores | `1.6.0-clean` | 8 | medium |
| 9 | `erase` | `1.6.0-erase` | 7d | large |
| 10 | Error recall, after its gate (task 10a) | `1.6.0-error-recall` | 5 | medium |
| 11 | Plain-word messages | `1.6.0-plain-words` | 7b | small |
| 12 | Welcome line and `docs/limitations.md` | `1.6.0-welcome` | 7a, 7c | small |
| 13 | Release | `1.6.0-release` | Release | medium |

That is 13 build PRs (1 to 12 with 2b) and the release PR, 12 if error recall fails its gate. PR 0
comes before them and is a release of its own, 1.5.4.

**Order.** 0 is released before 5 or 6 merges; 2b needs 2; 9 uses helpers from 8; 11 rewords what
1 to 10 added; 12 comes last and writes down what 1, 2, 5, 6, 8 and 10 found. If KIRE asks for
fewer PRs, 3+4, 5+6 and 8+9 can each go as one.

**Size.** One session per PR. Two small tasks may share a session. A medium task gets its own. A
large task gets its own, and its paid or risky step (the spike in task 2, the "read first" table in
task 9) is done and written into the RESUME before anything else. At the end of each task: one
line in the RESUME, then a new session.

**Two points where the release can stop.** After PR 4 (memory use, the eval, the wording, dates,
filters) and after PR 9 (also the capture gaps, the format check, `clean`, `erase`), what is merged
is whole and can ship. If the weekly usage runs short or KIRE says so, tasks 11 to 13 run there on
what is merged, and what is left becomes 1.6.1. Without that word the build goes on to the end.

## Before task 0

- [ ] Read `reports/RESUME-1.6.0.md` in KIRE's project folder, then the spec, then this plan.
- [ ] Check the weekly usage (the command is in the RESUME). At 97% or more: save state, start nothing.
- [ ] Claim the topic at the top of the project's `handoff.md`.
- [ ] Clone `https://github.com/zdraveski/project-memory` fresh into this session's scratchpad.
      Run `node check.mjs` once to see it green before any change.
- [ ] **Ask KIRE for the two clicks now,** in one line: "I'll show a two-line dummy plan twice:
      approve the first, reject the second." Call `EnterPlanMode` and `ExitPlanMode` (deferred
      tools, load with ToolSearch) twice, then read this session's own conversation file for the
      records. If KIRE is away, go on with the tasks that need no sample (0 to 4, 7 to 9) and ask
      again at the start of each session.
- [ ] **Make the other real samples of spec 4** in a temp folder with `CLAUDE_CONFIG_DIR` set to a
      new temp folder (the login step of task 2 comes first if these are the first headless runs):
      a Code Mode run (task 6, step 3), an MCP tool that writes a file (any filesystem MCP server
      already installed; install nothing new without KIRE's yes), and read the shape of the rewind
      sample named in the RESUME. Write each shape (field names only, no text of a conversation)
      into the RESUME. **A part with no real sample is not built:** it goes into
      `docs/limitations.md` (task 12) and waits for a later release.
- [ ] **The eval's login** (task 2, "read first"): find out from the Claude Code documentation how
      a headless session logs in under a temporary `CLAUDE_CONFIG_DIR`. If the only safe way is a
      long-lived token, ask KIRE for that one step now. If no safe way exists: tasks 2 and 2b are
      not built, KIRE is told, and nothing is run against the real folder in their place.

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
9. One line in the RESUME's log, with the local time (`date +%H:%M`) and the weekly usage. Then
   end the session: the next task starts in a new one (two small tasks may share one).

**Helpers in the test sketches.** In `memory.test.mjs`, `cli(...)` adds `--store <dir>` to every
call (line 38) and `run([...])` does not; both are async and give `{ status, stdout, stderr }`.
Both run the CLI inside the test process, under the suite's temp home, so `projectsRoot()` and
`erasedAt()` called by a test read that temp home too. A check of `--project`, of `erase` or of
`clean` uses `await run([...])`, and every exit code is read from `r.status`.

---

### Task 0: Reader first, released as 1.5.4

**Files:**
- Modify: `journal.mjs` (`FIELDS` 40, `render` 95, `parseDay` 110 with its field pattern at 118,
  `holds` 401, and every place that copies an entry field by field), `memory.mjs` (the search
  ranking at 375 and 393, `show` at 1212), `.claude-plugin/plugin.json`, `.bestpractices.json`,
  `CHANGELOG.md`
- Test: `journal.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces: an entry's `plan` and `undone`, both a string, `''` when the line is absent. `render`
  writes each line only when its value is not empty. Nothing builds an entry with either yet, so
  1.5.4 never writes one. Task 5 fills `plan`, task 6 fills `undone`.

**Read first:** `git grep -n "\.ran\b" -- '*.mjs'` for every place that lists the fields (`rescan`,
the incognito sweep, `forget`, `takeBack`, the search ranking, `show`, the date-only listing).

- [ ] **Step 1: Write the failing tests.**

```js
// journal.test.mjs
const e = { ...base, changed: ['a.js'], ran: ['npm test'], plan: 'Step 1: add a README. Step 2: link it.', undone: 'rewound 14:02' };
ok(render(e).endsWith('\n**Ran:** npm test\n**Plan:** Step 1: add a README. Step 2: link it.\n**Undone:** rewound 14:02'), 'Plan after Ran, Undone last');
ok(!/\*\*(Plan|Undone):\*\*/.test(render({ ...e, plan: '', undone: '' })));
const back = parseDay(render(e)).entries[0];
ok(back.plan === e.plan && back.undone === e.undone && !back.after, 'fields of the entry, not loose text');
ok(parseDay(render({ ...e, changed: [], ran: [] })).entries[0].plan === e.plan, 'with no Changed and no Ran');
ok(parseDay(render({ ...e, plan: '' })).entries[0].undone === e.undone, 'Undone without Plan');
ok(parseDay(render({ ...e, plan: '', undone: '' })).entries[0].plan === '');
ok(holds({ ...e, plan: 'the code word is tangerine' }, 'tangerine'), 'Review Focus 4: forget finds a word that is only in a plan');
ok(parseDay(V153_REWRITE).entries[0].plan === e.plan, 'a day file rewritten by 1.5.3 still reads back');
// memory.test.mjs: a day file written by hand with both lines
r = await cli('search', 'tangerine'); ok(r.stdout.includes(key));
r = await cli('show', key);           ok(/^\*\*Plan:\*\* /m.test(r.stdout) && /^\*\*Undone:\*\* /m.test(r.stdout));
r = await cli('forget', 'tangerine', '--yes');
ok(!readFileSync(dayPath, 'utf8').includes('tangerine'), 'the deleted entry takes its plan with it');
```

  `V153_REWRITE` is made once, by hand: `git show v1.5.3:journal.mjs` into the scratchpad, run its
  `parseDay` then `render` over a new day file that holds a plan and a prose line, paste the output
  into the test.

  Also: `rescan` finds and redacts a secret that is only in a plan; `incognito` sweeps an entry
  with a plan and with an `Undone` line; a rewrite of a day file (any `forget` of another entry of
  the same day) writes both lines back where they were; `search` ranks a word in a plan like a
  word in `Answered`.

- [ ] **Step 2:** Run both suites: fail. **Step 3:** Implement. Decide for each place found in
  "read first". No new message, no new option: nothing a user can see changes.
- [ ] **Step 4:** Fix the find-texts of the hand mutants that match a changed line. Suites green,
  `node check.mjs`. Commit (journal, CLI: two commits), push, PR, review.
- [ ] **Step 5: Release 1.5.4, on KIRE's word "release".** Version 1.5.4 in the two JSON files and
  the changelog. Name: "project-memory 1.5.4 (bug fix)". The notes say what it is for (it reads
  two lines the next release writes) and: reload or restart open sessions. Commands: the log in
  `reports/RESUME-1.5.3.md`. Until 1.5.4 is released, PRs 5 and 6 may be built and reviewed, not
  merged.

### Task 1: Memory use in `status` and `doctor`

**Files:**
- Modify: `memory.mjs` (new `use` and `useLine` next to `status`, line 407; `status` and `doctor` call them)
- Modify: `skills/memory/SKILL.md` (the `status` row names the line)
- Test: `memory.test.mjs`

**Interfaces:**
- Produces: `use(dir, { now = Date.now() } = {}) -> { searches, opened, notes, direct, used, conversations }`
  (all numbers) and `useLine(u) -> string`. Exported too:
  `callUse(name, input, dir) -> { searches, opened, notes, direct }`, the count of one tool call.
  `use` sums it, and task 2 grades with it.

**Read first:** `commandsOf` and `tally` in `enforce.mjs` (they already read shell commands out of
conversation files in pieces) and `chunk` in `journal.mjs`. Reuse one of them.

- [ ] **Step 1: Write the failing tests.** A temp project with four conversation files: A holds
  one `Bash` call whose command runs `memory.mjs search` twice and `memory.mjs" show` once, one
  `Read` of `<store>/journal/2026-11-18.md`, one `Grep` whose `path` is `<store>/journal`, and one
  `memory.mjs search` in a record dated 9 days before `now`; B holds a `PowerShell` call with one
  `memory.mjs' search`, a `Read` of `<store>/feedback-x.md` and a `Bash` call `rg port "<store>"`;
  C holds a prompt, a reply, a `Skill` call that loads the memory skill and a `Bash` call
  `grep -r port src`; D is like B but its file time is 10 days before `now`.

```js
const u = use(store, { now });
ok(u.searches === 3 && u.opened === 2 && u.notes === 1, 'two searches in one command count twice; a journal day read is an entry opened');
ok(u.direct === 2, 'a Grep in the store and a shell rg that names it; a grep of src is not one');
ok(u.used === 2 && u.conversations === 3, 'a skill load alone is not use; the old file and the old record are not counted');
ok(useLine(u) === 'memory use, last 7 days: 3 searches, 2 entries opened, 1 note read, 2 direct file searches, in 2 of 3 conversations');
ok(useLine({ searches: 1, opened: 1, notes: 1, direct: 1, used: 1, conversations: 1 }) === 'memory use, last 7 days: 1 search, 1 entry opened, 1 note read, 1 direct file search, in 1 of 1 conversation');
ok(useLine({ searches: 0, opened: 0, notes: 0, direct: 0, used: 0, conversations: 9 }) === 'memory use, last 7 days: none in 9 conversations');
ok(useLine({ searches: 0, opened: 0, notes: 0, direct: 0, used: 0, conversations: 0 }) === 'memory use, last 7 days: no conversations');
r = await cli('status'); ok(/^ +memory use, last 7 days: /m.test(r.stdout), 'indented like the other lines of a project');
r = await cli('doctor'); ok(/^note +memory use, last 7 days: /m.test(r.stdout));
```

  Also: a `Read` of a shared-store note counts as a note read; a `Glob` whose path is in the
  shared store counts as a direct file search; `findstr` and `Select-String` in a `PowerShell`
  command that names the store count, one each; a `ctx_execute` whose `code` holds
  `memory.mjs search` counts; a conversation file with a broken last line does not throw.

- [ ] **Step 2:** Run `node memory.test.mjs`. It fails at the first new check.
- [ ] **Step 3: Implement `use` and `useLine`.** Count per spec 1: a search or `show` is each match
  of `/memory\.mjs["']?\s+(search|show)\b/g` in a shell command; a direct file search is a `Grep`
  or `Glob` whose path is in one of the two stores, or a shell command with `grep`, `rg`, `findstr`
  or `Select-String` as a word that names one of them (the store's folder name, a slash of either
  kind, then `memory`). Parse only lines that hold the word `memory`. Compare paths with slashes
  normalized and, on Windows, without letter case.
- [ ] **Step 4:** Add the line as the last line of each project's `status` block, indented like
  the lines above it (`memory.mjs` 411 to 442), and as a `'note'` in `doctor`. Run the suite:
  green.
- [ ] **Step 5: Measure.** Time `node memory.mjs status` on the largest project of this PC before
  and after. More than 2 seconds slower: add the per-file cache from spec 1 with its own test.
  Put both times in the PR body. Note for task 12: the three limits of the count (spec 1).
- [ ] **Step 6:** Commit, push, PR.

### Task 2: Eval suite

**Files:**
- Create: `recall-eval.mjs`, `recall-eval.test.mjs`, `evals/answers/cases.json`
- Create, only if step 1 shows that they run on the build PC: `evals/<case>/prompt.md` and
  `evals/<case>/graders/skill.md` for the four cases of spec 2a
- Modify: `.gitignore` (`evals/results/`), `CONTRIBUTING.md` (how to run it, what it costs)
- Modify: `.github/workflows/test.yml` (one line `node recall-eval.test.mjs` after the eight suites,
  lines 40 to 47) and `check.mjs` (line 30 builds `ALL` from the `suites` of `mutate.mjs`: add
  `'recall-eval.test.mjs'` to `ALL` by hand). No entry in `suites` and none in `coverage.mjs`: a
  developer tool gets no mutants.

**Interfaces:**
- Consumes: `callUse` from task 1, imported from `memory.mjs`; `record` in `journal.mjs`.
- Produces, exported from `recall-eval.mjs`:
  `seed(day) -> [{ day, asked, answered, changed, ran }]`,
  `grade(c, answer) -> boolean` (the answer's text only),
  `searched(events, dir) -> boolean` (`dir` is the session's store),
  `passed(c, answer, didSearch) -> boolean` (the whole case),
  `answerOf(events) -> { text, cost, turns, session }`,
  `safe(dir) -> boolean` (true only for a folder under `os.tmpdir()`),
  `run(opts, spawn?) -> Promise<{ rows, cost, code }>` (`spawn` starts one session; a test passes
  a made-up one),
  `table(rows) -> string`.
  A case in `cases.json` is `{ name, set, runs, question, pattern?, flags?, absent?, search? }`:
  `set` is `'answer'` or `'search'`; `search` is `true` (a memory search must have run) or `false`
  (none may have run). `events` are the parsed lines of `--output-format stream-json`.

**Read first:** `claude plugin eval --help` and the official "plugin evals" page; the Claude Code
documentation on `CLAUDE_CONFIG_DIR`, on headless login and on the permission rules of a
`--settings` file (ask the claude-code-guide agent for all three); the note
`project-recall-test-method.md` in the project's memory folder; `record` and `write` in
`journal.mjs`; `configDir` and `projectsRoot` in `store.mjs` (lines 13 and 14); how `bench.mjs` is
treated (`HOOKS` in `deploy.mjs`, line 26, does not list it; the release archive holds it): treat
`recall-eval.mjs` and `evals/` the same.

- [ ] **Step 1: Spike, before any code.** Check the weekly usage. Every command of this step runs
  with `CLAUDE_CONFIG_DIR` set to a new folder under the OS temp folder, logged in the way "Before
  task 0" found. It answers the four questions of spec 2, "When it runs":
  1. Does a session log in there, and what does one cost? In an empty temp folder:
     `claude -p "Say OK." --output-format stream-json --verbose --model sonnet`.
  2. Does an eval run without a shell tool work on this PC, and does the skill load? Create only
     `evals/asks-about-last-week/` and run
     `claude plugin eval . --no-publish --trust-plugin --case asks-about-last-week --runs 1 --model sonnet --max-cost-usd 0.50 --json <scratchpad>/spike.json`.

  Write the four answers into the RESUME and the PR body, with the exact refusal if there is one.
  **Refused here too: 2a is parked.** Delete the case folder, ship no trigger case, and give task
  12 one line for `docs/limitations.md`. **No login under the temp folder: stop the task** and tell
  KIRE. Nothing is run against the real folder in its place.
- [ ] **Step 2: Write the failing tests** in `recall-eval.test.mjs` (`store` is a made-up store
  path, `toolUse(name, input)` makes one stream line):

```js
ok(grade({ pattern: '4317' }, 'We picked port 4317 because 3000 was taken.'));
ok(!grade({ pattern: '4317' }, ''));
ok(grade({ pattern: 'UTC|time ?zone', flags: 'i' }, 'closeDay used utc.'));
ok(grade({ pattern: 'Stripe|PayPal|Adyen|Braintree|Mollie', flags: 'i', absent: true }, 'We never chose one.'));
ok(!grade({ pattern: 'Stripe|PayPal|Adyen|Braintree|Mollie', flags: 'i', absent: true }, 'Probably Stripe.'));
ok(seed('2026-11-19').map((e) => e.day).join() === '2026-11-17,2026-11-11,2026-11-11,2026-11-14,2026-10-30');
ok(seed('2026-11-16').map((e) => e.day)[1] === '2026-11-11', 'on a Monday the previous week is still 9 to 15 November');
ok(searched([toolUse('Bash', { command: 'node "x/memory.mjs" search port' })], store));
ok(searched([toolUse('Read', { file_path: `${store}/journal/2026-11-17.md` })], store));
ok(searched([toolUse('Grep', { pattern: 'port', path: store })], store), 'a direct file search is a memory search');
ok(!searched([toolUse('Skill', { skill: 'project-memory:memory' })], store), 'loading the skill alone is not a search');
ok(!searched([toolUse('Read', { file_path: 'C:/p/src/app.js' })], store));
const implicit = { pattern: '4317', search: true }, noNeed = { search: false };
ok(passed(implicit, 'Use 4317.', true) && !passed(implicit, 'Use 4317.', false) && !passed(implicit, 'Use 3000.', true));
ok(passed(noNeed, 'const rev = ...', false) && !passed(noNeed, 'const rev = ...', true));
ok(passed({ pattern: '4317' }, 'Port 4317.', false), 'an answer case does not ask for a search');
ok(safe(join(tmpdir(), 'recall-eval-x')) && !safe(homedir()) && !safe(join(homedir(), '.claude')) && !safe(join(tmpdir(), '..')));
const cases = JSON.parse(readFileSync('evals/answers/cases.json', 'utf8'));
ok(cases.length === 9 && cases.filter((c) => c.set === 'search').map((c) => c.runs).join() === '5,5,3');
```

  Also, with a made-up `spawn` passed to `run`, so that no session starts and nothing is paid:
  `run` refuses with exit 1 and calls no `spawn` when the configuration folder or a project folder
  is not `safe` (Review Focus 3); it stops at `--max-usd`, marks the rest "not run" and gives exit
  2; after a `spawn` that throws, the project folders and the configuration folder are gone and the
  sessions' conversation files are in `<json path>.sessions/`; a leftover folder of a killed run is
  swept at the start, a folder that a running harness holds is not; when the seed check finds
  nothing, the run stops before the first `spawn`. `answerOf` reads `result`, `total_cost_usd`,
  `num_turns` and the session id from made-up stream lines; `table` prints one row per case with
  the columns case, right answers, searched, without, cost; `node recall-eval.mjs --self-check`
  exits 0 and starts no session.

- [ ] **Step 3:** Run it: fails. Implement the functions, and `cases.json` with the nine cases and
  the seeded entries of spec 2b, word for word.
- [ ] **Step 4: Implement the run** (spec 2b, steps 1 to 9). The sweep: every run folder holds a
  `pid` file, and a folder whose process is gone is a leftover. One configuration folder and one
  project folder per session, all under `os.tmpdir()`; every child process gets `CLAUDE_CONFIG_DIR`
  in its environment, the seeding too. Seed through `record`; the "without" arm gets no store. The
  seed check (`memory.mjs search port --store <dir>` on one seeded store) comes before the first
  paid session. `--plugin-dir` only in the "with" arm; the `--settings` file in both. 4 sessions
  at a time. In a `finally` and on `SIGINT`: copy the conversation files next to the results file,
  then remove the folders with `rmSync`. `--json` defaults to `evals/results/<date>-<time>.json`.
- [ ] **Step 5: One paid check.** List the real projects folder first (names and times only).
  `node recall-eval.mjs --plugin . --set answer --case port --runs 1`. Confirm: the answer holds
  4317; the real projects folder has no new folder and no changed file; the temp folders are gone;
  the session's file is in `<json path>.sessions/`; the cost. With the cost, check the table of
  spec 2 against the caps (`--max-usd 8` for a run of the search set, 20 for the release run). If
  a run would pass its cap, cut as the spec says. Write the numbers into `CONTRIBUTING.md` and the
  RESUME.
- [ ] **Step 6: The four trigger cases, only if step 1 ran them.** Frontmatter and grader of spec
  2a. Grader patterns in single quotes, no backslashes. Run them once, under the temp
  configuration folder:
  `claude plugin eval . --no-publish --trust-plugin --model sonnet --max-cost-usd 3 --json <path>`.
- [ ] **Step 7:** `.gitignore`, `CONTRIBUTING.md`, `test.yml`, `check.mjs`. Commit, push, PR. The
  baseline and the wording are task 2b. The release run and the README numbers are task 13.

### Task 2b: The wording that makes Claude search

**Files:**
- Modify, only if a wording wins: `skills/memory/SKILL.md` (the `description` in the frontmatter),
  `handoff-log.mjs` (the journal line the briefing prints at session start), and the tests and
  hand mutants that match the old texts
- No new code. The PR body holds the table.

**Interfaces:**
- Consumes: `recall-eval.mjs` from task 2.

**Read first:** spec 2c; `git grep -n "is in its journal"` for the briefing's line and every test
that pins it.

- [ ] **Step 1: Baseline.** Check the weekly usage. Make a clean checkout of v1.5.3
  (`git worktree add <scratchpad>/v153 v1.5.3`) and run
  `node recall-eval.mjs --plugin <scratchpad>/v153 --set search --max-usd 8 --json <path>`.
  Write the numbers into the RESUME before any wording is tried: the searches per case (of 5, 5
  and 3) and the cost.
- [ ] **Step 2: Is the target met?** `port-implicit` and `pdf-implicit` each searched in at least
  4 of 5 runs and `no-need` in none: nothing changes, the PR holds the baseline table and says so.
  Go to step 5.
- [ ] **Step 3: Up to 3 wordings, one at a time.** For each: a copy of the plugin in the scratchpad
  with only the two texts changed, then the same command with `--plugin <copy>`. One idea per
  wording: name the moment (a question about a choice, a value or a name this project may have
  settled before), say what the journal holds, or put the instruction first. A new description is
  no longer than the old one. Write each wording and its numbers into the RESUME as it finishes. A
  wording with which `no-need` searches even once is out. Stop when a wording meets the target.
- [ ] **Step 4: Keep one.** The wording with the most searches on the two implicit cases, at a tie
  the shorter. If none beats the baseline by at least 2 searches of 10, the old text stays. Put
  the winner into the two files, update the tests and hand mutants that match the old texts,
  suites green.
- [ ] **Step 5:** PR with the table (wording, searches per case, `no-need`, cost), also when the
  target is missed. A missed target goes into the RESUME under "Open for KIRE": release as it is,
  or try another wording.

### Task 3: Relative dates

**Files:**
- Modify: `store.mjs` (`dayOf` and `isDay` next to `local`, line 340, both exported); `memory.mjs`
  (`isDay` is a local of `main` today, line 1127: import it instead; the `--since`/`--until`
  checks at 1128 and 1130; the last line of the `forget` list; `USAGE` at line 6);
  `skills/memory/SKILL.md`
- Test: `store.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces, exported from `store.mjs`:
  `dayOf(word, today = local().slice(0, 10), end = false) -> 'YYYY-MM-DD' | null` and
  `isDay(v) -> boolean`. Task 10 uses `dayOf`.

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
  same text with `--until`); `search --since today --until 7d` prints
  `--since 2026-11-19 is after --until 2026-11-12` with the two dates, not the words, and exits 1;
  `forget --since 1d` prints the `since` line before its list and deletes nothing without `--yes`.

  **A word is never used to delete** (spec 3a): the last line of the `forget --since 1d` list
  names the delete with the date, not the word (it ends `forget --since <that date> --yes`), and
  holds no `1d`. With `--until last-week` it holds both dates.

- [ ] **Step 2:** Run both suites: fail.
- [ ] **Step 3: Implement `dayOf`** on calendar dates (`Date.UTC` of the three numbers, minus
  days), never on local hours. A date is accepted only when `isDay` accepts it.
- [ ] **Step 4:** Resolve `--since` (with `end = false`) and `--until` (with `end = true`) once, at
  line 1128, before the "is after" check of line 1130: that check compares the two as text, so it
  must see dates, never words. Every command that takes the options then gets the dates. Print
  the resolved line. Update `USAGE` and the skill's table with one example ("last week" is
  `search <words> --since last-week --until last-week`) and one rule for `forget`: run the list's
  last line as printed, or delete by `--key`, and never repeat the word.
- [ ] **Step 5:** Old tests and hand mutants that match the old "takes a date like" text: update.
  Suites green. Commit, push, PR.

### Task 4: Search filters

**Files:**
- Modify: `memory.mjs` (the `=value` pattern at 1091 and `valued` at 1092 get `project`; the list
  of options without a value at 1095 gets `--notes` and `--journal`; `table` at 1106: `search` gets
  `--conversation`, `--notes`, `--journal`; the place where `--store`, `--shared` and `--all` are
  resolved; `search` at 1167 and 1217; `USAGE`); `skills/memory/SKILL.md`
- Test: `memory.test.mjs`

**Interfaces:**
- Produces: `projectStore(name, stores) -> { dir } | { many: [{ cwd, dir }] } | { none: true }`,
  where `stores` is the list `--all` reads.

- [ ] **Step 1: Write the failing tests.** Two projects whose conversations started in `<tmp>/w/app`
  and `<tmp>/w/App-old`, each with a journal entry and a note that hold the word `port`. The entry
  of `app` also holds `4317`, the entry of `App-old` holds `old-only-word`.

```js
ok(projectStore('app', all).dir === appStore, 'the last folder name, whole, wins');
ok(projectStore('APP', all).dir === appStore);
ok(projectStore('old', all).dir === oldStore, 'no folder is named old: any part of the path');
ok(projectStore('w', all).many.length === 2);
ok(projectStore('zzz', all).none === true);
// run, not cli: cli adds --store, and --project cannot go with it
r = await run(['search', 'port', '--project', 'app']);
ok(r.status === 0 && r.stdout.includes('4317') && !r.stdout.includes('old-only-word'));
r = await run(['search', 'port', '--project=app']);
ok(r.status === 0 && r.stdout.includes('4317'), 'the = form, like --store=');
r = await run(['search', 'port', '--project', 'w']);
ok(r.status === 1 && /^--project w matches 2 projects:$/m.test(r.stdout) && r.stdout.includes('--store ') && !r.stdout.includes('4317'),
  'a word that matches two projects through the path: the answer is the list, and nothing else runs');
r = await run(['search', 'port', '--project', 'zzz']);
ok(r.status === 1 && r.stdout.trim() === '--project zzz matches no project: search --all names them');
for (const o of [['--store', appStore], ['--shared'], ['--all']]) {
  r = await run(['search', 'port', '--project', 'app', ...o]);
  ok(r.status === 1 && r.stdout.trim() === `--project cannot go with ${o[0]}`);
}
r = await cli('search', 'port', '--notes', '--conversation', tag);
ok(r.status === 1 && r.stdout.trim() === '--conversation searches the journal: drop --notes');
```

  Also: `search port --conversation <tag>` lists only that conversation's entries and no note;
  the full session id works where the tag works; `--journal` lists no note; `--notes` lists no
  journal entry; `--notes --journal` equals no option; `search port --notes=x` is refused like any
  value given to an option that takes none; `status --project app` prints the block of that
  project.

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. `--conversation` reuses the matching
  `forget --conversation` has (line 1226). `--project` resolves only among the stores `--all`
  reads. A start folder is split on both `/` and `\`.
- [ ] **Step 4:** `USAGE`, the skill's table (one example: "in the app project" is
  `search <words> --project app`). Suite green. Commit, push, PR.

### Task 5: Approved plans

**Files:**
- Modify: `handoff-log.mjs` (the turn reader gives `plan` and `planFile`), `journal.mjs` (`entryOf`
  67 fills `plan`; new `planOf`), `memory.mjs` (a hit line and a day listing end with
  ` · plan approved`, `head` 1154), `skills/memory/SKILL.md` (the `show` row)
- Test: `handoff-log.test.mjs`, `journal.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Consumes: the reader of task 0. `FIELDS`, `render`, `parseDay`, `holds`, `show`, `search`,
  `forget`, `rescan` and `incognito` already know `plan`. 1.5.4 is released before this PR merges.
- Produces: a turn's `plan` (the text, `''` when there is none) and `planFile` (the plan file's
  path, `''` when unknown); `planOf(turn, turns) -> string` in `journal.mjs`;
  `entryOf(turn, transcriptPath, when, turns = [turn])`, whose entry has `plan`.

**Read first:** the shapes written into the RESUME in "Before task 0": where the plan text is
(spec 4a names three places, in order) and what tells an approved plan from a rejected one. Every
caller of `entryOf` (`git grep -n "entryOf("`): each must pass the conversation's turns.
**No sample, or the text is in none of the three places: no `Plan` line is built.** The gap goes
to `docs/limitations.md` (task 12), no PR is opened, and the build goes on with task 6.

- [ ] **Step 1: Write the failing tests,** with made-up fixtures in the shape found.

```js
// handoff-log.test.mjs
ok(turnsOf(approved).at(-1).plan === 'Step 1: add a README. Step 2: link it.', 'squeezed to one line');
ok(turnsOf(rejected).at(-1).plan === '' && turnsOf(answeredWithChanges).at(-1).plan === '');
ok(!turnsOf(withSecret).at(-1).plan.includes(SECRET), 'redacted like Asked');
ok(turnsOf(huge).at(-1).plan.length <= 50000);
// journal.test.mjs: privacy is decided in entryOf (lines 67 to 74), so the entry is tested, not the turn
const ts = turnsOf(approved);
ok(entryOf(ts.at(-1), file, when, ts).plan === 'Step 1: add a README. Step 2: link it.');
const pv = turnsOf(privateApproved);
ok(entryOf(pv.at(-1), file, when, pv).plan === '', 'a private turn saves no plan');
const later = turnsOf(writtenInPrivateApprovedLater);   // the plan file is written in a private turn, approved two turns on
ok(later.every((t) => entryOf(t, file, when, later).plan === ''), 'text written in a private turn is never saved');
ok(!later.map((t) => render(entryOf(t, file, when, later))).join('\n').includes('tangerine'));
// memory.test.mjs
r = await cli('search', 'tangerine');                   ok(/ · plan approved$/m.test(r.stdout));
r = await cli('search', '--since', day, '--until', day); ok(/ · plan approved$/m.test(r.stdout), 'the day listing too');
```

  Also: the entry built by the live save and the entry built by `backfill` from the same fixture
  render to the same text; with a real save, `forget tangerine` finds the entry by its plan and
  the day file holds no `tangerine` after `--yes` (Review Focus 4, end to end).

- [ ] **Step 2:** Run the three suites: fail.
- [ ] **Step 3: Implement.** The reader takes the plan text from the first of the three places
  that holds it; the text passes through the same redact, squeeze and cut as `asked`. `planOf`
  gives `''` when the turn is private, when a private turn of `turns` has `turn.planFile` in its
  changed files, or when `planFile` is unknown and an earlier turn of the conversation is private.
- [ ] **Step 4:** Suites green, `node check.mjs`. Commit (reader, journal, CLI: three commits),
  push, PR.

### Task 6: MCP writes, Code Mode, rewound turns

**Files:**
- Modify: `handoff-log.mjs` (`editedFile` 261, maybe `ranOf`), `journal.mjs` (`entryOf` fills
  `undone`, only if a rewind can be marked), `PRIVACY.md`
- Test: `handoff-log.test.mjs`, `journal.test.mjs`, the suite that pins the note written before a
  compaction

**Interfaces:**
- Consumes: the reader of task 0 (`undone`). Produces: no new name; `editedFile(b)` and `ranOf(b)`
  read more tools.

**Read first:** the shapes in the RESUME from "Before task 0". `git grep -n "editedFile("`: the
journal's `Changed`, the handoff's `changed:` line and the note written before a compaction all
read it.

- [ ] **Step 1: Write the failing tests for MCP writes. Only with a real sample** of an MCP tool
  that wrote a file. Without one, steps 1 and 2 are skipped and task 12 writes the limit down.
  `editedFile` reads only a block with `type: 'tool_use'` (line 261) and gives `''` for a tool it
  does not know.

```js
const call = (name, input) => ({ type: 'tool_use', name, input });
ok(editedFile(call('mcp__filesystem__write_file', { path: 'C:/w/a.txt', content: 'x' })) === 'C:/w/a.txt');
ok(editedFile(call('mcp__plugin_a_b__Edit_file', { filePath: 'a.txt' })) === 'a.txt', 'any letter case');
ok(editedFile(call('mcp__notes__save', { destination: 'n.md' })) === 'n.md');
ok(editedFile(call('mcp__filesystem__edit_file', { path: 'a.txt', edits: [], dryRun: true })) === '');
ok(editedFile(call('mcp__x__write', { path: 'a.txt', dry_run: true })) === '');
ok(editedFile(call('mcp__filesystem__read_file', { path: 'a.txt' })) === '');
ok(editedFile(call('mcp__notes__create_note', { title: 'x' })) === '', 'no path');
ok(editedFile(call('mcp__x__save', { file: { a: 1 } })) === '', 'not a string');
ok(editedFile(call('mcp__x__update_doc', { filePath: '' })) === '');
ok(editedFile(call('write_file', { path: 'a.txt' })) === '', 'not an MCP tool');
ok(editedFile({ name: 'mcp__filesystem__write_file', input: { path: 'a.txt' } }) === '', 'not a tool call');
```

  Also: a refused or failed MCP write stays out of `Changed` the way a refused `Edit` does; a path
  of 400 characters is cut at 300; one made-up conversation with an MCP write gives the path in
  the handoff's `changed:` line and in the note written before a compaction (one test each).

- [ ] **Step 2:** Run: fail. Implement the rule of spec 4b in `editedFile`. Green. Commit.
- [ ] **Step 3: Code Mode.** With the sample of "Before task 0", take one of the three branches of
  spec 4b, each with its test on a made-up fixture of the shape seen: inner calls recorded (pin
  that `Changed` and `Ran` are filled); only `REPL` recorded (`ranOf` reads `input.code`, cut like
  a command); cannot be turned on (nothing built). Note the branch for task 12. Commit.
- [ ] **Step 4: Rewound turns.** Build a made-up fixture in the shape of the rewind sample (a
  prompt, a reply, then a second prompt under the same parent). Tests:

```js
const ts = turnsOf(rewound);
ok(ts.length === 2, 'the undone exchange and the one that replaced it are both read');
ok(new Set(ts.map(keyOf)).size === 2, 'no entry twice');
```

  and after a save followed by a backfill the day file holds each entry once. Mark the undone
  entry only if a record field shows the rewind for certain: then `entryOf` fills `undone` with
  `rewound <time>`, and `**Undone:**` is the last line of the entry, after `Plan` (one test with
  both lines). Otherwise nothing is marked; note for task 12 that undone turns stay in the journal.
- [ ] **Step 5:** `PRIVACY.md` gets a paragraph of its own, marked or not: an exchange you rewind
  stays in the journal; `forget` removes it. Commit, push, PR.

### Task 7: Format check and Claude Code versions

**Files:**
- Modify: `handoff-log.mjs` (`READS`, `formatCheck`; `latest` at 506 also gives the version),
  `journal.mjs` (`VERSIONS`, `sawVersion`, the call in `write` 559), `memory.mjs` (`doctor` 875)
- Test: `handoff-log.test.mjs`, `journal.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces: `READS: [{ kind, field, need, lost }]`;
  `formatCheck(file, { tail = 2 * 1024 * 1024 } = {}) -> { version, turns, prompts, missing: [{ kind, field, need, lost }] }`
  (`prompts` counts the prompts the user typed in the tail);
  `VERSIONS = '.versions'`; `sawVersion(dir, day, version) -> void`. Task 9 deletes `VERSIONS`.
- How the version reaches the save: `write(dir, transcriptPath, got, opts)` has no place for it
  today. `latest` sets `got.version` (the `version` field of the newest record it read), the way
  it sets `got.whole` at line 526, and `write` passes it to `sawVersion`.

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
const t = formatCheck(toolCallsOnly);   // over 20 KB, the tail holds only tool calls and their results
ok(t.prompts === 0 && t.turns === 0, 'a tail of tool calls alone: no prompt and no turn');
sawVersion(dir, '2026-11-18', '2.1.328'); sawVersion(dir, '2026-11-18', '2.1.328'); sawVersion(dir, '2026-11-19', '2.1.328');
ok(readFileSync(join(dir, VERSIONS), 'utf8') === '2026-11-18 2.1.328\n2026-11-19 2.1.328\n');
sawVersion(dir, '2026-11-19', '2.1 && rm'); ok(!readFileSync(join(dir, VERSIONS), 'utf8').includes('rm'), 'only /^[0-9A-Za-z.+-]{1,40}$/ is saved');
```

  `doctor`, exact texts from the table in spec 6: the `ok` line; the `PROBLEM` line for a missing
  needed field, ending with the `Next:` sentence; the same `PROBLEM` when the tail holds at least
  one prompt the user typed and a reply and no turn comes out; the `note` for a missing optional
  field; the `note` `conversation files: none large enough to check yet`; and a `note` with the
  text `Claude Code versions seen here: 2.1.328 since 2026-11-18, 2.1.327 since 2026-11-15`
  (newest three, each with its first day). A save through `write` adds the line under the same
  lock; a failed write of `.versions` never fails the save.

  **Which file `doctor` checks** (spec 6: the newest finished one). Three tests:
  - With `CLAUDE_CODE_SESSION_ID` set to the id of the newest file, that file is left out and the
    one before it is checked. With no other file over 20 KB: the "none large enough" note.
  - Without the variable, a file written in the last 60 seconds is left out (give the others an
    older time with `utimesSync`).
  - The newest finished file is `toolCallsOnly`: `doctor` prints the `note`
    `conversation files: the newest one ends in a long run of tool calls, cannot check it` and no
    `PROBLEM`. A tail of tool calls alone is never a `PROBLEM`.

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. `formatCheck` reads the tail with the reader
  `turns()` uses and drops the first, cut line. **Step 4:** Suites green. Commit (check, versions:
  two commits), push, PR.

### Task 8: `clean` for dead stores

**Files:**
- Modify: `store.mjs` (`mountRoot`), `memory.mjs` (`sizeOf`, `remove`, `KEPT`, `emptyStore`, `dead`,
  the `clean` command, `doctor`, `table` at 1106: `clean: ['--yes']`, `USAGE`),
  `skills/memory/SKILL.md`
- Test: `store.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces: `mountRoot(path, platform = process.platform) -> string`;
  `sizeOf(path) -> number` (bytes, 0 when missing; a link counts as a link and is never followed);
  `remove(path) -> void` (a link is removed as a link, a real folder with
  `rmSync(path, { recursive: true, force: true })`; throws with the path when it cannot delete);
  `KEPT`, the "do not save" marks that live in a store, as paths under the `memory` folder;
  `emptyStore(dir, keep = KEPT) -> number` (removes what is in a `memory` folder apart from `keep`,
  gives the bytes removed; the folder itself stays);
  `dead(stores, exists = existsSync, platform = process.platform) -> { dead: [{ dir, cwd, bytes, last, notes, conversations }], unknown: number }`.
  Task 9 uses `sizeOf`, `remove` and `KEPT`.
- `sizeOf` and `remove` look at the path with `lstatSync` before anything else. Neither holds a
  walk of its own (list, then delete each file): that goes through a Windows junction and deletes
  the files it points to (spec, "Facts checked").

**Read first:** where each "do not save" mark of spec 7d lives, as a table in the RESUME (task 9
reuses it). Known from v1.5.3: in a store, `.project-off` (`PROJECT_OFF`), `.off-periods`
(`OFF_PERIODS`) and the forget list `journal/.forgotten` (`FORGOTTEN` in `handoff-log.mjs`, line
907); under the projects folder, `.hash-salt` and the `.nudge` folder. Find `.memory-off` (`OFF`)
and `.private-sessions` (`QUIET`) the same way. **The forget list sits inside the `journal`
folder:** the folder is emptied around it, never removed whole. And one run by hand in a temp
home: after `clean --yes`, does `restore` bring back a note of the cleaned store? Write the answer
into the PR body and give it to task 12.

- [ ] **Step 1: Write the failing tests.**

```js
ok(mountRoot('C:\\Users\\x\\app', 'win32') === 'C:\\');
ok(mountRoot('\\\\nas\\share\\proj\\a', 'win32') === '\\\\nas\\share\\');
ok(mountRoot('/Volumes/Backup/proj', 'darwin') === '/Volumes/Backup');
ok(mountRoot('/mnt/d/proj', 'linux') === '/mnt/d');
ok(mountRoot('/media/kim/usb/proj', 'linux') === '/media/kim/usb');
ok(mountRoot('/run/media/kim/usb/proj', 'linux') === '/run/media/kim/usb');
ok(mountRoot('/home/kim/proj', 'linux') === '/' && mountRoot('/mnt', 'linux') === '/');
// dead(): `exists` and `platform` are injected, so no real drive is needed
ok(d.dead.map((x) => x.dir).join() === goneStore, 'the folder is gone and its drive is there');
ok(d.dead[0].notes === 2 && d.dead[0].conversations === 1, 'the list can say what would be lost');
ok(!listed(aliveStore), 'the folder exists');
ok(!listed(unpluggedStore) && d.unknown >= 1, 'Review Focus 5: the drive is missing, so it is left alone');
ok(!listed(noConversationStore) && !listed(noCwdStore), 'cannot tell is never dead');
ok(!listed(twoStartsOneAlive), 'dead only when none of its start folders exists');
ok(!listed(sharedStore), 'the shared store is never listed');
ok(!listed(otherSystemStore), 'a start folder like /home/x/app on win32, or C:\\x\\app on linux: cannot tell');
ok(!listed(linkStore) && !listed(linkedToStore), 'a memory folder that is a link, or that a link points to: cannot tell');
ok(!listed(marksOnlyStore), 'a store that holds nothing but marks is not listed');
```

  CLI, with `run([...])` and `r.status`, exact texts from spec 8:
  - `doctor` prints the note
    `N memory folders belong to projects whose folder is gone (X MB, last write YYYY-MM-DD): clean lists them`,
    and no such line when there is none or when the only dead store holds nothing but marks.
  - `clean` lists each dead store (start folder, size, last write, number of Claude's notes,
    number of conversation files left, store path) and ends with the two lines of the spec, the
    last one `Nothing was deleted. To delete them (the conversation files stay): clean --yes`.
    Every file is still there.
  - `clean --yes` prints `cleaned N memory folders, X MB. The conversation files stay.` The
    `memory` folder is still there, every `.jsonl` beside it too, and what is left in the folder
    is exactly the marks: one test pins the names (`.project-off`, `.off-periods`,
    `journal/.forgotten`, and what "Read first" found).
  - **A project that comes back.** After `clean --yes`, save one reply for that store from a
    conversation file that holds a forgotten exchange: the forgotten word is not in the journal.
  - **Review Focus 2.** In a dead store, `journal` is a junction (a symlink where the system has
    no junctions) to a folder with a file in it. After `clean --yes` the file is still there.
  - `clean` with nothing dead prints one line and exits 0; `clean --all` is refused by the option
    table.

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. `dead` checks the newest conversation file's
  start folder first and reads the others only when that one is gone. `clean --yes` calls
  `emptyStore` under `withLock`. **Step 4:** Suites green. Commit (helpers, `clean`: two commits),
  push, PR.

### Task 9: `erase`

**Files:**
- Modify: `store.mjs` (`ERASED`, `erasedAt`, `wasOff` at 227), `memory.mjs` (the `erase` command,
  `table` at 1106: `erase: ['--yes']`, `USAGE`), every file that makes text from old turns without
  asking `wasOff` (see "Read first"), `skills/memory/SKILL.md` (a row, per spec 7d), `README.md`
  (an "Uninstall" section)
- Test: `store.test.mjs`, `memory.test.mjs`, and the suite of each file "Read first" finds

**Interfaces:**
- Consumes: `sizeOf`, `remove`, `KEPT` (task 8), `VERSIONS` (task 7), `withLock`, and the existing
  code that cuts the automatic part of `handoff.md`.
- Produces, in `store.mjs`: `ERASED = '.erased'` (a file in the projects folder, beside
  `.hash-salt`, that holds the time of the erase in ms); `erasedAt() -> number` (0 when there is
  no mark). The function `wasOff(dir)` gives also says `true` for a turn with `t.ms <= erasedAt()`,
  and for a turn without a time once a mark exists.

**Read first, two tables, both into the RESUME before any code:**
1. **Every path the plugin writes** (path, what it is, class): each `join(projectsRoot(), ...)`,
   each dot-file constant in every module, the snapshots folder and how `memory-tier.mjs` makes
   it, `purge` in `memory.mjs`. Classes: saved content (delete), state or log (delete), "do not
   save" mark (keep; the list is in spec 7d, and task 8 wrote down where each one lives). Pick a
   sure sign that the snapshots folder is the plugin's, one that folders made by 1.5.x already
   carry.
2. **Every place that makes text from old turns** (place, asks `wasOff` today or not). The two
   callers of `wasOff` are `record` in `journal.mjs` (line 143) and `handoff` in `handoff-log.mjs`
   (line 805). Also look at the note written before a compaction, the briefing at session start,
   a subagent's report, `rescan` and `backfill`. A place that does not ask `wasOff` gets the rule
   and a test in this PR.

- [ ] **Step 1: Write the failing tests.** A temp home where every hook has run once, with two
  projects and two conversations in one of them, and where the user has forgotten one entry,
  turned one project off, turned memory off and on again once, and gone incognito in one
  conversation. `erase` takes no `--store`: every call is `run([...])`. `KEEP` is the test's own
  list of patterns for what may be left under the projects folder (conversation files, note
  files, the shared store, the marks of spec 7d); `MARKS` holds the paths of those marks in this
  home.

```js
// store.test.mjs
ok(erasedAt() === 0 && !wasOff(dir)({ ms: 5 }));
writeFileSync(join(projectsRoot(), ERASED), '1000');
ok(wasOff(dir)({ ms: 999 }) && wasOff(dir)({ ms: 1000 }) && !wasOff(dir)({ ms: 1001 }));
ok(wasOff(dir)({ ms: NaN }), 'a turn without a time stays out once a mark exists');
ok(wasOff(storeMadeLater)({ ms: 999 }), 'the mark holds for a store that did not exist at the erase');
// memory.test.mjs
r = await run(['erase']);
ok(r.status === 0 && /^erase would delete what project-memory saved on this computer:$/m.test(r.stdout));
ok(/^  journals +\d+ projects? +[\d.]+ [KM]B$/m.test(r.stdout) && /^  saved history +1 folder +[\d.]+ [KM]B /m.test(r.stdout));
ok(r.stdout.includes("It keeps your conversations (Claude Code's own files), Claude's notes, shared notes, the off switches and the list of what you asked to forget."));
ok(r.stdout.includes('After the erase only new exchanges are saved: nothing asked before it comes back.'));
ok(r.stdout.trimEnd().endsWith('Nothing was deleted. To delete: erase --yes') && existsSync(join(store, 'journal', today)) && erasedAt() === 0,
  'nothing deleted and no mark without --yes');
r = await run(['erase', '--yes']);
ok(r.status === 0 && /^erased [\d.]+ [KM]B\. Kept: conversations, notes, shared notes, off switches, the forget list\. Only new exchanges are saved from now on\.$/m.test(r.stdout));
ok(leftUnder(projectsRoot()).every((f) => KEEP.some((k) => k.test(f))), 'only conversations, notes, shared notes and the marks are left');
for (const f of MARKS) ok(existsSync(f), `kept: ${f}`);   // every name of spec 7d, .erased and .nudge/welcome too
ok(!existsSync(join(projectsRoot(), '.nudge', 'welcome-due')));
ok(readFileSync(join(store, 'handoff.md'), 'utf8').includes('my own line'), 'hand-written handoff lines stay');
// Review Focus 1: the plugin is still on, and the same conversation goes on
await stop(payloadWithOneNewExchange);
const j = journalText(store);
ok(j.includes(NEW_WORD) && !j.includes(OLD_WORD), 'the journal holds the new exchange and none from before the erase');
ok(!autoPart(store).includes(OLD_WORD), 'the automatic part of the handoff too');
ok(!j.includes(FORGOTTEN_WORD) && !j.includes(INCOGNITO_WORD) && !j.includes(OFF_PERIOD_WORD));
ok(!journalText(otherConversationStore).includes(OLD_WORD_2), 'another conversation of before the erase is not imported');
ok(isOff(offStore), 'an off project is still off');
const first = erasedAt(); await run(['erase', '--yes']); ok(erasedAt() > first, 'a second erase moves the mark later');
```

  Also:
  - **The mark is written first.** When `.erased` cannot be written (a folder of that name is in
    its place), `erase --yes` deletes nothing, says why and exits 1.
  - **Links (Review Focus 2).** A store whose `memory` folder is a link is left alone and listed
    as `not removed: <path> is a link`; the store it points to is erased under its own name.
    Inside a real `memory` folder, a `journal` that is a junction (a symlink where the system has
    no junctions) to a folder with a file in it: the junction is gone, the file is still there.
  - A snapshots folder without the plugin's sign is left, with the line
    `not removed: <path> was not made by project-memory`.
  - A read-only file inside the snapshots folder is deleted (`chmodSync(f, 0o444)` first); a path
    that cannot be deleted (patch `rmSync` with the suite's `meanwhile` helper to throw `EBUSY`
    for one path) is listed and the exit code is 1.
  - A `handoff.md` that holds only the automatic part is removed and its pointer line leaves
    `MEMORY.md`; so does the pointer to `journal.md`.
  - Each place of table 2 leaves out a turn from before the mark (one test per place).
  - `erase --all` is refused by the option table.
  - **Nothing saved yet.** In a home with old conversation files and no store, `erase --yes` still
    writes the mark and exits 0, and the next save imports none of the old conversations. Without
    `--yes` the list has no rows, and no mark is written.

- [ ] **Step 2:** Run: fail.
- [ ] **Step 3:** `ERASED`, `erasedAt` and the rule in `wasOff`; then each place of table 2.
  Suites green. Commit.
- [ ] **Step 4:** The command, per spec 7d: the mark first, then each store under its lock, then
  the snapshots folder and the files under the projects folder. `journal/` is emptied around
  `journal/.forgotten`. Commit.
- [ ] **Step 5:** The skill row: Claude runs `erase`, shows the list, and runs `erase --yes` only
  after the user says yes. README "Uninstall": `erase`, what stays, that the conversation files
  are Claude Code's, and how to stop saving (`/project-memory:memory-off`, or uninstall).
- [ ] **Step 6:** Suites green. Commit, push, PR.

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
- [ ] **Step 3: Replay.** A script that imports `signature` and `entries` (from `journal.mjs`) and
  reads the journals of every project for the last 30 days. It only reads: it writes nothing under
  the projects folder and starts no hook. **The plugin's own project is left out** (its journal is
  full of test runs that were meant to fail). A hit is a failed command whose signature matches an
  earlier failed command of another conversation in the same project, **when that conversation's
  newest entry is at least one hour older** (spec 5, step 3). It prints counts and writes the hits
  to a scratchpad file. Nothing is committed.
- [ ] **Step 4: Decide by the rule of spec 5.** Fewer than 5 hits: park. Otherwise read up to 20
  hits spread over the range, mark each useful or not with one line in
  `reports/error-recall-replay-1.6.0.md`. At least half useful: pass. Less: one change to the
  signature rule, one more replay. Still less: park, drop the branch, and write the numbers into
  the report and the RESUME.
- [ ] **Step 5: KIRE has the last word.** The hits hold text of real conversations: they stay in
  that local report. The RESUME, a commit message and a PR get the counts and nothing else. Tell
  KIRE in one line: the counts, pass or park, and the report's path. A pass is built (task 10)
  only after KIRE's yes. While KIRE reads, go on with task 11. No answer when task 12 is done:
  error recall stays out of 1.6.0, the branch stays, and the RESUME lists it under "Open for
  KIRE".

### Task 10: Error recall (only if 10a passed and KIRE said yes)

**Files:**
- Modify: `recall-error.mjs`, `recall-error.test.mjs`, `README.md`, `skills/memory/SKILL.md`
- Modify, the wiring: `hooks/hooks.json` (a `PostToolUseFailure` entry, matcher `Bash|PowerShell`,
  timeout 5, with a `statusMessage`, the same shape as the `enforce-hook.mjs` entries);
  `memory.test.mjs` (the timeouts map at 507 to 509 gets the new entry; the rule at 511 wants a
  `statusMessage` on every hook that is not `PreToolUse`); `deploy.mjs` (`HOOKS`, line 26);
  `mutate.mjs` (`FILES` 24, `suites` 27, which `check.mjs` reads at line 30); `coverage.mjs`
  (`FILES` 16, `SUITES` 17); `.github/workflows/test.yml` (one line after the suites, lines 40 to
  47); `mutants/recall-error.mjs`, the way `mutants/enforce-hook.mjs` is made
- Modify, the eval: `evals/answers/cases.json`, `recall-eval.mjs`, `recall-eval.test.mjs`
- Test: `recall-error.test.mjs`

**Interfaces:**
- Consumes: `signature` (10a), `entries` (`journal.mjs`), `storeOf`, `isOff`, `tag` (`store.mjs`),
  the `.nudge` folder path the way `compact-gate.mjs` builds it (line 90).
- Produces: `seen(dir, sig, { session, today, now }) -> { day, key } | null`;
  `line(payload) -> string | null`; the file run as a hook reads the payload from stdin like
  `enforce-hook.mjs` and prints one JSON line or nothing.

**Read first:** `enforce-hook.mjs` (the model for a fast fail-open hook); how incognito and private
entries are marked; the Claude Code changelog for the version that added `PostToolUseFailure`, and
whether an older version ignores an unknown hook or refuses the plugin; `claude plugin validate` on
the branch.

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
// the one-hour rule: Z is another conversation that hit the same error and is still going
ok(seen(storeWith(Z, { newestEntryAgoMin: 30 }), sig, { session: Y, today, now }) === null, 'a session open beside this one has no fix to read yet');
ok(seen(storeWith(Z, { newestEntryAgoMin: 61 }), sig, { session: Y, today, now }) !== null);
// Review Focus 6: PAIR is the live payload and the journal line of one real failure (step 3), text made up
ok(signature(PAIR.payload.error) === signature(PAIR.journalTail));
```

  Also nothing is printed when: memory is off for the project; the conversation is incognito; the
  old entry is forgotten; the old entry is private; the old entry is 91 days old; the entry's key
  does not match `/^[\w.:-]+$/`. With two old hits the newest is named.

- [ ] **Step 2:** Run: fail. Implement, in the order of spec 5 steps 1 to 5, the cheapest checks
  first. Green.
- [ ] **Step 3: Live check.** Deploy nothing. Under a new temporary configuration folder
  (`CLAUDE_CONFIG_DIR`, as in task 2), in a temp project: two headless sessions with
  `--plugin-dir <branch>`, each asked to run a command that fails the same way. Give the first
  one's journal entry a time over an hour back before the second starts. The second must receive
  the line (it is in the stream as hook output). Save the payload shape of that failure and the
  journal line of the first as the fixture `PAIR`, with made-up text. If the pair's signatures
  differ, fix `signature` so both agree and replay once more (10a step 3).
- [ ] **Step 4: Measure.** In a temp home, a made-up store with as many day files and bytes as the
  largest store on this PC (read its sizes only). `node recall-error.mjs < payload.json` there:
  under 300 ms. Slower: read fewer days first, newest day files first, stop at the first hit.
- [ ] **Step 5: The wiring** (the files listed above). `node check.mjs` green.
- [ ] **Step 6: The eval case `error-again`** (spec 2b, "One more case"): the tenth case, search
  set, 3 runs. `recall-eval.test.mjs` then pins `cases.length === 10` and the runs `5,5,3,3`. The
  seeded entry's `Ran` line is the journal line of `PAIR`.
- [ ] **Step 7:** README: what the line is, `PROJECT_MEMORY_ERROR_RECALL=0`, the Claude Code
  version that has the hook, and what an older version does with it (checked how: say it). Skill:
  one line, "when a hook says the same error was hit before, run `show` with that key before trying
  again". Commit, push, PR.

### Task 11: Plain-word messages

**Files:**
- Modify: `memory.mjs` (texts in `doctor`, in every refusal, and the `doctor` line of `USAGE`,
  line 36), `mutants/*.mjs` (find-texts), `skills/memory/SKILL.md` and `README.md` where they
  quote a changed text
- Test: `memory.test.mjs`

- [ ] **Step 1: Make the table first.** List every `say(...)` in `doctor`, the `ok` lines too
  (the one at line 946 says `the Stop hook`), and every line the CLI prints before it returns 1.
  For each: old text, new text, by the rules of spec 7b. The table is the PR body.
- [ ] **Step 2: Write the failing test** that walks every `doctor` problem case the suite already
  builds, plus the ones tasks 1 to 10 added, plus one healthy home:

```js
const CODE_WORDS = /\b(backfill|payload|transcript|Stop hook|PreToolUse|SessionStart|PreCompact)\b/;
for (const [name, out] of problemCases) {
  const lines = out.split('\n').filter((l) => /^PROBLEM/.test(l));
  ok(lines.length > 0 && lines.every((l) => /\bNext: \S/.test(l)), `${name}: every PROBLEM line names the next step`);
  ok(!CODE_WORDS.test(out), `${name}: no word from the code, in the ok and note lines too`);
}
ok(!CODE_WORDS.test(healthyDoctor.stdout) && !/^PROBLEM/m.test(healthyDoctor.stdout));
ok(!CODE_WORDS.test((await run(['--help'])).stdout));
```

  And for each refusal of the table, one assertion with the new text: it names what to type
  instead.

- [ ] **Step 3:** Run: fail. Change the texts, then the tests and the hand mutants that match old
  texts (grep each old text in `*.test.mjs` and `mutants/`). Text only: no behavior changes, no
  exit code changes. Green. Commit, push, PR. If task 10 merges after this PR, its texts pass the
  same test.

### Task 12: Welcome line and `docs/limitations.md`

**Files:**
- Modify: `memory-tier.mjs` (the `--stop` path: the early return for `SubagentStop` at line 707,
  the `systemMessage` at 780), `README.md` (a link)
- Create: `docs/limitations.md`
- Test: `memory-tier.test.mjs`

**Interfaces:**
- Produces: `welcome(payload, fresh) -> string | null`. `fresh` is read at the start of `--stop`,
  before the journal import and before anything is written. Two markers under the projects folder:
  `.nudge/welcome` (shown, or not needed) and `.nudge/welcome-due` (a new computer whose first
  save was not a real reply). Task 9 pins that `erase` keeps the first and removes the second.

**Read first:** the `--stop` path from its first line to where `systemMessage` is written; what
writes `.stop-ran`; how the reload notice is joined; **every path that saves without a real
`Stop`** (a subagent's report, a failed reply, a manual compaction: `grep -an hook_event_name`
in `memory-tier.mjs`, and the `manual` entry of `hooks/hooks.json`). Use `grep -a` on
`memory-tier.mjs`.

- [ ] **Step 1: Write the failing tests.** `TEXT` is the welcome text of spec 7a, word for word.
  `fresh()` makes a new temp home with nothing saved; `marker(h)` and `due(h)` are the paths of
  `.nudge/welcome` and `.nudge/welcome-due` in the home `h`.

```js
const a = fresh();
ok((await stop(a, stopPayload)).systemMessage === TEXT && existsSync(marker(a)), 'the first save on a new computer');
ok(!('systemMessage' in await stop(a, stopPayload)), 'never again');
ok(!('systemMessage' in await stop(homeWithJournal, stopPayload)) && existsSync(marker(homeWithJournal)), 'a 1.5.x user never sees it, and the check is not repeated');
ok((await stop(freshHomeWithOldConversations, stopPayload)).systemMessage === TEXT, 'Review Focus 7: old conversations are imported in this same save');
for (const ev of ['SubagentStop', 'StopFailure']) {
  const h = fresh();
  ok(!('systemMessage' in await stop(h, { ...stopPayload, hook_event_name: ev })) && !existsSync(marker(h)) && existsSync(due(h)), `${ev}: nothing shown, the welcome is due`);
  ok((await stop(h, stopPayload)).systemMessage === TEXT && existsSync(marker(h)) && !existsSync(due(h)), 'the next real reply shows it');
}
const b = fresh();
ok(!('systemMessage' in await stop(b, stopPayload, { off: true })) && !existsSync(marker(b)) && !existsSync(due(b)), 'not while memory is off');
ok((await stop(b, stopPayload)).systemMessage === TEXT, 'it shows after memory is turned on');
ok((await stop(fresh(), stopPayload, { reloadDue: true })).systemMessage === TEXT + '\n' + RELOAD_NOTICE);
```

  Also: a manual compaction on a new computer writes `.nudge/welcome-due` and the next real reply
  shows the line; a computer that is not new never gets `welcome-due`; an incognito conversation
  gets no welcome; two saves at the same moment print it once (the marker is made with the `wx`
  flag, the loser prints nothing).

- [ ] **Step 2:** Run: fail. **Step 3:** Implement. Order of the check: the marker
  `.nudge/welcome` first (one `existsSync`, the usual case), then `.nudge/welcome-due`, then the
  "new computer" probe of spec 7a. Not new: write the marker, print nothing. New and a real reply:
  write the marker, print. New and not a real reply: write `welcome-due`. Green. Commit.
- [ ] **Step 4: Write `docs/limitations.md`** from the list in spec 7c, with what the tasks really
  found: the three limits of the memory-use count (task 1); the trigger cases ran or were parked,
  and that the eval numbers come from a few runs (tasks 2 and 2b); plans, MCP writes, Code Mode and
  rewound turns, each built or waiting for a sample (tasks 5 and 6); whether `restore` brings back
  the notes of a cleaned store (task 8); what `erase` and `clean` leave (tasks 8 and 9); error
  recall built or parked (task 10); the journal sizes of this PC as numbers only; and that nothing
  was checked on a real Mac or Linux PC. Link it from the README. Commit, push, PR.

### Task 13: Release

**Files:**
- Modify: `.claude-plugin/plugin.json`, `.bestpractices.json`, `CHANGELOG.md`, `README.md`

**Read first:** the log in `reports/RESUME-1.5.3.md` for the exact release and deploy commands;
the v1.4.3 release notes as the model; the baseline and the wording table of task 2b in the
RESUME.

- [ ] **Step 1:** `/ponytail:ponytail-review` over `v1.5.4..master`. Fix every finding in small
  PRs. Re-review only the fixes.
- [ ] **Step 2: The release run.** Check the weekly usage first. Everything runs under a new
  temporary configuration folder. The trigger cases, only if task 2 shipped them:
  `claude plugin eval . --no-publish --trust-plugin --model sonnet --max-cost-usd 3 --json <path>`.
  Then once: `node recall-eval.mjs --plugin . --without --max-usd 20 --json <path>`. The v1.5.3
  baseline is the one of task 2b: it is not run again.
- [ ] **Step 3: The result against the target** (top of this plan): searches per implicit case of
  5, `no-need` of 3, beside the baseline. Put the numbers in the README as the spec says ("Numbers
  in the README"): date, model, Claude Code version, runs per case, both columns, the target and
  whether it was met, every failed case named. **Target missed: stop and tell KIRE** with the
  table. KIRE decides: release as it is, with the miss in the README and the release notes, or
  another wording first.
- [ ] **Step 4:** Version 1.6.0 in the two JSON files, the changelog, one commit. PR, green on the
  three systems.
- [ ] **Step 5: Stop here until KIRE says release.** Then merge, tag `v1.6.0`, publish
  "project-memory 1.6.0" with notes written for people, deploy with `deploy.mjs` from a fresh clone
  at the tag, run `doctor`.
- [ ] **Step 6:** Update the RESUME, the handoff and the memory note `project-1-6-0-roadmap`.

If the build stopped at one of the two release points ("PRs" above), this task runs on what is
merged, and the changelog names what moved to 1.6.1.

---

## Spec coverage

| Spec | Task |
|---|---|
| Why (the target) | 2b, result in 13 |
| 1 Memory use | 1 |
| 2a Trigger cases, 2b Answer cases | 2, the `error-again` case in 10 |
| 2c The wording that makes Claude search | 2b |
| 2 Numbers in the README, what it may cost | 2 (spike), 2b, 13 |
| 3a Relative dates, 3b Filters | 3, 4 |
| 4 Real samples before the build | "Before task 0" |
| 4 Reader first (1.5.4) | 0 |
| 4a Approved plans | 5 |
| 4b MCP writes, Code Mode, rewound turns | 6 |
| 5 Error recall and its gate | 10a, 10 |
| 6 Format check, versions | 7 |
| 7a Welcome, 7c Limitations | 12 |
| 7b Plain words | 11 |
| 7d `erase` | 9, helpers and the kept names from 8 |
| 8 Dead stores | 8 |
| Release | 0 (1.5.4), 13 |
| Open for KIRE | "Before task 0", 10a step 5, 13 steps 3 and 5 |

## Not checked when this plan was written

The spec's own list ("Not checked") holds here too. What a builder is most likely to meet:

- **The eval:** a run without a shell grant and its cost, the skill load in an empty workspace, a
  headless login under a temporary configuration folder, which `--settings` rule lets the search
  run. Task 2, step 1 answers them before any code.
- **The shapes of spec 4:** where an approved plan's text sits, what Code Mode, an MCP write and a
  rewind leave in the conversation file. "Before task 0" collects them; tasks 5 and 6 build only
  what a sample shows.
- **`erase`:** only the two callers of `wasOff` were read. The other places that make text from
  old turns are the second table of task 9.
- **`clean`:** whether `restore` brings back the notes of a cleaned store (task 8, "read first").
- **Error recall:** which Claude Code version added `PostToolUseFailure`, and what an older
  version does with the entry (task 10, "read first").
- **`doctor`:** `CLAUDE_CODE_SESSION_ID` was seen in a shell command under Claude Code 2.1.328 on
  Windows, on no other system or version. Without it the 60 second rule decides.
- **Links:** a junction was tried on Windows with Node 24 only. A symlink on a real Mac or Linux
  PC was not tried, like everything else there: CI is the only check on those systems.
- **Speed** of the memory-use count on a large projects folder (task 1 measures it).
- The helper names in the test sketches (`turnsOf`, `stop`, `hook`, `hookRaw`, `without`,
  `leftUnder`, `listed`, `storeWith`, `marker`, `due`, `toolUse`, `keyOf`, `journalText`,
  `autoPart`) are placeholders: use what each suite already has, or add a small local helper. The
  assertions and the exact texts are the contract.
- Line numbers are from v1.5.3 (366c983) and move as PRs merge.
- How the suites fix "today", how hand mutants can be checked without a full run, what writes
  `.stop-ran`, how the snapshots folder can be told apart: each is a "read first" in its task.
