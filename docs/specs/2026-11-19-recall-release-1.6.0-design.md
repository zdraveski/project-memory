# project-memory 1.6.0, the recall release: design

Written by Fable on 2026-11-19, on top of v1.5.3 (366c983). KIRE picked the scope the same day:
items 1 to 8 of the roadmap proposal, item 9 dropped. Opus builds it from the plan in
`docs/plans/2026-11-19-recall-release-1.6.0.md`.

Revised the same day after an audit of this spec and its plan: 37 findings, all applied here and in
the plan.

## Why

1.5.1 to 1.5.3 made saving solid. What is saved is rarely read. In the 14 days before this spec,
Claude searched the journal in 1 of about 40 sessions outside the plugin's own project, and after
45 searches it opened a whole entry 4 times. 1.6.0 does four things about that, in this order:

1. Measure how much memory is used.
2. Show with numbers that it helps.
3. Tune what makes Claude search: the memory skill's description and the line at session start.
4. Bring recall to the moments where it clearly pays, and close the holes a new user would fall
   into.

**The goal, as a number.** In the answer eval of section 2b, Claude runs a memory search in at
least 4 of 5 runs of each implicit case (a question that does not sound like recall), and in no run
of the case that needs no memory. The baseline is the same eval on v1.5.3, run before any wording
is changed. The release reports the result against this target, also when the target is missed: a
missed target goes into the README and the release notes with its numbers, and KIRE decides whether
to release.

## Scope

| # | Item | PR |
|---|---|---|
| | Before 1.6.0, as 1.5.4: the journal reader learns `Plan` and `Undone` (section 4, "Reader first") | 0 |
| 1 | Memory use in `status` and `doctor` | 1 |
| 2 | Eval suite, numbers in the README; then the wording that makes Claude search | 2, 2b |
| 3 | Search takes the question as asked: relative dates, then filters | 3, 4 |
| 4 | Save what the journal misses: approved plans; MCP writes, Code Mode, rewound turns | 5, 6 |
| 6 | Format canary: `doctor` checks the conversation file format, the store records Claude Code versions | 7 |
| 8 | Dead stores: listed by `doctor`, removed by `clean` | 8 |
| 7 | Ready for a stranger: `erase`, plain-word messages, welcome line, `docs/limitations.md` | 9, 11, 12 |
| 5 | "You hit this error before", only if its replay passes the gate | 10 |
| | Release | 13 |

That is 13 build PRs and the release PR, 12 if item 5 fails its gate. PR 0 comes before them and
is a release of its own, 1.5.4.

**Out of scope:** item 9 of the proposal (the small capture fixes), everything the proposal lists
under "held for 1.6.1" and "not in 1.6.0" (speed, checked lessons, moved folders, search ranking,
recall on every prompt, the regex holes, sync between computers).

## Rules for every item

- **The journal comes from the conversation file only.** No item reads a file from disk to build an
  entry (a plan file, an MCP server's output). A backfill a month later must give the same entry.
- **Hooks fail open.** A new hook that throws, times out or reads a file it does not understand
  prints nothing and exits 0.
- **A hook never puts saved text into the conversation.** A recall line names a date and a key.
  Claude opens the entry with `show` if it wants the text.
- **No network, no dependencies, Node 22 or newer.** As before.
- **Every new message is plain words** and, when it reports a problem, ends with one next step.
  Every new message is pinned by a test.
- **Test fixtures are made up.** Nothing from a real conversation file goes into the repo: a real
  file is read to learn its shape, then a fixture with the same shape and invented text is written.
- **Every new delete lists first.** A command that deletes prints what it would delete, with sizes,
  and deletes only with `--yes`. It never deletes a conversation file.
- **A delete never undoes a "do not save".** `erase` and `clean` keep every mark that tells the
  plugin not to save something (the list is in section 7d). Without those marks the next save
  would bring back what the user removed.
- **A delete never follows a link.** A link (a symlink or a Windows junction) is removed as a link.
  What it points to is never read for sizes and never deleted.
- **A paid or headless test never touches the real memory.** Every `claude` session a test or an
  eval starts runs with its own temporary configuration folder (section 2b).

## Facts checked on 2026-11-19

- `claude plugin eval` exists (needs Claude Code 2.1.269 or newer; this PC has 2.1.328). On native
  Windows it refuses any run that grants a shell tool: "A shell tool (Bash or PowerShell) was
  granted but this machine cannot confine it ... so the run was refused rather than run
  unconfined". The refusal cost nothing. The memory search needs a shell, so the official tool
  cannot test answers here. A run with no shell grant was not tried.
- The official docs say a sandboxed run cannot read the home folder or the Claude Code
  configuration. The store lives there, so the search would probably fail under the sandbox on
  Linux and macOS too. Not tested.
- `claude plugin eval` publishes its HTML report to claude.ai unless `--no-publish` is passed.
- WSL2 on the build PC has `claude` 2.1.146 (too old), no `node`, no `socat`. Installing them needs
  KIRE's yes.
- `ExitPlanMode` takes no plan text. Its tool description says "This tool does NOT take the plan
  content as a parameter - it will read the plan from the file you wrote". Where an approved plan's
  text sits in the conversation file is unknown.
- In 406 conversation files on the build PC there is no real `ExitPlanMode` call, no `REPL` call
  (Code Mode) and no MCP tool that writes a file. One file holds two prompts under one parent
  record, which is what a rewind or an edited prompt should look like. Its path is in the build's
  resume file, not in this repo.
- `PostToolUseFailure` is a documented hook: it fires when a tool call fails, the matcher is the
  tool name, and the payload holds `session_id`, `transcript_path`, `cwd`, `tool_name`,
  `tool_input`, `tool_use_id`, `error` (for Bash and PowerShell the first line is `Exit code N`,
  then the output, cut in the middle when long), `is_interrupt`, `duration_ms`. It answers with
  `{"hookSpecificOutput": {"hookEventName": "PostToolUseFailure", "additionalContext": "..."}}`.
  Which Claude Code version added it is unknown.
- Every user and assistant record in a conversation file holds `version`, the Claude Code version.
- The journal already saves a failed command as `<command> → failed: <last 300 characters of the
  result>` on the `Ran` line (since 1.5.0).
- An unknown line inside a journal entry is kept as loose text after the entry by the 1.5.3 reader,
  and written back after the entry's fields. Its `forget` does not search that text, and when the
  entry is deleted the text moves up to the entry before it. So a session that still runs 1.5.3
  could leave a forgotten plan in the journal, under the wrong exchange. That is why the reader
  ships first (section 4).
- One function, `record` in `journal.mjs`, writes every journal entry: the save after a reply, the
  import of older conversations and the subagent reports all go through it. It skips a turn asked
  while memory was off (`wasOff` in `store.mjs`) and a turn on the forget list. The automatic part
  of the handoff asks `wasOff` too.
- The store's place follows `CLAUDE_CONFIG_DIR`: `projectsRoot()` in `store.mjs` reads it on every
  call.
- A store's `memory` folder can be a link to another project's store. Tested on Windows with Node
  24: `rmSync` on a junction removes the junction and leaves its target alone; a hand-written walk
  (list, then delete each file) deletes the target's files.
- The saved history (a local git repository under the projects folder) holds the notes after each
  reply that changed one, and each finished day's journal file.
- Claude Code deletes a conversation file after 30 days without use, by default. For an old project
  the journal can be the only copy of an exchange.

---

## 1. Memory use in `status` and `doctor`

**What it does.** `status` prints one more line per project, and `doctor` prints the same line as a
note:

```
memory use, last 7 days: 3 searches, 1 entry opened, 2 notes read, 4 direct file searches, in 2 of 9 conversations
```

**How it counts.** From the project's main conversation files changed in the last 7 days, records
with a timestamp in the last 7 days. Subagent files in subfolders are not read; subagent records
inside a main file count.

- A search: a shell command (`Bash`, `PowerShell`, a context-mode `ctx_execute` or `ctx_batch`)
  that holds `memory.mjs` followed by the word `search`. Two in one command count as two.
- An entry opened: the same with `show`, or a `Read` of a file under the store's `journal/` folder.
- A note read: a `Read` of an `.md` file in the project's store or in the shared store, outside
  `journal/`.
- A direct file search: a `Grep` or `Glob` whose path is inside the project's store or the shared
  store, or a shell command that holds `grep`, `rg`, `findstr` or `Select-String` as a word and
  names one of those two stores (the store's folder name, a slash of either kind, then `memory`).
  Claude sometimes reads the files this way and skips the CLI; without this number `status` would
  show less use than there is.
- "in 2 of 9 conversations": conversation files with at least one of the four, of all counted.
- Loading the memory skill is not counted: a skill load alone reads no memory.

**Exact texts.**

| Case | Line |
|---|---|
| all ones | `memory use, last 7 days: 1 search, 1 entry opened, 1 note read, 1 direct file search, in 1 of 1 conversation` |
| nothing used | `memory use, last 7 days: none in 9 conversations` |
| no conversation in 7 days | `memory use, last 7 days: no conversations` |

In `status` the line is indented like the other lines of a project.

**Limits.** It cannot tell a real question from a test of the search. It cannot tell how many
conversations needed a search. The briefing at the start of a session is memory use too and is not
counted. These three lines go into `docs/limitations.md`.

**Speed.** Read each file in pieces with the journal's own reader, and parse only lines that hold
the word `memory`. No new logging. No cache, unless `status`
on the largest project of the build PC takes more than 2 seconds longer than before: then a
per-file cache keyed by size and change time, the way `.enforce.json` works.

## 2. Eval suite

Two layers, because the official tool cannot run the search here.

### 2a. Trigger cases, with `claude plugin eval`

An `evals/` folder with four cases that need no shell. Each case asks one question in an empty
workspace and checks whether Claude loads the memory skill.

- **What it can show:** only whether the skill's description makes Claude load the skill. The
  workspace has no store, so the line at session start is missing. Whether Claude then searches and
  answers right is 2b's job.
- **It ships only if it ran.** If the spike below shows that a run without a shell tool is refused
  on the build PC too, 2a is parked: no `evals/` folder goes into the repo with cases nobody ran,
  and the README says nothing about trigger cases.

| Case folder | Prompt | Passes when |
|---|---|---|
| `asks-about-last-week` | What did we decide last week about the login page? | the memory skill is loaded |
| `asks-general-advice` | Is it worth adding a cache to the price lookup? | the memory skill is loaded |
| `asks-never-done` | Have we ever set up automatic backups for this project? | the memory skill is loaded |
| `plain-coding-task` | Write a JavaScript function that reverses a string. Just the code. | the memory skill is not loaded |

`prompt.md` frontmatter for every case: `runs: 3`, `max_turns: 3`, `model: sonnet`,
`allowed_tools: [Skill, Read, Glob, Grep]`. The grader is `type: tool_used`, `tool: Skill`,
`input_match: '"skill"[ ]*:[ ]*"([a-z-]+:)?memory"'`, `arm: with-only`, with `min: 1` for the
first three and `min: 0`, `max: 0` for the last. Grader patterns use single quotes and no
backslashes: a double-quoted pattern with backslashes failed to parse on 2026-11-19.

The command, always with `--no-publish`:

```
claude plugin eval . --no-publish --trust-plugin --model sonnet --max-cost-usd 3 --json <path>
```

`evals/results/` goes into `.gitignore`.

### 2b. Answer cases, with a small harness

`recall-eval.mjs` in the repo root, a developer tool like `bench.mjs`. It automates the house
recall test: headless `claude -p` sessions in a throwaway project whose journal holds made-up
facts, with the plugin and, when asked, without it.

```
node recall-eval.mjs --plugin <dir> [--set answer|search] [--without] [--runs N] [--case <name>] [--model sonnet] [--max-usd 20] [--json <path>]
node recall-eval.mjs --self-check
```

`--set` runs one of the two case sets below (default: both). `--without` adds the arm without the
plugin. `--runs N` replaces every case's own number of runs.

**It never touches the real memory.** The harness and every session it starts run with
`CLAUDE_CONFIG_DIR` set to one new folder under the OS temp folder. The stores, the conversation
files and the saved history of the test projects all land there. The real projects folder, the
real shared notes and the real history are never read and never written. The folder holds a way to
log in and nothing else.

How the login gets there is the first thing the build finds out, from the Claude Code
documentation: a login file copied into the folder, or a long-lived token passed in the
environment. A copied login is used only if the documentation says a copy is safe: if the copy
renews the login, the real one could stop working and every open session would be logged out. If
no safe way exists, the harness is not built, KIRE is told, and nothing is run against the real
folder in its place.

**What a run does.**

1. Sweeps what a killed earlier run left: every folder under the OS temp folder with the harness's
   own name prefix that no running harness holds.
2. Makes the configuration folder and one throwaway project folder per session, all under the OS
   temp folder, so no session works in a folder another one used. Each project gets the same small
   source files.
3. Seeds the store of every "with" project through the journal's own writer (`journal.mjs` of the
   repo the harness runs from), with the entries below, dated from the run day. A "without"
   project gets no store: without the plugin nothing would have been saved.
4. Checks the seed before any paid session: `search port` on one seeded store must find the entry,
   or the run stops with an error.
5. Runs each case its own number of times in the "with" arm, and with `--without` once more in the
   "without" arm, 4 sessions at a time: `claude -p "<question>" --output-format stream-json
   --verbose --model <model>` with the project folder as the working directory. "With" adds
   `--plugin-dir <dir>`. Both arms pass a `--settings` file that turns an installed copy off
   (`{"enabledPlugins": {"project-memory@project-memory": false}}`) and allows only what the memory
   skill needs: the `Skill` tool, `Read`, `Grep`, `Glob` and the shell command that runs
   `memory.mjs`. The temporary configuration folder has no settings of its own, so without that
   rule a headless session could not run the search at all.
6. Grades each session: the final answer text against the case's pattern, and whether a memory
   search ran. Adds up `total_cost_usd` from each session's result record.
7. Stops starting sessions when the sum reaches `--max-usd`, marks the rest "not run" and exits 2.
8. Always, also after an error and after Ctrl+C: copies the sessions' conversation files next to
   the results file (they hold only the made-up facts, and a failed case can be read there), then
   deletes the project folders and the configuration folder with everything in it.
9. Prints a table (case, right answers, searched, without, cost) and writes the same as JSON.

It refuses to start when the configuration folder or a project folder is not under the OS temp
folder, so the clean-up can never delete a real store.

**A memory search** is, for the grader: a shell command that runs `memory.mjs` with `search` or
`show`, or a direct read of the store's files as section 1 counts them (`Read`, `Grep`, `Glob`, a
shell `grep`). Loading the memory skill alone is not a search.

**One limit.** All sessions of a run share the configuration folder, so `search --all` in one
session can see what another test session saved. Every store holds the same made-up facts, so no
case passes or fails because of it.

**Seeded entries** (project "bookshop", all invented; D is the run day):

| Day | Asked | Answered (the fact) | Also |
|---|---|---|---|
| D-2 | which port should the dev server use | port 4317, because 3000 and 8080 are taken by the other two apps | |
| Wednesday of the previous calendar week | the nightly export is one day off | cause: `closeDay()` took the date in UTC; fix: compute the day in Europe/Vienna | Changed `src/closeDay.js`, Ran `npm test` |
| same day | should we keep the PDF export | decision: drop the PDF export, keep CSV only; nobody downloaded a PDF in 90 days | |
| D-5 | what is the staging database called | staging uses `shop_stage_b`; the old `shop_stage` is read-only | |
| D-20 | the deploy fails | fixed by running the deploy as the `deploy` user: `chown -R deploy /var/app/releases` | Ran `npm run deploy → failed: EACCES: permission denied, open '/var/app/releases/current'` |

**Cases.** Two sets. The answer set asks questions that sound like recall; they already scored 6 of
7 on 2026-11-12, so two runs each are enough to see a break. The search set asks questions that do
not sound like recall: that is where Claude fails to search, and it carries the goal of this
release, so its cases run five times.

| Case | Set | Runs | Question | Passes when |
|---|---|---|---|---|
| `port` | answer | 2 | Which port did we pick for the dev server, and why? | the answer matches `4317` |
| `last-week-bug` | answer | 2 | What was the cause of the export bug we fixed last week? | the answer matches `UTC\|time ?zone` (any case) |
| `decision` | answer | 2 | Did we decide to keep the PDF export? | the answer matches `CSV` |
| `staging-db` | answer | 2 | What is the staging database called? | the answer matches `shop_stage_b` |
| `error-fix` | answer | 2 | The deploy fails with EACCES again. What fixed it last time? | the answer matches `deploy user\|chown` (any case) |
| `never-discussed` | answer | 2 | Which payment provider did we choose? | the answer does not match `Stripe\|PayPal\|Adyen\|Braintree\|Mollie` (any case) |
| `port-implicit` | search | 5 | Which port should the dev server use? | a memory search ran, and the answer matches `4317` |
| `pdf-implicit` | search | 5 | Should we keep the PDF export? | a memory search ran, and the answer matches `CSV` |
| `no-need` | search | 3 | Write a JavaScript function that reverses a string. Just the code. | no memory search ran |

Two cases are controls. `never-discussed` must pass in both arms: memory does not make Claude
invent an answer. `no-need` must pass with every wording of section 2c: a text that makes Claude
search more must not make it search for everything.

**One more case, only if item 5 ships:** `error-again`, search set, 3 runs. The project holds a
script `deploy.js` that prints the seeded EACCES line and exits 1, and the `--settings` file allows
that one command too. Question: "Run `node deploy.js` and tell me what to do about the result." It
passes when a memory search ran after the failed command and the answer matches `deploy
user|chown` (any case). The seeded D-20 entry's `Ran` line is then written the way the journal
saves that exact failure (the fixture pair of section 5 gives the text), so both give the same
signature.

### 2c. The wording that makes Claude search

Two texts decide whether Claude searches before it answers: the `description` in the frontmatter
of `skills/memory/SKILL.md`, and the line about the journal that the briefing prints at session
start (`handoff-log.mjs`). No other item of 1.6.0 touches them. Without this step the release
could measure the problem and leave it as it is.

1. Baseline: the search set on a clean v1.5.3 checkout. The numbers are written down before any
   text changes.
2. If the baseline already meets the target (see "Why"), nothing is changed, and the PR says so.
3. Otherwise up to 3 wordings are tried, one at a time. Each is a copy of the plugin with only
   those two texts changed, run with the search set. A wording with which `no-need` searches even
   once is out.
4. The wording with the most searches on the two implicit cases is kept; at a tie, the shorter
   text. If none beats the baseline by at least 2 searches of 10, the old text stays: a change
   nobody can measure is not shipped.
5. The PR shows a table: wording, searches per case, `no-need`, cost. It shows it also when the
   target is missed.

The new description is no longer than the old one: every session of every user pays for it.

**Not built:** a hook that tells Claude to search on every prompt (out of scope above), more than
3 wordings, a wording per model.

### Numbers in the README

A short section with the date, the model, the Claude Code version and the number of runs per case;
the trigger cases with their pass counts (if 2a ran); the answer cases with both columns; the
search cases with the v1.5.3 baseline beside the release; the target and whether it was met; each
failed case named with one line on what went wrong. One sentence says that the "without" column is
the floor: without the plugin there is nothing to look in. One sentence says that five runs show a
direction, not a rate. No claim beyond the table.

### When it runs, and what it may cost

- Before a release, never in CI and never on every PR. It uses the subscription, so check the
  weekly usage first.
- First a spike: one trigger case with `--runs 1` and `--max-cost-usd 0.50`, and one answer case
  with `--runs 1`. The spike answers four open questions: does a no-shell eval run work on this
  PC, does the skill load in an empty workspace, does a session log in under the temporary
  configuration folder, and what does one session cost.
- The runs, with the price of 2026-11-12 (2.97 USD for 7 sessions, about 0.42 USD each):

  | Run | When | Sessions | About |
  |---|---|---|---|
  | baseline: search set on v1.5.3 | PR 2b | 13 | 5.50 USD |
  | each wording: search set | PR 2b, at most 3 | 13 | 5.50 USD |
  | release: both sets with `--without` on the release candidate | PR 13 | 34 | 14.50 USD |

  All of it is about 36 USD if three wordings are tried, 3 sessions and about 1.30 USD more per
  run of the search set if `error-again` is in.
- The "without" arm runs once, in the release run: it does not depend on the plugin's version.
- If the spike's price says a run would pass its cap (`--max-usd 8` for a run of the search set,
  20 for the release run), cut first the answer set to 1 run, then the wordings to 2. The search
  set keeps its runs: it carries the goal.

**Not built:** a run on GitHub (needs an API key as a secret), a run inside WSL (needs installs and
would probably still fail on the store), LLM graders.

## 3. Search takes the question as asked

### 3a. Relative dates

`--since` and `--until` take, on every command that has them:

| Word | As `--since` | As `--until` |
|---|---|---|
| `2026-10-01` | that day | that day |
| `today` | today | today |
| `yesterday` | yesterday | yesterday |
| `7d` (any `Nd`, N from 0 to 3650) | N days before today | the same |
| `2w` (any `Nw`, N from 1 to 520) | 7 x N days before today | the same |
| `last-week` | Monday of the previous calendar week | Sunday of that week |

Days are local calendar days. A week starts on Monday. Words are matched in any letter case.

One pure function does it: `dayOf(word, today, end = false)` gives `YYYY-MM-DD` or `null`. It works
on calendar dates, never on hours, so a clock change cannot shift it.

**Texts.** A value it cannot read: `--since takes a date like 2026-10-01, or 7d, 2w, today,
yesterday, last-week` (the same for `--until`), exit 1. When a word was given, the command's first
output line names the day it stands for: `since 2026-11-12 (7d)`, or with both
`since 2026-11-09 (last-week), until 2026-11-15 (last-week)`. A value given as a date prints no
such line. `forget --since 7d` prints the line before its list, so the days are visible before
anything is deleted.

**A word is never used to delete.** A list made before midnight and a delete made after it would
mean different days. So the list's last line names the delete with the dates it used
(`... forget --since 2026-11-12 --yes`), and the skill tells Claude to run that line as printed,
or to delete by `--key`, and never to repeat the word.

**Not built:** `this-week`, `last-month`, weekday names, hours.

### 3b. Filters

| Option | On | Meaning |
|---|---|---|
| `--conversation <tag or id>` | `search` | only journal entries of that conversation; the same matching `forget --conversation` uses |
| `--journal` | `search` | only the journal |
| `--notes` | `search` | only notes |
| `--project <name>` | every command that takes `--store` | the store of the project with that name |

- `--notes --journal` together is the default. `--notes --conversation` is refused:
  `--conversation searches the journal: drop --notes`.
- `--project` matches the name, in any letter case, against the last folder name of each project's
  start folder. If none matches, against any part of the start folder's path.
- Several matches: it prints `--project app matches 2 projects:` and one line per match with the
  start folder and `--store <path>`, and exits 1. A short word can match many projects through the
  path; the answer is always this list, and nothing else runs.
- No match: `--project app matches no project: search --all names them`, exit 1.
- With `--store`, `--shared` or `--all` it is refused: `--project cannot go with --store` (or the
  other name).
- It only ever resolves to a store that `--all` already reads, so it opens no new path.

The skill's command table and the CLI help name all of 3a and 3b, with one example each for "last
week" and "in the app project".

## 4. Save what the journal misses

**The order of an entry's lines, written once.** The heading, then `Asked`, `Answered`, `Changed`,
`Ran`, then `Plan`, then `Undone`. `Plan` and `Undone` are new and optional. The entry marker is
not changed.

**Real samples before the build.** None of the four things below has a real record in the 406
conversation files of the build PC, apart from one candidate for a rewind. Before the first PR of
1.6.0, the builder makes the samples (an approved and a rejected plan, a Code Mode run, an MCP tool
that writes a file) and reads their shape. The two plan samples need KIRE: two clicks, asked for
before the build starts. A part with no real sample is not built: its tests would pin a made-up
format. It goes into `docs/limitations.md` and waits for a later release.

### Reader first: 1.5.4

A session that was open before an update keeps running the old version until it is reloaded. The
1.5.3 reader does not know `Plan` and `Undone` (see "Facts checked"): it holds them as loose text,
its `forget` does not search them, and deleting the entry moves them to the entry before. So the
reader ships first, alone, as 1.5.4:

- It reads `**Plan:**` and `**Undone:**` as fields of the entry, in the order above.
- `forget`, `rescan` and `incognito` treat both like every other field: a word that is only in the
  plan finds the entry, and a deleted entry takes its plan with it.
- A rewrite of a day file writes both back where they were.
- `show` prints them, `search` finds words in them.
- It never writes either line itself. Nothing a user can see changes in 1.5.4.

1.6.0 then only adds the writing (PRs 5 and 6). A session still on 1.5.3 or older is the one case
left. Since 1.5.3 such a session shows `project-memory <version> is installed, run /reload-plugins
to use it`, and the 1.6.0 release notes say: reload or restart open sessions before you use
`forget`.

### 4a. Approved plans

**What it does.** A turn in which the user approved a plan gets one more journal line, after `Ran`:

```
**Plan:** <the plan's text, on one line>
```

- Redacted, squeezed to one line and cut at 50,000 characters like `Asked` and `Answered`.
- Only an approved plan. A rejected plan, or one the user answered with changes, saves no line.
- A private turn saves no plan. And a plan whose text was written in a private turn is never
  saved, also when a later turn approves it: the reader never takes text from a private turn's
  tool calls. If any write of the plan file happened in a private turn, no `Plan` line is built.
- `show` prints the line. `search` finds words in it, ranked like `Answered`. A hit line and a day
  listing end with ` · plan approved` for an entry that holds one.
- `forget` treats the plan like every other field: a word that is only in the plan finds the entry.
- `rescan` and `incognito` treat the plan like every other field. A test pins each.

**Where the text is.** Read from the two real samples. Three places to look, in this order: a
structured field on the tool result record (`toolUseResult`), the text of the tool result, the
`Write` or `Edit` calls of the plan file earlier in the same conversation (never those of a private
turn, see above). The reader takes the first that holds the text. If none holds it, the plan's path
goes into `Changed` (it already does when `Write` made it), no `Plan` line is built, and the gap
goes into `docs/limitations.md`.

### 4b. Other writes, Code Mode, rewound turns

**MCP tools that write a file.** `Changed` gets the path when all three hold:

- the tool name starts with `mcp__`;
- its last part (after the last `__`) starts with `write`, `edit`, `create`, `append`, `save`,
  `update`, `replace` or `insert`;
- the input holds a string under `path`, `file_path`, `filePath`, `filepath`, `file`, `filename`,
  `notebook_path` or `destination`.

A call with `dryRun: true` or `dry_run: true` is skipped. A call the user refused or that failed is
skipped the way a refused `Edit` is. The path is cut at 300 characters like every other.

The same path then shows in two more places that read the same function: the `changed:` line of
the handoff and the note written before a compaction. A test pins each. The rule is built only
with one real record of an MCP tool that wrote a file (see "Real samples").

**Code Mode.** First run one real conversation with `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1` and
read its file. Then:

- If the inner tool calls of a script are recorded under their own names, nothing changes, and a
  test pins it.
- If only the `REPL` call is recorded, its `tool_input.code` goes into `Ran`, cut like a command.
  Files a script wrote stay out of `Changed`; that goes into `docs/limitations.md`.
- If Code Mode cannot be turned on at all on this PC, nothing is built and the limit is written
  down.

**Rewound turns.** Read the candidate file named under "Facts checked". Build a made-up fixture
with the same shape (a prompt, a reply, then a second prompt under the same parent). The test pins
two things: no entry is lost, and no entry is saved twice. Marking the undone entry is built only
if the file shows one certain sign of the rewind in a record field; then the entry's heading stays
as it is and the entry gets a line `**Undone:** rewound <time>`, the last line of the entry.
Without such a sign nothing is marked, and `docs/limitations.md` says that undone turns stay in
the journal.

**A rewound turn stays saved.** The user took the turn back, and the journal still holds it. That
is a privacy fact, so `PRIVACY.md` says it in its own paragraph, marked or not: an exchange you
rewind stays in the journal; `forget` removes it.

## 5. "You hit this error before"

Built only if the gate below passes.

**What it does.** When a shell command fails, and an earlier conversation in the same project hit
the same error, Claude gets one line:

```
project-memory: the same error was hit on 2026-11-12 in another conversation. Before trying again, read what was done then: memory skill, show "<key>"
```

**How.** A new hook, `PostToolUseFailure` with the matcher `Bash|PowerShell`, a 5 second timeout,
in a new small file `recall-error.mjs`.

1. Skip when `is_interrupt` is true, when the error holds `Command timed out`, when
   `PROJECT_MEMORY_ERROR_RECALL=0`, when memory is off for the project, when the conversation is
   incognito.
2. Signature: the last 300 characters of `error`, squeezed to one line the way the journal squeezes
   a failed result; every run of digits becomes `#`; every path becomes its last part; spaces are
   collapsed; the last 120 characters of that. A signature shorter than 20 characters is ignored.
3. Look in this project's journal, the day files of the last 90 days, newest first, for an entry of
   another conversation whose `Ran` holds `→ failed:` with the same signature. Forgotten and
   private entries are never read. Take the newest.
   Only a conversation whose newest entry is at least one hour old counts. A second session that
   is open at the same time and just hit the same failing test has no fix to read yet, and the
   line would send Claude there for nothing.
4. Once per signature and conversation: a marker file in the `.nudge` folder holds a hash of each
   signature already told. The hook saves nothing else.
5. Print the line through `additionalContext`. No hit: print nothing.

**The gate, before any hook code.** A throwaway script, outside the repo, applies steps 2 and 3
(with the one-hour rule) to the journals of every project on the build PC for the last 30 days:
each failed command is a "moment", and a hit is an earlier failed command of another conversation
in the same project with the same signature. The plugin's own project is left out: its journal is
full of test runs that were meant to fail, and they would pass the gate alone.

- Fewer than 5 hits: park the item, nothing is built.
- Otherwise read up to 20 hits spread over the range, and write one line each into
  `reports/error-recall-replay-1.6.0.md` (in KIRE's local project folder, outside the repo): useful
  or not. Useful means: the earlier entry, or one of the next two entries of that conversation,
  names the cause or the fix.
- At least half useful: build it. Less: change the signature rule once and replay once more. Still
  less: park it, with the numbers in the report.
- The builder's marks are a first reading. KIRE reads the report and has the last word on "useful":
  the builder wrote the rule and would mark its own work. The hits hold text of real conversations,
  so they stay in that local file. The PR gets the counts and nothing else.

**Before it ships.** One live check with two headless sessions in a temp project: the first fails a
command, the second fails it the same way and must get the line. The hook payload of that failure
and the journal line of the same failure become a fixture pair (made-up text, real shape), because
the replay compares journal with journal and cannot see a difference between the hook's `error`
text and the saved tail. Also: find the Claude Code version that added the hook, check that an
older version ignores an unknown hook instead of refusing the plugin, and name the version in the
README.

**Not built:** hits from other projects, fuzzy matching, a line for failed tools other than the
shell, any text of the old entry in the line.

## 6. Format canary

**`doctor` checks the newest finished conversation file.** It takes the project's newest
conversation file over 20 KB that is not the running conversation's, reads its last 2 MB and checks
the fields the journal reads. The running conversation is left out because its tail can be one long
turn of tool calls with no prompt in it. `doctor` knows the running conversation from
`CLAUDE_CODE_SESSION_ID`, which Claude Code 2.1.328 sets for a shell command (seen on the build PC,
not found in the documentation); where it is missing, `doctor` leaves out a file written in the
last 60 seconds. The fields are listed in one exported place next to the reader, each marked
required or optional:

- required: without it no turn comes out (for example a record's `type`, `message.content`,
  `timestamp`, `uuid`);
- optional: one detail is lost (for example `gitBranch`, `message.usage`, `message.model`).

The builder makes the list by reading what `turns()` reads; the starting list is in the plan.

| Case | `doctor` line |
|---|---|
| fine | `ok` + `conversation files: Claude Code 2.1.328 writes what project-memory reads` |
| a required field is in no record of its kind, or the tail holds at least one prompt the user typed and a reply and no turn comes out | `PROBLEM` + `Claude Code 2.1.340 writes conversation files in a new form: project-memory finds no <field> in <file name>, so new exchanges may be missing from the journal. Your conversations are still on disk. Next: update project-memory (/plugin, then update); if it is already the newest, report this line at https://github.com/zdraveski/project-memory/issues` |
| an optional field is in no record of its kind | `note` + `Claude Code 2.1.340 no longer writes <field>: <what is lost> is left out of new journal entries` |
| the tail holds no prompt the user typed (only tool calls and their results) | `note` + `conversation files: the newest one ends in a long run of tool calls, cannot check it` |
| no file over 20 KB apart from the running conversation | `note` + `conversation files: none large enough to check yet` |

A field counts as missing only when the tail holds at least 5 records of the kind and none has it.
A tail of tool calls alone is never a `PROBLEM`.

**The store records Claude Code versions.** A file `.versions` in the store, one line per day and
version, `2026-11-19 2.1.328`, added by the save after a reply when that pair is not in the file
yet. It is read from the `version` field of the conversation file. `doctor` prints a note with the
newest three: `Claude Code versions seen here: 2.1.328 since 2026-11-18, 2.1.327 since
2026-11-15`. The file is not a note: it is not indexed, not searched, and `erase` removes it.

The journal's entry marker is not changed: the 1.5.3 reader would not read a marker with a new
part.

**Not built:** a warning in the briefing or after a reply, a check of every conversation file.

## 7. Ready for a stranger

### 7a. Welcome line

Once per computer, after the first reply the plugin saves, the user sees:

```
project-memory is on. It saves each exchange in this project to a journal on this computer. The plugin sends nothing anywhere. What Claude reads from the journal becomes part of the conversation. Ask "what did we do last week?" to use it. /project-memory:memory-off turns it off for this project.
```

The text does not say "nothing leaves this computer": what Claude reads from the journal goes to
the model like every other part of the conversation, and a first-time user would be told something
that is not true.

- It goes out as the `systemMessage` of the Stop hook, like the reload notice. Both in one reply:
  two lines, the welcome first.
- Only on a real `Stop`, never for a subagent or a failed stop.
- Only on a new computer: before this save wrote anything, none of the plugin's own files existed
  under the projects folder (no journal in any store, no snapshots folder, no marker of an earlier
  save). Someone who updates from 1.5.x never sees it.
- **When the first save cannot show it.** The first save on a new computer can be a subagent's
  report, a failed reply or a manual compaction. None of them can show a line, and each leaves
  files that make the computer look "not new" afterwards. So on those three events a new computer
  writes the marker `.nudge/welcome-due`, and the next real reply shows the line and removes it.
- Not when memory is off for the project or the conversation is incognito.
- The marker `.nudge/welcome` is written with an exclusive create, so two sessions that stop at the
  same moment print it once.
- `erase` keeps `.nudge/welcome`, so the line never shows a second time on the same computer. It
  removes `.nudge/welcome-due`.
- No off switch: it shows once.

### 7b. Plain-word messages

A pass over what `doctor` prints and what the CLI prints when it refuses a command. Text only.

- Everyday words. No name the user never typed and no word from the code. "the save after each
  reply" for the Stop hook, "this project's memory folder" for the store, "the saved history" for
  the snapshots. Option and command names stay as typed.
- Every `PROBLEM` line ends with `Next:` and one step, for example
  `Next: restart Claude Code, then run doctor again`. Every refusal says what to type instead.
- One test walks each `doctor` problem case and checks for `Next:`.
- The PR shows a table: old text, new text.

This is PR 11, after every PR that adds messages, so the new ones get the same pass.

### 7c. `docs/limitations.md`

One page, linked from the README. What is not saved (and why): files written by a script, work in
subagent files beyond the report, anything in a private turn. One computer only. Node 22 or newer.
Search finds words, not meanings. The journal grows (sizes from the build PC). Rewound turns stay
saved. Code Mode. Every part of section 4 that waited for a real sample. What redaction can miss. A
new Claude Code version can change the file format, and what `doctor` says then. The memory-use
count's limits. What `erase` and `clean` leave on disk, and that Claude Code deletes old
conversation files on its own. What Claude reads from the journal goes to the model. The eval's
numbers come from a few runs. Never checked on a real Mac or Linux PC. The page is written last
(PR 12), so it says what 1.6.0 really does.

### 7d. `erase`

One command deletes what the plugin saved on this computer. It takes only `--yes`.

**Deletes:** every store's `journal/` folder and `journal.md`; the automatic part of every
`handoff.md` (between `<!-- auto:start -->` and `<!-- auto:end -->`; a file that is empty after
that is removed); every store's subagent reports; the saved history (the snapshots folder under the
projects folder); the plugin's markers and logs in each store and under the projects folder
(`.versions`, the health files, the enforce log and cache, what is in the `.nudge` folder apart
from `welcome`, the failed-save files, locks nobody holds).

**Keeps:** conversation files, Claude's notes (`MEMORY.md`, `MEMORY-archive.md`, every note file),
shared notes, and every "do not save" mark:

- the off switches (`.project-off`, `.memory-off`) and the list of times memory was off
  (`.off-periods`);
- the list of entries the user asked to forget (keys only, no text);
- the marks of incognito conversations (`.private-sessions`);
- `.hash-salt`, the random value the keys in those lists are made with: without it the lists match
  nothing;
- the erase mark below, and `.nudge/welcome` (section 7a).

Without those marks a later save would bring back what the user removed, because the journal is
built again from the conversation files whenever the plugin runs. Pointer lines to a deleted
`journal.md` or `handoff.md` are removed from `MEMORY.md`. One test lists a store after `erase
--yes` and pins every kept name.

**What stops the journal from coming back.** `erase` keeps the conversation files, and the plugin
builds the journal from them: the save after the next reply would import them again, and the
running conversation would be saved again from its first prompt. Telling the user to turn the
plugin off first does not work: that takes a restart, and then the skill cannot run `erase`. So
`erase` writes one mark, `.erased` in the projects folder beside `.hash-salt`, with the time of
the erase.

- Every time at or before the mark counts as a time when memory was off, in every project. The one
  function that already answers "was memory off then?" (`wasOff` in `store.mjs`) reads the mark, so
  the save after a reply, the import of old conversations, a subagent's report, `rescan` and the
  automatic part of the handoff all leave out what was asked before the erase.
- It holds for a store that is made later, for a project that had only conversation files.
- It holds for the conversation that runs `erase`: its earlier exchanges stay out, the next one is
  saved.
- A second `erase` moves the mark to the later time. A turn without a time stays out once a mark
  exists.
- The mark is written first. If it cannot be written, `erase` deletes nothing, says why and
  exits 1.
- The builder greps every place that makes text from old turns (the note before a compaction, the
  briefing at session start) and gives each the same rule. Each gets a test.

**Links.** A store whose `memory` folder is a link is left alone and listed as
`not removed: <path> is a link`. The store it points to is erased under its own name when it is
under the projects folder. Inside a real `memory` folder, a `journal` that is a link is removed as
a link, and what it points to stays.

**The snapshots folder is deleted only when it is the plugin's.** The builder reads how the plugin
makes it and uses a sure sign. If the sign is missing, `erase` leaves it and says
`not removed: <path> was not made by project-memory`.

**Without `--yes`** it prints a list and deletes nothing:

```
erase would delete what project-memory saved on this computer:
  journals            14 projects    9.8 MB
  handoff logs        14 projects    0.4 MB   the automatic part; your own lines stay
  subagent reports     9 projects    1.1 MB
  saved history        1 folder     22.0 MB   C:\Users\x\.claude\projects\.git
  markers and logs    31 files       0.1 MB
It keeps your conversations (Claude Code's own files), Claude's notes, shared notes, the off switches and the list of what you asked to forget.
After the erase only new exchanges are saved: nothing asked before it comes back. To stop saving too: /project-memory:memory-off, or uninstall the plugin.
Nothing was deleted. To delete: erase --yes
```

**With `--yes`:** `erased 33.4 MB. Kept: conversations, notes, shared notes, off switches, the
forget list. Only new exchanges are saved from now on.` What it could not delete is listed by
path, and it exits 1.

Each store is changed under its lock. The skill gets a row: the user asks to delete everything
project-memory saved, Claude runs `erase`, shows the list, and runs `erase --yes` only after the
user says yes. The README gets an "Uninstall" section that names it and says that the conversation
files are Claude Code's and stay.

**Not built:** an erase of one project (`forget --since <first day> --purge` does that), a slash
command, an undo.

## 8. Dead stores

**Dead** means: the project's folder no longer exists. The project's folder is the start folder
read from the store's conversation files, never a guess from the store's name. A store is dead only
when none of those start folders exists. The shared store is never listed.

- No conversation file, or none with a start folder: not dead ("cannot tell").
- The start folder is missing and so is its drive or mount root: not dead ("cannot tell"). The
  mount root is the drive letter or the `\\server\share` on Windows; `/Volumes/x`, `/mnt/x`,
  `/media/x/y`, `/run/media/x/y` on the others; else `/`.
- The start folder is written the way the other system writes paths (`/home/x/app` on Windows, a
  drive letter anywhere else): not dead ("cannot tell"). The store came from another computer or
  is used from WSL, and this system cannot say whether that folder exists.
- The store's `memory` folder is a link, or another store's `memory` folder is a link to it: not
  dead ("cannot tell"). More than one project may use it, and one of them may be alive.

**`doctor`** prints one note when there is at least one:

```
17 memory folders belong to projects whose folder is gone (2.1 MB, last write 2026-11-12): clean lists them
```

**`clean`** lists every dead store (start folder, size, last write, how many of Claude's notes it
holds, how many conversation files are left, store path), then:

```
17 memory folders, 2.1 MB, with 23 of Claude's notes. 3 more could not be checked and were left alone.
Nothing was deleted. To delete them (the conversation files stay): clean --yes
```

With `--yes` it empties each dead store's `memory` folder under its lock and prints
`cleaned 17 memory folders, 2.1 MB. The conversation files stay.` It takes only `--yes`.

- **It deletes** what the plugin saved there and Claude's notes. The list shows the number of
  notes per store before anything is deleted: they may be the only thing left of that project.
- **It keeps every "do not save" mark** of the store, the same names as `erase` (section 7d). The
  conversation files of a dead project stay, so a project folder that comes back (a backup, a new
  clone in the same place) would be imported again, and without the marks a forgotten or incognito
  exchange would be saved again. A test pins the kept names.
- **Nothing else is deleted:** no conversation file, no snapshot. The saved history still holds
  the notes and the finished journal days of a cleaned store. `clean` tidies; `erase` is the
  command that removes what was saved.
- A store that holds nothing but marks is no longer listed, by `clean` or by `doctor`.

`erase` and `clean` share one helper for sizes and one for deleting. Both look at a path with
`lstat` before anything else. A link is never followed for a size and is removed as a link. A real
folder is removed with Node's own `rmSync`, never with a walk written for this: a hand-written walk
goes through a Windows junction and deletes the files it points to (see "Facts checked"). One test
builds a junction (a symlink where the system has no junctions) to a folder with a file in it, runs
both commands and finds the file still there.

**Not built:** moving a store to a renamed folder, merging stores, an age limit.

## Release

- **1.5.4 first.** PR 0 (the reader of section 4) is released on its own as "project-memory 1.5.4
  (bug fix)", by KIRE's word, before the first PR of 1.6.0 that writes `Plan` or `Undone` merges.
  Its notes say: reload or restart open sessions.
- One PR at a time, in the plan's order, each green on the three systems before the next merges.
- **One session per PR**, or per pair of small PRs. The resume file carries the state from one
  session to the next. The plan gives each task a size (small, medium, large).
- **Two points where the release can stop.** After PR 4 (memory use, the eval, the wording, dates
  and filters) and after PR 9 (also what the journal misses, the format check, `clean` and
  `erase`), what is merged is whole and can ship. If the weekly budget runs short or KIRE says so,
  the release PR runs there, and what is left becomes 1.6.1. Without that word the build goes on to
  the end.
- Before the release: `/ponytail:ponytail-review` over `v1.5.4..master`, its fixes, the eval runs
  with the numbers in the README and the result against the target of "Why", version 1.6.0 in
  `.claude-plugin/plugin.json` and `.bestpractices.json`, the changelog, release notes written for
  people (v1.4.3 is the model).
- `recall-eval.mjs` and `evals/` are in the repository and in the release archive like `bench.mjs`
  (the release archives the whole tree, and a plugin is installed from the repository). No hook
  loads them, `deploy.mjs` does not copy them, and nothing runs them unless a developer does.
- Merging and releasing need KIRE's word. No mutation or fuzz run unless KIRE says run.

## Open for KIRE

1. `secret` followed by 40 letters and digits with no colon is saved as it is. Advice: redact it.
   It is not part of 1.6.0 unless KIRE says yes.
2. Whether "start" for the build also means "merge when green", as it did for 1.5.3.
3. The plugin directory submission: advice is right after 1.6.0, with the eval numbers in the
   README.
4. Before the build starts: two clicks. Approve one made-up plan and reject one, so the build has
   the two real samples of section 4a.
5. The word "release" for 1.5.4.
6. One step for the eval's login, only if the documentation says a copied login is not safe: a
   long-lived token made once by KIRE.
7. The last word on the error-recall gate (section 5): KIRE reads the hits in the local report.
8. If the eval misses the target of "Why": whether to release, or to try another wording first.

## Not checked

- A `claude plugin eval` run without a shell grant, and what any eval session costs. The prices
  in section 2 come from seven sessions on 2026-11-12.
- Whether the memory skill loads in an empty workspace.
- Whether a headless session logs in under a temporary configuration folder, and which way is safe.
- Which rule in a `--settings` file lets a headless session run the memory search and nothing else.
- Where an approved plan's text sits in a conversation file, and how approval is marked.
- What Code Mode, an MCP write and a rewind leave in a conversation file.
- Which Claude Code version added `PostToolUseFailure`, and what an older one does with it.
- How fast the memory-use count is on the largest project.
- Every place that makes text from old turns, for the erase mark. Only the two callers of `wasOff`
  were read.
- Whether `restore` brings back the notes of a cleaned store.
- What the briefing at session start writes before the first save (it decides what "a new
  computer" can look at, section 7a).
- `CLAUDE_CODE_SESSION_ID` on any system but Windows, and in any version but 2.1.328.
- A junction on any Node version but 24, and a symlink on a real Mac or Linux PC.
- Anything on a real Mac or Linux PC.
