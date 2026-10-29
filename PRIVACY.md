# Privacy policy

project-memory is a plugin for Claude Code. It runs only on your computer.
This page says what it reads, what it saves, and how to remove it.

## What it reads

- Claude Code's record of your conversations in this project (the files Claude
  Code keeps in `~/.claude/projects`), to know what was asked and answered:
  the current conversation's after every reply, and for the journal, the
  other conversations of this project and of the folders inside it, each
  read whole and read again when it has grown. When a reply's read doesn't
  reach back to the start of its conversation, the part of it no earlier
  look has read is read for a `<private-session>` mark, each time more than
  512 KB has been added since the last look. To tell which project
  a conversation belongs to, it reads the start of the conversations in
  every folder whose name is this project's folder name followed by `-`,
  and in the folder of a worktree of the project once a reply there was
  saved. One that belongs to another project is listed in `.imported` as
  `other` and not read further.
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
    with `[redacted]` first. So are passwords and tokens Claude passes to a
    command: after `--password`, `--token` or `--secret`, after `-p` in
    `docker login` and the like, in `export`, `setx`,
    `SetEnvironmentVariable` or `aws configure set` of a name that says key,
    secret, token or password, in `htpasswd`, `gh secret set` and an npm
    `_authToken`. A reference to one, such as `$API_TOKEN`, and a file's
    path are kept. A number is kept only under a name that counts something,
    such as `TOKEN_LIMIT=4096`; after a password or token option, or under a
    secret's name, it is replaced, since it can be a PIN. No tool recognizes
    every secret.
  - Anything you write between `<private>` and `</private>` is left out, and
    so are Claude's reply to that message and the names of the files changed
    in that turn.
  - A conversation where you type `<private-session>` is left out entirely,
    and its earlier entries are removed, also when the plugin finds the mark
    later: when it takes the conversation into the journal, when a reply
    reads the part of the conversation its own read missed, or, for a mark
    only the compaction step saw, the next time the journal looks for
    conversations to take in.
  - An exchange in which Claude runs `forget` is saved as `[private]`, with
    no file names.
  - Both tags work in any letter case, and in a message typed while Claude is
    still working. A later reply that repeats something private is saved like
    any other reply.
  - The tags keep text out of project-memory's own files only. Claude still
    sees it, Claude Code keeps it in its own conversation files, and a note
    Claude writes about it is kept in the history like any other note.
- A journal of every exchange, one file per day in a project's `memory`
  folder (`journal/YYYY-MM-DD.md`), with a file `journal.md` beside it that
  tells Claude the journal is there. Each entry holds your message (up to
  2,000 characters), Claude's reply (up to 6,000: of a longer one, its first
  4,000 and its last 2,000), the paths of up to 20 files Claude changed, and
  the last 20 commands it ran (up to 400 characters each), with the time,
  the conversation's short tag and the git branch. An entry is at most about
  22,000 characters. Measured on the author's computer, half are under 3 KB.
  - The rules above apply to it too: secrets are replaced with `[redacted]`,
    commands included, a `<private>` message's reply is saved as `[private]`
    with no files or commands, and a conversation marked `<private-session>`
    writes nothing, and its earlier entries are removed from every day's
    file, wherever in the conversation the mark is. An exchange in which
    Claude runs `forget` is saved without its words, files or commands.
  - A day's file left with no entries is deleted. One that also holds lines
    you wrote yourself keeps them.
  - If a day's file can't be rewritten (it isn't UTF-8 text), it is left as
    it is and `status` names it. Entries a `<private-session>` should remove
    from it are removed after every reply until that works.
  - After every reply, a few at a time, it takes in any of the project's
    conversations it hasn't read yet that Claude Code still keeps (by
    default, Claude Code deletes one after 30 days without use). That covers
    a new install, and the conversations held while the plugin was disabled,
    uninstalled or turned off. It reads each one whole, however long, a part
    at a time over several replies, and looks through all of it for a
    `<private-session>` mark before it saves anything from it. It never
    takes in a conversation marked `<private-session>`, or one held while
    `CLAUDE_CODE_DISABLE_AUTO_MEMORY` was set: it knows them by their tags in
    `.private-sessions` and in `~/.claude/projects/.memory-off`, or by the
    mark in the conversation. Finding a mark typed while the plugin was off,
    it tags the conversation and removes its earlier entries, from the
    journal and from `handoff.md`, as it does for one typed while it is on.
    A conversation held with auto memory off while this version wasn't
    installed and on has no tag, and is taken in. If you go on with it later
    with auto memory off, it is tagged then. A conversation tagged after it
    was taken in (by a reply with auto memory off, or by a
    `<private-session>` only the compaction step saw) loses its entries at
    the next look for conversations to take in, even if it never has another
    reply, or at its next reply with auto memory on. The look meets it only
    once it has grown since it was taken in: one tagged at a start with
    nothing typed after it keeps its entries until then.
  - It is never loaded at the start of a conversation. The briefing only
    says, in one line, that it exists and since when. Claude reads entries
    when it searches the journal, shows one in full, lists them for
    `forget`, or opens a day's file.
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
  changed a note, its new version is kept. Once a day is over, that day's
  journal file is kept there too, and when a day's file is deleted later,
  the history records that, keeping its earlier versions. It never holds
  the record of where you left off, today's journal file, or the journal's
  bookkeeping files.
- A few small bookkeeping files, such as when it last ran, the short tags of
  conversations you marked `<private-session>` or held with auto memory off,
  and, in each `journal` folder, which conversations it has taken in
  (`.imported`), how far it read the current one for a `<private-session>`
  mark and which it took out as private or held with auto memory off
  (`.checked`), the worktree folders it takes them from (`.folders`), when
  it last looked for them (`.looked`), the last failure of the journal's
  write and of its import (`.failed`), the conversations and days whose
  entries are still to be removed (`.sweeps`), and which entries you had it
  forget (`.forgotten`).

If auto memory is turned off with `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (set to
`1`, `true`, `yes` or `on`), project-memory reads and saves nothing on its
own, except the conversation's short tag in `~/.claude/projects/.memory-off`
when it starts and after every reply, so the journal never takes that
conversation in later. It stays out of the journal even if you go on with
it after turning auto memory back on. A tag is kept while Claude Code keeps
that conversation (the newest 100 always, 10,000 at most). The memory skill
still reads or changes your notes when you ask it to.

## What it sends

project-memory itself connects to nothing: it makes no internet connections
and has no server, and the git repository it keeps has no remote and is never
pushed.

It does add a briefing to your conversations: when one starts, after
`/clear` and after a compaction, up to 9,500 characters. The briefing can hold
the start of recent messages and replies in this project, what other
conversations open on this project were last asked, a line saying the
project has a journal and its first day, the shared notebook's table of
contents, and problems to fix. A conversation marked `<private-session>`
shows in other conversations' briefings only as working, without its
messages. Claude reads the briefing and your notes like anything else in the
conversation, so they go to Anthropic with it, as Claude Code's built-in
memory does. Journal entries reach Anthropic only when Claude reads them in
a conversation.

## How long it keeps it

- The record of where you left off: until newer exchanges replace it. Lines
  Claude writes in `handoff.md` outside the record: until Claude or you
  change them.
- The note of a task in progress: until Claude's next reply.
- Your notes: until you or Claude delete them. A deleted note's old versions
  stay in the history.
- The journal: until you delete it, or remove entries with `forget`. A
  finished day's file stays in the history even after entries are removed
  from the journal.
- The history of your notes and finished journal days: until you delete it.

## Deleting it

Uninstalling the plugin leaves all of this in place. To delete:

- the history, finished journal days included: the hidden folder `.git`
  inside `~/.claude/projects`. That removes the history of every project at
  once. While project-memory is on and Git is installed, the next change to a
  note, or the next day, starts a new one.
- the record of where you left off: `handoff.md` in a project's `memory`
  folder.
- the journal: the `journal` folder (with its bookkeeping files inside it)
  and `journal.md` in a project's `memory` folder, and the line that points
  to `journal.md` in its `MEMORY.md`. While
  project-memory is installed, a deleted `journal` folder is filled again
  from the conversations Claude Code still keeps. To empty the journal
  instead, use `forget` as below.
- the bookkeeping files: in `~/.claude/projects`, `.gitignore`, `.stop-ran`,
  `.snapshot-health`, `.memory-off`, any `.handoff-failed-…` file and the
  folder `.nudge`; in each project's `memory` folder, `.tiered`, `.health`
  and `.private-sessions`.

To remove only some journal entries, ask Claude (for example, "forget the
password I pasted yesterday"), or run the memory tool's `forget` with words,
a date range (`--since`, `--until`) or a conversation's tag or id. It first
lists the entries that match, each with its key, and removes nothing. After
you confirm, `forget --key <key> --yes` removes exactly the entries whose
keys you name, and `--yes` with the same words removes every entry they
match. A list by words, keys or a conversation shows up to 200 entries;
past that, narrow it, since `--yes` removes only what a list can show. A
list by dates alone shows the first 20 and how many entries fall between
the first and last day, and `--yes` removes them all, however many. Their
keys are kept in `.forgotten`, so a later import never brings them back. To
forget the whole journal, use `forget --since 1970-01-01 --yes`. That
removes only what the journal holds so far: check that `status` shows no
conversations left to import, or run it again once they're in.

- `forget` works on one project's journal at a time. If you name a key that
  project has no entry for, it says so.
- `forget` clears the journal only. The record of where you left off
  (`handoff.md`) and Claude Code's own conversation files are separate.
- An exchange in which Claude runs `forget` is kept without its words, files
  or commands, in the journal and in `handoff.md`, so its list of what goes
  isn't saved again. Claude finds the entries with `forget` itself for that
  reason. An exchange in which Claude searched for them with `search`
  instead is kept as usual.
- A day whose file can't be written keeps its entries, and `forget` names
  it.
- A finished day's file is already in the history, and an entry removed
  later by `forget`, or by a `<private-session>` typed later in its
  conversation, stays there. `forget` names those days. Delete the `.git`
  folder as above to remove them.

Before version 1.1.0, the history also kept versions of the record of where
you left off. If you used an earlier version, those older copies are still in
the history: delete the `.git` folder as above to remove them.

## Children

project-memory is not meant for people under 18.

## Contact

Questions or problems: open an issue at
<https://github.com/zdraveski/project-memory/issues>. To report a security or
privacy problem privately, see [SECURITY.md](SECURITY.md).
