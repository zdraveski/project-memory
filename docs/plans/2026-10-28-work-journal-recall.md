# Work Journal and Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every exchange in every project for good, in a per-day journal written by the Stop hook, and let Claude find any of it from a plain question.

**Architecture:** A new module, `journal.mjs`, turns the transcript turns `handoff()` already parses into redacted, capped entries, and merges them into one Markdown file per day in the project's notebook. The Stop hook passes it to `handoff()` as a callback, run inside the same lock. Backfill imports old transcripts a little per Stop. `search` reads notes and journal together, by words and by dates, and `forget` removes entries. Claude is pointed at it three ways: the skill, a pinned `journal.md` index line, and one briefing line.

**Tech Stack:** Node.js 20+ ES modules, no dependencies. Tests are plain `node *.test.mjs` suites, with `node:assert` and a throwaway HOME (`harness.mjs`). Mutants live in `mutate.mjs`.

**Spec:** `docs/specs/2026-10-28-work-journal-recall-design.md`

## Global Constraints

- Plain Node.js 20, no dependencies. Nothing goes online, no model is called, and the `claude` command is never run.
- No environment read beyond the seven names read today, and no copy of the whole environment, tests included.
- Hooks exit 0 and stay fast. The journal adds at most a few milliseconds to a Stop that has nothing to import.
- Windows, macOS and Linux, Node 20 and 24, as CI runs today.
- Every new rule gets a test and a mutant, and every fix a fresh review.
- Caps: request 2,000 characters, reply 3,000, 20 files, 10 commands of 200 characters.
- One file per day per project: `~/.claude/projects/<project>/memory/journal/YYYY-MM-DD.md`. The shared notebook has no journal.
- Every write goes through `withLock` and `replaceIfUnchanged` (`store.mjs`).
- Every field goes through the secret redaction (`clip()` in `handoff-log.mjs`). `<private>` and `<private-session>` behave as for `handoff.md`, and nothing is written while `CLAUDE_CODE_DISABLE_AUTO_MEMORY` is set.
- Work on a branch in a worktree. Push it, and merge only after CI passes 6/6.

## Decisions this plan makes (beyond the spec)

- `handoff(input, sink)` takes an optional callback instead of importing `journal.mjs`, so the two modules don't import each other. `memory-tier.mjs --stop` passes the journal writer. The compaction gate passes none: a turn it cuts is journaled at the next Stop.
- The pinned index line comes from a note, `memory/journal.md` (`tier: hot`). Tiering already gives every `tier: hot` note an index line, the way `handoff.md` gets one.
- Entry key: the uuid of the turn's prompt record. When a record has none (older transcripts, the suites' fixtures), it is `<tag> <at> <sha256 of the raw ask, 12 hex>`.
- Entries in a day file are sorted by time, then key, on every write. Text that isn't an entry is kept at the top.
- Search output: the top 3 journal hits print in full (up to the caps), the rest short (request 200 characters, reply 300), each with its day file's path. Search with only `--since`/`--until` lists entries in that range, newest first, 30 by default.
- `forget` lists what would go, and removes it only with `--yes`. `--conversation <tag>` picks one conversation. (`--session` already means the caller's conversation.)
- Backfill budget: 150 ms per Stop, at least one transcript. A transcript over 64 MB is imported from its last 64 MB, and the marker says so.
- A journal write that throws is caught, kept in `journal/.failed`, and reported by `status`. The next successful write deletes the file.

## Review Focus

1. A transcript with one 50 MB tool output (backfill or live). Expected: the Stop still finishes within its budget, nothing crashes, and the turns around it are journaled. Test: Task 4, `backfill keeps to its budget on a huge transcript`.
2. Two windows ending a reply at the same moment on one project. Expected: both turns are in the day file and neither is lost. Test: Task 3, `parallel Stops lose no entry`.
3. A turn that starts at 23:59 and ends at 00:01, or a clock that moves to another time zone. Expected: the entry is in the file of the day the turn started (local time), once. Test: Task 2, `an entry belongs to the day its turn started`.
4. A day file Claude or the user edited by hand: prose added, an entry's line changed, or a broken marker. Expected: the hand-written text is kept, the merge doesn't crash, and no entry is duplicated. Test: Task 2, `hand-written text in a day file survives a merge`.
5. Years of journal. Expected: search stays under 2 seconds, and date filters don't open files outside the range. Test: Task 6, `search over 30 MB of journal is fast and skips days out of range`.

---

### Task 1: `turns()` keeps what the journal needs

**Files:**
- Modify: `handoff-log.mjs` (`turns()`, lines 169-238)
- Test: `handoff-log.test.mjs` (append a block at the end)

**Interfaces:**
- Produces: `export function turns(raw)`, exported (it isn't today). Each turn object keeps its existing fields (`at`, `ask`, `raw`, `did`, `changed`, `frozen`, `reopened`) and gains:
  - `ran: string[]`: commands of `tool_use` blocks named `Bash` or `PowerShell` (`input.command`), in order. Like `changed`, they're collected only while the turn isn't frozen.
  - `id: string`: the prompt record's `uuid`, or `''`.
  - `branch: string`: the prompt record's `gitBranch`, or `''` when it is missing or `HEAD`.
  - `cwd: string`: the prompt record's `cwd`, or `''`.

- [ ] **Step 1: Write the failing test** (in `handoff-log.test.mjs`, a new block):

```js
// The journal's fields: commands, the prompt's uuid, branch and cwd.
{
  const { turns } = await import('./handoff-log.mjs');
  const u = (s, x = {}) => JSON.stringify({ type: 'user', timestamp: '2026-10-28T09:00:00Z', uuid: 'u-1', gitBranch: 'main', cwd: 'C:\\proj', message: { content: [{ type: 'text', text: s }] }, ...x });
  const a = (content) => JSON.stringify({ type: 'assistant', timestamp: '2026-10-28T09:01:00Z', message: { content } });
  const raw = [u('deploy it'), a([{ type: 'tool_use', name: 'Bash', input: { command: 'npm run build' } }]),
    a([{ type: 'tool_use', name: 'PowerShell', input: { command: 'Get-ChildItem' } }]), a([{ type: 'text', text: 'Deployed.' }])].join('\n');
  const [t] = turns(raw);
  ok(t.id === 'u-1' && t.branch === 'main' && t.cwd === 'C:\\proj', 'a turn keeps its prompt uuid, branch and cwd');
  ok(JSON.stringify(t.ran) === '["npm run build","Get-ChildItem"]', 'a turn keeps its Bash and PowerShell commands in order');
  ok(turns(u('x', { gitBranch: 'HEAD' }) + '\n' + a([{ type: 'text', text: 'y' }]))[0].branch === '', 'a detached HEAD is no branch');
  const priv = turns([u('<private>k</private>'), a([{ type: 'tool_use', name: 'Bash', input: { command: 'echo k' } }]), a([{ type: 'text', text: 'ok' }])].join('\n'));
  ok(priv[0].ran.length === 0, 'a private turn keeps no command');
}
```

- [ ] **Step 2: Run it and see it fail.** Run `node handoff-log.test.mjs`. Expected: it fails at the import (`turns` isn't exported) or at the first new `ok`.
- [ ] **Step 3: Implement.** Export `turns`. Add the four fields where `pending` is created (line 226), and collect commands in the existing `tool_use` loop (lines 181-191) next to the edits, without changing the text of the existing lines.
- [ ] **Step 4: Run `node handoff-log.test.mjs`.** Expected: every check passes, the old ones included.
- [ ] **Step 5: Run `node mutate.mjs handoff`** (the labels of `handoff-log.mjs` mutants). Expected: all killed, and none "MUTATION DID NOT APPLY". Re-aim any whose target text changed. Add mutants: "a turn's commands not kept" (drop the push to `ran`) and "a private turn's commands kept" (collect `ran` even when frozen).
- [ ] **Step 6: Commit**: `git add handoff-log.mjs handoff-log.test.mjs mutate.mjs && git commit -m "turns() keeps a turn's commands, prompt uuid, branch and cwd"`

---

### Task 2: `journal.mjs`: entries and day files

**Files:**
- Create: `journal.mjs`
- Create: `journal.test.mjs`
- Modify: `mutate.mjs` (add `'journal.mjs'` to `FILES`, and a `'journal.mjs': ['journal.test.mjs', { … }]` section)

**Interfaces:**
- Consumes: `turns`, `clip`, `tag`, `PRIVATE`, `hash` from `handoff-log.mjs`; `withLock`, `replaceIfUnchanged`, `raw`, `projectsRoot` from `store.mjs`.
- Produces (all exported from `journal.mjs`):
  - Constants `JOURNAL = 'journal'`, `J_ASK = 2000`, `J_ANSWER = 3000`, `J_FILES = 20`, `J_RAN = 10`, `J_CMD = 200`.
  - `Entry`: `{ key, at, s, t, branch, asked, answered, changed: string[], ran: string[] }`.
    - `at` is `'YYYY-MM-DD HH:MM'`, local.
    - `s` is the 8-character conversation tag.
    - `t` is `'<project folder>/<session id>'`, from the transcript path.
  - `entryOf(turn, transcriptPath) -> Entry`.
    - `asked` is `clip(turn.ask, J_ASK)`.
    - `answered` is `'[private]'` when `PRIVATE` matches `turn.raw ?? turn.ask`, otherwise `clip(turn.did, J_ANSWER)`.
    - `changed` holds the last `J_FILES` paths, made relative to `turn.cwd` when they're inside it, each clipped to 300. It is empty for a private turn.
    - `ran` holds the last `J_RAN` commands, each `clip(c, J_CMD)`. It is empty for a private turn.
    - `key` is `turn.id`, or `` `${s} ${at} ${hash(turn.raw ?? turn.ask).slice(0, 12)}` ``.
  - `render(entry) -> string`. The format, exactly:

```
<!-- j:KEY t:FOLDER/SESSION -->
## HH:MM · conversation S · branch B
**Asked:** …
**Answered:** …
**Changed:** a, b
**Ran:** c1 · c2
```

    The branch part is left out when the branch is empty, and so are the Changed and Ran lines when they would be empty.
  - `parseDay(text) -> { prose: string, entries: Entry[] }`. An entry starts at a marker line alone on its line. A marker that won't parse, and anything before the first marker, stays in `prose`.
  - `dayFile(dir, at) -> string`: `join(dir, JOURNAL, at.slice(0, 10) + '.md')`.
  - `record(dir, transcriptPath, turns) -> number`. Call it under `withLock(dir)`. It merges each turn's entry into its day file: an entry with the same key is replaced, a new one is added, and the entries are then sorted by `at`, then `key`. The file is `# Journal YYYY-MM-DD` + `\n\n` + prose + the entries, joined by a blank line. It is written only when the text changed, and the function returns how many entries were added or changed. It also writes `journal.md` (Task 5 adds the note's content).
  - `days(dir) -> string[]`: the `YYYY-MM-DD` day files, sorted.

- [ ] **Step 1: Write the failing tests** in `journal.test.mjs`, in the suites' style (`tempHome`, `storeFor`, `ok`). Fixture helper: `turn(over)` returns `{ at: '2026-10-28 14:05', ask, raw: ask, did, changed: [], ran: [], id: 'u-1', branch: 'main', cwd: 'C:\\proj', ...over }`. Tests:
  - `entryOf caps every field`. A 5,000-character ask gives `asked.length === 2000`, ending in `…`. A 9,000-character reply gives 3,000. 30 files give 20 (the last 20). 15 commands give 10. A 500-character command gives 200.
  - `entryOf redacts every field`. Use a key-shaped string built at run time (as `store.test.mjs` does with `stripe()`) in the ask, the reply, a path and a command. None of the outputs contains it, and each contains `[redacted]`.
  - `a private turn keeps no answer, files or commands`: `answered === '[private]'`, with `changed` and `ran` empty.
  - `render and parseDay round-trip`: `parseDay(render(e)).entries[0]` deep-equals `e`.
  - `record appends once per key`. Recording the same turn twice leaves one entry. Recording it again with a new `did` replaces the answer in place.
  - `an entry belongs to the day its turn started`. A turn with `at: '2026-10-27 23:59'` recorded on the 28th lands in `journal/2026-10-27.md`.
  - `entries are sorted by time`. Record 14:07 first, then 14:05: the file lists 14:05 first.
  - `hand-written text in a day file survives a merge`. Prepend a paragraph and add a broken marker line. Record a new turn: the paragraph and the broken line are still there, and there's exactly one entry per key.
  - `a key-less turn gets a stable key`: `id: ''` gives the same key twice.
- [ ] **Step 2: Run `node journal.test.mjs`.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `journal.mjs`** with the interfaces above. `record` reads each day file with `raw()`, builds the next text, and writes with `replaceIfUnchanged`, retrying up to 3 times on `'conflict'`, as `handoff()` does. `mkdirSync(join(dir, JOURNAL), { recursive: true })` before the first write.
- [ ] **Step 4: Run `node journal.test.mjs`.** Expected: all pass.
- [ ] **Step 5: Add mutants** in the `journal.mjs` section, one per rule: the ask cap, the reply cap, the files cap, the commands cap, the command cap, redaction of each field, the private answer, the private files and commands, replace-by-key, the day from the turn's start, the sort by time, prose kept, the key fallback. Run `node mutate.mjs journal`. Expected: all killed.
- [ ] **Step 6: Commit**: `git add journal.mjs journal.test.mjs mutate.mjs && git commit -m "journal.mjs: redacted, capped entries merged into one file per day"`

---

### Task 3: The Stop hook writes the journal

**Files:**
- Modify: `handoff-log.mjs` (`handoff()`, lines 501-561)
- Modify: `memory-tier.mjs` (the `--stop` block, lines 516-542)
- Modify: `journal.mjs` (add `sweep`, and `.failed` handling)
- Test: `journal.test.mjs`

**Interfaces:**
- Consumes: `record` (Task 2), `turns` fields (Task 1).
- Produces:
  - `handoff(input, sink = null)`. Inside its `withLock` callback, right after `quiet` is computed, it calls `sink(dir, input.transcript_path, got, { quiet, hush })` in a `try`. A throw there never changes what `handoff` returns.
  - `journal.write(dir, transcriptPath, got, { quiet, hush }) -> void`, the sink:
    - when `quiet` and `hush`: `sweep(dir, tag(basename(transcriptPath, '.jsonl')))`;
    - when `quiet` only: nothing;
    - otherwise: `record(dir, transcriptPath, got)`.
    - A throw is written to `join(dir, JOURNAL, '.failed')` as `{"at":ISO,"error":first line}`. A successful run deletes that file.
  - `sweep(dir, s) -> number`: removes every entry whose `s` matches, from the day files dated on or after that conversation's first record (read from the transcript's first line, when it exists; otherwise every day file). It returns how many it removed.
  - In `memory-tier.mjs`: `handoff(payload, journal.write)`. `journal.mjs` is imported dynamically next to `handoff-log.mjs`.

- [ ] **Step 1: Write the failing tests** (spawning `memory-tier.mjs --stop` with `{ cwd, transcript_path, session_id, hook_event_name: 'Stop', last_assistant_message }` on stdin, `env` from `tempHome`):
  - `a reply leaves one journal entry`. One prompt and one reply: `journal/<day>.md` has one entry with the request, the reply and the branch.
  - `the reply Claude Code passes is the one journaled`. When the transcript lags, `last_assistant_message` is the `Answered`.
  - `a second Stop on the same turn changes nothing`: the file's text and mtime are unchanged.
  - `parallel Stops lose no entry`. Two transcripts (two sessions) on one project, each with a new turn, Stops spawned at once 10 times: 10 entries per session, none twice.
  - `a private session writes nothing and removes what it wrote`. Turn 1 normal, Stop; turn 2 types `<private-session>`, Stop: the day file has no entry of that session.
  - `auto memory off writes no journal`. Set `process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'` around this one Stop, deleting it in a `finally`, as `handoff-log.test.mjs` line 880 does: there is no `journal` folder.
  - `a failing journal write is kept and cleared`. Make `journal/<day>.md` a folder, so the write throws: `.failed` exists and `handoff.md` was still written. Remove the folder and Stop again: `.failed` is gone.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run `node journal.test.mjs` and `node handoff-log.test.mjs`.** Expected: all pass.
- [ ] **Step 5: Mutants:**
  - "the sink is never called";
  - "a private session's entries kept";
  - "a quiet session still records";
  - "a sink throw breaks the handoff";
  - ".failed never cleared".

  Run `node mutate.mjs journal` and `node mutate.mjs handoff`. Expected: all killed.
- [ ] **Step 6: Commit**: `git commit -m "The Stop hook journals every turn, under the handoff's lock"`, with the changed files staged by name.

---

### Task 4: Backfill

**Files:**
- Modify: `journal.mjs` (add `backfill`)
- Modify: `memory-tier.mjs` (call it after `handoff`, before the nudge)
- Test: `journal.test.mjs`

**Interfaces:**
- Consumes: `turns`, `readTail`, `hushed`, `tag` (handoff-log), `storeOf`, `withLock`, `projectsRoot` (store), `record` (Task 2).
- Produces:
  - Constants `IMPORT_BUDGET_MS = 150` and `IMPORT_MAX_BYTES = 64 * 1024 * 1024`.
  - `backfill(dir, { budgetMs = IMPORT_BUDGET_MS } = {}) -> { imported: number, left: number }`. Call it under `withLock(dir)`.
    - Candidates: every `*.jsonl` directly in a folder of `projectsRoot()`, except `_shared`, with `storeOf({ transcript_path })` the same as `dir`, and not listed in `journal/.imported`. Oldest mtime first.
    - Skip a conversation that `hushed(dir, tag)` marks.
    - For each candidate: `readTail(p, IMPORT_MAX_BYTES)`, then `record(dir, p, turns(text))`, then append `<folder>/<session> <bytes>` (with ` partial` when it wasn't read whole) to `journal/.imported`.
    - Stop once `budgetMs` has passed and at least one was done.
  - In `memory-tier.mjs --stop`: after `handoff(...)`, run `withLock(storeOf(payload), () => backfill(storeOf(payload)))` in a `try`, only when the store has a `journal` folder or Claude Code's project folder has transcripts. It never prints.

- [ ] **Step 1: Write the failing tests:**
  - `backfill imports old transcripts once`. Three transcripts in the project's folder, plus one in a subfolder conversation's folder whose first `cwd` is inside the repo (as the suites build repositories for `storeOf`). After enough Stops, all four conversations' turns are in the journal, and `.imported` has four lines. One more Stop changes nothing.
  - `backfill resumes after a kill`. Pre-write `.imported` with one transcript: only the other three are imported.
  - `backfill skips a private conversation`. A transcript whose tag is in `.private-sessions` leaves no entries.
  - `backfill keeps to its budget on a huge transcript`. A transcript with one 70 MB tool result: the Stop that imports it takes under 3 seconds (old code: no import at all), `.imported` marks it `partial`, and the turns after the huge output are journaled.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run `node journal.test.mjs`.** Expected: all pass.
- [ ] **Step 5: Mutants:**
  - "backfill imports twice";
  - "backfill ignores the budget" (no time check);
  - "a private conversation imported";
  - "another store's transcript imported".

  Run `node mutate.mjs journal`. Expected: all killed. A mutant that takes longer than mutate's 120 seconds counts as a failure, so keep the timed test's input below that.
- [ ] **Step 6: Commit**: `git commit -m "Backfill: the conversations still on disk, a few per reply"`

---

### Task 5: Snapshots of closed days, and the pinned line

**Files:**
- Modify: `memory-tier.mjs` (`gitignore()`, lines 321-342)
- Modify: `journal.mjs` (`record` writes `journal.md`)
- Test: `memory-tier.test.mjs`

**Interfaces:**
- Produces:
  - `gitignore()` gains, after `'*/memory/handoff.md'`, two lines: `'!*/memory/journal/*.md'` and `` `*/memory/journal/${today}.md` ``, where `today` is the local `YYYY-MM-DD` (`local()` from `store.mjs`, first 10 characters).
  - `record()` writes `journal.md` in `dir` when it's missing, or when its description's first day is later than `days(dir)[0]`. Content:

```
---
name: journal
description: "Every exchange in this project since FIRST, one file per day in journal/; search it before saying something was never done or decided"
metadata:
  node_type: memory
  type: reference
  tier: hot
---

project-memory writes one entry here after every reply: what was asked, what was answered, the files changed and the commands run. Search it with the memory skill (`search <words>`, `--since`/`--until YYYY-MM-DD`).
```

- [ ] **Step 1: Write the failing tests** in `memory-tier.test.mjs`:
  - `a closed journal day is committed, today's is not`. Write `journal/<yesterday>.md` and `journal/<today>.md`, then run tiering: `git ls-files` lists yesterday's file and not today's.
  - `the journal folder is no note`. Tier a store that has `journal/` and `journal.md`: `.health` has no odd-name line, and the archive has no line for `journal`.
  - `journal.md gets a pinned index line`. Tier with `--now` 3 minutes after `journal.md` was written: `MEMORY.md` has a line pointing at `journal.md`, and it stays after `--now` 30 days later.
- [ ] **Step 2: Run `node memory-tier.test.mjs`.** Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run `node memory-tier.test.mjs` and `node journal.test.mjs`.** Expected: all pass.
- [ ] **Step 5: Mutants:**
  - "today's journal committed";
  - "closed days never committed";
  - "journal.md not hot";
  - "journal.md rewritten every record" (drop the first-day check).

  Then run `node mutate.mjs gitignore`. Expected: all killed.
- [ ] **Step 6: Commit**: `git commit -m "Snapshots take a journal day once it closes; journal.md pins its line"`

---

### Task 6: Search reads the journal

**Files:**
- Modify: `journal.mjs` (add `entries`)
- Modify: `memory.mjs` (`search()` lines 133-149, the CLI lines 501-533, `USAGE`)
- Test: `memory.test.mjs`

**Interfaces:**
- Produces:
  - `entries(dirs, { since, until } = {}) -> Array<Entry & { day, path, dir }>`. It opens only day files with `since <= day <= until` (bounds optional, inclusive).
  - `search(dirs, query, limit = 8, { since, until } = {})`. Hits now carry `kind: 'note' | 'journal'`.
    - Notes are scored as today, skipping `journal.md` as well as `handoff.md`, and dated by `modified` for the range.
    - A journal entry scores, per term:
      - +3 in `asked`;
      - +2 in `changed` or `ran`;
      - `min(2, mentions)` in `answered`.
    - On top of that, the entry gets +5 when every term is in `asked`, or +2 when every term is somewhere.
    - Ties go to the newest (`Date.parse(at.replace(' ', 'T'))` for entries, `modified` for notes).
  - CLI:
    - `--since` and `--until` are valued options, `=` form included. Each must be `YYYY-MM-DD`; otherwise the tool prints `--since takes a date like 2026-10-01` and exits 1.
    - `search` with no words but a date range lists entries in range, newest first, `--limit` or 30, one line each: `at  conversation s  asked (200)`.
    - A journal hit prints `score  journal   at  conversation s · branch b  (path)`, then indented lines `Asked:`, `Answered:`, `Changed:` and `Ran:`. The top 3 are in full; the rest are clipped to 200 and 300 characters. A `Full conversation: <path>` line appears when `join(projectsRoot(), t + '.jsonl')` exists.
    - The default limit becomes 10.

- [ ] **Step 1: Write the failing tests** in `memory.test.mjs` (build day files with `render` from `journal.mjs`):
  - `search finds a journal entry by its request`. An entry asked "fix the deploy error" ranks first for `search deploy error`, labelled `journal`, with its date.
  - `a note and an entry rank together`: a note named `deploy.md` and an entry both show.
  - `--since/--until narrow by day`. Entries on the 1st, 15th and 28th: `--since 2026-10-10 --until 2026-10-20` shows only the 15th.
  - `a date range alone lists the work of those days`. `search --since 2026-10-21 --until 2026-10-27` with no words lists those days' requests, newest first.
  - `a bad date is refused`: `--since yesterday` exits 1 with the message.
  - `the full conversation is named while it exists`.
  - `search over 30 MB of journal is fast and skips days out of range`. Write 365 day files totalling about 30 MB: a search takes under 2 seconds. With `--since` set to the last week, a day file outside the range that is replaced by a folder (unreadable) causes no error.
  - `--all searches every project's journal`.
- [ ] **Step 2: Run `node memory.test.mjs`.** Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Update `USAGE` for `search`.
- [ ] **Step 4: Run `node memory.test.mjs` and `node journal.test.mjs`.** Expected: all pass.
- [ ] **Step 5: Mutants:**
  - "journal not searched";
  - "a request scores as a reply";
  - "--since ignored";
  - "--until ignored";
  - "a date range alone finds nothing";
  - "journal.md listed as a note";
  - "every hit printed in full".

  Run `node mutate.mjs search`. Expected: all killed.
- [ ] **Step 6: Commit**: `git commit -m "search reads the journal, by words and by dates"`

---

### Task 7: `forget`

**Files:**
- Modify: `journal.mjs` (add `forget`)
- Modify: `memory.mjs` (CLI, `USAGE`)
- Test: `memory.test.mjs`

**Interfaces:**
- Produces:
  - `forget(dir, terms, { since, until, conversation, apply = false }) -> { matched: Entry[], removed: number }`. An entry matches when every term (case-insensitive) is in one of its fields, it is in the range, and its `s` equals `conversation` when one is given. With `apply` it removes them under `withLock(dir)` (through `replaceIfUnchanged`).
  - CLI `forget <words…> [--since D] [--until D] [--conversation TAG] [--yes]`:
    - With no word, date or conversation, it is refused: `forget needs words, a date range or --conversation; to drop the whole journal, delete <dir>/journal`.
    - Without `--yes` it prints up to 20 matches (`at  conversation s  asked (120)`), then `N entr(y|ies) would go; run again with --yes to remove them`. Exit 0.
    - With `--yes` it prints `removed N`. When any of them is in a day already committed, it adds a line saying the history still holds those days, and that deleting `~/.claude/projects/.git` removes them. `--conversation` joins the valued options.

- [ ] **Step 1: Write the failing tests:**
  - `forget lists and keeps without --yes`: the files are unchanged.
  - `forget --yes removes only the matches`: two of five entries go, three stay byte for byte.
  - `forget with nothing to match is refused`: exit 1.
  - `forget --conversation removes one conversation`.
- [ ] **Step 2: Run `node memory.test.mjs`.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `node memory.test.mjs` and `node journal.test.mjs`.** Expected: all pass.
- [ ] **Step 5: Mutants:**
  - "forget removes without --yes";
  - "forget matches any term";
  - "forget ignores the range";
  - "forget with no filter removes all".

  Run `node mutate.mjs forget`. Expected: all killed.
- [ ] **Step 6: Commit**: `git commit -m "forget: remove journal entries on request, after a look"`

---

### Task 8: Claude is pointed at it

**Files:**
- Modify: `skills/memory/SKILL.md`
- Modify: `handoff-log.mjs` (`print()`, the startup and clear branch, line 762)
- Modify: `memory.mjs` (`status()`, one line)
- Modify: `journal.mjs` (add `summary`)
- Test: `handoff-log.test.mjs`, `memory.test.mjs`

**Interfaces:**
- Produces:
  - `summary(dir) -> { first: string | null, days: number, bytes: number, left: number, failed: string | null }`. `left` is the number of backfill candidates not yet imported, counted by the same rule as `backfill`.
  - Briefing: when `summary(dir).first` exists, the startup and clear briefing adds, before the health lines: `Earlier work in this project since FIRST is in its journal: when asked about the past, search it with the memory skill before saying you don't know.`
  - `status` adds one line per store with a journal: `journal: D days since FIRST, X.X MB`, then `; importing L older conversations` when `L > 0`, and `; last write failed: E` when one did.
  - `SKILL.md`:
    - The description adds, after "Use before concluding something was never learned or decided here": "and whenever the user asks about earlier work (what was done, decided, fixed, run or said, and when): the journal holds every exchange".
    - A new paragraph after the table says:
      - search before answering a question about earlier work;
      - when nothing is found, try other words (synonyms, a file's or a tool's name) and `--all`;
      - for "what did I do last week", search with `--since`/`--until` alone;
      - answer with the date, and quote the entry when the exact words matter;
      - never say there is no record until notes, journal and `--all` were searched;
      - `forget` only after the user confirms what it lists.
    - The table gets a `forget <words>` row.
  - Register `journal.mjs`'s `summary` import in `handoff-log.mjs` dynamically, inside `print()` (`await import(new URL('./journal.mjs', import.meta.url))`), so the module graph stays one way at load time.

- [ ] **Step 1: Write the failing tests:**
  - `the briefing names the journal`. A store with a journal day: the startup briefing contains `is in its journal` and the first day. A store without one has no such line.
  - `status reports the journal`: `journal: 2 days since …`.
  - `status says an import is pending`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement**, including the `SKILL.md` text above.
- [ ] **Step 4: Run all six suites.** Expected: all pass.
- [ ] **Step 5: Mutants:**
  - "no journal line in the briefing";
  - "the journal line without a journal";
  - "status hides the journal";
  - "status hides a pending import".

  Run them. Expected: all killed.
- [ ] **Step 6: Commit**: `git commit -m "Claude is pointed at the journal: skill, briefing line, status"`

---

### Task 9: The sixth suite everywhere, and the docs

**Files:**
- Modify: `.github/workflows/test.yml` (add `- run: node journal.test.mjs`)
- Modify: `deploy.mjs` (the suites array, `'journal'`)
- Modify: `CONTRIBUTING.md` (six suites)
- Modify: `README.md`, `PRIVACY.md`, `docs/how-it-works.md`, `docs/art/what-you-get.html` (re-rendered to `docs/what-you-get.webp`), `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Wire the suite.** Add it to CI, to `deploy.mjs`, and to CONTRIBUTING's list and counts ("five" becomes "six" wherever it counts suites).
- [ ] **Step 2: Docs.** Edit each file, for the reader it already has:
  - README: in "What you get", a row for asking about any earlier work; examples in "Using it day to day" ("What did we decide about the logo in September?", "What did I work on last week?", "Forget the password I pasted yesterday."); the privacy bullets; the comparison table's "How memories are made" and "Old versions kept" rows; the leftover-files list (`journal` folders, `journal.md`).
  - PRIVACY: "What it saves" adds the journal (what an entry holds, the caps); "How long" adds it (until deleted or forgotten); "Deleting it" adds the `journal` folders and `journal.md`.
  - how-it-works: a "The journal" section (format, keys, backfill, closed-day snapshots); `search`'s new options; `forget`; the briefing line.
  - `docs/art/what-you-get.html`: the first card says it remembers all your work, not only where you left off. Also its alt text in the README. Re-render with `node docs/art/render.mjs` and look at `docs/what-you-get.webp`: the title fits on one line, the card heights still match.
  - CHANGELOG: an `## Unreleased` section in plain words.
- [ ] **Step 3: Check the docs.** Run the scratchpad's `doclinks.mjs` (0 broken) and the 80-column check on prose lines.
- [ ] **Step 4: Run `node mutate.mjs`, the full run.** Expected: every mutant killed. Then push the branch and wait for CI: 6/6.
- [ ] **Step 5: Commit**: `git commit -m "Journal: sixth suite in CI and deploy; README, privacy, how-it-works, changelog"`

---

### Task 10: Measure, deploy, and the recall test

**Files:** none changed unless a step finds something.

- [ ] **Step 1: Cost.** Run `node bench.mjs` on master before merging and on the branch after. Expected: the Stop hook's median grows by under 10 ms with nothing to import.
- [ ] **Step 2: Fresh review.** A fresh reviewer reads the branch diff against the spec and the Review Focus. Fix what it finds, with a test and a mutant each, and have the fixes reviewed again.
- [ ] **Step 3: Merge and deploy.** Fast-forward `master`, push, wait for CI 6/6, then `node deploy.mjs` (in the background) and `node ~/.claude/hooks-live/memory.mjs doctor`. Expected: all gates ok, doctor all ok.
- [ ] **Step 4: Recall test, after a day of normal use** (so the backfill has run).
  1. Pick 30 facts from this machine's conversations older than a week: a decision, a fix, a command, a file changed, a date.
  2. Word a question for each the way a user would, with words that differ from the entry's.
  3. Ask each in a fresh conversation, giving no hints.

  Pass: at least 27 of the 30 answered correctly, with the right date, without naming a command. Record each miss and its cause (caps, ranking, the skill's wording, or a detail only the full transcript had) in the spec's folder as `2026-10-28-work-journal-recall-results.md`, for the next round.
