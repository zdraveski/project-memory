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
- Thirteen settings from the environment, by name: `PROJECT_MEMORY_BRIEFING`
  (set to `0`, the startup briefing is not shown), `PROJECT_MEMORY_TIMING`
  (set to `0`, the hook times are not recorded), `PROJECT_MEMORY_RECALL`
  (set to `1`, pointers to earlier exchanges are on; set to `0`, the recall hooks do nothing), and ten that Claude Code
  reads too: `CLAUDE_PROJECT_DIR` (the project folder), `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_PROJECT_DIR_NAME` and
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (where the notes are, and whether they're
  on), and `CLAUDE_CODE_MAX_CONTEXT_TOKENS`, `CLAUDE_CODE_DISABLE_1M_CONTEXT`,
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`
  (how big a conversation can get). `DISABLE_COMPACT` (on or off) and
  `ANTHROPIC_MODEL` (tested against a pattern, never saved) are read only to
  decide whether `CLAUDE_CODE_MAX_CONTEXT_TOKENS` counts. The home folder (`HOME` or `USERPROFILE`)
  is read to find `~/.claude`. Nothing else in the environment, apart from
  `PROJECT_MEMORY_TIDY`, a switch the tests set to `inline` so the tidy step runs inside the hook.
- Claude Code's lists of installed plugins and marketplaces, and the plugin's
  own manifest, in `~/.claude/plugins`, only when you run the `doctor` check,
  to see where the plugin is installed and whether its auto-update is on.
- Claude Code's settings files, for two values only: `autoMemoryEnabled` (the
  hooks and `doctor` read it from the managed settings, the project's
  `.claude/settings.local.json` and `.claude/settings.json`, and
  `settings.json` in Claude Code's folder) and `autoMemoryDirectory` (`doctor`,
  from that last file only). The files can hold keys; nothing else in them is
  read or printed.

The git-rule watcher (a PreToolUse hook) reads the notes that hold an `enforce:` rule, the first bytes of the conversation's record to find its store, and the git command about to run, to compare it with the rules. It sends nothing anywhere.

The command `memory enforce replay <note>` is run by hand. It reads the git commands Claude ran through Bash or PowerShell in this project's conversation records of the last 30 days (every project's with `--all`) and prints the ones that match the note's rule to your terminal, each clipped to 160 characters with secrets replaced. It skips private conversations and projects with memory off, and saves nothing.

Pointers to earlier exchanges are off by default: unless `PROJECT_MEMORY_RECALL` is `1`, neither hook below reads the journal, and they only keep the session file and the other-session lines.

The file-change hook (a PostToolUse hook, after Edit, Write and NotebookEdit) reads the path of the file just changed, this project's journal (the newest 365 days or 6 MB of it), its forget list and its private-conversation list, to name earlier exchanges that changed the same file. It sends nothing anywhere. `PROJECT_MEMORY_RECALL=0` turns it off.

The prompt hook (a UserPromptSubmit hook, at each message you send) reads your message, this project's journal (the newest 90 days or 2 MB of it), its forget list and its private-conversation list, to name earlier exchanges that share rare words with the message. It writes your message, secrets replaced and cut to 120 characters, as the conversation's `asked` line in its session file (below). A message with a `<private>` block or the `<private-session>` mark writes only a `quiet` line, with no text, and the mark cuts the file down to that line. It sends nothing anywhere, and does nothing inside a subagent. `PROJECT_MEMORY_RECALL=0` turns it off.

Sessions that see each other: the prompt hook and the file-change hook also read the session files of the other conversations open on this project (only those changed in the last 30 minutes) and tell Claude what such a session asked, its title and the files it changed. Only `asked`, `title` and `file` lines are ever shown to another session; a private conversation or turn writes none of them. The prompt hook reads the end of this conversation's own record for the title you gave it with `/rename`. The SessionEnd hook, when a conversation ends, writes one `end` line with Claude Code's reason (a word such as `clear` or `logout`) to that conversation's session file, if it has one. None of them sends anything anywhere. `PROJECT_MEMORY_RECALL=0` turns them off.

When a subagent finishes, the plugin reads the end of that subagent's own conversation record and saves its final report, the first line of its task and the files it changed in the journal. The report is cleaned of secrets, and `forget` removes it. A report over 8,000 characters keeps its first 5,000 and last 2,900, with a note of how many characters were cut between them.

## What it saves

All of it stays in `~/.claude/projects` on your computer:

- `.timing`, one line for each run of a hook: the time, which hook (`save`, `tidy`, `brief`, `enforce`, `gate`, `recall`, `prompt` or `end`), which event (`Stop`, `PreToolUse` and the like, letters only) and how many milliseconds each step took, and for `recall` and `prompt` how many earlier exchanges they named. Numbers and those fixed names only: no text from a conversation, no file name, no command. It is cut to its newer half at 256 KB. `memory doctor` shows the times. They count from the start of Node, so what Claude Code spends starting a hook comes on top. Set `PROJECT_MEMORY_TIMING=0` to turn it off.
- `.sessions/<project folder>/<conversation tag>`, one small file per conversation: the full path of each file it changed (lower case on Windows and macOS) the keys of the earlier exchanges it was told about, a line for each compaction, each message you sent (an `asked` line: secrets replaced, cut to 120 characters) or a `quiet` line for a private one, the title you gave the conversation (a `title` line, secrets replaced, cut to 80 characters), a `saw` line with another session's tag (and a file path) once Claude was told about it, an `end` line with the reason when the conversation ended, each with the time (and a helper's id when a helper wrote it). No other text of a conversation. Over 64 KB it is rewritten with the newest line of each kind and file. Nothing is written for a private conversation or turn, or while memory is off. Each reply's save deletes those older than 7 days; `forget` and `memory off` delete the project's, `rescan --apply --yes` every project's, and `incognito` (or a `<private-session>` mark) the conversation's.
- The journal page, `project-memory/journal.html` in `~/.claude`, only when you run `memory page`: the journal text of the days you asked for, secrets already replaced, private turns without text, helper entries and switched-off projects left out. Only you can read it, and it loads nothing from the network.
- `.enforce-log` and `.enforce.json` in a store: which note's rule a git command matched (note name, session tag, sub-agent type, tool-call id; never the command) and a cache of the rules and of each lesson note (its clipped name and description, 120 and 300 characters, and the paths and words it is tagged with). Nothing is written for a private conversation or while memory is off.
- A record of where you left off (`handoff.md`): the start of your latest
  messages (up to 500 characters each) and of Claude's replies (up to 900),
  and the names of the files Claude changed, for the last 10 exchanges of each
  of your 3 most recent conversations. Older entries are replaced as you go,
  and the record is not part of the history below. A copy of the file as the
  first reply of each day found it sits beside it as `handoff.md.prev`, so a
  bad edit can be undone. It is not part of the history either, and none is
  made for a private conversation (one made earlier goes when a conversation
  is marked private, or an exchange is forgotten).
  - Keys, tokens and passwords are replaced with `[redacted]` first: the
    keys and tokens of many services (cloud, AI, payment, code hosting, chat,
    monitoring and more), long tokens in Authorization headers, passwords in web
    addresses, settings such as `password=`, and the entries under a settings
    key such as `passwords:` or `secrets:`. Since 1.4.1 that also covers
    passwords you type in chat (`pw: …`, "the PIN is …", backup codes, in
    English, German, French, Spanish, Russian, Swedish, Danish, Dutch,
    Portuguese, Polish, Japanese, Chinese and Korean), passwords given to
    command-line and database tools, cookies and session ids, seed phrases,
    password hashes, and look-alike spellings of all of these (full-width
    letters, hidden characters, accents, HTML entities, percent and unicode
    escapes). Passwords and tokens Claude passes to a command are replaced
    too, in quotes or not: after `--password`, `--token` or `--secret`, after
    `-p` in `docker login` and the like, in `export`, `setx`,
    `SetEnvironmentVariable`, PowerShell's `$env:`, a `.env` line (and
    cmd's `set`, a compose or Kubernetes env entry) or `aws configure set`
    of a name that says key, secret, token or password,
    in `htpasswd`, `gh secret set`, an npm `_authToken` and an Azure
    `SharedAccessKey`. A reference to one, such as `$API_TOKEN`, and a file's
    path are kept. A number is kept only under a name that counts something,
    such as `TOKEN_LIMIT=4096`; after a password or token option, or under a
    secret's name, it is replaced, since it can be a PIN. A value in quotes
    is replaced whole, blanks and all. For the handoff, text is cut to 64 KB
    before the secrets are removed, so one huge paste cannot stall a hook. The
    journal cleans a reply whole before it caps it; a request over 200,000
    characters is cut to that length first. Not found:
    - a value with blanks and no quotes, past its first word (in
      `password: p@ss w0rd` nothing is replaced, since `p@ss` is under 6
      characters);
    - a JSON object more than one level under a secret's key
      (`"secrets": {"db": {"main": …}}`);
    - a bare 32-character hex key with no keyword (a Rails `master.key`), and
      `key=<hex>` with no vendor or secret word;
    - a value under 6 characters (`password=abc` stays as typed), and a
      short token in an Authorization header, Basic aside: under 20
      characters, or under 32 with no digit (`Bearer abcdef1234567890`
      stays);
    - a Cyrillic or Greek letter that looks like a Latin one, used to spell
      the word that names the secret.

    Going the other way, a long list of small numbers in code can be cut as a
    possible Solana key.

    Only secrets are removed. Email addresses, phone numbers, card numbers
    and ID numbers are saved as typed; put them between `<private>` tags.

    No tool recognizes every secret, so put such text between `<private>`
    tags.
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
  - Both tags work in any letter case, with invisible characters inside
    them, in a message typed while Claude is still working, in your answer
    to a question Claude asks you, and in what you type when you turn down
    something Claude was about to do. A tag that only appears in a file
    Claude reads, in a command's output or in Claude's own question counts
    for nothing. A later reply that repeats something private is saved like
    any other reply.
  - The tags keep text out of project-memory's own files only. Claude still
    sees it, Claude Code keeps it in its own conversation files, and a note
    Claude writes about it is kept in the history like any other note.
  - Notes are saved and snapshotted as Claude writes them: secrets are
    replaced in the journal and handoff, not in notes. Since 1.4.1, a note
    that holds a key, token or password (in its text or its file name) is
    kept out of the snapshots, `status` and the startup line name it, and
    `promote` refuses it unless you add `--force`. A note whose file name
    holds a key is not added to `MEMORY.md`, and `doctor` says to rename it.
    A key pasted into a note that was snapshotted before that stays in the
    history after the note is deleted (`forget --purge` removes forgotten
    journal entries from the history, not notes). `rescan --apply --yes` redacts
    such a key in notes, the journal, the handoff and the snapshots; it first
    makes a backup folder that still holds the key, which you delete yourself).
- A journal of every exchange, one file per day in a project's `memory`
  folder (`journal/YYYY-MM-DD.md`), with a file `journal.md` beside it that
  tells Claude the journal is there. Each entry holds your message and
  all the text Claude wrote in the turn, not only its last block, the paths
  of every file Claude changed, and the commands it ran, each whole, up to
  20,000 characters for one command and 50,000 for a turn, newest first, with the time, the conversation's short tag
  and the git branch. When you answer one of Claude's multiple-choice
  questions, your pick is saved with your message, as `Picked: ...`. A turn
  you stop with Escape, or one that ends in an API error, still keeps what
  it changed and ran.
  A command you refused or a hook blocked is not listed, and an edit that
  failed is not listed as changed. When a command failed and no later try
  of it worked, the last 300 characters of its error are saved after it,
  with secrets replaced. Commands run through context-mode's ctx_execute
  and ctx_batch tools are listed too, with their code. A long pasted text or a long command
  is kept in full up to a cap, and secrets in it are still replaced. The cap is 50,000 characters. For a reply, past it the start is dropped
  and the end kept, with a note of how many characters came before. For a request, the
  start is kept and the end is cut, with a note of how many were cut. A command is cut at 20,000. Entries saved before 1.5.0 are not
  rewritten: they keep the form they were saved in.
  - The rules above apply to it too: secrets are replaced with `[redacted]`,
    commands included, a `<private>` message's reply is saved as `[private]`
    with no files or commands, and a conversation marked `<private-session>`
    writes nothing, and its earlier entries are removed from every day's
    file, wherever in the conversation the mark is. A mark found after a
    day is over removes the entries from the file, but the snapshot of
    that day keeps a copy, as `forget` says. An exchange in which
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
    mark in the conversation. When one of those lists can't be read (another
    program, such as a virus scanner, has it open), nothing is saved or
    removed for that conversation, and it is tried again after the next
    reply. Each time, the next briefing says the store needs attention and
    names the list, and `status` names it too, so a list that stays
    unreadable is reported, not silently left to stop the saving. The
    warning goes at the next reply that reads the list again. Either list
    unreadable after a reply keeps that reply out of the record of where you
    left off too. Finding a mark typed while the plugin was off,
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
  lasts until Claude's next reply. None is made for a private conversation,
  or for one held with auto memory off, even after auto memory is back on.
- When a conversation is getting full (about 54% of a 200k window; later in
  a very big one, never past 85%), project-memory asks Claude to write
  down the work in progress: in its notes, and in `handoff.md` outside the
  automatic record. Those lines are Claude's own writing, and stay until
  Claude or you change them. Claude isn't asked in a private conversation,
  or in one held with auto memory off.
- A history of your notes, in a local git repository: after each reply that
  changed a note, its new version is kept. Once a day is over, that day's
  journal file is kept there too, and when a day's file is deleted later,
  the history records that, keeping its earlier versions. It never holds
  the record of where you left off, today's journal file, or the journal's
  bookkeeping files.
- A few small bookkeeping files, such as when it last ran (with 8 characters
  of a hash of each reply, which tell two quick replies from one reply
  answered twice; the reply can't be read back from them), the short tags of
  conversations you marked `<private-session>` or held with auto memory off,
  and, in each `journal` folder, which conversations it has taken in
  (`.imported`), how far it read the current one for a `<private-session>`
  mark and which it took out as private or held with auto memory off
  (`.checked`), the worktree folders it takes them from (`.folders`), when
  it last looked for them (`.looked`), the last failure of the journal's
  write and of its import (`.failed`), the conversations and days whose
  entries are still to be removed (`.sweeps`), and which entries you had it
  forget (`.forgotten`); and, in each `memory` folder, each note's type,
  `tier:` and date as last read, with its size and time (`.facts`), so a
  note is read again only once it changes.

If auto memory is turned off with `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (set to
`1`, `true`, `yes` or `on`), project-memory reads and saves nothing on its
own, except the conversation's short tag in `~/.claude/projects/.memory-off`
when it starts and after every reply, so the journal never takes that
conversation in later. It stays out of the journal and out of the record
of where you left off even if you go on with it after turning auto memory
back on: its first reply with auto memory on removes what that record held
of it from before, and saves nothing new. A tag is kept while Claude Code keeps
that conversation (the newest 100 always, 10,000 at most). If that list
can't be written after a reply of such a conversation, the next briefing
with auto memory on says the store needs attention and names `.memory-off`,
until the handoff of a later reply in that project, with auto memory on,
goes through. If it can't be written after any of that conversation's
replies, the conversation has no tag, and the journal may take it in later.
The memory skill still reads or changes your notes when you ask it to.

That variable, Claude Code's own `autoMemoryEnabled: false` setting, and the
two switches below, are the ones project-memory follows. It reads that single
value from the settings files Claude Code reads (managed, the project's
`.claude/settings.local.json` and `.claude/settings.json`, and
`~/.claude/settings.json`) and nothing else in them. It cannot see `--settings`,
`--bare`, safe mode or server-managed settings. To stop it in those cases, use
one of the switches below or disable the plugin
([Turning it off](docs/how-it-works.md#turning-it-off)).

| Switch | Set by | What stops | What stays |
|---|---|---|---|
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | you, in the environment | everything it saves on its own, in every project, and the conversation is tagged in `.memory-off` | your notes, the journal and snapshots already made |
| `.memory-off` | the line above, per conversation | that conversation is never taken into the journal later | what was saved before it started |
| `.project-off` | `memory off` in one project's `memory` folder: `{"t": <time>}` | in that project, the handoff, journal, tiering and snapshots; the startup says it is off | everything already saved, readable by `search` and `show`; `memory on` removes the marker and keeps the times it was off in `.off-periods`, so what was said in them stays out of the journal and handoff |

Off stops adding; it doesn't hide. A marker that can't be read counts as off,
and the startup and `status` say memory is paused there.

`/project-memory:incognito` (the `incognito` command) is narrower: it adds the conversation's
tag to `.private-sessions`, then removes that conversation's entries from the
journal and from `handoff.md`. It does not touch notes already written,
snapshots of days already over keep a copy, and Claude Code by default still
keeps its own transcript and its own auto memory may still save notes.

## What it sends

project-memory itself connects to nothing: it makes no internet connections
and has no server, and the git repository it keeps has no remote and is never
pushed.

It does add a briefing to your conversations: when one starts or
resumes, after
`/clear` and after a compaction, up to 9,500 characters. The briefing can hold
the start of recent messages and replies in this project, what other
conversations open on this project were last asked, a line saying the
project has a journal and its first day, the shared notebook's table of
contents, and problems to fix. When a conversation starts, that is the
last conversation's latest exchanges as `handoff.md` keeps them, as many as
fit in about 3,500 characters. A conversation marked `<private-session>`
shows in other conversations' briefings only as working, without its
messages, even if removing it from `handoff.md` failed. Its exchanges are
never listed at the start of a conversation, nor is an exchange you had
Claude forget, nor any exchange of a conversation held with auto memory off
(which `handoff.md` keeps out too, even when you go on with it with auto
memory on). Claude reads the briefing and your notes like anything else in the
conversation, so they go to Anthropic with it, as Claude Code's built-in
memory does. Journal entries reach Anthropic only when Claude reads them in
a conversation.

The file-change and prompt hooks add short notes to the conversation in the
same way: the date, conversation tag and request of an earlier exchange
(for a request of under three words, the start of its answer too), up to
three files it changed, and what another open session asked and changed.
The text passes the secret filter first.
They go to Anthropic with the rest of the conversation. A note already shown
stays in that conversation: `forget` removes the exchange from the journal,
but cannot take back a note Claude was already given.

The `recall` helper is a Claude Code agent that runs on its own model call.
It reads the journal and notes with the memory tool, and what it reads goes
to Anthropic as part of that call, as when Claude searches itself. Its
report is not saved to the journal again.

## How long it keeps it

- The session files (`.sessions`): 7 days after their last change.
- The journal page: until you delete it, or until `forget`, `incognito`,
  `memory off` or `rescan --apply` deletes it.
- The hook times (`.timing`): the newest part of 256 KB, a few days of use. Deleting the file loses nothing but the times.
- The record of where you left off: until newer exchanges replace it. Lines
  Claude writes in `handoff.md` outside the record: until Claude or you
  change them. Its daily copy, `handoff.md.prev`: until the next day's first
  reply replaces it.
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
- the record of where you left off: `handoff.md` and its daily copy
  `handoff.md.prev` (and a half-written `handoff.md.prev.tmp`, if one is left) in a project's `memory` folder, and the line that points to it in its `MEMORY.md`.
- the archive: `MEMORY-archive.md` in a project's `memory` folder, and the
  `Archive` line in its `MEMORY.md`. It holds the pointers to older notes:
  move any you want loaded again back into `MEMORY.md` first. The shared
  notebook, `~/.claude/projects/_shared/memory`, gets its own archive and
  `Archive` line once it has a `MEMORY.md`: delete them there too.
- the journal: the `journal` folder (with its bookkeeping files inside it)
  and `journal.md` in a project's `memory` folder, and the line that points
  to `journal.md` in its `MEMORY.md`. While
  project-memory is installed, a deleted `journal` folder is filled again
  from the conversations Claude Code still keeps. To empty the journal
  instead, use `forget` as below.
- a backup that `memory rescan --apply --yes` made: the folder
  `project-memory-rescan-backup-<date>` in Claude Code's folder (`~/.claude`).
  It still holds the secrets it removed, and is never deleted for you.
- the journal page, if you ran `memory page`: `project-memory/journal.html`
  in Claude Code's folder (`~/.claude`). It holds the journal text, secrets
  already replaced, and never leaves your computer. `forget`, `incognito`,
  `memory off` and `rescan --apply` delete it; run `memory page` again to
  make a fresh one.
- the bookkeeping files: in `~/.claude/projects`, `.hash-salt`, `.gitignore`, `.stop-ran`, `.timing`, `.sessions`,
  `.snapshot-health`, `.memory-off`, any `.handoff-failed-…` or
  `.journal-failed-…` file and the folder `.nudge`; in each project's
  `memory` folder, `.tiered`, `.facts`, `.health`, `.private-sessions`,
  `.off-periods`, `.moved-said` (the names of another folder's notes the startup line told you of), `.enforce-log`, `.enforce.json` and `.project-off` (the marker; delete it to turn that project on);
  and in the shared notebook's (`_shared/memory`), `.tiered`, `.facts` and
  `.health`. Delete `.memory-off`, `.private-sessions` and `.off-periods` only
  once project-memory is removed for good: they list the conversations it
  must not record. Without them, a conversation held with auto memory off is
  recorded from its next reply; one marked private is tagged again at its
  next reply, which finds its mark. When the journal's look for
  conversations to take in meets one it took out before and that has lost
  its tag (once it has grown), it tags it private, even one held with auto
  memory off, so it leaves the handoff too, and removes what the journal
  holds of it, entries an earlier version saved included.

To remove only some journal entries, ask Claude (for example, "forget the
password I pasted yesterday"), or run the memory tool's `forget` with words,
a date range (`--since`, `--until`) or a conversation's tag or id. It first
lists the entries that match, each with its key, and removes nothing. After
you confirm, `forget --key <key> --yes` removes exactly the entries whose
keys you name, and `--yes` with the same words removes every entry they
match. It also removes the temp copy of a journal day or of `handoff.md`
that a reply's save left half done when it was stopped, as the next reply
does. A list by words, keys or a conversation shows up to 200 entries;
past that, `--yes` removes nothing and asks you to narrow it. A
list by dates alone shows the first 20 and how many entries fall between
the first and last day, and `--yes` removes them all, however many. Their
keys are kept in `.forgotten`, so a later import never brings them back,
for as long as Claude Code keeps their conversation's file (once it's gone,
nothing can bring them back, and the key is dropped). Keep the memory folder
on one computer: synced to another (Dropbox, OneDrive), each computer drops
the keys of conversations it doesn't have, and an entry you forgot on one can
come back on the other. To forget the whole journal, use `forget --since 1970-01-01 --yes`. That
removes only what the journal holds so far: check that `status` shows no
conversations left to import, or run it again once they're in.

- `forget` works on one project's journal at a time. If you name a key that
  project has no entry for, it says so. A key of an exchange that isn't in
  the journal yet (its reply came while another window held the project's
  memory folder, and is saved at the next reply) is kept out all the same:
  the list shows it as not in the journal yet, without its words. A list by
  words finds such an exchange too. A key you had it forget before is named
  as already forgotten, and nothing more is removed from the journal (its
  exchange still goes from `handoff.md`, if an earlier `forget` couldn't
  remove it there).
- `forget` also takes the exchanges it removes out of the record of where
  you left off (`handoff.md`), so the next conversation's briefing doesn't
  show them, and a later reply in their conversation doesn't put them back.
  It matches them there by conversation and minute, so another exchange of
  that conversation in the same minute goes too. Claude Code's own
  conversation files are separate: they still hold the exchanges, and
  `forget` says so after removing them.
- A search hit never names a conversation file. `show` of a private entry
  doesn't either, since that file still holds the private part. `show` of
  another exchange in the same conversation still names that file: it is
  Claude Code's own record of the whole conversation, private parts
  included.
- An exchange in which Claude runs `forget` is kept without its words, files
  or commands, in the journal and in `handoff.md`, so its list of what goes
  isn't saved again. Claude finds the entries with `forget` itself for that
  reason. An exchange in which Claude searched for them with `search`
  instead is kept as usual.
- A day whose file can't be written keeps its entries, and `forget` names
  it. Until a later `forget` removes them, `search`, `show` and the day's
  listing leave them out.
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

## Removing a forgotten entry from the snapshots

`forget --yes` alone does not remove the entry from the snapshot history: the text stays in git until you purge it. Add `--purge` to also rewrite the snapshot history without
those days' older versions (the journal day files that held the entry, expired from the reflog and collected). Run it only on
a snapshot repository this plugin made. A purged day loses its older versions whole, so other conversations' entries of that
day go from the history too (the current files are untouched; the next snapshot adds the cleaned day back). Only the branches
are rewritten: a branch, stash or tag you added to that repository yourself still keeps the old text. It refuses while a
snapshot is being taken; run it again a moment later. While it runs, it keeps a full copy of the snapshot history in a `pm-purge-...`
folder inside the snapshot repository's own `.git` (in Claude Code's projects
folder), and removes it when it finishes. `rescan --apply --yes` does the same
when it rewrites the snapshots.

On Linux and macOS the files the hooks write are mode 0600, their folders 0700 and the snapshot `.git` 0700, so other users
of the computer cannot read them. An older install is tightened at its next Stop. The fingerprints used as a journal key (for a turn with no id) and in `.stop-ran` are
keyed with a random per-computer salt (`.hash-salt` in the projects folder, never snapshotted), so a short prompt or reply
cannot be recovered from them by a dictionary run.
