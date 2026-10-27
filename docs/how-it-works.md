# How project-memory works

This page is the technical side of the [README](../README.md): what runs when,
which files it writes, and the numbers it works to. You don't need any of it
to use the plugin.

## When it runs

Claude Code runs project-memory at three moments, and gives Claude one skill.

| Moment | Claude Code event | What runs |
|---|---|---|
| Claude finishes a reply | `Stop` | `memory-tier.mjs --stop`: tidies this project's notebook and the shared one, updates the handoff, takes a snapshot, and reminds Claude to save notes when a compaction is close |
| A conversation starts, is cleared with `/clear`, or resumes after a compaction | `SessionStart` | `handoff-log.mjs --print`: the startup briefing |
| You run `/compact` | `PreCompact` (manual) | `memory-tier.mjs --stop`, so the notebook is tidy and the handoff current before the summary is made |
| Claude Code compacts on its own | `PreCompact` (auto) | `compact-gate.mjs`: may ask Claude Code to wait for the end of the turn (see [Compaction](#compaction)) |

The skill is `memory` (`/project-memory:memory`). It runs `memory.mjs`, the
command-line tool described [below](#the-memory-tool-from-a-terminal).

Every hook exits with status 0, even when something goes wrong, so a hook can
never block a session. What went wrong is reported in the startup briefing
instead.

## Where things live

Claude Code keeps one folder per project under `~/.claude/projects/`, named
after the project's path with every character that isn't a letter or digit
replaced by `-`. Auto memory lives in its `memory/` subfolder.

| Where | What |
|---|---|
| `~/.claude/projects/<project>/memory/MEMORY.md` | the index: one line per note, worth loading every session |
| `…/memory/MEMORY-archive.md` | lines moved out of the index; not loaded, still searchable |
| `…/memory/handoff.md` | the rolling handoff (see [The handoff](#the-handoff)) |
| `…/memory/.lock` | the store's lock, a folder that exists while a write is in progress |
| `…/memory/.tiered`, `.health` | a fingerprint of the last tidy-up, and problems for the startup briefing |
| `~/.claude/projects/_shared/memory/` | the shared notebook, same layout |
| `~/.claude/projects/.git` | the snapshot repository |
| `~/.claude/projects/.stop-ran`, `.snapshot-health`, `.nudge/` | bookkeeping: when the Stop hook last ran, the snapshot's state, the reminder's state per session |

## The index

Claude Code loads the first 200 lines or 25 KB of `MEMORY.md` at the start of
every conversation. project-memory keeps it under **7,000 bytes**, so it is
always read in full and costs few tokens.

After each reply it decides which lines stay in `MEMORY.md` and which move to
`MEMORY-archive.md`:

- Notes of type `feedback` and `user` (how to work, who you are) stay. When
  the index is full they get at most half of it.
- Any other note stays for **7 days** after it was last changed, by its
  `modified:` date or, failing that, the file's date.
- A note whose file name carries a date is an event log. It stays for
  **3 days**.
- `tier: hot` or `tier: archive` in a note's front matter overrides all of
  this. `superseded-by: <file>` counts as `tier: archive`, even next to
  `tier: hot`, and `search` names the replacement under the note.
- When the index is over its size limit, lines are moved out, dated event logs
  first, then the oldest, and marked. Marked lines come back by themselves
  when there is room.
  Any other move to the archive is final, unless the note says `tier: hot`.

Lines are moved word for word, never rewritten. A note that has no line gets
one, two minutes after it was written. Duplicate lines are removed. Nothing is
written when nothing changed.

## The handoff

`handoff.md` records the latest exchanges after every reply: up to 10 per
conversation, for up to 3 conversations, keeping the first 240 characters of
what you asked and the first 400 of the answer, and the names of the files
the turn changed (from Edit, Write and NotebookEdit; the last 8, and how many
more). A turn that is only a slash command is not recorded.

Before any of it is written, secrets are taken out: text between `<private>`
and `</private>`, private key blocks (PGP's too), keys and tokens known by
their prefix (`sk-`, Stripe's `sk_live_`/`pk_test_`/`rk_live_`, `ghp_`,
`github_pat_`, `xox…-`, `AKIA`, `AIza`, JWTs, `Bearer …` in any case), and a
value after `password`, `secret`, `api_key`, `access_token` or `auth_token`,
also as the end of a longer name (`DB_PASSWORD=`) and with the value on the
next line. The same applies to the startup briefing and the compaction
recovery note.

What is recorded as your message is your own words: Claude Code's
`<system-reminder>` blocks, and tags it puts before them (a slash command's,
a task notification, an IDE's note of the open file), are left out.

The answer to a message that contains `<private>` is saved as `[private]`,
because an answer often repeats what it was told. A message that contains
`<private-session>` marks its whole conversation: its entries are removed from
`handoff.md`, later turns write none, and the compaction gate writes no
recovery note for it. The mark is kept by the conversation's tag in
`.private-sessions` (the newest 50), because only the turn that typed it sees
it in the transcript. Snapshots taken before the mark keep their versions of
`handoff.md`.

## The startup briefing

At the start of a conversation, after `/clear`, and after a compaction,
Claude is told:

- which other conversations are working in this project right now (their
  transcript changed in the last 30 minutes), and what they were last asked;
- where the last conversation stopped;
- anything failing: the Stop hook not running, snapshots failing;
- the shared notebook's index, up to 3,000 bytes;
- after a compaction that cut a turn short: what that turn had in flight.

## Compaction

Claude Code compacts a conversation when it nears the size limit, and it
checks before every step, so a long task can be cut in the middle. Three
things soften that.

- **A reminder.** When a conversation passes 85% of the compaction window, the
  Stop hook asks Claude once to write its notes now. It asks again only after
  a compaction.
- **A short wait.** When Claude Code compacts on its own in the middle of a
  turn, `compact-gate.mjs` asks it to wait for the end of the turn, while the
  conversation is between 200,000 tokens and 90% of the model's window. Below
  that, or above it, or at the end of a turn, the compaction goes ahead.
  Claude Code doesn't always honour the request.
- **A recovery note.** When a turn is cut anyway, the next startup briefing
  gives Claude what it had in flight: what you asked, its last words,
  background tasks still running with their output files, and the files it
  had edited.

The plugin assumes a compaction window of 1,000,000 tokens. On a smaller
window, put the size in `CLAUDE_CODE_AUTO_COMPACT_WINDOW` under `env` in your
Claude Code settings, for example `"200000"`. Otherwise the reminder never
fires.

## Snapshots

After each change, the Stop hook commits the notes to a git repository at
`~/.claude/projects`. The repository ignores everything except
`*/memory/*.md`: transcripts are never committed. It has no remote and is
never pushed.

- `history <note>` lists the commits that changed a note.
- `status` names the notes the snapshots saw added, edited or deleted in the
  last 7 days, leaving out `MEMORY.md`, the archive and `handoff.md`, which
  change after nearly every reply.
- `restore <note>` writes it back from the newest snapshot that has it,
  together with its index line. `--rev <commit>` picks an older version.
  `--force` replaces a note that exists, and keeps the replaced text in the
  repository, printing the command that shows it.
- A store reached through a link to another project's store is committed once.
- Without git there are no snapshots, and `doctor` says so.

To drop the history, delete `~/.claude/projects/.git`. The next change starts
a new one.

## The shared notebook

`~/.claude/projects/_shared/memory/` works like a project's notebook, with
two differences: its index is limited to **3,000 bytes**, because it is
loaded into every conversation of every project, and its notes never age out.

`promote <note>` moves a note there: it copies the file, adds the line to the
shared index, then removes both from the project. If anything fails part-way,
the note is in both places, never in neither. The skill tells Claude to ask
you before promoting.

## Several conversations at once

Each store has a lock, a `.lock` folder that only one process can create. A
hook waits up to 2 seconds for it. If the store is still busy, the hook skips
this reply and catches up after the next one. A lock left by a process that
was killed is taken over after 30 seconds.

Every write first checks that the file still holds what was read. When Claude
edited the file in the meantime, Claude's edit is kept and the hook tries
again next time.

## Search

`search` looks at notes in this project and the shared notebook, archive
included (`--all`: every project). Words shorter than 3 letters are ignored.
For each word: +3 if it's in the note's name, +2 in its description, +1 per
mention in the body, up to 2. A note that has every word in its name or
description gets +5; one that has every word somewhere gets +2. Equal scores
show the newest first.

## The memory tool from a terminal

The skill runs `memory.mjs`, and so can you:

```
node ~/.claude/plugins/cache/project-memory/project-memory/<version>/memory.mjs <command>
```

| Command | Options |
|---|---|
| `search <words…>` | `--all`, `--limit N` |
| `status` | `--all` |
| `history <note>` | `--all` |
| `restore <note>` | `--rev <commit>`, `--force` |
| `promote <note>` | |
| `doctor` | |

Every command works on the project of the conversation that `--session <id>`
names (the skill passes Claude Code's session id), or, without it, on the
project of the folder you're in. The tool reads no environment variable to
find the conversation. `--store <folder>` picks another project's `memory`
folder, and `--shared` picks the shared notebook. The tool exits with 1 when a
command is refused or fails.

## Requirements and limits

- Node.js 20 or newer. No other dependencies.
- Git, for snapshots.
- Paths assume `~/.claude`. `CLAUDE_CONFIG_DIR` is not supported yet.
- Tested on Linux, macOS and Windows, with Node 20 and 24.
- The snapshot repository only grows.

The design documents, with the measurements behind these numbers, are in
[`docs/specs/`](specs/).
