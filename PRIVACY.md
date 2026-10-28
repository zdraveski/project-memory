# Privacy policy

project-memory is a plugin for Claude Code. It runs only on your computer.
This page says what it reads, what it saves, and how to remove it.

## What it reads

- Claude Code's record of your conversations in this project (the files Claude
  Code keeps in `~/.claude/projects`), to know what was asked and answered.
  If you set `CLAUDE_CONFIG_DIR`, that folder's `projects` instead.
- The notes Claude Code's built-in memory writes in the same folder.
- The git information of the folder a conversation starts in (its `.git`
  folder or file, and those of the folders above it), to find the repository
  whose notebook Claude Code uses, as Claude Code does.
- Seven settings from the environment, by name, the same ones Claude Code
  reads: `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME` and
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (where the notes are, and whether they're
  on), and `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`,
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
  (how big a conversation can get). Nothing else in the environment.
- Claude Code's lists of installed plugins and marketplaces, and the plugin's
  own manifest, in `~/.claude/plugins`, only when you run the `doctor` check,
  to see where the plugin is installed. It never reads your Claude Code
  settings file, which can hold keys.

## What it saves

All of it stays in `~/.claude/projects` on your computer:

- A record of where you left off (`handoff.md`): the start of your latest
  messages (up to 240 characters each) and of Claude's replies (up to 400),
  and the names of the files Claude changed, for the last 10 exchanges of each
  of your 3 most recent conversations. Older entries are replaced as you go,
  and the record is not part of the history below.
  - Common kinds of keys, tokens and passwords (API keys, access tokens,
    passwords in web addresses, settings such as `password=`) are replaced
    with `[redacted]` first. No tool recognizes every secret.
  - Anything you write between `<private>` and `</private>` is left out, and
    so are Claude's reply to that message and the names of the files changed
    in that turn.
  - A conversation where you type `<private-session>` is left out entirely,
    and its earlier entries are removed.
  - Both tags work in any letter case, and in a message typed while Claude is
    still working. A later reply that repeats something private is saved like
    any other reply.
  - The tags keep text out of project-memory's own files only. Claude still
    sees it, Claude Code keeps it in its own conversation files, and a note
    Claude writes about it is kept in the history like any other note.
- When Claude Code shortens a nearly full conversation in the middle of a
  task, with no room to wait for the task's step to end, a note of what was in
  progress: your request, the start of Claude's last words, any background
  tasks still running, and the names of the files Claude had changed. It
  lasts until Claude's next reply. None is made for a private conversation.
- When a conversation is about 85% full, project-memory asks Claude to write
  down the work in progress: in its notes, and in `handoff.md` outside the
  automatic record. Those lines are Claude's own writing, and stay until
  Claude or you change them. Claude isn't asked in a private conversation.
- A history of your notes, in a local git repository: after each reply that
  changed a note, its new version is kept. It holds your notes only, never
  the record of where you left off.
- A few small bookkeeping files, such as when it last ran, and the short tags
  of conversations you marked `<private-session>`.

If auto memory is turned off with `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (set to
`1`, `true`, `yes` or `on`), project-memory reads and saves nothing on its
own. The memory skill still reads or changes your notes when you ask it to.

## What it sends

project-memory itself connects to nothing: it makes no internet connections
and has no server, and the git repository it keeps has no remote and is never
pushed.

It does add a briefing to your conversations: when one starts, after
`/clear` and after a compaction, up to 9,500 characters. The briefing can hold
the start of recent messages and replies in this project, what other
conversations open on this project were last asked, the shared notebook's
table of contents, and problems to fix. A conversation marked
`<private-session>` shows in other conversations' briefings only as working,
without its messages. Claude reads the briefing and your notes like anything
else in the conversation, so they go to Anthropic with it, as Claude Code's
built-in memory does.

## How long it keeps it

- The record of where you left off: until newer exchanges replace it. Lines
  Claude writes in `handoff.md` outside the record: until Claude or you
  change them.
- The note of a task in progress: until Claude's next reply.
- Your notes: until you or Claude delete them. A deleted note's old versions
  stay in the history.
- The history of your notes: until you delete it.

## Deleting it

Uninstalling the plugin leaves all of this in place. To delete:

- the history: the hidden folder `.git` inside `~/.claude/projects`. That
  removes the history of every project at once. While project-memory is on
  and Git is installed, the next change to a note, or the next day, starts a
  new one.
- the record of where you left off: `handoff.md` in a project's `memory`
  folder.
- the bookkeeping files: in `~/.claude/projects`, `.gitignore`, `.stop-ran`,
  `.snapshot-health`, any `.handoff-failed-…` file and the folder `.nudge`;
  in each project's `memory` folder, `.tiered`, `.health` and
  `.private-sessions`.

Before version 1.1.0, the history also kept versions of the record of where
you left off. If you used an earlier version, those older copies are still in
the history: delete the `.git` folder as above to remove them.

## Children

project-memory is not meant for people under 18.

## Contact

Questions or problems: open an issue at
<https://github.com/zdraveski/project-memory/issues>. To report a security or
privacy problem privately, see [SECURITY.md](SECURITY.md).
