# How project-memory works

This page is the technical side of the [README](../README.md): what runs when,
which files it writes, and the numbers it works to. You don't need any of it
to use the plugin.

**On this page:** [Using it](#using-it) · [When it runs](#when-it-runs) · [Where things live](#where-things-live) · [The index](#the-index) · [The handoff](#the-handoff) · [The journal](#the-journal) · [The startup briefing](#the-startup-briefing) · [Compaction](#compaction) · [Turning it off](#turning-it-off) · [Snapshots](#snapshots) · [The shared notebook](#the-shared-notebook) · [Several conversations at once](#several-conversations-at-once) · [Search and forget](#search-and-forget) · [Checked lessons (experimental)](#checked-lessons-experimental) · [The memory tool from a terminal](#the-memory-tool-from-a-terminal) · [Good to know](#good-to-know) · [Requirements and limits](#requirements-and-limits) · [When something seems wrong](#when-something-seems-wrong)

## Using it

There is nothing to learn. Ask in your own words:

| You say | What happens |
|---|---|
| *"What did we decide about the logo in September?"* | Claude searches your notes and the journal, and answers with the date. |
| *"What did I work on last week?"* | Claude lists what you asked each day, from the journal. |
| *"Where did we leave off?"* | Claude already knows: each new conversation starts with the last one's latest exchanges, as many as fit in a short briefing. For more, it reads the record of your last conversation. |
| *"Remember that I prefer short answers."* | Claude saves a note. |
| *"I deleted the note about pricing by mistake. Bring it back."* | Claude restores it from the history. |
| *"Forget the password I pasted yesterday."* | Claude lists the journal entries that match, and removes the ones you confirm from project-memory's files. Claude Code's own conversation files still hold them. |
| *"Remember for all my projects that I like plain language."* | Claude saves it to the shared notebook. |

If you would rather type a command, start with `/project-memory:memory`:

| Type after it | What it does |
|---|---|
| `search logo colors` | Finds notes and journal entries about "logo colors". An entry shows as a short headline: what you asked, how it ended, and the lines with your words |
| `search --file src/cart.js` | Lists the entries that changed that file, newest first (a name alone works too). `--asked` keeps your own words only, `--conversation <id>` one session; notes are left out |
| `show 'key'` | Shows one journal entry in full, by the key `search` printed. `show pricing` (a note's name) shows the first exchange that changed that note and the last one |
| `forget password` | Lists the journal entries that mention "password" and removes the ones you confirm (Claude Code's own conversation files still hold them) |
| `history pricing` / `restore pricing` | Shows when the note "pricing" changed, and the exchange and your words behind each change / brings it back |
| `promote pricing` | Moves the note "pricing" to the shared notebook |
| `status` / `doctor` | A health check of this project's notes / of project-memory itself |
| `incognito`, `off`, `on` | Stop saving this conversation / turn this project off / turn it back on ([Turning it off](#turning-it-off)); also available as `/project-memory:incognito`, `/project-memory:memory-off` and `/project-memory:memory-on` |
| `enforce status`, `enforce replay <note>` | Checked lessons, experimental ([Checked lessons](#checked-lessons-experimental)) |

The full list of commands and options is [below](#the-memory-tool-from-a-terminal).

To read your notes yourself, type `/memory` in Claude Code and open the auto
memory folder. The journal is its `journal` folder, one file per day.

## When it runs

Claude Code runs project-memory on six of its events, declared in
`hooks/hooks.json`. It gives Claude one skill, `skills/memory/SKILL.md`, and
three slash commands in `commands/`: `/project-memory:incognito`,
`/project-memory:memory-off` and `/project-memory:memory-on`.

| Moment | Claude Code event | What runs |
|---|---|---|
| Claude finishes a reply | `Stop` | `memory-tier.mjs --stop`: tidies this project's notebook and the shared one, updates the handoff, writes the journal and imports a few other conversations into it, takes a snapshot, and reminds Claude to save notes when a compaction is close. When a newer version is installed than the one this conversation runs, it says once per version: `project-memory X is installed, run /reload-plugins to use it` |
| A subagent finishes | `SubagentStop` | `memory-tier.mjs --stop`, which saves the subagent's final report, with the first line of its task, as its own journal entry |
| Claude stops because of an error (an API error, for example) | `StopFailure` | `memory-tier.mjs --stop`, the same as `Stop`, so the turn is saved at once and not at the next reply |
| A conversation starts, is resumed, is cleared with `/clear`, or goes on after a compaction | `SessionStart` | `brief.mjs --print`: the startup briefing (none for a resumed conversation) |
| Claude is about to run a `git` command in Bash or PowerShell | `PreToolUse` | `enforce-hook.mjs`: logs which note's rule matched, if a note holds one (see [Checked lessons](#checked-lessons-experimental)). It blocks nothing and prints nothing |
| Claude has changed a file with Edit, Write or NotebookEdit | `PostToolUse` | `recall-hook.mjs`: the first time a conversation changes a file (since its last compaction), it names the newest two earlier exchanges of this project that changed the same file, with `and N more` and the `search --file` command. Never this conversation's own, a `[private]` entry, a forgotten one or a private conversation's; at most three such blocks between two prompts, then one line that more files have a past; nothing in a private conversation or turn, or with memory off. It writes the conversation's session file (below). `PROJECT_MEMORY_RECALL=0` turns it off. It gives up and says nothing after 400 ms |
| You run `/compact` | `PreCompact` (manual) | `memory-tier.mjs --stop`, so the notebook is tidy and the handoff current before the summary is made |
| Claude Code compacts on its own | `PreCompact` (auto) | `compact-gate.mjs`: may ask Claude Code to wait for the end of the turn (see [Compaction](#compaction)) |

The skill is `memory` (`/project-memory:memory`). It runs `memory.mjs`, the
command-line tool described [below](#the-memory-tool-from-a-terminal).

Each hook has a time limit, which Claude Code enforces by stopping the hook:
120 seconds for Stop, StopFailure and `/compact`, 60 for the automatic compaction check,
30 for SubagentStop and for the startup briefing and 5 seconds for the git-rule watcher. Without a limit Claude Code waits 10 minutes.
A real Stop took up to 46 seconds. A hook stopped at its limit has its output
thrown away, so a startup briefing that runs past 30 seconds is lost without a
word. A Stop stopped while git runs has already written the journal and the
handoff, because the snapshot comes last; the next Stop reports the snapshot as
busy until the lock git left is ten minutes old, then takes it. That one rule (`busy()` in
`snapshot.mjs`: git's lock files and `gc.pid`) also stops `restore`, `forget --purge` and
`rescan --apply` while a snapshot or git's clean-up is under way (a live purge keeps its own lock fresh; a `gc.pid` is stale when its gc died on this machine, else after git's 12 hours). After a snapshot that commits,
the plugin runs `git gc --auto` itself, in that same process (git's own automatic gc is off in
every git command the plugin runs). Each hook shows
a short status message while it runs, except the git-rule watcher, which runs
silently. Nothing is printed during `/compact`:
what a PreCompact hook prints becomes part of the instructions for the summary,
so that run stays silent whatever it finds.

The briefing is printed on a new conversation, `/clear` and after a
compaction, not on a resume, which has its history, and not on a fork. A fork
starts from a copy of an existing conversation, which already holds the briefing. The journal keys an entry by
its turn's id, so a copied turn that keeps its id lands on the entry it came
from. This hasn't been checked against a real fork's transcript; a fork that
gives its turns new ids would journal them again.

A hook that fails exits with status 0, so a failure never blocks a session:
what went wrong is reported in the startup briefing instead. Two hold things up
on purpose, briefly: once per compaction cycle the Stop hook sends Claude
feedback that keeps the conversation going, to ask it to write its notes, and
the compaction gate can ask Claude Code to wait (exit status 2). While
`CLAUDE_CODE_DISABLE_AUTO_MEMORY` is `1`, `true`, `yes` or `on` (in any case),
every hook (the git-rule watcher too, which then logs nothing) does nothing, except that the SessionStart and Stop hooks note
the conversation's tag in `.memory-off` so the journal never imports it; the
memory tool still works when you run it yourself. Claude Code's own switch
(`autoMemoryEnabled: false`, which `/memory` sets) counts too: the hooks read
that one value from the managed, project-local, project and user settings
files, in that order, and the variable wins over them (`0` means on). They
cannot see `--settings`, `--bare`, safe mode or server-managed settings.
Disabling the plugin stops them.

## The code

Every file is in `src/`. The leaves come first; each file imports only those above it, apart from the loop through `handoff-log.mjs`
that step 18 of 1.6.0 removes.

- `store.mjs`: where a project's memory lives, the locks, `redact`, and the small helpers everything shares.
- `text.mjs`: prints text safely (`clip`, `defuse`, `plain`, `fit`), and the 9,500-character limit on what a hook says (`SAY`). It imports `store.mjs` only.
- `privacy.mjs`: decides whether a turn or a conversation may be saved or shown, and owns the marker files (`.private-sessions`, `.memory-off`,
  `.project-off`, `.off-periods`, `journal/.forgotten`). A file it cannot read counts as private. It imports `store.mjs` only, so the git-rule
  hook can load it and still start fast.
- `transcript.mjs`: reads a transcript: its records, forward or backward, and its turns. It imports `store.mjs`, `privacy.mjs` and `text.mjs` only.
- `snapshot.mjs`: runs every git call against the projects root: it takes the snapshot (the git repository at the projects root: its `.gitignore`, the lock sweep, the held notes, the health record in `.snapshot-health`, and the one reader of that record), builds every git command line (`gitArgs`, `gitWhy`), and does the git half of `history`, `restore`, `forget --purge`, `rescan` and `doctor` (`memory.mjs` keeps their wording and arguments). Git runs through one seam, so a test can stand in for it. It imports `store.mjs` and `privacy.mjs` only.
- `run-records.mjs`: reads and writes the run records (GLOSSARY.md, "Run records"): store health, the Stop record, the two failure records and the deploy record, and reads Claude Code's `installed_plugins.json` and `known_marketplaces.json`. One read rule: a missing file is none, an unreadable or unparseable one is damaged (and reads as none), a BOM is stripped. It imports `store.mjs` only.
- `handoff-log.mjs`: writes `handoff.md` and prints the startup briefing.
- `journal.mjs`, `compact-gate.mjs`, `memory-tier.mjs`, `memory.mjs`, `recall.mjs`, `page.mjs`, `enforce.mjs`, `enforce-hook.mjs`, `recall-hook.mjs`, `brief.mjs`, `timing.mjs`: the journal, the compaction gate, the Stop hook and tidy-up, the `memory` command, search words, the journal page, the git rule, and the rest.

## Where things live

Claude Code keeps one folder per project under `~/.claude/projects/`, named
after the project's path with every character that isn't a letter or digit
replaced by `-`. Auto memory lives in its `memory/` subfolder.

For memory, a project is a git repository: a conversation started in a
subfolder or a worktree uses the repository's folder, though its transcript
sits in the folder named for where it started. project-memory finds the
repository the same way, from the folder the conversation started in. It
follows a worktree's `.git` file only when the main repository's worktree
record names it back, as Claude Code does. A repository whose folder name
would pass 200 characters, which Claude Code shortens with a hash of its own,
is not followed: a conversation started in a subfolder of it keeps its
handoff and journal in the folder Claude Code made for that conversation,
and the startup briefing there shows them.

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
| `…/memory/handoff.md.prev` | a copy of the handoff made at the first reply of each day, so one bad overwrite does not lose all of it (see [The handoff](#the-handoff)) |
| `…/memory/journal/YYYY-MM-DD.md` | the journal, one file per day (see [The journal](#the-journal)) |
| `…/memory/journal.md` | the journal's note, so the index has a pinned line for it |
| `…/memory/journal/.imported`, `.looked`, `.folders` | the transcripts imported and how far, the time of the last look for them, the worktree folders looked in too (see [The journal](#the-journal)) |
| `…/memory/journal/.checked`, `.sweeps` | how far a Stop looked through each conversation for a mark, and those swept out; the tag and day of each sweep not yet done |
| `…/memory/journal/.failed`, `.forgotten` | the last failure of the live write and of the import, one line each; the keys of forgotten entries, each with its conversation and time |
| `…/memory/.lock` | the store's lock, a folder that exists while a write is in progress |
| `…/memory/.tiered`, `.health` | a fingerprint of the last tidy-up, and problems for the startup briefing |
| `…/memory/.facts` | what the tidy-up read at the top of each note (its type, its `tier:` and its date), with the note's size and time, so a note is read again only once it changes |
| `…/memory/.enforce-log`, `.enforce.json` | the git-rule watcher's log (note name, conversation tag, sub-agent type and tool-call id, never the command) and its cache of the rules (see [Checked lessons](#checked-lessons-experimental)) |
| `…/memory/.private-sessions` | the tags of conversations marked private (the newest 1,000) |
| `…/memory/.project-off`, `.off-periods` | the marker while `memory off` holds, and the times it was off before, whose turns are never written |
| `~/.claude/projects/_shared/memory/` | the shared notebook, same layout |
| `~/.claude/projects/.git`, `.gitignore` | the snapshot repository, and what it ignores |
| `~/.claude/projects/.git/project-memory-ignored`, `project-memory-parts` | bookkeeping for the snapshot's ignore list; a first snapshot still being taken in parts |
| `~/.claude/projects/.timing` | one JSON line per hook run: the time, the hook (`save`, `tidy` (the tidy-up and snapshot after a reply, run in the background), `brief`, `enforce`, `gate` or `recall`), the event name (letters only) and milliseconds (when Node started, when the hook's code started, each step, the total), and for `recall` the number of earlier exchanges it named (`memory doctor` adds them up for 7 days). Numbers and fixed names only; cut to its newer half at 256 KB; shown by `memory doctor`; `PROJECT_MEMORY_TIMING=0` turns it off |
| `~/.claude/projects/.sessions/<project folder>/<conversation tag>` | one small append-only file per conversation, a line `<kind> <ISO time> [agent:<helper id>] <rest>`: `file <path>` for each file it changed (the full path, `/`, lower case on Windows and macOS; again only after 5 minutes) and `told <key>` for each earlier exchange it was shown (`told more` for the line past the third block). Outside the store, so no snapshot or status sees it. Deleted after 7 days by the save after a reply, by `forget` and `memory off` (the project's), `rescan --apply --yes` (all) and `incognito` or a `<private-session>` mark (the conversation's) |
| `~/.claude/projects/.stop-ran`, `.snapshot-health`, `.nudge/` | bookkeeping: when the Stop hook last ran (with each reply's fingerprint, 8 characters of its hash), the snapshot's state, the reminder's state and the last update notice per conversation tag |
| `~/.claude/projects/.handoff-failed-<project folder>` | a handoff that could not be saved, or with auto memory off a conversation's tag that could not be written (`off`), and why (a list that won't read is named there). It is also written when a reply could not be saved because another window held the store through two tries; read at the next start and by `status` |
| `~/.claude/projects/.journal-failed-<project folder>` | a journal write that failed after a reply when the `journal` folder wouldn't take `.failed` either, and why; read at the next start and by `status`, removed by the next write that goes through |
| `~/.claude/projects/.memory-off` | the tags of conversations held with auto memory off, which the journal never imports: kept while the transcript is on disk, and the newest 100 in any case, 10,000 at most |

`~/.claude/projects/.hash-salt` holds a random per-computer key used for the
fingerprints in journal keys and `.stop-ran`, so that a short prompt cannot be
recovered from them; it is never snapshotted.

On Linux and macOS the files the hooks write are mode 0600 and their folders
0700, and so is the snapshot's `.git`. An older install is made private at its
next Stop. Windows has no such modes: the files are protected by your user
account's own permissions.

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
are gathered at the top, above the lines, with a blank line between if the
file had one there. The file keeps its line endings: a `MEMORY.md` saved
with CRLF stays CRLF, and a new archive takes the index's.

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

A project's notebook that the plugin has written to (it has a `handoff.md` or
a `journal/` folder) but that has no `MEMORY.md` gets an empty one, with a
title only, in the reply that made the handoff. A manual run does the same for
every project. A notebook with neither gets nothing.

Claude Code's own index backfill sometimes adds a line like
`- [title](journal/2026-11-01.md)` for a journal day. These are removed, since
the journal is searched, not listed; so is one you wrote by hand in that form.
A line with text after the link stays.

Lines are moved word for word, never rewritten. A note that has no line gets
one, built from its description, two minutes after it was written. That line
is filed by the same rules as any other, by the note's age: a note changed in
the last 7 days is in the index, an older one in the archive. `tier: hot` or
`tier: archive` in the note still decides it, and in the shared notebook the
line is in the index unless the note says `tier: archive`. A file name no line
can point at, such as `lesson (1).md`, is reported in the startup briefing instead, to be renamed. A line that points
at a web page or a path outside the notebook is kept as plain text. When two
lines point at the same note, one is kept: in the index, the newer (lower)
line, in the first one's place; an index line over an archived one. The other
line is dropped, and the history still has it. On Windows, and on macOS by
default, a line written `(Kase.md)` counts as `kase.md`'s line. Nothing is
written when nothing changed.

## The handoff

`handoff.md` records the latest exchanges after every reply: up to 10 per
conversation, for up to 3 conversations, keeping the first 500 characters of
what you asked and the first 900 of the answer, and the names of the files
the turn changed (from Edit, Write and NotebookEdit; the 8 edited last, and
how many more). A slash command is recorded as you typed it, with its
arguments. The answer is the reply Claude Code hands the Stop hook, since the
transcript file can lag behind it. A project gets its `memory/` folder for
this if Claude hasn't saved a note there yet.

The conversation's file is read from its end, up to 32 MB, back to the
turn's request. A request further back than that (a long browser task's
screenshots) is looked for line by line, up to 256 MB more, and the turn is
recorded with the files changed in its last 32 MB.

At the first reply of each day, `handoff.md` is copied to `handoff.md.prev`
beside it, because the file is kept out of the snapshots. A private
conversation never makes the copy. Sweeping a private or forgotten
conversation out of `handoff.md` deletes the copy too, and `rescan`
checks it for the same text.

Entries carry your local time and are ordered by it, so changing time zones
shows up here. After you move west, new turns rank before the newest entries
and aren't kept until your clock passes them, up to the hours you moved.
After you move east, recent turns can be listed twice until newer ones
replace them. The clock going back an hour at the end of daylight saving
time, or set back by hand, works like a move west: the repeated hour's
turns are ordered by the clock, and the startup briefing can name an older
turn as the last one. A conversation you go on with after a change of zone
is read again in the new zone, so its earlier entries show their time in
the new zone (one made at 09:00 in Los Angeles shows 17:00 once the
conversation goes on in Skopje, eight hours ahead), and near midnight
another day.

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
- passwords on a command line: `curl -u user:…`, `mysql -p…`, and `-p …`
  after `docker`, `podman`, `az` or `oc login`, `sshpass` and
  `twine upload`;
- a secret passed to a command, which the journal's `Ran` keeps: the value
  after `--password`, `--token` or `--secret`, with up to three words before
  the last (`--client-secret`), but not after `--no-password`, nor a word
  such as `flag` or `option` after one in prose; in quotes, the whole value
  to the closing quote, blanks and all, and one starting with `-` too
  (`--password "a b c"`, `-p '…'`; the same for every quoted value below and
  for `curl -u "user:…"`);
  `aws configure set` of a secret, key or token; the password of
  `htpasswd -b` or `-nb`, before any redirect; `gh secret set … --body`; an
  npm `:_authToken`; and `export NAME=…`, `setx NAME …`,
  `SetEnvironmentVariable("NAME", …)` and PowerShell's `$env:NAME = …` (in
  any case)
  when a `_`-separated part of `NAME` is `KEY`, `SECRET`, `TOKEN`,
  `PASSWORD`, `PASSWD`, `PASS` or `PWD` and its last part isn't `FILE`,
  `PATH`, `DIR`, `NAME` or `ID`. Kept, so a search still finds the command:
  a reference (`$TOKEN`, `${TOKEN}`, `$(cat pw)`), a path
  (`~/.ssh/id_ed25519`, `./pw.txt`, `certs/key.pem`), and a number under a
  name with a part such as `LIMIT`, `MAX`, `SIZE`, `COUNT`, `TTL`,
  `TIMEOUT` or `PORT` (`TOKEN_LIMIT=4096`). A number after a password or
  token option, or under a secret's name (`export TOKEN=12345678`), goes:
  it can be a PIN;
- a `.env` line, `NAME=…` at a line's start with an upper-case name, no
  blank before `=` and a last `_`-part of `KEY`, `SECRET`, `TOKEN`,
  `PASSWORD`, `PASSWD`, `PASS` or `PWD` (`SIGNING_KEY=…`, not
  `KEY_ALGORITHM=RS256` or `TOKEN_URL=…`, nor code such as `key = x`), with
  the same exceptions; also as a compose list item (`- NAME=…`), as cmd's
  `set NAME=…`, after a shell's `&&`, `||`, `;` or `|` (`cd app &&
  NAME=… npm start`), and as a Kubernetes env entry (`- name: NAME` with
  `value: …` on the next line);
- "password is …", "the password for the server is …" and "the api key is …",
  when the value has a digit or a symbol in it ("my password is sunshine"
  stays, since "the password is hashed" is prose);
- a value of 6 characters or more after `:` or `=` following `password`,
  `passwd`, `pass`, `passphrase`, `secret`, `access_token`, `auth_token`,
  `refresh_token`, `session_token`, `api_token`, `api_key`, `account_key`,
  `private_key`, Azure's `SharedAccessKey` (not `SharedAccessKeyName`),
  `key-data` or `pwd`, also inside a longer name
  (`DB_PASSWORD=`, `DB_PASS=`, `PGPASSWORD=`, `dbPassword`, `clientSecret`)
  and with the value on the next line. A key (a name and a colon with a
  value after it on its line, or an indented child on the next) is never
  taken for the value: in `secret:` with `password: …` under it, or on its
  line, the value after `password:` goes; a password that itself ends in
  `:`, before a blank or at its line's end, is still a value. Such a value
  goes even with no digit (`correct_horse_battery_staple`), unless it is
  plainly code: a type (`password: string`), a reference (`${…}`, `$(…)`,
  `process.env.X`, `user.password`), or, with no digit in it, a call, an
  index or a path of two parts or more (`jwt.sign(…`, `request.form[…`,
  `/etc/app/secret`). In quotes, the whole value goes, blanks and all
  (`api_key: "my secret value 1"`). Not in quotes, a value ends at its first
  blank: in `password: p@ss w0rd` the first word is too short to go and the
  second is not read;
- a value after `token` alone, only when it has a letter in it
  (`token: abc123def`), so a count like `input_tokens: 863324` stays;
- under a YAML key of its own line that names a secret (`passwords:`,
  `secrets:`, `tokens:`, `api_keys:`, with or without the `s`), the value of
  every `name: value` line indented under it (up to the next line indented
  no more than the key), 6 characters or more, with a digit or a symbol
  (`!@#$%^&*+=?~`), a PIN included, and not plainly code or a path
  (`admin: …`);
  under `tokens:`, 16 characters or more with a letter and a digit
  (`github: …`). So a sibling after the key, a name (`type: apiKey`), a
  setting (`hash_algorithm: bcrypt`), a colour or a count stays. The same
  for each string in a JSON object under such a key (`"secrets": {"db":
  "…"}`), one level deep. Not read: a deeper JSON object
  (`"secrets": {"db": {"main": "…"}}`).
- since 1.4.1 and 1.4.2, much more: the keys and tokens of about 70 more
  services (Terraform, Vault, Doppler, DigitalOcean, Heroku, Cloudflare,
  Sentry, Grafana, New Relic, Okta, Splunk, CircleCI, 1Password, GitLab,
  Discord, Teams, Twilio, Dropbox, Azure, Voyage AI and more); long tokens
  in Authorization headers of any scheme (Digest, Hawk, OAuth1, AWS SigV4, Negotiate, NTLM,
  SSWS, ApiKey) and unsigned JWTs; session ids and cookies, in a `Cookie` or
  `Set-Cookie` header, after `curl -b`, as `sessionid`, `JSESSIONID` or
  `PHPSESSID`, and in cookie jars and HAR files; passwords typed in chat
  (`pw: …`, `credential=…`, "set the password to …", "the PIN is 123456",
  backup codes, a passphrase of plain words) in German, French, Spanish,
  Russian, Swedish, Danish, Dutch, Portuguese, Polish, Japanese, Chinese and
  Korean as well as English, and a password typed alone as the answer to
  "what is the password?"; passwords given to dozens of command-line tools
  and to database, mail, Windows, Wi-Fi and VPN logins; password hashes
  (`apr1`, bcrypt, SHA-crypt, argon2, NTLM, DPAPI); seed phrases, Bitcoin WIF
  keys, Solana keypair arrays, a bare 40-character AWS secret key and base64
  private keys without a header; and a variable set mid-command whose name
  says key, secret, token or password (`docker run -e SIGNING_KEY=…`);
- the same secrets behind look-alike spellings: full-width letters, hidden
  characters, accents, HTML entities, and percent and unicode escapes.

Text is cut before the secrets are removed, so one huge paste is read in
linear time: blank runs are squeezed first, then it is cut to 64 KB, or to
four times the final limit when that is more (200,000 characters for a
request, 80,000 for a command). A journal reply is not cut first: it is
cleaned whole, then capped at 50,000. Kept on purpose, since they are not secrets: references
such as `$API_TOKEN` and `${API_PASS}`, URL settings (`TOKEN_URL=…`), schema
types (`password: z.string()`), labels, and times and `file.js:42`.

Not read, a known limit: a value with blanks and no quotes past its first
word, a JSON object more than one level under a secret's key, a bare
32-character hex key with no keyword (a Rails `master.key`), `key=<hex>` with
no vendor or secret word, a value under 6 characters (`password=abc`), a
short token in an Authorization header (Basic aside: under 20 characters,
or under 32 with no digit), and a Cyrillic or Greek letter that looks like a
Latin one. A long list of small numbers in code is cut as a possible Solana
key, which is a false alarm the other way.

No list of patterns finds every secret: anything these rules miss belongs
between `<private>` tags. The same rules apply to everything the startup
briefing and the compaction recovery note print, the shared index and the
health lines included.

What is recorded as your message is your own words. A message that another
conversation or a sub-agent sent in (a cross-session or agent message) is not
saved as something you asked, and a fork does not list its parent's turns
again. Claude Code's
`<system-reminder>` blocks, and tags it puts before them (a task notification,
an IDE's note of the open file), are left out. Text you pasted is yours and
stays.

The answer to a message that contains `<private>` is saved as `[private]`,
because an answer often repeats what it was told, and so are the names of the
files changed in that turn. A turn that runs `memory.mjs forget` is saved
as `[private]`, its request and its answer, with no file names, since its
answer lists what the forget removes. A message that contains
`<private-session>`, a slash command's arguments included, marks its whole
conversation: its entries are removed from `handoff.md`, later turns write
none, the compaction gate writes no recovery note for it, and Claude gets
no reminder to write notes. A mark the Stop's read missed, found later by
the journal (its import, or its look at the whole transcript), takes the
entries out of `handoff.md` too. So does a conversation held with auto
memory off (its tag in `.memory-off`), as the journal keeps it out: its
first Stop with auto memory on writes none of its turns and removes what it
had written before the tag. A `.memory-off` that won't read is unknown, as
`.private-sessions` is: the Stop writes nothing and records why.
Other conversations' briefings name it as working, without its messages.
Both tags are read in any case, with spaces or attributes, self-closed,
fullwidth, with hidden characters inside (any character Unicode shows as
nothing: a zero-width space, a soft hyphen, a left-to-right or
right-to-left mark, a bidi control, a variation selector), and as
`private_session`; in a
message typed while Claude works (a queued record); inside another tag; in
the answer to Claude's question (the answers in the result of its
`AskUserQuestion` call, found by the call's id; not the question, which the
result quotes too); and in the words given with a rejected tool call (what
follows "the user said:" in a result Claude Code marks as rejected, not one
that only reads like it). From there on, the turn's
reply and the files it changes are not saved. The tags inside what Claude
Code quotes, such as an agent's report or a task's result, are not the
user's and mark nothing, and neither do they in any other tool's output (a
file read, a command's output) or in a compaction summary that mentions
them. The mark is kept by the conversation's tag in
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
**Asked:** your message, whole
**Answered:** all the text Claude wrote in the turn
**Changed:** every file edited or written in the turn
**Ran:** every command Claude ran in the turn
```

Each field is kept whole, on one line (line breaks become spaces), up to the
limits at the end of this section: the journal is the detailed record, and
`search` reads headlines of it.

- When you answered a multiple-choice question Claude asked, `Asked` ends
  with ` Picked:` and your choices. `Ran` lists Bash and PowerShell commands
  and the code Claude sent to context-mode's `ctx_execute` and `ctx_batch`.
  A command that Claude Code refused or a hook blocked never ran, so it is
  not listed. A turn that ends with Escape or an API error is saved too, with
  what it changed and ran.

- The time is local, as in the handoff. The branch is the one Claude Code
  recorded with the message (`gitBranch`): the branch at the time of the
  turn, none on a detached HEAD. A path inside the turn's folder is written
  relative to it, any other path in full; the folder's name matches in any
  case on Windows and macOS, exactly on Linux. `Changed` and `Ran` are left out
  when empty.
- The key is the id of the turn's prompt record; a record without one gets
  the conversation's tag, the time and a hash of the message. One key is one
  entry: twin Stops, retries and a killed hook write nothing twice, and a
  turn seen again with more in it replaces its entry. A turn skipped while
  another window held the lock is written after the next reply, as the
  handoff catches up. A Stop that finds the store busy waits a moment and
  tries once more. If it is still busy, that reply is not saved, and
  `~/.claude/projects/.handoff-failed-<project folder>` says so; the startup
  briefing and `status` warn about it. A key written to a day leaves the day before and the
  day after: read again after a time-zone change, a turn gets the new
  zone's time, and so can fall on the next or the previous day. Daylight
  saving time ending, or a clock set back, acts the same way.
- A subagent's final report is an entry of its own, with the key
  `subagent-<id>` and `Asked:` set to the subagent's type and the first
  line of its task, and `Changed:` set to the files the subagent changed
  (1.6.0; read from its own conversation file as a turn's are). A report over 8,000 characters keeps its first 5,000 and
  last 2,900, with `(N chars cut)` between them. Nothing is saved when the
  conversation's turn is private or memory is off. A subagent that is
  resumed and finishes again replaces its earlier report, since the key is
  the same. The plugin's own `recall` helper (below) is the exception: its
  report is made of journal text, so saving it would double every hit, and
  it is not saved.
- Writes go under the store's lock through the same unchanged-file check as
  every other write. Entries are kept in time order. A line in a day file
  that isn't part of an entry (a note you wrote) stays under the entry it
  follows, or at the top before the first; when that entry goes, the note
  moves up to the entry before. A day's file is rewritten only to add or
  update an entry, by `forget`, and by a later `<private-session>`. A day
  left with no entry and no note is deleted.
- A day file survives being saved by an editor: a blank line inside an
  entry (a Markdown formatter adds them), CRLF line ends, a BOM, and a `·`
  re-saved in another code page (`Â·`) all still read. The fields are read
  in the order they're written, each once, so a line shaped like a field
  under an entry is a note. A day file that isn't UTF-8 text is never
  rewritten: the write that needed it fails, and `status` names the file.
  `search` and `status` name it too (`could not read <file>: not UTF-8`):
  one saved as UTF-16, as Windows PowerShell 5.1's `Out-File` writes, reads
  as a day with no entry.
- Every field goes through the redaction rules above, commands included. A
  `<private>` message's answer is `[private]`, with no files or commands. A
  turn that ran `memory.mjs forget` in any of its commands is kept like a
  private one, its request included:
  `[private]`, with no files or commands, since its reply lists what the
  forget removes. With auto memory off, nothing is written.
- A `<private-session>` conversation writes nothing, and its entries are
  removed from every day file. So does a conversation held with auto memory
  off (its tag in `.memory-off`), even when it goes on with auto memory on.
  A conversation tagged after its entries were written (an import before
  its memory-off tag, a mark only the compaction gate saw) loses them at its
  next Stop with auto memory on or at the next import look that meets it,
  whichever is first.
  When a Stop's read doesn't reach the start of its transcript (it reads
  back from the end), the transcript is looked through for a mark from
  where the last look stopped, whenever more than 512 KB (what any Stop's
  read covers) has been added since, so a mark anywhere counts.
  `journal/.checked` holds how far each conversation was looked through,
  and which were swept, so a sweep is done once.
- A sweep that stops short (a day it can't rewrite) lists that day in
  `journal/.sweeps`, and only the days listed are swept again, at every
  Stop and every import look, until they go through. The live write's
  failure line names the day until then; a look's failure to finish an
  owed sweep is not the import's failure, and doesn't slow it.
- `journal.md` is written once, the first time, as a `tier: hot` note, so
  the index gets a pinned line telling Claude to search the journal. It is
  never rewritten, so an edit to it stays.
- A failure is kept in `journal/.failed` for `status`, one line for the live
  write and one for the import, each cleared by its own next success. A
  live write's failure that the `journal` folder won't take either (it
  refuses writes) is kept in `~/.claude/projects/.journal-failed-<project
  folder>`, and the startup briefing and `status` say it all the same.

An entry is kept whole, within limits. A request or reply is cut at 50,000
characters (a reply that long keeps its end, and is cut at its start) and a
command at 20,000 (since 1.3.2). All the commands of a turn together are
kept up to 50,000 characters, keeping the latest; a line such as `[3 earlier
commands not kept]` stands for the rest. Saved text is cut before secrets
are removed, to 64 KB or four times the limit, whichever is more (since
1.4.1). With the limits it had until 1.2.4 (2,000
characters of the request, 6,000 of the reply, 20 commands of 400), measured
on 2026-10-29 by importing the 293 transcripts on the author's computer (362
entries): half the entries were under 2,660 bytes, nine in ten under 6,723,
and the largest 14,546. The busiest project wrote 74 entries in 3 days, 115
KB a day: about 40 MB in a year of daily use. Kept whole, measured again on
2026-11-01 from real transcripts: half the entries are under 4.6 KB, 64 % are
over 3 KB, one in a hundred is over 59 KB, and a busy project writes about
110 MB a year. The memory suite's year of entries, 14 a day, is 30 MB,
which `search` reads in about a second.

**Importing other conversations.** Every Stop also imports some of the
project's conversations still on disk that it hasn't read: on a new install
the last month (Claude Code deletes a transcript after 30 days without use,
by default), and afterwards any held while the plugin was disabled,
uninstalled or off, since a live Stop doesn't list its own transcript. The
candidates are the transcripts in the project's own folder, in folders
whose name starts with it and `-` (its subfolders'), and in the folders
listed in `journal/.folders`: a folder not named like the project's where
a live Stop ran for a conversation of this repository (a worktree outside
the repository's folder). A worktree folder where no Stop has run yet is
not looked in. A listed folder gone from disk, or holding only other
repositories' transcripts, is dropped from the list. Each candidate is
confirmed to belong to this repository by reading its start, oldest first.
One of another repository is listed as `other` and not read again. One
changed in the last 30 minutes is left to its own Stop. A subagent's own
transcript is no candidate: today's Claude Code keeps them in
`<conversation>/subagents/`, which no look lists, and one named
`agent-<id>.jsonl` beside the conversations, where a version kept them, is
passed over. A subagent's records inside a conversation's transcript
(`isSidechain`) are read by no writer: they are neither your words nor the
conversation's reply.

The import holds the store's lock for up to 150 ms per Stop, plus one
segment past that, and goes on at the next Stop. It reads a transcript
whole, however long, in segments of up to 64 MB of whole lines. Each
segment ends where its last exchange starts, so no exchange is split, and
holds at most 500 exchanges. An exchange longer than a segment is read in
parts and kept whole; a single line longer than 64 MB (a tool's output) is
passed over unread. Before anything of a transcript is recorded, every byte
of it not yet looked at is searched for a `<private-session>` mark; that
look keeps to the budget too, and goes on at the next Stop.

`journal/.imported` lists each transcript: `<folder>/<session> <bytes>`
once it is through, `<bytes looked at> at <offset>` while an import is under
way, `other`, or `failed <time>` when it wouldn't open (it is tried again a
day later, grown or not). One that has grown since and been quiet for 30
minutes is read on from where the last read ended (keys keep a repeat
harmless). A transcript gone from disk loses its line.
`journal/.looked`
holds the time of the last look: when the budget left work, the next Stop
looks again; otherwise the next look is 30 minutes later, and a Stop
before then doesn't take the store's lock for it. Every look first redoes
the sweeps listed in `.sweeps`. A conversation never imported:

- one whose tag is in `.private-sessions`, or in
  `~/.claude/projects/.memory-off` (the SessionStart and Stop hooks put it
  there while auto memory is off). A look that meets one takes back what
  it has in the journal, and a private one's lines in `handoff.md`, once.
  It meets a transcript only when it has grown since it was read, so one
  tagged at a start with nothing typed after it keeps its entries until it
  grows or has a Stop with auto memory on. A conversation held with auto
  memory off while this version wasn't installed and on has no tag, and is
  imported;
- one with a `<private-session>` mark anywhere in it, typed while the
  plugin was off. The import then does what that turn's Stop would have
  done: it adds the tag to `.private-sessions` and removes the
  conversation's earlier entries from the journal and from `handoff.md`. A
  tag quoted in a tool's output is no mark; one typed fullwidth or with a
  hidden character inside is.

Keys listed in `journal/.forgotten` are never written again, by an import or
a live Stop, and the exchanges they name are never written to `handoff.md`
again, by a Stop or the compaction gate.

To rebuild entries saved before 1.5.0, delete `journal/.imported` and
`journal/.looked` once per store. The next Stops read the transcripts again,
replace the entries and redact them under the current rules (forgotten
entries stay gone, private conversations stay swept). This only works for
conversations whose transcript is still on disk. Claude Code keeps
transcripts 30 days unless you change that, and older entries stay as saved.

**In the history.** Today's file grows with every reply, so it stays out of
the snapshots: committed, every version would stay in the history. The
ignore list names today's file, and changes at midnight, so a day is first
committed at a reply on a later day. An entry `forget` or a later
`<private-session>` removes from a finished day stays in that day's
committed version; delete `~/.claude/projects/.git` to remove it. A day
file deleted because it emptied is committed as deleted, and its earlier
versions stay. The journal's bookkeeping files (`.imported` and the other
dot files) are never committed.

## The startup briefing

At the start of a conversation, and after `/clear`, Claude is told:

- which other conversations are working in this project right now (their
  transcript changed in the last 30 minutes and has a turn still open), and
  the last request recorded for each, said as such: what it works on now may
  be newer; if none, where the last conversation stopped, if
  that was in the last 30 days, followed by that conversation's own exchanges
  from the handoff, oldest first (request, answer and files, as the handoff
  keeps them), as many as fit (see below). After `/clear` neither, since the conversation
  just cleared is the newest. It names at most two, and only conversations
  started in the project's folder or in the folder this one started in.
  A conversation marked `<private-session>` is never named as the last one
  or shown, even when `handoff.md` still holds it because removing it
  failed: the last conversation is then the one before it, and when the
  list of private conversations can't be read, none is named. One that is
  working is named without its words (`(no handoff entry)`). The exchanges
  listed never include one `forget` took out (listed in
  `journal/.forgotten`, matched by conversation and minute as `forget`
  matches them), for the same reason, and none is listed when that list
  can't be read. A conversation held with auto memory off has none of its
  exchanges listed, a second guard: its replies with memory on write none
  to `handoff.md` and take out what it wrote before ([The
  handoff](#the-handoff)). In both cases the "where it stopped" line still
  names the newest entry;
- when the project's journal has an entry, one line: "Earlier work in this
  project since <first day> is in its journal: when asked about the past,
  search it with the memory skill before saying you don't know." The
  journal itself is never loaded; a second line says the code wins when a
  note and the code disagree, and that a correction you give is saved as a
  feedback note; a third says that a "decided", "rejected" or "parked" in a note
  is a session's summary, and to check the user's own words (`search --asked KEYWORDS`)
  before telling them they decided it;
- anything failing, such as the Stop hook not running, snapshots failing
  three times in a row, a notebook that needs attention, hook files changed
  outside the installer, a full disk, a reply that could not be saved, or
  auto memory switched off. A Node older than 22 gets its own line first;
- the shared notebook's index, up to 3,000 bytes.

After a compaction, Claude is told:

- what the turn the compaction cut had in flight, if it cut one;
- this conversation's own latest exchanges, never another's;
- which other conversations are working here, when there is a recovery note or
  this conversation has exchanges of its own;
- the journal line and the code-wins line, as at startup, when the journal has
  an entry;
- the shared notebook's index.

A conversation that is resumed gets no briefing: its history already holds
the one it got when it started. When the briefing cannot load, it says so in
one line instead of showing nothing. Set `PROJECT_MEMORY_BRIEFING=0` in the
environment to turn the briefing off.

The briefing stays under 9,500 characters, inside the 10,000 Claude Code
passes on whole. After a compaction, the oldest exchanges are left out first,
until it fits. At the start of a conversation, the last conversation's
exchanges fill the briefing up to 3,500 characters, the oldest left out first; with a full shared index (3,000
bytes) they get a reserve of about 1,500 characters of their own, so the newest is still shown. Each line is cut to 1,000 characters, then the end is cut, so
the shared index goes first. A `<` that starts a
tag is written `&lt;`, so text from an earlier conversation can't pose as part
of Claude Code's own message.

## Compaction

Claude Code compacts a conversation when it nears the size limit, and it
checks before every step, so a long task can be cut in the middle. Three
things soften that.

- **A reminder.** When a conversation passes 85% of the compaction window
  (less in a small window, so that 60k tokens stay free before the compaction
  point, which is 33k short of the window: about 54% of 200k, or 107,000 tokens), the
  Stop hook asks Claude once to write its notes now. It asks again only after
  a compaction, and never in a private conversation or one held with auto
  memory off (its tag in `.memory-off`), which gets no cut-turn note
  either. It's sent as hook
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
  and nothing is written. Claude Code compacts about 33,000 tokens short of its
  compaction window, so the gate waits only for a window of about 233,000 to
  933,000 tokens (on a 1M model): set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to
  `800000`, and Claude Code compacts at about 767,000 tokens, so the turn can
  finish first. Under about 233,000 (a 200,000-token model) or over about
  933,000 (the 1M default), the compaction goes ahead, and the recovery note
  below does the work. Claude Code doesn't always honour the request either.
- **A recovery note.** When a turn is cut anyway, the briefing right after
  the compaction gives Claude what it had in flight: what you asked, its last
  words, background tasks still running with their output files, and the
  names of the files it had edited. A task counts as running from the result
  of the Bash or Agent call that started it until its end is reported;
  nothing else in the conversation adds one.

The plugin reads the window sizes from the environment, as Claude Code does:

- the model's window: 1,000,000 tokens, or 200,000 when `CLAUDE_CODE_DISABLE_1M_CONTEXT` is set. `CLAUDE_CODE_MAX_CONTEXT_TOKENS` counts
  only with `DISABLE_COMPACT` set, or when `ANTHROPIC_MODEL` names a model that is not a Claude one (Claude Code ignores it for its own models);
- the compaction window: `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (`800000`, `800k`
  and `0.8M` all work), never more than the model's;
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moves the reminder earlier to match.

Claude Code compacts 33,000 tokens short of its window. The reminder comes at 85% of the window, or 60,000 tokens before
that compaction point when that is earlier (at 850,000 tokens in a 1,000,000 window, at about 107,000 in a 200,000 one). `memory doctor` names both windows and the point.

A window chosen with `/autocompact`, `autoCompactWindow` or `--autocompact`
is kept in Claude Code's settings, which the plugin doesn't read (it reads only `autoMemoryEnabled`, and `autoMemoryDirectory` in `doctor`). With one of
those, also put the size in `CLAUDE_CODE_AUTO_COMPACT_WINDOW` under `env` in
your Claude Code settings, for example `"200k"`. Otherwise the reminder
never fires.

With a gateway or a model that is not a Claude model, the real window is often
between 200,000 and 900,000 tokens, and the plugin still assumes 1,000,000.
Set `CLAUDE_CODE_MAX_CONTEXT_TOKENS` to the real window and `ANTHROPIC_MODEL` to its id (also under `env`), so
the reminder and the wait come at the right time.

### If your model holds 200,000 tokens

The reminder to save notes never comes, because project-memory assumes a
window of 1,000,000 tokens. Ask Claude: *"Is my context window 200,000
tokens?"* If it is, ask: *"Add CLAUDE_CODE_AUTO_COMPACT_WINDOW set to 200k
under env in my Claude Code settings,"* then restart Claude Code. With a
window of 200,000, the reminder comes at about 54% (107,000 tokens; 60,000 stay free before the compaction point),
and the gate can wait only if the compaction window is set below the model's.

## Turning it off

There are four levels, from narrowest to widest. None of them reaches Claude
Code's own files: Claude Code by default still keeps its own transcript of
every conversation (30 days unless you change that), and its own auto memory
may still save notes. Those are Claude Code's settings, not project-memory's.
Per message, `<private>…</private>` keeps one piece of text out.

1. **One conversation:** `/project-memory:incognito`. It stops saving that
   conversation and sweeps what it already saved from the journal and
   `handoff.md`; snapshots of days already over keep a copy. It holds if you
   resume the conversation; `/clear` starts a new one, so run it again
   there. If it says `incognito NOT applied`, it did not work.
2. **One project:** `/project-memory:memory-off`, and
   `/project-memory:memory-on` to come back. While it is off, nothing is added
   to that project's journal, handoff or history, and its notes are not
   tidied; the startup says it is off. What you say meanwhile stays out after
   it is back on, and the same conversation's turns before and after are
   kept. Claude can still write a note if you ask. Off stops adding; it does
   not hide: search and show still answer from what is there.
3. **All projects on this machine:** set the environment variable `CLAUDE_CODE_DISABLE_AUTO_MEMORY` to
   `1`, `true`, `yes` or `on` (for example in the `env` block of Claude Code's
   `settings.json`), or disable the plugin (below). Claude Code's own
   `/memory` setting (`autoMemoryEnabled: false`) stops project-memory too;
   it reads only that value, from the settings files Claude Code reads.
4. **Claude Code itself:** `autoMemoryEnabled: false` stops its auto memory,
   `CLAUDE_CODE_SKIP_PROMPT_HISTORY` its transcripts (with none, the journal
   records nothing either), and `claude purge` deletes what it keeps.
   project-memory reads only `autoMemoryEnabled` (item 3) and changes none of the three.

The git-rule watcher does nothing while memory is off or the conversation is
private.

### How the project switch works

Two commands stop it, and each is checked first thing in the hook that would
have saved something.

- `.project-off` in a project's `memory` folder (`memory off` writes it, `memory
  on` removes it). `isOff` in `privacy.mjs` reads it: no marker is on; a marker
  is off, with the date from its `t` or "an unknown date" if it can't be read;
  a marker that can't be examined at all (any error but "not there") also
  counts as off, so a failure never reads as on. The Stop and PreCompact
  hooks return before touching anything, `compact-gate.mjs` does nothing, the
  startup prints one line saying memory is off, and the snapshot leaves that
  store out by a git pathspec (not a `.gitignore` rule, which would stop
  tracking the notes already committed). Search and show still read the store.
- `memory on` first adds the period to `.off-periods` (`<from ms> <to ms>`, one
  a line), then removes the marker. If either step fails it says `NOT applied`
  and the marker stays. The handoff and the journal skip a turn whose prompt
  is timed inside a period, so a conversation that runs across off and on keeps
  what it said before and after, and the import takes nothing from the period.
  A turn whose time won't parse isn't skipped.
- `incognito` goes through the existing private-session route: it adds the
  conversation's tag to `.private-sessions` and sweeps the journal and
  `handoff.md` for it (`takeBack` in `journal.mjs`), under the store's lock. If
  the sweep fails the tag stays and the next Stop retries; the command says
  so and exits 1.

The `/project-memory:incognito`, `/project-memory:memory-off` and
`/project-memory:memory-on` slash commands are three files in `commands/` that run the `memory` CLI with `--session ${CLAUDE_SESSION_ID}`.
Checked by hand on 2026-11-09: each ran when typed by its full name,
`/project-memory:incognito` got the real session id, resuming keeps that id, and `/clear`
starts a new one, in a new transcript. So incognito holds across a resume, and
after `/clear` the new conversation is not incognito.

### Pausing or removing it

To pause it everywhere, run `claude plugin disable project-memory@project-memory`
in a terminal and restart Claude Code; `enable` turns it back on. To remove it,
type `/plugin uninstall project-memory@project-memory` in Claude Code. If you
added it from claude.ai, use `/plugin` in Claude Code for both.

Your notes, the journal and the history stay either way, and so do the lines
project-memory added to each `MEMORY.md`: the ones pointing at `handoff.md`
and `journal.md` keep being loaded, so delete them when you remove it. The
privacy policy lists what to delete by hand:
[Deleting it](../PRIVACY.md#deleting-it).

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
full disk) is rebuilt from that snapshot; no note is touched. So is a
missing one, before anything is added. If
`~/.claude/projects` is already a git repository that project-memory didn't
make, it commits nothing there, and `doctor` says snapshots are off. A
repository at `~/.claude` itself (a dotfiles repository) doesn't count:
project-memory still makes its own in `~/.claude/projects`.
The first time, with no repository there yet, it takes a snapshot of every
notebook as it finds it before its first tidy-up, then tidies. On a large
store that first snapshot is taken in parts of 1,000 files, the `MEMORY.md`
files first: two parts at the first reply (before and after its tidy-up),
then one a reply, so no git command runs past its 30 seconds; `doctor` says
how many files are still to add. A git command that
does run past them is stopped, and the next replies go on in parts.

A snapshot that doesn't go through (another window's git is committing, or
git fails) is tried again after the next reply, even when no note changed;
the tidy-up itself isn't redone. Waiting on another window's git counts as a
failure once it has lasted more than 10 minutes, and the startup briefing
names snapshots that failed three times in a row.

- `history <note>` lists the commits that changed a note, the newest 30
  (`--limit N` for more).
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
- A note that holds a key, token or password, in its text or its file name,
  is kept out of the snapshots (since 1.4.1). `status` and the startup line
  name it and say how to release it: remove the secret. Prose after a key
  word, such as `password: required`, is not a secret. A note
  already snapshotted before that keeps its text in the history.
- `forget --purge` also removes the forgotten entries from the snapshot
  history, for the days before today. It waits for a snapshot in progress.
- Without git there are no snapshots, everything else works, and `doctor` says
  so.

To drop the history, delete `~/.claude/projects/.git`. The next change to a
note, or the next day, starts a new one. For journal entries, `forget --purge`
does the same job for the entries you forgot. Deleting `.git` is the only way
to remove anything else from a finished day's committed version, such as a
note, which `--purge` does not touch.

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
already full, `promote` says so and suggests `tier: hot`. It refuses an
index, `handoff.md` and `journal.md`, which are project-memory's own, a
folder, a file that is not UTF-8, and a note that holds a key, token or
password (`--force` copies it anyway; the shared notebook is read by every
project). The
skill tells Claude to ask you before promoting.

## Several conversations at once

Each store has a lock, a `.lock` folder that only one process can create. A
hook waits up to 2 seconds for its locks, in all: a Stop takes up to four
(its handoff, the journal's import, its notebook's tidy-up and the shared
one's), and the wait is shared among them. If a store is still busy, the
hook skips that part for this reply and catches up after the next one. A lock left by a process that
was killed is taken over after 30 seconds.

Every write first checks that the file still holds what was read. When Claude
edited the file in the meantime, Claude's edit is kept and the hook tries
again next time.

A write goes to a temp copy, `<file>.tmp<process id>`, which then replaces
the file. A hook killed between the two leaves its copy behind; the next Stop
removes it from the notebook and its journal once that process is gone (or
the copy is over 30 seconds old), and so does `forget`. Only copies of its own
files are removed (a `.md` file or one whose name starts with a dot); a file of
yours named like `x.tmp5` stays.

## Search and forget

`search` looks at notes in this project and the shared notebook, archive
included, and at this project's journal (`--all`: every project). Common
words such as "the", "how", "what" and "is" are ignored (a question made only
of such words still searches). Other forms of a word match: `migrated` finds
`migrating` and `migration`, and the same works for common Macedonian
endings. Irregular forms (`run` and `ran`) do not match. A version number is
one word, so `1.4.3` does not find `1.4.30`. A word of two
letters (CI, PR) counts only standing alone, so `ci` doesn't match
"decision".
For each word: +3 if it's in the note's name, +2 in its description, +1 per
mention in the body, up to 2. A note that has every word in its name or
description gets +5; one that has every word somewhere gets +2. A journal
entry is scored the same way on its request (+3), its files and commands
(+2), or failing those its branch (+1), and its reply (+1 per mention, up
to 2): every word in the request gets +5, every word somewhere +2, so a
reply that names everything can't outrank the request for the thing.

Three options narrow a search to the journal: `--file <path>` keeps entries that
changed that file (a name alone matches the end of a path, at a folder), `--asked`
looks only at what you asked (helper reports and private turns are left out, and
only the request is scored), and `--conversation <id>` keeps one conversation (the
start of its id, 4 characters or more). `--file` also takes an absolute path. `--file` and `--conversation` listings include helper (subagent) entries, `--asked` leaves them out. A path with ", " in its name cannot be matched (the journal lists changed files with that separator). With any of them notes are left out, and with no words they list
the entries newest first.

Hits are ordered by a weighted rank built from these scores: rarer words
count more, long entries count less, and an entry that holds your whole
search text word for word gets a bonus. The newest first only breaks a tie
on that rank. The score printed beside a hit is the plain sum above, so hits can print out of score
order.

It shows the top 10 (`--limit N` for more), then how many matched, then a last
fixed line, `Not the entry you meant? Search again with other words.` (a
search with no hits and the day list do not print it). A journal
hit shows its day and time, conversation tag and branch (and under `--all`
its project: the folder its conversations started in, then in brackets its
folder in `~/.claude/projects`, which `--store` takes), then its key and its
request, cut to 200 characters, then
`Result:`, the first sentence of its reply (140 characters at most; left out
when the reply's own stretch below starts there). Of its
reply, files and commands it shows only those that hold a search word, and
of each only the stretches 30 characters either side of a match, 240
characters in all a hit. Every field is redacted before it is cut, so a
stretch never shows part of a secret. From the 6th journal hit on, only the
request, the `Result:` line and the key are printed. A hit is a headline: `show <key>`
prints the entry whole, with its day file and, while it is still on disk,
its transcript's path, unless the entry is private (its reply is
`[private]`): the transcript is where the private part still is. A request
of 80 characters or more asked again (a
prompt a script sends, a retry) is one hit: the best-ranked copy, then
`N more like this, <first day>..<last day>` with up to 5 of the other
copies' keys. `--limit` and the count are of these hits. A ranged search
also says how many notes match outside the range, since a note's date is
its last change.

A word of two letters is found only standing alone (`ci` is not in
"decision"), but a word made only of Chinese or Japanese characters is
found anywhere in the text, even a single character, since those languages
put no spaces round words. A Latin word touching such text counts as standing
alone, so `ci` finds `CIが落ちた`. When some of the search words are held by no note or
entry in the stores and range searched, one line after the hits names them:
`no note or entry holds: hetzner`. A search where no word is held still says
only `nothing matches`.

`show <key…>` prints journal entries whole, by the key a hit printed: the
heading, the key, every field, the day file and, when it's still on disk
and the entry isn't private, the transcript. `--same` adds every entry whose request is the same, as a
hit's "more like this" counts them; `--all` and `--store` reach another
project. A key no entry has is tried as a note's file name (see Who said it, below); when neither exists the miss says so, and the tool exits with 1. When the
entry's request is 25 characters or less ("yes", "go"), `show` and the day
list add one line, `Reply to key <key>: …`, with the end (200 characters) of
the reply before it in that conversation, so the short request reads in
context. The day list with no search words leaves out subagent reports
(`subagent-` keys); a search by words still finds them.

**Who said it.** `history <note>` puts a `by:` line under each snapshot, and
`show <note>` prints the first exchange that changed it and the last one: the
time, the conversation, what the user asked (cut at 100 characters, control
characters printed as U+FFFD) and the entry's key. The journal entries that
changed the note by its full path are paired with its snapshots, oldest first.
For each snapshot the candidates are the entries sent at or after the minute of
the note's previous snapshot and no later than this snapshot's minute that no
older snapshot took; a helper's entry counts only when no other fits. One sent
earlier than the snapshot's own minute comes first, and the newest of them wins.
Every entry in a snapshot's own minute is taken, named or not. A name is
printed only when it is sure: when the candidates come from more than one
conversation the line says `several exchanges`, and a deletion, a change with no
candidate (by hand, by a shell command, by the plugin's own sorting) and the
note's oldest snapshot when more than one exchange could be it all say
`no exchange found`. A shared note says it was not looked up: its edits are in
the project journals. `--limit N` opens only the journal days from the snapshot
below the oldest one shown.
Limits: an entry holds its time to the minute only, and entry and snapshot
times are both the machine's local time, so a clock change (daylight saving, a
new time zone) between them can pair them wrongly; a long turn that changes a
note, is snapshotted by another session's save in the middle, and changes the
note again gets its exchange named for the first snapshot only. The plugin
cannot judge what is true. It makes the check one command.

`search`, `show` and a day's listing never show an entry whose key is in
`journal/.forgotten`: when `forget` couldn't rewrite its day file, the entry
is still there until `forget` runs again, but nothing prints it. When that
list can't be read, they show none of that project's entries, and name the
list (`could not read …`).

`--since` and `--until` take a date, `YYYY-MM-DD`, and keep only the days
from one to the other, both included: a note by the day of its `modified:`
date (or its file's), the journal by its day files. A day file outside the
range is never opened. With dates and no words, `search` lists the requests
of those days, newest first, 30 by default: the answer to "what did I work
on last week". A day file that can't be read is named in the output, and
the rest is still searched.

`forget [<words…>]` finds the journal entries that hold every word (in any
case) in their request, reply, branch, files or commands, narrowed by
`--since`, `--until`, `--conversation <tag or session id>` and `--key <key>`
(again for each key: only those entries); it needs at least one of these.
`--same` with `--key` adds every entry whose request is the same as a
key's. Without `--yes`, it lists each match with its key and says how many
would go: this look is how the skill finds what to forget, and it removes
nothing. When nothing matches, it names the words no entry holds. A look
by words, keys or a conversation lists 200 at most: past that, it lists
none and asks for a narrower one, and `--yes` removes nothing. A look by
`--since` or `--until` alone is confirmed by its range: it lists the first
20, says how many more, and names the first and last day of what would go.
With `--yes`, it looks again and removes what that look found, under the
store's lock, then lists what went (past 200, only how many), and says that
Claude Code's own conversation files still hold those exchanges: `forget`
changes only project-memory's files. A key the
store has no entry for is named, and the tool exits with 1, unless it is the
key of an exchange in one of the project's conversations (the folders the
import reads) that no day holds yet: a reply whose Stop met the lock, which
the next reply writes. That exchange is listed as `[not in the journal yet]`,
without its words (its conversation may be one the journal never takes), and
`--yes` lists its key in `.forgotten` and takes it out of `handoff.md`, as
for an entry. It is found by the id of its prompt record: a turn whose
record has none (rare: Claude Code gives every record one) is keyed by a
hash, as above, and can't be found until the journal holds it. `--same` with
such a key adds only the copies the journal already holds. A look by words
alone (no `--key`) finds such exchanges too, those that hold every word,
listed the same way: it reads every conversation of the project for them.
While a day file can't be read, neither looks for them: the exchange may be
in that day, and a key of it is named as in no day that could be read,
nothing is removed for it, and the tool exits with 1. A key already
listed in `.forgotten` is named as already forgotten, nothing is removed,
and the tool exits with 0; with `--yes`, its exchange still goes from
`handoff.md`, by the conversation and minute its line keeps, in case an
earlier `forget` couldn't write that file. It works on one
store: `--all` is refused, and `--store` picks another project's.

The keys are added to `journal/.forgotten` first, each with its
conversation and time, so neither a killed `forget` nor a later import
brings them back. A key is listed only while its conversation's transcript
is on disk: once that is gone, nothing can bring the entry back, and the
next `forget` drops its line. A day whose file can't be
written keeps its entries and is named (`could not write`), the other days
still go, and the tool exits with 1. When the snapshot repository is
project-memory's, it then names the days before today, which the snapshots
already hold, and the folder to delete. The same exchanges go from
`handoff.md`, matched by conversation and minute (two exchanges of one
minute go together), so the next startup's briefing doesn't show them; a
`handoff.md` that can't be written is named the same way. A later Stop of
that conversation, which reads them again, leaves out every exchange listed
in `.forgotten`. Claude Code's transcripts are untouched. The turn that
runs it is kept without its words, in the journal and in `handoff.md` (see
[The journal](#the-journal)). `--since 1970-01-01 --yes` empties the
journal of what it holds so far, however many entries; conversations
`status` still counts as to import come in later and need another
`forget`. Deleting the `journal` folder instead rebuilds it from the
transcripts still on disk, since `.imported` and `.forgotten` are inside it.

`status` adds a journal line: how many days hold entries since the first,
the size, how many older conversations are still to import, and the last
failure of the live write and of the import, if any. When `journal.mjs`
won't load, the line says so. A day file that can't be read or isn't
UTF-8 gets a line of its own (`journal: could not read <file>: <why>`).

### The recall helper

`agents/recall.md` is a helper agent that ships with the plugin; Claude Code
names it `project-memory:recall`. Claude hands it a question about the past
that one search does not answer (the skill and the startup briefing say so),
or you ask it by name with `@agent-project-memory:recall`. It runs on Sonnet,
for at most 15 turns, without your CLAUDE.md files, and its only tool is
Bash: it runs `search`, `show`, `history` and `status` of the CLI with
several wordings and filters, opens the promising hits, and reports the
answer first, then each source's date, conversation tag and key, quoting
your own words for a "who said it" question, or "not found" with what it
searched. It changes nothing; that it runs only those four commands is its
instruction, not a lock, since a plugin's agent cannot limit Bash to one
command. It reads the same journal and notes the skill does, nothing more.
Its report is not saved to the journal. With `PROJECT_MEMORY_RECALL=0` the
briefing leaves out the line that points to it.

## Checked lessons (experimental)

This part is a test of an idea, not a promise. It is a 30-day trial, and on
2026-12-18 it is decided whether to keep it or cut it. A note can carry a rule that a
computer checks on a git command. The hook only watches and logs: it never
blocks a command and never prints anything. It works on git commands only.

### Writing a rule

Add an `enforce:` block to the note's front matter. `enforce:` stands alone on
its line, and its three keys are indented two spaces. A rule written under
`metadata:`, or with any indented `enforce:`, is reported as a bad rule:

```
enforce:
  on: git add
  has: [-A, --all, .]
  unless: [mktemp, init]
```

- `on` is `git <subcommand>` and nothing more.
- `has` is one word or a list of up to 8, written as `[a, b, c]` on one line.
  A command matches when it holds one of them as a whole word.
- `unless` is optional. If any of its words is in the same command, the rule
  does not match. It also matches a folder or file name inside a path, split
  at `/` and `\`: `unless: [scratchpad]` spares `cd /tmp/x/scratchpad/repo &&
  git add -A`, but not a folder called `scratchpad-old`. `has` is not split: a
  path like `src/.` or `a/--all` is not a match.
- Words are exact and case-sensitive: no patterns, no quotes, no spaces. A
  list written as `- x` lines is not read. One rule per note.
- A bad rule is reported with the reason by `memory enforce status` and by
  `memory doctor`. Archived notes are skipped.

### Try a rule before you trust it

`memory enforce replay <note>` lists what the rule would have caught in the
last 30 days of this project's conversations, sub-agents included. `--all`
reads every project and can take about a minute on 2.7 GB of history
(measured once). It only reads. Read each hit yourself: a hit is a catch only
if you agree the command broke the lesson. Replay skips private sessions and
projects with memory off.

To write a rule in three steps: add the block to a note, run `memory enforce
replay <note>`, read each hit.

### What the hook does

Once a rule is in a note, `enforce-hook.mjs` (the `PreToolUse` hook, 5 second
limit) runs when Claude is about to run a Bash or PowerShell command that
holds `git`. It compares the command with the rules and, on a match, adds one
line to `.enforce-log` in the project's store: the note's name, the first 8
characters of the conversation's tag, the sub-agent type and the tool-call id.
It never logs the command.

- It blocks nothing and prints nothing. Any failure lets the call go on.
- It does nothing while memory is off or the conversation is private.
- The log stops at 256 KB, then drops its oldest half. A line can be lost when
  many conversations write at once.
- The rules are cached in `.enforce.json`, and only a changed note is read
  again.
- Cost, measured once on a copy of the largest store here (194 notes): about
  40 ms added to each git call, and about 180 ms more on the first call after
  a note changes.

### Status and doctor

`memory enforce status` shows per note the hits of the last 30 days (main and
sub-agent), the last one, bad rules with the reason, and whether the log is
full or memory is off. On 2026-12-18 the author reads this output and keeps
checked lessons or cuts them. The live log keeps no command text, so run `replay`
to see commands. `memory doctor` has one line for the hook: it runs the copy
the plugin runs and says what is wrong, even when memory is off in this
project.

### What a rule sees and what it does not

It sees a command after an escaped quote, after git options such as
`--no-optional-locks`, inside `{ }` or `( )`, after a line continuation, behind
`env`, `sudo` (with options such as `-u bob`), `time`, `nohup`, `exec -a`, `cmd /c`, `cmd.exe`, `command`, `rtk` (also `rtk bypass` and `rtk proxy`), `git.exe` or a full path to git, and after
`FOO=1`, `cd x &&` or `sleep 1 &`, and inside the quotes of a shell
(`bash -c "git add -A"`, `cmd /c "git add -A"`, `powershell -Command "..."`).
A heredoc body is not a command. That is what the rule
engine reads, and what `replay` reads in saved commands.

It does not see:

- Git commands that never start the hook, because Claude Code's `if` filter
  (`Bash(git *)`) skips them: `env FOO=1 git add -A`, `command git add -A`,
  `/usr/bin/git add -A`, `git.exe add -A`, `rtk git add -A`. A live Claude
  Code run confirmed this for Bash; the `PowerShell(git *)` filter was not
  tried. In 30 days of one user's real commands, about 0.4% of git calls
  were of these forms. `replay` reads the saved commands, so it does see
  them, and the log will show fewer hits than `replay` does for them.
- `$(...)` inside quotes, and words after `--` (`git add -- -A`); git
  aliases and scripts; joined short flags (`-Av`); `#` comments; and a rule
  with `unless:` words that a comment holds.

### The honest numbers

Few lessons fit this form. Of 115 feedback notes in one real store, about 1
could be written as a git rule (measured once by the author, not repeated).

## The memory tool from a terminal

The skill runs `memory.mjs`, and so can you:

```
node "$HOME/.claude/plugins/cache/project-memory/project-memory/<version>/src/memory.mjs" <command>
```

| Command | Options |
|---|---|
| `search <words…>` | `--file P`, `--asked`, `--conversation ID`, `--since D`, `--until D`, `--all`, `--limit N` (words optional with a filter) |
| `show <key…>` or `show <note>` | `--same`, `--all` |
| `forget [<words…>]` | `--key K` (again for each key), `--same`, `--since D`, `--until D`, `--conversation <tag or id>`, `--yes`, `--purge` (also remove from the snapshot history) |
| `page` | `--days N` or `--days all` (30 by default), `--project NAME` (a project's name or its folder); writes the journal as one HTML page and prints its link (see [The journal page](#the-journal-page)) |
| `status` | `--all` |
| `history <note>` | `--all`, `--limit N` (the newest 30 by default); each snapshot names the exchange behind it |
| `rescan` | `--apply`, `--yes` (redact secrets saved before a rule existed, in files and snapshots; makes a backup that still holds them) |
| `restore <note>` | `--rev <commit>`, `--force` |
| `promote <note>` | `--force` (copy a note that holds a secret) |
| `doctor` | |
| `enforce status` | per rule note: hits in the last 30 days, bad rules (see [Checked lessons](#checked-lessons-experimental)) |
| `enforce replay <note>` | `--all` (every project); what the rule would have caught in the last 30 days |
| `incognito` | needs `--session <id>` (see [Turning it off](#turning-it-off)) |
| `off`, `on` | turn this project off or back on (see [Turning it off](#turning-it-off)) |
| `help` | (also `--help` and `-h`) |

Every command works on the project of the conversation that `--session <id>`
names (the skill passes Claude Code's session id). Without it, or when that
conversation's transcript isn't found (it then says so on its first line),
it works on the nearest project with a notebook, from the folder you're in
upward. The tool reads no environment
variable to find the conversation. `--store <folder>` picks another
project's `memory` folder, one inside `~/.claude/projects` (any other is
refused), and `--shared` picks the shared notebook. With no command, it runs
`status`. `D` is a date, `YYYY-MM-DD`, one the calendar has (`2026-02-30` is
refused). An option the tool doesn't know is refused, and so is an option
that takes a value with nothing after it, or another option in its place
(`forget --key --yes`). Every word after `--` is a search word, one that starts with `--`
too, so options go before it. The tool exits with 1 when a command is
refused or fails.

### The journal page

`page` reads the journal of every project, leaves out helper entries (a
subagent's own) and switched-off projects, keeps the last 30 days (or
`--days`), and writes one file, `project-memory/journal.html` in Claude
Code's folder, through a temporary file renamed into place (mode 0600, its
folder 0700; a temporary file a killed run left is removed by the next write or delete). It prints the `file://` link, how many exchanges in how many
projects, what it left out, and how to refresh and remove it. A turn marked
`[private]` shows as private, with no text. Each question and answer is
capped (2,000 and 4,000 characters) and marked when cut. A page past 40 MB (`--days all` on a long journal) is not written: it says so and suggests `--days N`.

The stores' locks are held to read the journal and again to write the page, not while the page is built (redacting takes about 0.35 s a MB, longer than a lock lasts before a hook calls it stale). While it reads, the run leaves a claim file, `journal.html.<pid>.reading`, beside the page. Anything that deletes the page (`forget`, the sweeps, `incognito`, `off`, `rescan --apply --yes`) deletes every claim too, and the write goes ahead only if the run's own claim is still there; otherwise it says `the journal changed while the page was built; run memory page again`, so a `forget` or an `off` in between is never undone. A reply saved by a session meanwhile does not stop the write. The claim is removed when the run ends, whatever the outcome. A page whose text alone is past the limit is refused before it is built. A store another hook holds is said, not skipped. When the page cannot be deleted (on Windows, a browser holding it open), `forget`, `incognito`, `off` and `rescan --apply` say `could not delete the page` and exit 1, since it still holds the text.

The page is built by `page.mjs`, which only turns data into text. Every
string passes the secret filter and the same cleaning as the `by:` lines, and
is then escaped. The file has one style block and one script, a
Content-Security-Policy that allows exactly those two (by hash), no network and
no outside script. The data sits in the script as JSON with `<` written as
`\u003c`, and the script writes it with `textContent`, never `innerHTML`.
`forget`, `incognito`, `off`, `rescan --apply`, and the sweeps that take
entries back delete the file, since it may hold what they removed.

A note's name may be several words, quoted or not: `restore my note` is
`my note.md`. Without Git, or before the first snapshot, `history` and
`restore` say so, and a note no snapshot holds is named in plain words, not
git's. `history`, `restore` and `promote` take a note's name as the disk resolves it: on Windows
and on macOS by default in any letter case (on Windows, a short name such as
`memory~1` too), on Linux only as written, and everywhere in either Unicode
form (`café` typed composed finds a file named decomposed); a deleted note
by the name the snapshots had for it, the same way, and `.MD` is `.md`.
When two names read alike (`Twin.md` and `twin.md` in the snapshots, typed
`TWIN`), neither is taken. git reads the name literally, so a
name with `[`, `*` or `?` in it works. A write the disk refuses is reported in
one line that says what was left behind.

## Good to know

### Room

Each conversation starts with a short briefing for Claude. The last
conversation's exchanges fill it up to 3,500 characters (at most 3,499 on 13
real projects), and when the shared lessons already take that, the newest
exchanges still get about 1,500 characters of their own. A long list of shared
lessons or warnings can pass 3,500, but never 9,500. After a compaction it is larger: 8,481 characters at the median
and 9,366 at most on 8 projects, never over 9,500. The journal is not loaded,
only searched when needed. What the hooks do after each reply runs outside the
conversation and uses none of its room. See also
[The startup briefing](#the-startup-briefing).

### Disk space

The journal keeps each exchange whole, so an entry is as long as what was
said: half are under about 5 KB, and one in a hundred is over about 60 KB. A
very busy project adds up to about 110 MB a year. The snapshot history only
grows.

### Your notes

The first run may move older lines of the table of contents to an archive, so
it stays short without dropping a note. The
plugin deletes no note (Claude Code's own cleanup might), and Claude can still
search them.

### MEMORY.md is the plugin's to tidy

It rewrites the file as a plain file in place (so a link to it becomes a copy)
and keeps the lines, not your `##` headings. Put what you want kept in a
note, not in the headings. A line keeps the file name of its note, and a file
name that holds a key is not added to the index ([privacy policy](../PRIVACY.md)).

### Where it works

Windows, macOS and Linux, with Claude Code only. Notes stay on the computer
they were made on, and do not sync. Do not sync the memory folder yourself
(Dropbox, OneDrive): each computer would undo the other's *"forget"*.

### A moved memory folder

The Claude Code setting `autoMemoryDirectory` is not followed: notes in the
moved folder are not tidied, snapshotted or briefed. `doctor` warns when it is
set.

### Your files

It writes only inside Claude Code's own folder (`~/.claude/projects`, or the
folder `CLAUDE_CONFIG_DIR` names), never in your project. Two commands, `forget --purge` and
`rescan --apply --yes`, also work on a full copy of the snapshot history. It sits in a
`pm-purge-...` folder inside the snapshot repository's own `.git` (in that same
projects folder) and is removed afterwards. A shorter
`cleanupPeriodDays` in Claude Code's settings shortens the time the journal can
catch up on conversations Claude Code has not yet deleted.

## Requirements and limits

- Node.js 22 or newer. No other dependencies.
- Git, for snapshots (optional: without it everything else works).
- Claude Code only, on Windows, macOS or Linux.
- Paths follow `CLAUDE_CONFIG_DIR`, and `CLAUDE_CODE_PROJECT_DIR_NAME` only
  when `CLAUDE_CONFIG_DIR` is set too (see [Where things live](#where-things-live)).
  The `autoMemoryDirectory` setting is not followed: `doctor` only warns when
  it is set. The plugin reads Claude Code's settings for two values only,
  `autoMemoryEnabled` and `autoMemoryDirectory`.
- Tested on Linux with Node 22, Windows with Node 22 and 24, and macOS with
  Node 26.
- The snapshot repository only grows.
- The suite is 8 test files and about 2,500 checks. Each pull request runs
  them on all three systems, with a sign-off check; the mutation tests and
  the long fuzz run by hand.

The design documents, with the measurements behind these numbers, are in
[`docs/specs/`](specs/).

## When something seems wrong

`memory.mjs doctor` (`/project-memory:memory doctor` in Claude Code) checks
the setup. Most of its `PROBLEM` lines end with what to do. The ones people
meet most:

- **Claude doesn't remember the last conversation.** Ask *"Where did we leave
  off?"*, then run the check. Right after installing, one line says the plugin
  is waiting for Claude's first reply, which is normal.
- **A note seems to be gone.** It may have moved to the archive. Ask Claude to
  search for it, or to bring it back from the history.
- **"not installed".** The plugin isn't installed and has never run. If it
  was added on claude.ai rather than with `/plugin`, let Claude finish one
  reply and run the check again. Otherwise install it again.
- **"the Stop hook ran twice for one reply".** The hooks are set up twice, so
  everything happens twice: they were also added to the Claude Code settings
  by hand, or a second copy is installed under another name. Remove the hooks
  from the settings, or uninstall the second copy, and keep the plugin. Two
  different replies under 2 seconds apart don't count: each run notes its
  reply's fingerprint. Runs noted before 1.2.5 have none, and are judged by
  time alone.
- **"Memory hooks look stopped"**, in the briefing. Another conversation in
  this project finished a reply after the plugin last saved. After a pause
  this goes away with the next reply; otherwise run `doctor`.
- **"Memory could not be saved after … reply"**, in the briefing or from
  `doctor`. The same, but the disk holding `~/.claude/projects` is full (less
  than 1 MB free), or that folder refuses writes (the code says why: a
  permission, another program holding a file). Free some space or fix the
  folder's permissions; the plugin saves again at the next reply, and the
  journal takes in what was missed from Claude Code's own conversation files.
- **"snapshots: off".** Git isn't installed, or the projects folder is a git
  repository the user made. Everything works except bringing back an old
  version of a note. Install Git, or move that repository out of the folder.
- **"its Stop hook is not running".** Claude finished a reply, but the plugin
  didn't save after it. Restart Claude Code; if the line stays after the next
  reply, check that Node.js is installed and on the `PATH`. A `disableAllHooks`
  setting, `--bare`, `--settings` or `CLAUDE_CODE_SKIP_PROMPT_HISTORY` would
  cause this too.
- **"the record of where you left off could not be saved"**, in the briefing
  or from `status`. A reply was not saved: another window held the store
  through two tries, or the write failed. The line says when and why. The
  journal takes in what was missed from Claude Code's own conversation files.
- **A leftover `pm-purge-…` folder**, from `doctor`, listed once it is a few minutes old. It sits inside `~/.claude/projects/.git`. A `forget --purge` was
  killed half way and left a copy of the snapshot history, which may hold
  text you meant to forget. Run `forget <word> --purge` again, or delete the
  folder.
- **"project-memory needs Node 22 or newer"**, at the start of a
  conversation. Update Node.js; the hooks may fail until then.
- **"node" is not found.** Install Node.js 22 or newer and restart Claude
  Code.
