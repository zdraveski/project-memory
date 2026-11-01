# Security assessment

What could go wrong with project-memory, how likely and how bad it would be,
and what in the code and the tests guards against it. It covers version
1.2.4 and the project around it, and was written in November 2026. A change
that reads, saves or sends anything new updates this page, as
[CONTRIBUTING.md](../CONTRIBUTING.md#sending-a-change) says. The facts here
come from [PRIVACY.md](../PRIVACY.md) and [How it works](how-it-works.md),
which have the details.

## What it is

A Claude Code plugin: three hook scripts that Claude Code runs on its own
events, and a command-line tool that its skill runs. It is plain JavaScript
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
| The SessionStart hook (`handoff-log.mjs --print`) | Prints the startup briefing. |
| The compaction gate (`compact-gate.mjs`) | Before an automatic compaction: may ask Claude Code to wait for the turn to end, or writes a note of the work in progress. |
| The memory tool (`memory.mjs`) | `search`, `show`, `forget`, `status`, `history`, `restore`, `promote`, `doctor` ([commands](how-it-works.md#the-memory-tool-from-a-terminal)). |
| git | Run by the hooks and the tool, as a program, for the snapshot repository. |
| Other processes | Another Claude Code window on the same project, Claude's own edits, a virus scanner or a sync tool holding a file. |
| The maintainer and GitHub | Write, review and release the code; GitHub hosts it, runs CI and serves it to Claude Code's `/plugin`. |

## External interfaces

- **Hook events**, declared in [`hooks/hooks.json`](../hooks/hooks.json):
  `Stop`, `SessionStart` (`startup`, `resume`, `clear`, `compact`) and
  `PreCompact` (`manual`, `auto`). Input: Claude Code's JSON payload on
  stdin. The fields read are `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `source`
  and `trigger`. Output: the briefing as text (SessionStart, up to 9,500
  characters), a reminder as `additionalContext` JSON (Stop), and the gate's
  request to wait (PreCompact, exit status 2). Any other failure exits 0.
- **Transcripts**: Claude Code's JSONL files in `~/.claude/projects`, read
  only ([What it reads](../PRIVACY.md#what-it-reads)).
- **Notes and bookkeeping files**: read and written in `~/.claude/projects`
  only ([Where things live](how-it-works.md#where-things-live)).
- **Environment**: seven variables, by name, the ones Claude Code reads
  ([What it reads](../PRIVACY.md#what-it-reads)).
- **git**: the `git` program, run without a shell, on the snapshot
  repository at `~/.claude/projects/.git`, which has no remote; and the
  `.git` folder or file of the folder a conversation starts in, read to
  find its repository ([Snapshots](how-it-works.md#snapshots)).
- **The memory tool**: its commands and options
  ([The memory tool from a terminal](how-it-works.md#the-memory-tool-from-a-terminal)),
  run by the skill or by hand; it exits 1 when a command is refused or
  fails.
- **Claude Code's plugin lists**, in `~/.claude/plugins`, read only by
  `doctor`.
- **The network**: none.

## Trust boundaries

1. **Claude Code to the hooks.** The payload comes from Claude Code, but the
   transcripts it points to hold text from anywhere: the user's messages,
   Claude's replies, and tool output such as web pages and files Claude
   read. All of it is treated as untrusted text: recorded, never run.
2. **The hooks to the disk.** Everything is written in `~/.claude/projects`,
   which other processes write too.
3. **The hooks to Claude.** The briefing puts saved text back into a new
   conversation, where Claude reads it like anything else.
4. **GitHub to the user's computer.** The plugin's code runs in every
   conversation of everyone who installs it.

## Threats and what guards against them

### Secrets saved to disk

Likely: people paste keys and passwords into conversations, and commands
Claude runs can hold them. Impact: a secret in a plain file, and in the
history.

- Before anything is saved or printed, `redact()` replaces the secrets it
  knows with `[redacted]`: dozens of key and token prefixes, private key
  blocks, passwords in web addresses and on command lines, and values after
  names such as `password=` ([The handoff](how-it-works.md#the-handoff)).
- `<private>` keeps text out, and `<private-session>` a whole conversation,
  in any letter case and in the other forms
  [The handoff](how-it-works.md#the-handoff) lists.
- `forget` removes journal entries, and names the finished days the
  history still holds.
- The tests and the fuzzer send secrets in every shape `redact()` knows, and
  check that none is written, briefed or printed.

What remains: no list of patterns finds every secret. The README and
PRIVACY.md say so, and point to the tags.

### Private text leaking

Likely if a rule is wrong. Impact: text the user marked private ends up in
the journal, the handoff, a briefing, a search hit or the history.

- A `<private-session>` mark found late, by the journal's import or a later
  read, removes what was saved of that conversation, from every day's file
  and from `handoff.md`. Its tag is kept so it is never taken in again.
- `handoff.md` is never committed; the snapshot repository has no remote
  and is never pushed.
- A search hit never names a transcript, and `show` of a private entry
  doesn't name its transcript, which still holds the private part.
- The startup briefing leaves out a conversation marked private, and from
  the exchanges it lists one listed in `journal/.forgotten`, even while
  `handoff.md` still holds it (its removal failed); a private list it can't
  read hides every conversation. `search`, `show` and a day's listing leave
  out an entry listed in `journal/.forgotten` that a day file still holds.
- The fuzzer checks after every round that no private or forgotten text is
  written, briefed or printed. Mutation testing checks that the tests catch
  each rule broken.

What remains: Claude still sees private text, Claude Code keeps it in its
own transcripts, and a finished day already in the history stays there
until the user deletes the history.

### Another process writing

Likely: two windows on one project, and Claude editing a note while a hook
runs. Impact: a note or the journal loses lines.

- Each store has a lock that only one process can take; a hook waits up to
  2 seconds, then skips this reply and catches up after the next. A lock
  left by a killed process is taken over after 30 seconds.
- Every write goes through `replaceIfUnchanged` (`store.mjs`): it checks the
  file still holds what was read, so Claude's edit is kept and the hook tries
  again later.
- The fuzzer runs two Stops at once, kills Stops part way, and makes disk
  calls fail (`fuzz-faults.cjs`); `memory-tier.break.mjs` breaks a store in
  14 ways. Each checks that no line is lost.

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
  `handoff.md` is cut to fixed sizes; a journal entry is kept whole, a line
  a field. The briefing is held to 9,500 characters, and the last
  conversation's exchanges at startup to a briefing of 4,000.

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
  git calls time out (30 seconds in the hooks), and a busy store is waited
  on for 2 seconds at most.

### The plugin's supply chain

Unlikely, high impact: code pushed to this repository runs on every user's
computer with their rights.

- The maintainer's GitHub account uses two-factor sign-in.
- Every change reaches `master` through a pull request that must pass the
  tests, the sign-off check, dependency review and CodeQL. Nobody can push
  to `master` or bypass the ruleset ([GOVERNANCE.md](../GOVERNANCE.md)).
- The plugin has no dependencies, so no third-party code ships. The CI's
  actions are pinned by commit SHA and updated by Dependabot; dependency
  review checks each change to them.
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

- Six test suites and the fuzzer run on every pull request and every push to
  `master`, on
  Linux, macOS and Windows; mutation testing checks before each release
  that they catch every rule broken ([CONTRIBUTING.md](../CONTRIBUTING.md#tests)).
- CodeQL scans the code and the workflows on every pull request
  ([SECURITY.md](../SECURITY.md#code-scanning)).
- This page is reviewed at each release, and updated with any change to
  what the plugin reads, saves or sends.
