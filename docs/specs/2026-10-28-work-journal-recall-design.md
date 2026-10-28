# Recall: a work journal Claude searches for you

Status: design, not built. Date: 2026-10-28. Builds on 1.1.0 ("Cronos").

## Intent

In the user's words: the end user should just ask Claude Code for something
from their past work, and Claude finds it and gives it to them. The user
never searches. After working with Claude Code for a long time, everything
they will need later should be there for Claude to recall, with no setup and
no fiddling with code, plugins or tools.

Today project-memory can't do that. What it keeps of the work itself is:

- `handoff.md`: the last 10 exchanges of the last 3 conversations, and only
  the first 240 characters of each request and 400 of each reply. Older
  exchanges are replaced.
- The notes Claude chooses to write. Work Claude didn't write a note about is
  not kept.
- Old versions of those notes, in the snapshot history.

Claude Code keeps the full conversation files, but deletes them after 30 days
of inactivity by default (its `cleanupPeriodDays` setting), and nothing makes
them searchable. So a question like "how did we fix the deploy error in
September?" gets an answer only if a note happens to cover it.

## What the user experiences

The user asks in their own words, in any conversation, months later:

- "How did we fix the deploy error in September?"
- "What did we decide about the cake prices?"
- "What was the command we used to rebuild the search index?"
- "What did I work on last week?"
- "When did we change the logo, and why?"

Claude searches, reads what it found, and answers with the date and what was
asked, done and decided. If two records disagree, it says which is newer. The
user types no command and opens no file. Nothing changes in how they work, and
the start of each conversation costs no more than a sentence.

## Goals

1. Every exchange in every project is kept for good, automatically, from the
   moment the plugin is installed. Exchanges from before the install that are
   still on disk are imported once.
2. Claude can find any of it from a plain question, including by time ("last
   week", "in September") and across projects.
3. What is kept is exactly what was said and done, taken from Claude Code's
   own conversation files. Nothing is paraphrased by a model, so the record
   can't make things up.
4. The same privacy rules as today: secrets redacted, `<private>` and
   `<private-session>` respected, and a way to forget on request.
5. No setup, and no new requirement beyond Node.js (Git stays optional).

## Non-goals

- Search by meaning (embeddings). That needs a model or a dependency. Claude
  does the "meaning" part itself, by searching again with other words.
- Sync between computers or teammates.
- Summaries written by a model outside the conversation. The plugin can't call
  a model (the directory's scan holds a plugin that runs the `claude` command
  or uses a key).
- A page or app for browsing the history. Claude is the way in. A page can
  come later.
- Keeping full conversation files forever. See "My calls", 3.

## Anti-goals: it fails even if it technically works when

- the user has to type a search, or know a note's name;
- Claude says "I don't have a record of that" while the journal has it;
- a secret the redaction rules catch today ends up in the journal;
- replies get slower in a way anyone notices, or the start of a conversation
  gets heavier than one line;
- the journal or its history fills the disk out of proportion to the work.

## How it works

Three layers. Only the second is new.

1. **Notes** (unchanged): what Claude decides is worth remembering, kept tidy,
   with old versions in the history.
2. **The journal** (new): one entry per exchange, written automatically after
   every reply, kept for good, never loaded at the start of a conversation.
3. **Recall** (new): Claude searches notes and journal together whenever the
   user asks about earlier work, and answers with dates.

### The journal

**When it's written.** The Stop hook already parses the latest turns of the
transcript (`turns()` in `handoff-log.mjs`) to update `handoff.md`. The same
parse appends each completed turn to the journal. There is no second read of
the transcript.

**Where.** One file per day per project, in the project's notebook:
`~/.claude/projects/<project>/memory/journal/2026-10-28.md`. A conversation
started in a subfolder or a worktree writes to the repository's notebook, as
`handoff.md` does (`storeOf`). The shared notebook has no journal.

**What an entry holds**, from the transcript only:

```
## 14:05 · conversation 551dc2d3 · branch master

**Asked:** the request, up to 2,000 characters
**Answered:** Claude's final reply, up to 3,000 characters
**Changed:** files edited or written in the turn, up to 20, relative to the project
**Ran:** shell commands Claude ran, up to 10, the first 200 characters of each
```

The time is local, as in `handoff.md`. The branch is read from the
repository's `HEAD` file, when there is one. An entry whose turn changed no
file and ran nothing leaves those lines out. The caps keep a long report or a
pasted file from making one entry huge. The start of a reply is what gets
kept.

**Correct and complete.**

- Each turn is appended exactly once. Its key is the conversation id plus the
  turn's start time, as the handoff uses. A turn already in today's file isn't
  appended again, so twin Stop runs, a killed hook and retries are safe.
- Appends go through `withLock` and `replaceIfUnchanged`, like every other
  write.
- A turn skipped while another window held the lock is appended at the next
  reply. The handoff already catches up this way.
- A turn cut by a compaction is appended when the turn ends, like any other.
- Entries are written in the order the turns happened. A day's file is never
  rewritten except by `forget` and by a later `<private-session>`.

**Privacy**, the same rules as `handoff.md`:

- Every field goes through the secret redaction (`SECRETS`, as `clip()`
  applies it today). That includes commands, where secrets show up most.
- A message with `<private>`: its private part is removed, and the reply is
  saved as `[private]`, as are the files and commands of that turn.
- A conversation marked `<private-session>` writes nothing, and its earlier
  entries are removed from every day's file. The mark is already kept for the
  newest 1,000 conversations (`.private-sessions`).
- While `CLAUDE_CODE_DISABLE_AUTO_MEMORY` is set, nothing is written.

**Backfill.** The first time a project's journal is written, the conversation
files still on disk for that project (up to 30 days of them by default) are
imported, oldest first, with the same rules. This is spread over replies
(a few transcripts per Stop) or run by a detached process, so no hook runs
noticeably longer. A marker records which transcripts are done, so an
interrupted import picks up where it stopped. The journal then starts with
the last month instead of empty.

**Size.** A typical entry is about 1.5 KB and the most an entry can hold is
about 6 KB. At 50 exchanges a day that's about 75 KB a day, or 27 MB a year
for a busy project. Files are plain Markdown, readable by the user and by
Claude.

### The history of the journal

Each day's file only grows during that day, then never changes. The snapshot
commits a day's file once, after the day is over, and doesn't commit today's
file at every reply. That keeps git from storing a new copy of a growing file
after every reply, which would cost hundreds of megabytes a day for a busy
project. A deleted or damaged journal day can come back from the history like
a note.

### Recall

**Search.** `search` (the memory tool's existing command) gains the journal:

- It searches notes, the archive and the journal together, and labels each
  hit as a note or a journal entry with its date and conversation id.
- `--since <date>` and `--until <date>` narrow it by time. Day files outside
  the range aren't opened.
- `--all` searches every project, as it does now.
- Ranking keeps today's word scoring. A word in the request counts more than
  one in the reply, and newer entries win ties.
- A journal hit prints the whole entry, up to the caps, so Claude has what it
  needs without a second command. The top 10 are shown; `--limit` shows more.
- If the hit's conversation file is still on disk, its path is printed, so
  Claude can open it for full detail (an error message, a long output).

**Making Claude use it.** This decides whether the goal is met, so it gets
three independent nudges, none of which costs more than a line:

1. The memory skill's description says to use it whenever the user asks about
   earlier work: what was done, decided, fixed, run or said, and when. Its
   instructions say:
   - search before answering;
   - when the first search finds nothing, try other words (synonyms, the
     file's name, the tool's name) and `--all`;
   - answer with the date, and quote the entry when the exact words matter;
   - never say there is no record until the notes, the journal and `--all`
     have been searched.
2. `MEMORY.md` gets a pinned line next to the handoff's: `- [Journal](journal/)
   — every exchange since <first day>; search it before saying something was
   never done`. Claude Code loads it in every conversation, even if the
   briefing is missed.
3. The startup briefing adds one line when the project has a journal:
   "Earlier work here since <first day> is in the journal: search it when
   asked about the past."

**Speed.** Searching a year of a busy project (about 27 MB) by reading the
files should take well under 2 seconds. If it's measured slower, add a small
word index per day file, built when the day closes. Until then it's a
`shortcut:` comment, not code.

### Forgetting

`forget` (new command): the user asks Claude "forget the password I pasted
yesterday", or "forget everything about the old client". Claude runs `forget`
with the words, and optionally a date range or a conversation id. It shows
what would go, asks the user to confirm, then removes those entries from the
day files. For a day already committed, the old copy is still in the history,
and `forget` says how to remove it (as deleting `.git` does today). A forget
that rewrites history is left for later.

## Constraints

- Plain Node.js 20, no dependencies. Nothing goes online, no model is called,
  and the `claude` command is never run.
- No environment read beyond the seven names read today, and no copy of the
  whole environment, tests included (the directory's scan).
- Hooks exit 0 and stay fast. The journal adds at most a few milliseconds to
  a Stop that has nothing to import.
- Windows, macOS and Linux, Node 20 and 24, as CI runs today.
- Every new rule gets a test and a mutant, and every fix a fresh review, as in
  the bug hunt.

## Privacy and the directory listing

- **The privacy policy** gains the journal: what an entry holds, that it's
  kept until the user deletes or forgets it, how to delete it (the `journal`
  folders), and that its content reaches Anthropic only when Claude reads it
  in a conversation.
- **The README** changes "your latest exchanges are saved" to "every
  exchange is saved". The comparison table and the graphics change with it.
- **Directory policy 1.G** says plugins must not extract Claude's chat
  history, or store conversation content to change behaviour across sessions.
  Read literally, today's handoff already brushes against it, and a permanent
  journal of every exchange goes much further. This is the biggest risk in
  the design (see "My calls", 1).

## My calls (change any of these)

1. **The journal is on by default, with no setup**, because the goal is
   memory without complication. The cost is risk to the directory listing
   under policy 1.G. The fallback, if the review holds it: a one-time question
   the first time it runs ("keep a journal of your work? yes / no"), stored in
   the plugin's own file. That is one click, not configuration.
2. **Kept forever by default**, removable with `forget` or by deleting the
   folder. The goal is "everything the user will need after a long time".
3. **No full-conversation archive in this version.** Copying Claude Code's
   conversation files before they're deleted would keep every detail, but
   each one is several megabytes and holds file contents, command output and
   secrets the redaction never sees. The journal plus Claude Code's own 30
   days cover recall. If the recall test (below) shows questions only the full
   files could answer, a compressed, redacted archive is the next step. Node's
   own `zlib` does the compressing, with no dependency.
4. **Search by words, with Claude retrying other words**, instead of search by
   meaning. That's how Claude Code finds code, and it adds no dependency.
5. **One file per day per project**, inside the notebook folder: easy to read,
   cheap to commit once the day closes, and cheap to skip by date.
6. **Caps:** request 2,000 characters, reply 3,000, 20 files, 10 commands of
   200 characters. These can be tuned after the recall test.

## Left to the builder

- Whether the journal append lives in `handoff-log.mjs` beside `handoff()`, or
  in its own module the Stop hook calls.
- How backfill is spread: per Stop or as a detached process. It must survive
  being killed, and never block a reply.
- The marker formats for imported transcripts and closed days.
- Exactly how a closed day is detected for the snapshot (the local date
  changed since its last entry), across time zones, and how that fits the
  first snapshot.
- Making sure tiering, `status` and `doctor` don't treat `journal/` as notes
  (they read `memory/*.md` at the top level today; check, don't assume).
- What `status` and `doctor` say about the journal: its first day, its size,
  and an import still running.
- Wording of the skill, the pinned line and the briefing line, within the
  rules above.

## How we'll know it works

1. **Tests**, in the style of the suites:
   - append once per turn under twin Stops, a held lock and a kill;
   - private and private-session, including removal of earlier entries;
   - redaction of every field;
   - backfill resuming after an interruption;
   - day boundaries and time zones;
   - `--since`/`--until`;
   - `forget`;
   - a hostile transcript that must not slow the hook (the round-5 hostile
     inputs).
   Each rule gets a mutant.
2. **A recall test** on the maintainer's own data, replayed in a throwaway
   home as in round 4:
   - pick 30 facts from real conversations older than a week (a decision, a
     fix, a command, a file changed, a date);
   - phrase a question for each the way a user would, with words that differ
     from the entry's;
   - in a fresh conversation, with the plugin and no other hints, ask each
     one.
   It passes when Claude answers at least 27 of the 30 correctly with the
   right date, without the user naming a command. The misses show what to
   tune: the caps, the ranking, the skill's wording, or the archive in
   call 3.
3. **Cost**: the Stop hook's time measured with `bench.mjs` before and after.
   The extra time must be a few milliseconds without an import running.
   Startup briefing size stays within its current limits.
