# project-memory 1.6.0, the recall release: design

Written by Fable on 2026-11-19, on top of v1.5.3 (366c983). KIRE picked the scope the same day:
items 1 to 8 of the roadmap proposal, item 9 dropped. Opus builds it from the plan in
`docs/plans/2026-11-19-recall-release-1.6.0.md`.

## Why

1.5.1 to 1.5.3 made saving solid. What is saved is rarely read. In the 14 days before this spec,
Claude searched the journal in 1 of about 40 sessions outside the plugin's own project, and after
45 searches it opened a whole entry 4 times. 1.6.0 does three things about that, in this order:

1. Measure how much memory is used.
2. Show with numbers that it helps.
3. Bring recall to the moments where it clearly pays, and close the holes a new user would fall into.

## Scope

| # | Item | PR |
|---|---|---|
| 1 | Memory use in `status` and `doctor` | 1 |
| 2 | Eval suite, numbers in the README | 2 |
| 3 | Search takes the question as asked: relative dates, then filters | 3, 4 |
| 4 | Save what the journal misses: approved plans; MCP writes, Code Mode, rewound turns | 5, 6 |
| 6 | Format canary: `doctor` checks the conversation file format, the store records Claude Code versions | 7 |
| 8 | Dead stores: listed by `doctor`, removed by `clean` | 8 |
| 7 | Ready for a stranger: `erase`, plain-word messages, welcome line, `docs/limitations.md` | 9, 11, 12 |
| 5 | "You hit this error before", only if its replay passes the gate | 10 |
| | Release | 13 |

That is 12 build PRs and the release PR, 11 if item 5 fails its gate.

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
- An unknown line inside a journal entry is kept as prose after the entry by the 1.5.3 reader, and
  written back after the entry's fields.

---

## 1. Memory use in `status` and `doctor`

**What it does.** `status` prints one more line per project, and `doctor` prints the same line as a
note:

```
memory use, last 7 days: 3 searches, 1 entry opened, 2 notes read, in 2 of 9 conversations
```

**How it counts.** From the project's main conversation files changed in the last 7 days, records
with a timestamp in the last 7 days. Subagent files in subfolders are not read; subagent records
inside a main file count.

- A search: a shell command (`Bash`, `PowerShell`, a context-mode `ctx_execute` or `ctx_batch`)
  that holds `memory.mjs` followed by the word `search`. Two in one command count as two.
- An entry opened: the same with `show`, or a `Read` of a file under the store's `journal/` folder.
- A note read: a `Read` of an `.md` file in the project's store or in the shared store, outside
  `journal/`.
- "in 2 of 9 conversations": conversation files with at least one of the three, of all counted.

**Exact texts.**

| Case | Line |
|---|---|
| all ones | `memory use, last 7 days: 1 search, 1 entry opened, 1 note read, in 1 of 1 conversation` |
| nothing used | `memory use, last 7 days: none in 9 conversations` |
| no conversation in 7 days | `memory use, last 7 days: no conversations` |

**Limits.** It cannot tell a real question from a test of the search. It cannot tell how many
conversations needed a search. The briefing at the start of a session is memory use too and is not
counted. These three lines go into `docs/limitations.md`.

**Speed.** Read each file in pieces with the journal's own reader, and parse only lines that hold
`memory.mjs`, or `"name":"Read"` together with `memory`. No new logging. No cache, unless `status`
on the largest project of the build PC takes more than 2 seconds longer than before: then a
per-file cache keyed by size and change time, the way `.enforce.json` works.

## 2. Eval suite

Two layers, because the official tool cannot run the search here.

### 2a. Trigger cases, with `claude plugin eval`

An `evals/` folder with four cases that need no shell. Each case asks one question in an empty
workspace and checks whether Claude loads the memory skill.

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
facts, with the plugin and without it.

```
node recall-eval.mjs --plugin <dir> [--runs 3] [--case <name>] [--model sonnet] [--max-usd 10] [--json <path>]
node recall-eval.mjs --self-check
```

**What a run does.**

1. Makes one throwaway project folder per session under the OS temp folder, so no session reads
   what another one saved. Each gets the same two small source files.
2. Seeds the store of every "with" project through the journal's own writer (`journal.mjs` of the
   repo the harness runs from), with the entries below, dated from the run day. A "without"
   project gets no store: without the plugin nothing would have been saved.
3. Runs each case `--runs` times in the "with" arm and once in the "without" arm, 4 sessions at a
   time: `claude -p "<question>" --output-format stream-json --verbose --model <model>` with the
   project folder as the working directory. "With" adds `--plugin-dir <dir>`. Both arms pass
   `--settings` with `{"enabledPlugins": {"project-memory@project-memory": false}}`, so an
   installed copy never answers.
4. Grades each session: the final answer text against the case's pattern, and whether a memory
   search ran. Adds up `total_cost_usd` from each session's result record.
5. Stops starting sessions when the sum reaches `--max-usd`, marks the rest "not run" and exits 2.
6. Always, also after an error: deletes the temp folders and each "with" project's `memory` folder.
   The test projects' conversation files stay.
7. Prints a table (case, with, without, searched, cost) and writes the same as JSON.

It refuses to run when a project folder is not under the OS temp folder, so the clean-up can never
delete a real store.

**Seeded entries** (project "bookshop", all invented; D is the run day):

| Day | Asked | Answered (the fact) | Also |
|---|---|---|---|
| D-2 | which port should the dev server use | port 4317, because 3000 and 8080 are taken by the other two apps | |
| Wednesday of the previous calendar week | the nightly export is one day off | cause: `closeDay()` took the date in UTC; fix: compute the day in Europe/Vienna | Changed `src/closeDay.js`, Ran `npm test` |
| same day | should we keep the PDF export | decision: drop the PDF export, keep CSV only; nobody downloaded a PDF in 90 days | |
| D-5 | what is the staging database called | staging uses `shop_stage_b`; the old `shop_stage` is read-only | |
| D-20 | the deploy fails | fixed by running the deploy as the `deploy` user: `chown -R deploy /var/app/releases` | Ran `npm run deploy → failed: EACCES: permission denied, open '/var/app/releases/current'` |

**Cases.**

| Case | Question | Passes when the answer |
|---|---|---|
| `port` | Which port did we pick for the dev server, and why? | matches `4317` |
| `last-week-bug` | What was the cause of the export bug we fixed last week? | matches `UTC\|time ?zone` (any case) |
| `decision` | Did we decide to keep the PDF export? | matches `CSV` |
| `staging-db` | What is the staging database called? | matches `shop_stage_b` |
| `error-fix` | The deploy fails with EACCES again. What fixed it last time? | matches `deploy user\|chown` (any case) |
| `never-discussed` | Which payment provider did we choose? | does not match `Stripe\|PayPal\|Adyen\|Braintree\|Mollie` (any case) |

The last case is a control: it must pass in both arms, and shows that memory does not make Claude
invent an answer.

### Numbers in the README

A short section with the date, the model, the Claude Code version and the number of runs; the
trigger cases with their pass counts; the answer cases with both columns; each failed case named
with one line on what went wrong. One sentence says that the "without" column is the floor: without
the plugin there is nothing to look in. No claim beyond the table.

### When it runs, and what it may cost

- Before a release, never in CI and never on every PR. It uses the subscription, so check the
  weekly usage first.
- First a spike: one trigger case with `--runs 1` and `--max-cost-usd 0.50`, and one answer case
  with `--runs 1`. The spike answers three open questions: does a no-shell eval run work on this
  PC, does the skill load in an empty workspace, and what does one session cost.
- If a full run of 2b would cost more than 10 USD by the spike's numbers, cut `--runs` to 2,
  then to 1.
- For the release, 2b runs twice: once with `--plugin` on a clean v1.5.3 checkout and once on the
  release candidate. The README shows both.

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
  start folder and `--store <path>`, and exits 1.
- No match: `--project app matches no project: search --all names them`, exit 1.
- With `--store`, `--shared` or `--all` it is refused: `--project cannot go with --store` (or the
  other name).
- It only ever resolves to a store that `--all` already reads, so it opens no new path.

The skill's command table and the CLI help name all of 3a and 3b, with one example each for "last
week" and "in the app project".

## 4. Save what the journal misses

### 4a. Approved plans

**What it does.** A turn in which the user approved a plan gets one more journal line, the last of
the entry:

```
**Plan:** <the plan's text, on one line>
```

- Redacted, squeezed to one line and cut at 50,000 characters like `Asked` and `Answered`.
- Only an approved plan. A rejected plan, or one the user answered with changes, saves no line.
- A private turn saves no plan.
- `show` prints the line. `search` finds words in it, ranked like `Answered`. A hit line and a day
  listing end with ` · plan approved` for an entry that holds one.
- `forget` treats the plan like every other field: a word that is only in the plan finds the entry.
- `rescan` and `incognito` treat the plan like every other field. A test pins each.

**Why last.** The 1.5.3 reader keeps an unknown line after the entry's fields. With `Plan` as the
last field, a day file that an older version rewrites still reads back whole.

**First step, before any code.** Get one real approved plan and one rejected plan in a conversation
file and read where the text is. Three places to look, in this order: a structured field on the
tool result record (`toolUseResult`), the text of the tool result, the `Write` or `Edit` calls of
the plan file earlier in the same conversation. The reader takes the first that holds the text. If
none holds it, the plan's path goes into `Changed` (it already does when `Write` made it), no
`Plan` line is built, and the gap goes into `docs/limitations.md`.

### 4b. Other writes, Code Mode, rewound turns

**MCP tools that write a file.** `Changed` gets the path when all three hold:

- the tool name starts with `mcp__`;
- its last part (after the last `__`) starts with `write`, `edit`, `create`, `append`, `save`,
  `update`, `replace` or `insert`;
- the input holds a string under `path`, `file_path`, `filePath`, `filepath`, `file`, `filename`,
  `notebook_path` or `destination`.

A call with `dryRun: true` or `dry_run: true` is skipped. A call the user refused or that failed is
skipped the way a refused `Edit` is. The path is cut at 300 characters like every other.

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
as it is and the entry gets a line `**Undone:** rewound <time>`, placed after `Plan`. Without such
a sign nothing is marked, and `docs/limitations.md` says that undone turns stay in the journal.

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
4. Once per signature and conversation: a marker file in the `.nudge` folder holds a hash of each
   signature already told. The hook saves nothing else.
5. Print the line through `additionalContext`. No hit: print nothing.

**The gate, before any hook code.** A throwaway script, outside the repo, applies steps 2 and 3 to
the journals of every project on the build PC for the last 30 days: each failed command is a
"moment", and a hit is an earlier failed command of another conversation in the same project with
the same signature.

- Fewer than 5 hits: park the item, nothing is built.
- Otherwise read up to 20 hits spread over the range, and write one line each into
  `reports/error-recall-replay-1.6.0.md` (in KIRE's local project folder, outside the repo): useful
  or not. Useful means: the earlier entry, or one of the next two entries of that conversation,
  names the cause or the fix.
- At least half useful: build it. Less: change the signature rule once and replay once more. Still
  less: park it, with the numbers in the report.

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

**`doctor` checks the newest conversation file.** It takes the project's newest conversation file
over 20 KB, reads its last 2 MB and checks the fields the journal reads. The fields are listed in
one exported place next to the reader, each marked required or optional:

- required: without it no turn comes out (for example a record's `type`, `message.content`,
  `timestamp`, `uuid`);
- optional: one detail is lost (for example `gitBranch`, `message.usage`, `message.model`).

The builder makes the list by reading what `turns()` reads; the starting list is in the plan.

| Case | `doctor` line |
|---|---|
| fine | `ok` + `conversation files: Claude Code 2.1.328 writes what project-memory reads` |
| a required field is in no record of its kind, or the tail holds prompts and replies and no turn comes out | `PROBLEM` + `Claude Code 2.1.340 writes conversation files in a new form: project-memory finds no <field> in <file name>, so new exchanges may be missing from the journal. Your conversations are still on disk. Next: update project-memory (/plugin, then update); if it is already the newest, report this line at https://github.com/zdraveski/project-memory/issues` |
| an optional field is in no record of its kind | `note` + `Claude Code 2.1.340 no longer writes <field>: <what is lost> is left out of new journal entries` |
| no file over 20 KB | `note` + `conversation files: none large enough to check yet` |

A field counts as missing only when the tail holds at least 5 records of the kind and none has it.

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
project-memory is on. It saves each exchange in this project to a journal on this computer, and nothing leaves this computer. Ask "what did we do last week?" to use it. /project-memory:memory-off turns it off for this project.
```

- It goes out as the `systemMessage` of the Stop hook, like the reload notice. Both in one reply:
  two lines, the welcome first.
- Only on a real `Stop`, never for a subagent or a failed stop.
- Only on a new computer: before this save wrote anything, none of the plugin's own files existed
  under the projects folder (no journal in any store, no snapshots folder, no marker of an earlier
  save). Someone who updates from 1.5.x never sees it.
- Not when memory is off for the project or the conversation is incognito.
- The marker `.nudge/welcome` is written with an exclusive create, so two sessions that stop at the
  same moment print it once.
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
Search finds words, not meanings. The journal grows (sizes from the build PC). Rewound turns. Code
Mode. What redaction can miss. A new Claude Code version can change the file format, and what
`doctor` says then. The memory-use count's three limits. Never checked on a real Mac or Linux PC.
The page is written last (PR 12), so it says what 1.6.0 really does.

### 7d. `erase`

One command deletes what the plugin saved on this computer. It takes only `--yes`.

**Deletes:** every store's `journal/` folder and `journal.md`; the automatic part of every
`handoff.md` (between `<!-- auto:start -->` and `<!-- auto:end -->`; a file that is empty after
that is removed); every store's subagent reports; the saved history (the snapshots folder under the
projects folder); the plugin's markers and logs in each store and under the projects folder
(`.versions`, the health files, the enforce log and cache, the `.nudge` folder, the failed-save
files, locks nobody holds).

**Keeps:** conversation files, Claude's notes (`MEMORY.md`, `MEMORY-archive.md`, every note file),
shared notes, and every "do not save" mark: the off switches, the list of entries the user asked to
forget (keys only, no text) and the marks of incognito conversations. Without those marks a later
save would bring back what the user removed, because the journal is built again from the
conversation files whenever the plugin runs. Pointer lines to a deleted `journal.md` or
`handoff.md` are removed from `MEMORY.md`.

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
It keeps your conversations, Claude's notes, shared notes, the off switches and the list of what you asked to forget.
Nothing was deleted. Turn the plugin off first (/plugin), or the journal is built again from your conversations at the next reply. Then: erase --yes
```

**With `--yes`:** `erased 33.4 MB. Kept: conversations, notes, shared notes, off switches, the
forget list.` What it could not delete is listed by path, and it exits 1.

Each store is changed under its lock. The skill gets a row: the user asks to delete everything
project-memory saved, Claude runs `erase`, shows the list, and runs `erase --yes` only after the
user says yes. The README gets an "Uninstall" section that names it.

**Not built:** an erase of one project (`forget --since <first day> --purge` does that), a slash
command.

## 8. Dead stores

**Dead** means: the project's folder no longer exists. The project's folder is the start folder
read from the store's conversation files, never a guess from the store's name. A store is dead only
when none of those start folders exists. The shared store is never listed.

- No conversation file, or none with a start folder: not dead ("cannot tell").
- The start folder is missing and so is its drive or mount root: not dead ("cannot tell"). The
  mount root is the drive letter or the `\\server\share` on Windows; `/Volumes/x`, `/mnt/x`,
  `/media/x/y`, `/run/media/x/y` on the others; else `/`.

**`doctor`** prints one note when there is at least one:

```
17 memory folders belong to projects whose folder is gone (2.1 MB, last write 2026-11-12): clean lists them
```

**`clean`** lists every dead store (start folder, size, last write, store path), then:

```
17 memory folders, 2.1 MB. 3 more could not be checked and were left alone.
Nothing was deleted. To delete them (the conversation files stay): clean --yes
```

With `--yes` it deletes each dead store's `memory` folder under its lock and prints
`deleted 17 memory folders, 2.1 MB. The conversation files stay.` It takes only `--yes`. Nothing
else is deleted: no conversation file, no snapshot.

`erase` and `clean` share one helper for sizes and one for deleting a folder that may hold
read-only files.

**Not built:** moving a store to a renamed folder, merging stores, an age limit.

## Release

- One PR at a time, in the plan's order, each green on the three systems before the next merges.
- Before the release: `/ponytail:ponytail-review` over `v1.5.3..master`, its fixes, the eval runs
  with the numbers in the README, version 1.6.0 in `.claude-plugin/plugin.json` and
  `.bestpractices.json`, the changelog, release notes written for people (v1.4.3 is the model).
- Merging and releasing need KIRE's word. No mutation or fuzz run unless KIRE says run.

## Open for KIRE

1. `secret` followed by 40 letters and digits with no colon is saved as it is. Advice: redact it.
   It is not part of 1.6.0 unless KIRE says yes.
2. Whether "start" for the build also means "merge when green", as it did for 1.5.3.
3. The plugin directory submission: advice is right after 1.6.0, with the eval numbers in the
   README.

## Not checked

- A `claude plugin eval` run without a shell grant, and what any eval session costs.
- Whether the memory skill loads in an empty workspace.
- Where an approved plan's text sits in a conversation file, and how approval is marked.
- What Code Mode, an MCP write and a rewind leave in a conversation file.
- Which Claude Code version added `PostToolUseFailure`, and what an older one does with it.
- How fast the memory-use count is on the largest project.
- Anything on a real Mac or Linux PC.
