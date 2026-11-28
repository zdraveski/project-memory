# Security assessment

What could go wrong with project-memory, how likely and how bad it would be,
and what in the code and the tests guards against it. It covers version
1.6.0 and the project around it, and was written in November 2026. A change
that reads, saves or sends anything new updates this page, as
[CONTRIBUTING.md](../CONTRIBUTING.md#sending-a-change) says. The facts here
come from [PRIVACY.md](../PRIVACY.md) and [How it works](how-it-works.md),
which have the details.

## What it is

A Claude Code plugin: five hook scripts that Claude Code runs on its own
events, a command-line tool that its skill runs, and a helper agent that
runs the same tool. It is plain JavaScript
run by Node.js, with no dependencies. It runs with the rights of the user
who runs Claude Code, on their computer. It has no server, no account and
no network code.

## Actors and actions

| Actor | What it does |
|---|---|
| The user | Talks to Claude; marks text `<private>` or a conversation `<private-session>`; asks Claude to search, restore, promote or forget; can run the memory tool in a terminal. |
| Claude Code | Runs the hooks on its events ([When it runs](how-it-works.md#when-it-runs)) and hands each one a JSON payload on stdin; writes the transcripts the hooks read; loads `MEMORY.md` and the briefing into the conversation. |
| Claude (the model) | Reads the briefing and the notes; writes notes itself; runs the memory tool through the skill (`skills/memory/SKILL.md`), with commands it composes. |
| The Stop hook (`memory-tier.mjs --stop`) | After every reply: tidies the indexes, writes the handoff and the journal, imports other conversations, takes a snapshot, and may remind Claude to save notes. |
| The SessionStart hook (`brief.mjs --print`) | Prints the startup briefing. |
| The compaction gate (`compact-gate.mjs`) | Before an automatic compaction: may ask Claude Code to wait for the turn to end, or writes a note of the work in progress. |
| The git-rule watcher (`enforce-hook.mjs`) | Before a git command: logs which note's `enforce:` rule matched. Blocks nothing, prints nothing. |
| The recall hook (`recall-hook.mjs`) | After Claude changes a file, and at each message the user sends: names earlier exchanges of this project (date, conversation tag, request, up to three files) and other open sessions, and writes the conversation's session file. At SessionEnd: writes one `end` line. Blocks nothing. |
| The recall helper (`agents/recall.md`) | A Claude Code agent with Bash only, told to run `search`, `show`, `history` and `status`; reports what it found. Its report is not saved again. |
| The memory tool (`memory.mjs`) | `search`, `show`, `forget`, `status`, `history`, `restore`, `promote`, `doctor`, `enforce` (`status`, `replay`), `lessons` (and `lessons replay`), `rescan` (`--apply --yes` rewrites saved text and the snapshot history, using a temporary working copy of it), `forget --purge`, and `off`, `on` and `incognito` ([commands](how-it-works.md#the-memory-tool-from-a-terminal)). |
| git | Run by the hooks and the tool, as a program, for the snapshot repository. |
| Other processes | Another Claude Code window on the same project, Claude's own edits, a virus scanner or a sync tool holding a file. |
| The maintainer and GitHub | Write, review and release the code; GitHub hosts it, runs CI and serves it to Claude Code's `/plugin`. |

## External interfaces

- **Hook events**, declared in [`hooks/hooks.json`](../hooks/hooks.json):
  `Stop`, `StopFailure`, `SubagentStop`, `SessionStart` (`startup`, `resume`, `clear`, `compact`) and
  `PreCompact` (`manual`, `auto`), `PreToolUse` (`Bash|PowerShell`, filtered to `git *`; the git-rule watcher), and `PostToolUse` (`Edit|Write|NotebookEdit`), `PostToolUseFailure` (`Bash|PowerShell`, the stuck-streak line, off by default), `UserPromptSubmit` and `SessionEnd` (the recall hook). Input: Claude Code's JSON payload on
  stdin. The fields read are `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `source`
  and `trigger`; for a finished subagent also `agent_type`, `agent_id` and
  `agent_transcript_path`; for the git-rule watcher `tool_input.command` and
  `tool_use_id`; for the recall hook `tool_name`, `tool_input.file_path` or
  `notebook_path`, `prompt`, `reason` and `agent_id`; for the stuck-streak line `tool_input.command`, `error` and
  `is_interrupt`. Output: the briefing as text (SessionStart, up to 9,500
  characters), a reminder as `additionalContext` JSON (Stop), the recall hook's notes as
  `additionalContext` JSON (PostToolUse, UserPromptSubmit), and the gate's
  request to wait (PreCompact, exit status 2). Any other failure exits 0.
- **Transcripts**: Claude Code's JSONL files in `~/.claude/projects`, read
  only ([What it reads](../PRIVACY.md#what-it-reads)).
- **Notes and bookkeeping files**: read and written in `~/.claude/projects`
  only ([Where things live](how-it-works.md#where-things-live)).
- **Environment**: thirteen variables, by name: `PROJECT_MEMORY_BRIEFING`, `PROJECT_MEMORY_TIMING` and `PROJECT_MEMORY_RECALL` (the plugin's own)
  and ten that Claude Code reads too, plus `HOME` or `USERPROFILE` to find
  `~/.claude`. `DISABLE_COMPACT` and `ANTHROPIC_MODEL` are read only to
  decide whether the context-size setting counts, and are never saved
  ([What it reads](../PRIVACY.md#what-it-reads)).
- **git**: the `git` program, run without a shell, on the snapshot
  repository at `~/.claude/projects/.git`, which has no remote; and the
  `.git` folder or file of the folder a conversation starts in, read to
  find its repository ([Snapshots](how-it-works.md#snapshots)). At a startup the briefing
  also runs `git status --porcelain=v2 --branch` and `git diff --shortstat HEAD` in that
  folder (without a shell, side by side, 1.5 s each, `GIT_OPTIONAL_LOCKS=0` and
  `core.fsmonitor` off so the repository's own setting starts no program). Only the branch,
  the counts and up to five file names are kept, passed through `fit()` (tags defused, secrets
  replaced, 300 characters); a failure or a timeout is no line. A file name is text a
  repository's author chose, so it is as untrusted as a note's text, and bounded the same way.
- **The memory tool**: its commands and options
  ([The memory tool from a terminal](how-it-works.md#the-memory-tool-from-a-terminal)),
  run by the skill or by hand; it exits 1 when a command is refused or
  fails.
- **The journal page**: `memory page` writes one HTML file, `project-memory/journal.html`
  in `~/.claude`, mode 0600. Every journal string is untrusted text in an
  HTML file, so it is escaped or written with `textContent`, the file holds
  one style and one script allowed by hash in a Content-Security-Policy
  (`default-src 'none'`, no network), and the tests feed it `<script>`,
  `"><img onerror=`, `</style>` and control characters; `base-uri` and `form-action`
  are `'none'` too. The sweeps and `forget`, `incognito`, `off` and
  `rescan --apply` delete it (and any temporary file a killed write left),
  and say so when they cannot.
- **The session files**: one per conversation in
  `~/.claude/projects/.sessions/<project folder>/`, written by the recall hook
  and read by it and the briefing: changed file paths, the keys of exchanges
  already named, the user's message (secrets replaced, 120 characters) or a
  `quiet` line for a private one, a title, `saw` and `end` lines, and with the
  stuck trigger on `fail` and `stuck` lines (hashes of a command name and an error line, no text)
  ([What it saves](../PRIVACY.md#what-it-saves)).
- **The mistakes cache**: `.mistakes.json` in a project's `memory` folder, mode 0600, written under the
  store's lock by the Stop's background tidy-up (never by the Stop itself) once a day from the last 90
  days of the journal. It holds failed commands cut to a program and subcommand, error lines folded and
  cut to 120 characters, and fixing commands, all passed through the same secret redaction as the journal,
  and file pairs. `recent()` leaves out private and forgotten exchanges, and the sweeps and `forget`,
  `incognito`, `memory off` and `rescan --apply --yes` delete it (and a temp copy a killed build left), and
  say so when they cannot. Only `memory lessons` reads it, to list the recurring errors past their startups.
- **The replay** (`memory lessons replay`, run by hand): reads the journal through `recent()`, which leaves
  out private and forgotten exchanges and conversations marked private, and the lesson notes with no cache
  write. It prints counts; request text only with `--show`, clipped to 120 characters and through the secret
  filter, to the terminal. The one thing it writes is a line of numbers (no name, request, file or command)
  to `.replay-history` in the project's `memory` folder, mode 0600, cut at 64 KB. A lesson newer than an
  exchange is never counted for it: the cut throws instead of counting a leak.
  say so when they cannot. The startup briefing reads it for the errors that keep coming back
  (the `recurring` trigger) and prints at most two, each held to 240 characters.
- **The lesson counters**: `.lessons.json` in a store, mode 0600, written by the startup briefing
  under the store's lock and `replaceIfUnchanged`: note names and error ids with counts and a
  `told` flag, no text. A dry run (`memory preview`) writes nothing.
- **Claude Code's plugin lists**, in `~/.claude/plugins`, read only by
  `doctor`.
- **Switches**: `.project-off` (a marker in one project's `memory` folder),
  `.off-periods` (the times that project was off) and `.private-sessions`
  (the conversations marked private). All are plain files in
  `~/.claude/projects`, and the hooks read them. Only the memory tool writes
  the first two. Incognito adds to `.private-sessions`, and so does the Stop
  hook when a conversation asks to be private
  ([Turning it off](how-it-works.md#turning-it-off)).
- **The network**: none.

## Trust boundaries

1. **Claude Code to the hooks.** The payload comes from Claude Code, but the
   transcripts it points to hold text from anywhere: the user's messages,
   Claude's replies, and tool output such as web pages and files Claude
   read. All of it is treated as untrusted text: recorded, never run.
2. **The hooks to the disk.** Everything is written in `~/.claude/projects`,
   which other processes write too.
3. **The hooks to Claude.** The briefing puts saved text back into a new
   conversation, and the recall hook into the current one, where Claude
   reads it like anything else.
4. **GitHub to the user's computer.** The plugin's code runs in every
   conversation of everyone who installs it.

## Threats and what guards against them

### Secrets saved to disk

Likely: people paste keys and passwords into conversations, and commands
Claude runs can hold them. Impact: a secret in a plain file, and in the
history.

- Before anything is saved or printed, `redact()` replaces the secrets it
  knows with `[redacted]`: the keys and tokens of many services, private key
  blocks, passwords in web addresses and on command lines, values after
  names such as `password=`, passwords typed in chat in several languages,
  cookies and session ids, and look-alike spellings of these
  ([The handoff](how-it-works.md#the-handoff)). Handoff text is cut to 64 KB
  first. The journal cleans a reply whole and then caps it; a request over
  200,000 characters is cut to that length first.
- A note that holds a secret is kept out of the snapshots, and `promote`
  refuses it. On Linux and macOS the files are private to the user (mode
  0600, folders 0700).
- `<private>` keeps text out, and `<private-session>` a whole conversation,
  in any letter case and in the other forms
  [The handoff](how-it-works.md#the-handoff) lists.
- `forget` removes journal entries, and names the finished days the
  history still holds.
- The tests and the fuzzer (run by hand) send secrets in every shape `redact()` knows, and
  check that none is written, briefed or printed.

What remains: no list of patterns finds every secret. The README and
PRIVACY.md say so, and point to the tags. Only secrets are removed: email
addresses, phone, card and ID numbers stay as typed, so put such text in
`<private>`. `rescan --apply --yes` first makes a backup folder in
`~/.claude` that still holds the old secrets until the user deletes it.

### Private text leaking

Likely if a rule is wrong. Impact: text the user marked private ends up in
the journal, the handoff, a briefing, a search hit or the history.

- A `<private-session>` mark found late, by the journal's import or a later
  read, removes what was saved of that conversation, from every day's file
  and from `handoff.md`. Its tag is kept so it is never taken in again.
- `handoff.md` is never committed; the snapshot repository has no remote
  and is never pushed.
- A temp copy a killed save left (`<file>.tmp<pid>`) is removed by the next
  Stop and by `forget`, once its process is gone or it is 30 s old.
- A search hit never names a transcript, and `show` of a private entry
  doesn't name its transcript, which still holds the private part.
- The startup briefing never shows the words of a conversation marked
  private, even while `handoff.md` still holds them (its removal failed);
  a private list it can't read hides every conversation. The exchanges it
  lists leave out one listed in `journal/.forgotten`, and every one of a
  conversation held with auto memory off; a list of either it can't read
  lists none. `search`, `show` and a day's listing leave out an entry
  listed in `journal/.forgotten` that a day file still holds, and every
  entry of a store whose list can't be read.
- The fuzzer checks after every round that no private or forgotten text is
  written, briefed or printed.

What remains: Claude still sees private text, Claude Code keeps it in its
own transcripts, and a finished day already in the history stays there
until the user deletes the history.

### Notes about the past and other sessions

Likely: the recall hook shows saved text in a conversation on its own, and
one session's words in another. Impact: a private or forgotten exchange
shown again, or text from a transcript read as an instruction.

- The hook asks `privacy.mjs` the same questions the journal does: it never
  names a `[private]` entry, a forgotten one or a private conversation's,
  and a list it cannot read counts as private. A `<private>` block or the
  `<private-session>` mark writes only a `quiet` line, with no text, and
  nothing is shown to another session from a private conversation or turn.
- A note carries an exchange's request (and for a request of under three
  words, the start of its answer), each clipped to 100 characters, file
  names and a key, all passed through the secret filter; never a command.
  At most three per message or between two messages, each once per
  conversation.
- Every look-up has a 400 ms budget and a 5-second limit; any failure exits
  0 with nothing printed. `PROJECT_MEMORY_RECALL=0` turns it all off.
- The session files are deleted after 7 days and by `forget`, `off`,
  `incognito` and `rescan --apply --yes`. So is the mistakes cache, which
  is rebuilt from the journal once a day. `.replay-history` holds numbers
  only, so no forget has to reach it.
- The recall helper's instruction lists four read-only commands. That is an
  instruction, not a lock: a plugin's agent cannot limit Bash to one
  command.

What remains: a note already shown stays in that conversation, and `forget`
cannot take it back. A request line is text from a past conversation and can
hold words written to steer Claude, as the briefing can.

### Saving what the user turned off

Likely if a check is missed. Impact: text from a project the user turned off,
or a conversation they made incognito, is written anyway.

- `.project-off` is read first in the Stop and PreCompact hooks, before
  anything is read or written. A marker that can't be examined counts as off,
  so a failure never reads as on. The startup prints one line saying memory is
  off, and the snapshot leaves that store out by a git pathspec.
- `memory on` records the time it was off in `.off-periods` before it removes
  the marker, and says `NOT applied` and keeps the marker if either step
  fails. The handoff and the journal skip a turn asked inside a period
  (`wasOff` in `store.mjs`), because a transcript runs on while the marker is
  there and its turns are read later. A turn whose time won't parse is kept.
- Incognito adds the conversation's tag to `.private-sessions` and sweeps the
  journal and `handoff.md` for it under the store's lock (`takeBack`). If the
  sweep fails the tag stays, the next Stop retries, and the command says so.
- The tests turn a project off and on and check that nothing from the off
  turns is written, briefed or printed, and that incognito's sweep leaves
  nothing of the conversation.

What remains: off stops adding; it doesn't hide, so `search`, `show` and
`--all` still read what was saved before. What incognito swept is gone, but a
finished day already in the history keeps a copy, and Claude Code keeps its
own transcript and may still save auto-memory notes. Incognito holds across a
resume; `/clear` starts a new conversation, which is not incognito. A user
or process that can edit these files can turn the switches off, as in
[Out of scope](#out-of-scope).

### Another process writing

Likely: two windows on one project, and Claude editing a note while a hook
runs. Impact: a note or the journal loses lines.

- Each store has a lock that only one process can take; a hook waits up to
  2 seconds for its locks in all, then skips this reply and catches up
  after the next. A lock
  left by a killed process is taken over after 30 seconds.
- Every write goes through `replaceIfUnchanged` (`store.mjs`): it checks the
  file still holds what was read, so Claude's edit is kept and the hook tries
  again later.
- The fuzzer runs two Stops at once, kills Stops part way, and makes disk
  calls fail (`tools/fuzz-faults.cjs`); `test/memory-tier.break.mjs` breaks a store in
  13 ways, plus one control run with nothing broken. Each checks that no line is lost.

What remains: a folder synced between computers can undo a `forget`; the
README warns against syncing it.

### A malicious transcript

Possible: a web page or file Claude reads can hold text written to attack
whatever reads the transcript. Impact: a write outside the store, a command
run, or instructions placed in a later briefing.

- Nothing from a transcript is run. git is run as a program with an
  argument list, never through a shell, with its own settings forced: no
  hooks, no signing, and literal path names in the tool.
- The hooks write only in `~/.claude/projects`. A project folder is made
  only for a transcript inside it (`inProjects`), never from a payload's
  `cwd` alone; `--store` refuses a folder outside it. A worktree's `.git`
  file is followed only when the main repository names it back.
- Broken lines, half-written lines, odd encodings and huge replies are
  read without failing; the fuzzer sends all of them. Text saved in
  `handoff.md` is cut to fixed sizes; a journal reply keeps its last 50,000
  characters and a request its first 50,000, a command at 20,000 and
  a turn's commands at 50,000. The briefing is held to 9,500 characters, and the last
  conversation's exchanges at startup to a briefing of 3,500 (at most five, each a headline with 160 characters of its answer, and a reserve of 1,000 for them when the shared lessons fill it).

What remains: text saved from one conversation is shown to Claude in a
later one, as with Claude Code's own memory. The briefing holds only the
start of recent messages and replies, and the journal is read only when
searched.

### Claude tricked into a destructive command

Possible: text in a conversation may push Claude to run `forget --yes` or
`restore --force`. Impact: journal entries or a note lost.

- `forget` without `--yes` only lists what would go; the skill tells Claude
  to show the list and run `--yes` only on what the user confirms. Claude
  Code asks before running a command unless the user allowed it.
- `restore --force` keeps the replaced text in the repository and prints
  how to see it. A deleted note's versions stay in the history.

What remains: a user who allows every command lets Claude run these
without asking.

### A hook breaking Claude Code

Likely, from a bug or a full disk. Impact: a blocked or slow session.

- A hook that fails exits 0 and reports the problem in the next briefing.
  git calls time out (30 seconds in the hooks), and busy stores are waited
  on for 2 seconds at most in all, however many locks a hook takes.
- A history's first snapshot is taken in parts of 1,000 files, so it fits
  that time on a large store. A git stopped at its timeout touches no note
  (git only reads them), and the next replies go on in parts.

The git-rule watcher (`enforce-hook.mjs`, PreToolUse) fails open: one try/catch, exit 0, no output, a 5-second timeout that lets the call go on. It never prints a decision (allow, ask, deny) and never exits 2, so it cannot block or change a call. It writes only `.enforce-log` (note name, session tag, agent type, tool-call id; no command text, so nothing private) and `.enforce.json` (a cache of the rules, and, since 1.7.0, of each lesson note: its clipped name and description and the paths and words it names, text that was already in the note), both inside the store. `memory enforce replay` is a separate, manual command: it reads git commands (Bash and PowerShell) from this project's conversation records, or every project's with `--all`, for the last 30 days, and prints them clipped to 160 characters with secrets replaced. It skips private conversations and projects with memory off, and prints only to the terminal. The log is appended without a lock, so a line can be lost under heavy parallel use, and it stops growing at 256 KB. Conversations marked private, and projects with memory off, are skipped. A tag list that cannot be read counts as private.

### The plugin's supply chain

Unlikely, high impact: code pushed to this repository runs on every user's
computer with their rights.

- The maintainer's GitHub account uses two-factor sign-in.
- Every change reaches `master` through a pull request that must pass the
  tests and the sign-off check. Nobody can push to `master` or bypass the ruleset
  ([GOVERNANCE.md](../GOVERNANCE.md)).
- The plugin has no dependencies, so no third-party code ships. The CI's
  actions are pinned by commit SHA and updated by Dependabot.
- Secret scanning and push protection are on, and the project keeps no
  secrets for an attacker to steal from CI. Pull requests run with a
  read-only token and no secrets.
- From 1.2.4, release archives carry a signed attestation and hashes, with
  how to check them in [SECURITY.md](../SECURITY.md#verifying-a-release).

What remains: Claude Code installs from the repository with git over HTTPS,
not from the attested archives, so a `/plugin` install trusts GitHub and the
maintainer's account. With one maintainer, no second person reviews a
change.

## Out of scope

Someone who can already read or write the user's files, as that user, can
read `~/.claude` anyway. The notes, the journal and the history are plain
files protected only by the computer's account permissions; they are not
encrypted. What Claude Code sends to Anthropic is Claude Code's.

## How this stays true

- Eight test suites run on every pull request and every push to `master`, on
  Linux, macOS and Windows; before each release the changes get one code
  review ([CONTRIBUTING.md](../CONTRIBUTING.md#tests)).
- CodeQL scans the code and the workflows every week
  ([SECURITY.md](../SECURITY.md#code-scanning)).
- This page is reviewed at each release, and updated with any change to
  what the plugin reads, saves or sends.
