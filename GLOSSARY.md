# Glossary

The words this project uses for its own ideas. Code, docs and reviews use these
names. Decisions that must not be undone are in `docs/adr/`.

## Reading a conversation

**Transcript**: the JSONL file Claude Code writes for one conversation, one
record a line. The plugin only reads it. `src/transcript.mjs` is the one module
that reads it (1.6.0 step 15).

**Record**: one line of a transcript, parsed. A helper's (subagent's) records
are left out everywhere except where a caller asks for them.

**Turn**: what the user asked and everything up to Claude's reply, built from
records: the ask, the reply, the commands run, the files changed, and whether it
is a private turn.

**Exchange**: a turn as the journal keeps it, one entry with a key. Search,
`show` and `forget` work on exchanges.

## Not saving or showing

**Private turn**: a turn whose typed text holds `<private>`. Its words are never
written; the journal and the handoff show `[private]`.

**Private conversation**: a conversation the user made incognito (the
`incognito` command, listed in the store's `.private-sessions`), or one whose
typed text holds `<private-session>`. Nothing of it is saved from then on.

**Typed mark**: a `<private-session>` the user typed, queued while Claude worked,
or gave as an answer to Claude's question, in any spelling. One only quoted (a
tool's output, a task's end) or in a compaction summary is none. Read in one
place, `typedMark` / `markFrom` in `transcript.mjs`, by the git-rule hook, the
compaction gate and the journal alike.

**Switched off**: memory not saving at all, at one of three reaches: one
conversation (`.memory-off` in the projects root), the project (`.project-off`
in the store, from `memory off`), or Claude Code's own auto memory setting
(`autoMemoryEnabled`, which is Claude Code's switch, not the plugin's).

**Off period**: a stretch of time the project was switched off, one
`<from ms> <to ms>` line in `.off-periods`, added by `memory on`. A turn asked
inside one is never written, even when its Stop comes later.

**Forgotten exchange**: an exchange the user removed with `forget`. Listed in
`journal/.forgotten` so a later Stop or import does not bring it back.

**Quiet conversation**: a private conversation or one switched off on its own
(`.private-sessions` in its store or `.memory-off` in the projects root):
`isQuiet()`.

**Gate**: the question a hook asks before it does anything for a conversation,
`gate()`: auto memory off, then the project switched off, then a quiet
conversation. It answers why to do nothing, or nothing, and the store.

The privacy module (`src/privacy.mjs`, 1.6.0 step 15) decides all of these,
writes their marker files (`memory off` and `on`, the forget list), and a file
it cannot read counts as private. See `docs/adr/0001-privacy-decided-in-one-module.md`.

**Secret detector**: `src/secrets.mjs`, the one place that knows what a key, token
or password looks like. `redact()` replaces one with `[redacted]` and a
`<private>` span with `[private]`; `holdsSecret()` says whether a note holds one;
`BARE()` says whether a typed answer to a question that asks for one is one. It
imports nothing, so `store.mjs` and every writer can use it.

## The index

**Index**: `MEMORY.md` and its archive, `MEMORY-archive.md`: one pointer line
(`- [Title](file.md) — hook`) per memory, a hook maybe wrapped onto indented
lines under it. `src/store.mjs` holds the format once: `POINTER`,
`pointerLine`, `indexLines` (BOM off), `eolOf` (each file keeps its own line
endings), `wraps`, the archive line (`archiveLine`, `emptyArchive`) and the
overflow mark. Tiering, restore, promote and the briefing read and write
through these, never their own copies.

**Overflow mark**: what tiering's byte ceiling adds to a line it evicts
(`mark`), so the line comes back when there is room; `unmark` takes it off with
only the one space it was added with.

## Snapshots

**Projects root**: `~/.claude/projects` (or under `CLAUDE_CONFIG_DIR`), the
folder that holds every project's store. It holds the snapshot repo.

**Snapshot**: a git commit of the memories in every store, taken in the
background after a Stop. It leaves out `handoff.md` and the journal.

**Snapshot health**: `.snapshot-health` in the projects root. It records the
last good snapshot, failures in a row, whether a snapshot is owed, and the held
notes and missed stores. Doctor, status and the startup line report it.

**Held note**: a note left out of the snapshots because it, or its name, looks
like it holds a key, token or password. Once the secret is removed, the next
snapshot takes it.

**Missed store**: a store that git cannot snapshot because it is reached
through a link to a folder outside the projects root.

**Purge**: rewriting the snapshot history so that whole days are dropped from
it (`forget --purge`), or so that secrets are replaced with `[redacted]`
(`rescan --apply`).

**Kept copy**: the text a `restore --force` replaced, kept in the snapshot repo
under `refs/project-memory/replaced/<id>` so no restore loses it. `rescan`
scrubs kept copies too.

**History questions**: what the CLI asks of the snapshots, in note terms:
`versionsOf` (the snapshots that changed a note), `changedLately` (the week's
changes for status), `dropDays` (forget --purge), `scanHistory` and
`scrubHistory` (rescan, with the CLI's own scrub function), `keptCopies` and
`keepReplaced`, `leftoverPurges` (doctor) and `isOurs`. `src/snapshot.mjs`
answers them, so git's log and fast-export formats, the first snapshot's
message and the purge's temporary copy are known there alone.

## Run records

**Run record**: a small status file the hooks write and doctor, status and the
startup line read. `src/run-records.mjs` (1.6.0 step 17) reads and writes all of
them. A missing record is "none"; one that exists but cannot be read or parsed
is "damaged".

**Stop record**: `.stop-ran` in the projects root. It holds one line per Stop
hook run, which is how doctor and the startup line tell whether saving still
runs.

**Failure record**: a note that a handoff or journal write failed:
`.handoff-failed-<project folder>` and `.journal-failed-<project folder>` in the
projects root, and `journal/.failed` in the store.

**Store health**: `.health` in a store. It holds the problems the last tiering
pass found, one per line, and is deleted when there are none.

**Deploy record**: `.deployed.json` in a copy made by `tools/deploy.mjs`. It
holds the commit, the tag and each file's size and time, so a file changed
after the deploy is named.

**Shipped files**: what the plugin is made of: every `src/*.mjs`, every file
under `.claude-plugin`, `hooks`, `commands`, `skills` and `agents`, and
`LICENSE`. `pluginFiles()` in `tools/suites.mjs` reads them from the folders;
the deploy copies them, `tools/mutate.mjs` copies them beside a mutant, and
`tools/check.mjs` checks they are what the release archive keeps.

## Starting a conversation

**Briefing**: the text the plugin prints when a conversation starts, resumes,
is cleared or compacts: the handoff's last exchanges, the journal line, the
health notes and the compaction note, cut to the size limits. `src/briefing.mjs`
builds it (1.6.0 step 18); `src/brief.mjs` is only the guard that runs it. See
`docs/adr/0003-no-import-loops-in-src.md`.

**Safe printing**: cutting, clearing and fitting text so it is safe to print: `clip`,
`cut`, `plain`, `defuse` and `fit`. `src/text.mjs` (1.6.0 step 15) holds them. It
imports only the secret detector, so a hook can print without loading the
briefing.

`src/snapshot.mjs` (1.6.0 step 16) runs every git call against the projects
root. See `docs/adr/0002-plugin-owns-git-cleanup-and-one-busy-rule.md`.

## The memory command

**Option**: a `--word` the memory command knows. `OPTIONS` in `src/memory.mjs`
declares each once, and whether it takes the next word as its value; `TAKES`
says which commands take it. `parseArgs` reads the words with both before any
store is touched, and gives back the command or the refusal to print. USAGE and
the `argument-hint` in `skills/memory/SKILL.md` are written by hand, apart.
