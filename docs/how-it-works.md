# How project-memory works

This page is the technical side of the [README](../README.md): what runs when,
which files it writes, and the numbers it works to. You don't need any of it
to use the plugin.

## When it runs

Claude Code runs project-memory on three of its events, declared in
`hooks/hooks.json`, and gives Claude one skill, `skills/memory/SKILL.md`.

| Moment | Claude Code event | What runs |
|---|---|---|
| Claude finishes a reply | `Stop` | `memory-tier.mjs --stop`: tidies this project's notebook and the shared one, updates the handoff, writes the journal and imports a few older conversations into it, takes a snapshot, and reminds Claude to save notes when a compaction is close |
| A conversation starts, is cleared with `/clear`, or resumes after a compaction | `SessionStart` | `handoff-log.mjs --print`: the startup briefing |
| You run `/compact` | `PreCompact` (manual) | `memory-tier.mjs --stop`, so the notebook is tidy and the handoff current before the summary is made |
| Claude Code compacts on its own | `PreCompact` (auto) | `compact-gate.mjs`: may ask Claude Code to wait for the end of the turn (see [Compaction](#compaction)) |

The skill is `memory` (`/project-memory:memory`). It runs `memory.mjs`, the
command-line tool described [below](#the-memory-tool-from-a-terminal).

A hook that fails exits with status 0, so a failure never blocks a session:
what went wrong is reported in the startup briefing instead. Two hold things up
on purpose, briefly: once per compaction cycle the Stop hook sends Claude
feedback that keeps the conversation going, to ask it to write its notes, and
the compaction gate can ask Claude Code to wait (exit status 2). While
`CLAUDE_CODE_DISABLE_AUTO_MEMORY` is `1`, `true`, `yes` or `on` (in any case),
every hook does nothing, except that the Stop hook notes the conversation's
tag in `.memory-off` so the journal never imports it; the memory tool still
works when you run it yourself.

## Where things live

Claude Code keeps one folder per project under `~/.claude/projects/`, named
after the project's path with every character that isn't a letter or digit
replaced by `-`. Auto memory lives in its `memory/` subfolder.

For memory, a project is a git repository: a conversation started in a
subfolder or a worktree uses the repository's folder, though its transcript
sits in the folder named for where it started. project-memory finds the
repository the same way, from the folder the conversation started in. It
follows a worktree's `.git` file only when the main repository's worktree
record names it back, as Claude Code does. A repository whose path is so long
that Claude Code shortens its folder name with a hash is not followed: a
conversation started in a subfolder of it writes its handoff under the long
name.

With `CLAUDE_CONFIG_DIR` set, all of this is under that folder instead of
`~/.claude`, and a plain name in `CLAUDE_CODE_PROJECT_DIR_NAME` (up to 64
letters, digits, `-` and `_`) names the project folder. Without
`CLAUDE_CONFIG_DIR`, that name is not followed; neither are `_shared` and
Windows device names such as `con` and `nul`.

| Where | What |
|---|---|
| `~/.claude/projects/<project>/memory/MEMORY.md` | the index: one line per note, worth loading every session |
| `…/memory/MEMORY-archive.md` | lines moved out of the index; not loaded, still searchable |
| `…/memory/handoff.md` | the rolling handoff (see [The handoff](#the-handoff)) |
| `…/memory/journal/YYYY-MM-DD.md` | the journal, one file per day (see [The journal](#the-journal)) |
| `…/memory/journal.md` | the journal's note, so the index has a pinned line for it |
| `…/memory/journal/.imported`, `.failed`, `.forgotten` | the transcripts imported, the journal's last failure, the keys of forgotten entries |
| `…/memory/.lock` | the store's lock, a folder that exists while a write is in progress |
| `…/memory/.tiered`, `.health` | a fingerprint of the last tidy-up, and problems for the startup briefing |
| `…/memory/.private-sessions` | the tags of conversations marked private (the newest 1,000) |
| `~/.claude/projects/_shared/memory/` | the shared notebook, same layout |
| `~/.claude/projects/.git`, `.gitignore` | the snapshot repository, and what it ignores |
| `~/.claude/projects/.git/project-memory-ignored` | bookkeeping for the snapshot's ignore list |
| `~/.claude/projects/.stop-ran`, `.snapshot-health`, `.nudge/` | bookkeeping: when the Stop hook last ran, the snapshot's state, the reminder's state per conversation tag |
| `~/.claude/projects/.handoff-failed-<project folder>` | a handoff that could not be saved, and why; read at the next start |
| `~/.claude/projects/.memory-off` | the tags of conversations held with auto memory off (the newest 1,000), which the journal never imports |

Uninstalling the plugin leaves all of these, and the history, in place; you
may delete them.

## The index

Claude Code loads the first 200 lines or 25 KB of `MEMORY.md` at the start of
every conversation. project-memory keeps it under **7,000 bytes** and **200
lines**, so it is read in full and costs few tokens. Pinned lines
(`tier: hot`), lines whose file is missing, and prose (headings, and lines
that point at no note) are never moved, so they alone can go past those
limits; past 7,000 bytes, the startup briefing says the index is over budget.

Every `MEMORY.md` ends with an Archive line that counts the archived lines,
and a project's also gets a line for `handoff.md` and, once it has a journal,
one for `journal.md`; both are pinned. Prose and headings anywhere in it
are gathered at the top, above the lines.

After each reply it decides which lines stay in `MEMORY.md` and which move to
`MEMORY-archive.md`:

- Notes of type `feedback` and `user` (how to work, who you are) stay. When
  the index is full they get at most half of what is left after the pinned
  lines.
- Any other note stays for **7 days** after it was last changed, by its
  `modified:` date or, failing that, the file's date.
- A note whose file name carries a date is an event log. It stays for
  **3 days**.
- `tier: hot` or `tier: archive` in a note's front matter overrides all of
  this. `superseded-by: <file>` counts as `tier: archive`, even next to
  `tier: hot`, and `search` names the replacement under the note.
- When the index is over 7,000 bytes or 200 lines, lines are moved out and
  marked: first `feedback` and `user` lines over their half, oldest first,
  then dated event logs, then the oldest other notes, then the remaining
  `feedback` and `user` lines. A marked line comes back by itself when there
  is room, if its note would still stay by the rules above; if not, the mark
  comes off and the line stays archived. Any other move to the archive is
  final, unless the note says `tier: hot`.

Lines are moved word for word, never rewritten. A note that has no line gets
one, built from its description, two minutes after it was written. That line
goes in the archive (in the shared notebook, in its index) unless the note
says `tier: hot`. A file name no line can point at, such as `lesson (1).md`,
is reported in the startup briefing instead, to be renamed. A line that points
at a web page or a path outside the notebook is kept as plain text. When two
lines point at the same note, one is kept: in the index, the newer (lower)
line, in the first one's place; an index line over an archived one. The other
line is dropped, and the history still has it. On Windows, and on macOS by
default, a line written `(Kase.md)` counts as `kase.md`'s line. Nothing is
written when nothing changed.

## The handoff

`handoff.md` records the latest exchanges after every reply: up to 10 per
conversation, for up to 3 conversations, keeping the first 240 characters of
what you asked and the first 400 of the answer, and the names of the files
the turn changed (from Edit, Write and NotebookEdit; the 8 edited last, and
how many more). A slash command is recorded as you typed it, with its
arguments. The answer is the reply Claude Code hands the Stop hook, since the
transcript file can lag behind it. A project gets its `memory/` folder for
this if Claude hasn't saved a note there yet.

Entries carry your local time and are ordered by it, so changing time zones
shows up here. After you move west, new turns rank before the newest entries
and aren't kept until your clock passes them, up to the hours you moved.
After you move east, recent turns can be listed twice until newer ones
replace them.

Before any of it is written, these are taken out:

- text between `<private>` and `</private>`;
- private key blocks (PGP's too), and a private key in base64;
- keys and tokens known by their prefix: `sk-`, Stripe's
  `sk_live_`/`pk_test_`/`rk_live_` and `whsec_`, `ghp_`, `github_pat_`,
  GitLab's `glpat-`, npm's `npm_`, PyPI's `pypi-`, Hugging Face's `hf_`,
  Slack's `xox…-` and `xapp-`, AWS's `AKIA` and `ASIA`, Google's `AIza`,
  `GOCSPX-` and `ya29.`, SendGrid's `SG.`, Groq's `gsk_`, xAI's `xai-`,
  Shopify's `shpat_`, DigitalOcean's `dop_v1_`, Notion's `ntn_`, Atlassian's
  `ATATT`, Vault's `hvs.`, Docker's `dckr_pat_`, JWTs, and `Bearer`, `Basic`
  or `Token` before one with a digit;
- Slack webhook addresses, and the password in a web address
  (`postgres://user:…@host`, also with no user name);
- passwords on a command line: `curl -u user:…`, `--password …`,
  `mysql -p…`, `docker login`, `sshpass` and `twine` with `-p …`;
- "password is …", "the password for the server is …" and "the api key is …",
  when the value has a digit or a symbol in it ("my password is sunshine"
  stays, since "the password is hashed" is prose);
- a value of 6 characters or more after `:` or `=` following `password`,
  `passwd`, `pass`, `passphrase`, `secret`, `access_token`, `auth_token`,
  `refresh_token`, `session_token`, `api_token`, `api_key`, `account_key`,
  `private_key`, `key-data` or `pwd`, also inside a longer name
  (`DB_PASSWORD=`, `DB_PASS=`, `PGPASSWORD=`, `dbPassword`, `clientSecret`)
  and with the value on the next line. Such a value goes even with no digit
  (`correct_horse_battery_staple`), unless it is plainly code: a type
  (`password: string`), a reference (`${…}`, `$(…)`, `process.env.X`,
  `user.password`), or, with no digit in it, a call, an index or a path of two
  parts or more (`jwt.sign(…`, `request.form[…`, `/etc/app/secret`);
- a value after `token` alone, only when it has a letter in it
  (`token: abc123def`), so a count like `input_tokens: 863324` stays.

No list of patterns finds every secret: anything these rules miss belongs
between `<private>` tags. The same rules apply to everything the startup
briefing and the compaction recovery note print, the shared index and the
health lines included.

What is recorded as your message is your own words: Claude Code's
`<system-reminder>` blocks, and tags it puts before them (a task notification,
an IDE's note of the open file), are left out. Text you pasted is yours and
stays.

The answer to a message that contains `<private>` is saved as `[private]`,
because an answer often repeats what it was told, and so are the names of the
files changed in that turn. A message that contains `<private-session>`, a
slash command's arguments included, marks its whole conversation: its entries
are removed from `handoff.md`, later turns write none, the compaction gate
writes no recovery note for it, and Claude gets no reminder to write notes.
Other conversations' briefings name it as working, without its messages.
Both tags are read in any case, with spaces or attributes, self-closed,
fullwidth, with hidden zero-width characters, and as `private_session`; in a
message typed while Claude works (a queued record); and inside another tag.
The tags inside what Claude Code quotes, such as an agent's report or a task's
result, are not the user's and mark nothing, and neither does a compaction
summary that mentions them. The mark is kept by the conversation's tag in
`.private-sessions` (the newest 1,000), because only the turn that typed it
sees it in the transcript. `handoff.md` is not in the snapshots.

## The journal

The handoff keeps the last few exchanges; the journal keeps all of them. After
every reply, the Stop hook writes each finished turn to
`<project>/memory/journal/YYYY-MM-DD.md`, from the same read of the
transcript that updates the handoff. A conversation started in a subfolder or
a worktree writes to the repository's journal, as for the handoff. The shared
notebook has none. An entry, with a blank line between entries:

```
<!-- j:<key> t:<project folder>/<session id> d:2026-10-28 -->
## 14:05 · conversation 551dc2d3 · branch master
**Asked:** your message, up to 2,000 characters
**Answered:** Claude's reply, up to 3,000 characters
**Changed:** the files edited or written in the turn, the last 20
**Ran:** the Bash and PowerShell commands, the last 10, 200 characters each
```

- The time is local, as in the handoff. The branch comes from the
  repository's `HEAD` file. A path inside the turn's folder is written
  relative to it. `Changed` and `Ran` are left out when empty.
- The key is the id of the turn's prompt record; a record without one gets
  the conversation's tag, the time and a hash of the message. One key is one
  entry: twin Stops, retries and a killed hook write nothing twice, and a
  turn seen again with more in it replaces its entry. A turn skipped while
  another window held the lock is written after the next reply, as the
  handoff catches up.
- Writes go under the store's lock through the same unchanged-file check as
  every other write. Entries are kept in time order. Lines in a day file that
  aren't part of an entry are kept, above the entries. A day's file is
  rewritten only to add an entry, by `forget`, and by a later
  `<private-session>`.
- Every field goes through the redaction rules above, commands included. A
  `<private>` message's answer is `[private]`, with no files or commands. A
  `<private-session>` conversation writes nothing, and its entries are
  removed from every day since it began. With auto memory off, nothing is
  written.
- `journal.md` is written once, the first time, as a `tier: hot` note, so
  the index gets a pinned line telling Claude to search the journal. It is
  never rewritten, so an edit to it stays.
- A failure to write is kept in `journal/.failed` for `status`, and cleared
  by the next write that succeeds.

An entry is about 1.5 KB, and at most about 6 KB. At 50 exchanges a day
that is about 27 MB a year.

**Importing older conversations.** Each Stop also imports some of the
conversations still on disk, so a new install starts with the last month
(Claude Code deletes a transcript after 30 days without use, by default)
instead of nothing. The candidates are the transcripts in the project's own
folder and in folders whose name starts with it and `-` (its subfolders'),
each confirmed to belong to this repository, oldest first. One changed in
the last 30 minutes is left to its own Stop. The import holds the store's
lock for up to 150 ms per Stop, plus one transcript past that, and reads at
most the last 64 MB of a transcript. `journal/.imported` lists each one
read, with its size: one that has grown since and been quiet for 30 minutes
is read again (keys keep that harmless), and once nothing is left, the
folders are looked at again at most every 30 minutes. A conversation never
imported:

- one whose tag is in `.private-sessions`, or in
  `~/.claude/projects/.memory-off` (a Stop while auto memory is off puts it
  there). A conversation held with auto memory off before this version has
  no tag, and is imported;
- one with a `<private-session>` mark in the part read. In a transcript from
  before the plugin kept marks, a mark more than 64 MB before its end is not
  seen.

Keys listed in `journal/.forgotten` are never written again, by an import or
a live Stop.

**In the history.** Today's file grows with every reply, so it stays out of
the snapshots: committed, every version would stay in the history. The
ignore list names today's file, and changes at midnight, so a day is first
committed at a reply on a later day. An entry `forget` or a later
`<private-session>` removes from a finished day stays in that day's
committed version; delete `~/.claude/projects/.git` to remove it.

## The startup briefing

At the start of a conversation, and after `/clear`, Claude is told:

- which other conversations are working in this project right now (their
  transcript changed in the last 30 minutes and has a turn still open), and
  what they were last asked; if none, where the last conversation stopped, if
  that was in the last 7 days. After `/clear` neither, since the conversation
  just cleared is the newest. It names at most two, and only conversations
  started in the project's folder or in the folder this one started in;
- when the project's journal has an entry, one line: "Earlier work in this
  project since <first day> is in its journal: when asked about the past,
  search it with the memory skill before saying you don't know." The
  journal itself is never loaded;
- anything failing: the Stop hook not running, snapshots failing three times
  in a row, a notebook that needs attention;
- the shared notebook's index, up to 3,000 bytes.

After a compaction, Claude is told:

- what the turn the compaction cut had in flight, if it cut one;
- this conversation's own latest exchanges, never another's;
- which other conversations are working here, when there is a recovery note or
  this conversation has exchanges of its own;
- the shared notebook's index.

A conversation that is resumed gets no briefing: its history already holds
the one it got when it started.

The briefing stays under 9,500 characters, inside the 10,000 Claude Code
passes on whole. After a compaction, the oldest exchanges are left out first.
At the start of a conversation, each line is cut to 1,000 characters, then
the end is cut, so the shared index goes first. A `<` that starts a
tag is written `&lt;`, so text from an earlier conversation can't pose as part
of Claude Code's own message.

## Compaction

Claude Code compacts a conversation when it nears the size limit, and it
checks before every step, so a long task can be cut in the middle. Three
things soften that.

- **A reminder.** When a conversation passes 85% of the compaction window, the
  Stop hook asks Claude once to write its notes now. It asks again only after
  a compaction, and never in a private conversation. It's sent as hook
  feedback (`additionalContext`), so the conversation goes on and no hook
  error is shown. What Claude writes in answer is its notes, not the turn's
  result, so the record keeps the answer from before the reminder until the
  next piece of work starts, such as a background task finishing.
- **A short wait.** When Claude Code compacts on its own in the middle of a
  turn, `compact-gate.mjs` asks it to wait for the end of the turn, while the
  conversation is between 200,000 tokens and 90% of the model's window. Past
  90% there may be no room for one more step, so the compaction goes ahead,
  and the gate first writes the handoff and the turn's in-flight note into
  `handoff.md`. Under 200,000 tokens, or at the end of a turn, it goes ahead
  and nothing is written. Claude Code compacts at about 96% of its compaction
  window, so the gate can wait only when `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is
  set below the model's window: set to `800000` on a 1M model, Claude Code
  compacts at about 767,000 tokens, and the turn can finish first. With the
  default settings the compaction goes ahead, and the recovery note below
  does the work. Claude Code doesn't always honour the request either.
- **A recovery note.** When a turn is cut anyway, the briefing right after
  the compaction gives Claude what it had in flight: what you asked, its last
  words, background tasks still running with their output files, and the
  names of the files it had edited. A task counts as running from the result
  of the Bash or Agent call that started it until its end is reported;
  nothing else in the conversation adds one.

The plugin reads the window sizes from the environment, as Claude Code does:

- the model's window: 1,000,000 tokens, or `CLAUDE_CODE_MAX_CONTEXT_TOKENS`,
  or 200,000 when `CLAUDE_CODE_DISABLE_1M_CONTEXT` is set;
- the compaction window: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (`800000`, `800k`
  and `0.8M` all work), never more than the model's;
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moves the reminder earlier to match.

A window chosen with `/autocompact`, `autoCompactWindow` or `--autocompact`
is kept in Claude Code's settings, which the plugin doesn't read. With one of
those, also put the size in `CLAUDE_CODE_AUTO_COMPACT_WINDOW` under `env` in
your Claude Code settings, for example `"200k"`. Otherwise the reminder
never fires.

## Snapshots

After each reply that changed a note, the Stop hook commits the notes to a git
repository at `~/.claude/projects`. It commits only `*/memory/*.md` and the
journal's finished days (`*/memory/journal/*.md` but today's), never
`handoff.md`: transcripts and the record of the latest exchanges are never
committed. It has no remote and is never pushed. It overrides the git
settings that would break snapshots, whatever yours say: no hooks of yours run
on it, commits aren't signed, line endings are kept exactly as
written, and long paths work on Windows. Your other git settings still apply.
A damaged index (git's working copy of the last snapshot, after a crash or a
full disk) is rebuilt from that snapshot; no note is touched. If
`~/.claude/projects` is already a git repository that project-memory didn't
make, it commits nothing there, and `doctor` says snapshots are off. A
repository at `~/.claude` itself (a dotfiles repository) doesn't count:
project-memory still makes its own in `~/.claude/projects`.
The first time, with no repository there yet, it takes a snapshot of every
notebook as it finds it before its first tidy-up, then tidies.

- `history <note>` lists the commits that changed a note.
- `status` names the notes the snapshots saw added, edited or deleted in the
  last 7 days, leaving out `MEMORY.md`, the archive and `handoff.md`, which
  change after nearly every reply, and what the first snapshot found.
- `restore <note>` writes it back from the newest snapshot that has it,
  together with its index line. `--rev <commit>` picks a version `history`
  lists; a commit it lists as "deleted" brings back the version that commit
  deleted. `--force` replaces a note that exists, and keeps the replaced text
  in the repository, printing the command that shows it. That text is a loose
  object in no commit, so git's own cleanup may delete it after about two
  weeks. A note that was promoted to the shared notebook comes back only with
  `--force`, since it would then be in both.
- A store reached through a link to another project's store is committed once.
  A memory folder, or a project folder, linked to a folder outside
  `~/.claude/projects` (a synced folder) is snapshotted once where git follows
  the link, as Git for Windows does with a junction: under the first link in
  the folder's listing. `restore` and `history` read the paths under every
  link to it, that one first, so a version saved under a link added earlier
  still comes back. Elsewhere git keeps a symlink as a link, so that folder's
  notes are not in the history, and `doctor` and the startup briefing say so.
  To have them snapshotted, keep the folder in `~/.claude/projects` and make
  the link the other way round.
- Without git there are no snapshots, everything else works, and `doctor` says
  so.

To drop the history, delete `~/.claude/projects/.git`. The next change to a
note, or the next day, starts a new one. It is also the only way to remove
an entry from a finished day's committed version.

## The shared notebook

`~/.claude/projects/_shared/memory/` works like a project's notebook, with
two differences: its index is limited to **3,000 bytes** (and 200 lines),
because it is loaded into every conversation of every project, and its notes
never age out. When the index is over that, its oldest lines move to the
shared archive like any other, and the startup briefing, which prints only
the index, no longer shows them; `tier: hot` keeps a lesson in view.

`promote <note>` moves a note there: it copies the file, adds the line to the
shared index, then removes both from the project. If anything fails part-way,
the note is in both places, never in neither. When the shared index is
already full, `promote` says so and suggests `tier: hot`. The skill tells
Claude to ask you before promoting.

## Several conversations at once

Each store has a lock, a `.lock` folder that only one process can create. A
hook waits up to 2 seconds for it. If the store is still busy, the hook skips
this reply and catches up after the next one. A lock left by a process that
was killed is taken over after 30 seconds.

Every write first checks that the file still holds what was read. When Claude
edited the file in the meantime, Claude's edit is kept and the hook tries
again next time.

## Search and forget

`search` looks at notes in this project and the shared notebook, archive
included, and at this project's journal (`--all`: every project). Words
shorter than 3 letters are ignored, and so are common words such as "the",
"how" and "what".
For each word: +3 if it's in the note's name, +2 in its description, +1 per
mention in the body, up to 2. A note that has every word in its name or
description gets +5; one that has every word somewhere gets +2. A journal
entry is scored the same way on its request (+3), its files and commands
(+2) and its reply (+1 per mention, up to 2): every word in the request gets
+5, every word somewhere +2, so a reply that names everything can't outrank
the request for the thing. Equal scores show the newest first.

It shows the top 10 (`--limit N` for more), then how many matched. A journal
hit shows its day and time, conversation tag, branch and day file. The top
three journal hits are printed whole, up to the caps, and the rest are cut
to 200 or 300 characters a field. When the hit's transcript is still on
disk, its path follows, for the detail the entry left out.

`--since` and `--until` take a date, `YYYY-MM-DD`, and keep only the days
from one to the other, both included: a note by the day of its `modified:`
date (or its file's), the journal by its day files. A day file outside the
range is never opened. With dates and no words, `search` lists the requests
of those days, newest first, 30 by default: the answer to "what did I work
on last week". A day file that can't be read is named in the output, and
the rest is still searched.

`forget <words…>` finds the journal entries that hold every word (in any
case) in their request, reply, branch, files or commands, narrowed by
`--since`, `--until` and `--conversation <tag>`; it needs at least one of
these. Without `--yes` it lists them (up to 20) and says how many would go;
with `--yes` it removes them under the store's lock and lists what went.
Their keys are added to `journal/.forgotten` first, so neither a killed
`forget` nor a later import brings them back. It then names the days before
today, which the snapshots already hold, and the folder to delete. It clears
the journal only: `handoff.md` and Claude Code's transcripts are untouched.
Its words are recorded in today's journal like any other request.
`--since 1970-01-01 --yes` empties the journal; deleting the `journal` folder
instead rebuilds it from the transcripts still on disk, since `.imported`
and `.forgotten` are inside it.

`status` adds a journal line: how many days since the first, the size, how
many older conversations are still to import, and the last failure, if any.

## The memory tool from a terminal

The skill runs `memory.mjs`, and so can you:

```
node "$HOME/.claude/plugins/cache/project-memory/project-memory/<version>/memory.mjs" <command>
```

| Command | Options |
|---|---|
| `search <words…>` | `--since D`, `--until D`, `--all`, `--limit N` |
| `forget <words…>` | `--since D`, `--until D`, `--conversation <tag>`, `--yes` |
| `status` | `--all` |
| `history <note>` | `--all` |
| `restore <note>` | `--rev <commit>`, `--force` |
| `promote <note>` | |
| `doctor` | |

Every command works on the project of the conversation that `--session <id>`
names (the skill passes Claude Code's session id). Without it, or when that
conversation's transcript isn't found, it works on the nearest project with
a notebook, from the folder you're in upward. The tool reads no environment
variable to find the conversation. `--store <folder>` picks another
project's `memory` folder, one inside `~/.claude/projects` (any other is
refused), and `--shared` picks the shared notebook. With no command, it runs
`status`. `D` is a date, `YYYY-MM-DD`. The tool exits with 1 when a command
is refused or fails.

`restore` and `promote` take a note's name as the disk resolves it: on Windows
and on macOS by default in any letter case (on Windows, a short name such as
`memory~1` too), on Linux only as written. git reads the name literally, so a
name with `[`, `*` or `?` in it works. A write the disk refuses is reported in
one line that says what was left behind.

## Requirements and limits

- Node.js 20 or newer. No other dependencies.
- Git, for snapshots.
- Paths follow `CLAUDE_CONFIG_DIR`, and `CLAUDE_CODE_PROJECT_DIR_NAME` only
  when `CLAUDE_CONFIG_DIR` is set too (see [Where things live](#where-things-live)).
  The `autoMemoryDirectory` setting is not followed: the plugin reads no
  settings.
- Tested on Linux, macOS and Windows, with Node 20 and 24.
- The snapshot repository only grows.

The design documents, with the measurements behind these numbers, are in
[`docs/specs/`](specs/).
