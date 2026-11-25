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

**Switched off**: memory not saving at all, at one of three reaches: one
conversation (`.memory-off` in the projects root), the project (`.project-off`
in the store, from `memory off`), or Claude Code's own auto memory setting
(`autoMemoryEnabled`, which is Claude Code's switch, not the plugin's).

**Off period**: a stretch of time the project was switched off, one
`<from ms> <to ms>` line in `.off-periods`, added by `memory on`. A turn asked
inside one is never written, even when its Stop comes later.

**Forgotten exchange**: an exchange the user removed with `forget`. Listed in
`journal/.forgotten` so a later Stop or import does not bring it back.

The privacy module (`src/privacy.mjs`, 1.6.0 step 15) decides all of these, and
a file it cannot read counts as private. See `docs/adr/0001-privacy-decided-in-one-module.md`.

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

## Starting a conversation

**Briefing**: the text the plugin prints when a conversation starts, resumes,
is cleared or compacts: the handoff's last exchanges, the journal line, the
health notes and the compaction note, cut to the size limits. `src/briefing.mjs`
builds it (1.6.0 step 18); `src/brief.mjs` is only the guard that runs it. See
`docs/adr/0003-no-import-loops-in-src.md`.

`src/snapshot.mjs` (1.6.0 step 16) runs every git call against the projects
root. See `docs/adr/0002-plugin-owns-git-cleanup-and-one-busy-rule.md`.
