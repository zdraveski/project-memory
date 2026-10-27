# Changelog

## Unreleased

Fixes from a four-way review before the directory listing: hostile input,
security and privacy, the docs against the code, and a new user's first week.

**Privacy**
- The history of your notes no longer keeps the record of your latest
  exchanges (`handoff.md`): it lasts only until newer exchanges replace it, as
  the privacy policy said. Copies an earlier version put in the history stay
  there until you delete the history (see [PRIVACY.md](PRIVACY.md)).
- More secrets are recognized and replaced with `[redacted]`: passwords in web
  addresses, GitLab, npm and Hugging Face tokens, Slack webhooks, Azure account
  keys, `mysql -p…`, "my password is …", and names like `PGPASSWORD=`,
  `dbPassword` and `clientSecret`.
- A `<private>` message's turn no longer records the names of the files it
  changed. `<private-session>` also works inside a slash command's arguments,
  and is remembered for the newest 1,000 conversations, not 50.
- After a compaction, a conversation is shown only its own exchanges, never
  another conversation's.

**Safety**
- Text from an earlier conversation can no longer pose as Claude Code's own
  message in the startup briefing: a tag in it is written `&lt;`.
- The compaction reminder is labelled `[project-memory: …]`, not `[SYSTEM: …]`.
- `--store` only accepts a memory folder inside `~/.claude/projects`, and
  `--rev` only a commit. Before, `promote --store` could delete a file
  anywhere, and `--rev --format=…` wrote git's output into a note.
- If `~/.claude/projects` is a git repository you made, project-memory leaves
  it alone instead of committing into it.
- An index line can no longer point outside its notebook, or at a web page.

**Things that went wrong**
- Snapshots no longer use your own git settings. With commit signing or a
  global hooks folder set, every snapshot failed, and your hooks ran on the
  memory history. Long paths on Windows are saved too.
- Without Git, everything else works quietly, as the README says, instead of
  warning at every start and redoing the whole tidy-up after every reply.
- A git lock that cannot be cleared counts as a failure; it used to read as
  "busy" forever while nothing was saved.
- A prompt that starts with pasted text, or with `<`, is recorded, and so is a
  slash command. Each used to be skipped, and its answer saved under the
  question before.
- With four or more windows on one project, a window's own turn is no longer
  dropped from the record.
- A project gets its record of where you left off from the first reply, not
  only after Claude saves its first note.
- "Another session is working" means a turn is still open in it, so a window
  you just closed (for example to restart after installing) isn't reported as
  working.
- `doctor` no longer reports "ran twice" for a `/compact` typed right after a
  reply, or for the reply to the compaction reminder. "Memory hooks look
  stopped" says that a pause explains it, and doctor no longer tells you to
  run doctor.
- The briefing after a compaction stays within the 10,000 characters Claude
  Code passes on whole, so the shared notes at its end are no longer cut off.
- Notes with the same date no longer swap in and out of the index on every
  pass. File names with brackets (`lesson (1).md`) are reported instead of
  getting a new index line every pass.
- `status` no longer lists every note as "added" in the first week. `restore
  --rev` works with a commit `history` lists as "deleted". Dates of notes are
  no longer shown a day early west of Greenwich. The skill run with no
  arguments shows `status`.
- Hostile input no longer slows the hooks down: a crafted message took 35
  seconds a hook, and a store of 10,000 notes 24 seconds a tidy-up.
- The README, the how-it-works page and the graphics say what the code does:
  the compaction wait needs room set aside, and the history keeps old
  versions, not every version.
- A security policy, [SECURITY.md](SECURITY.md), says how to report a problem
  privately.

## 1.0.7 (2026-10-27)

project-memory now passes the Anthropic plugin directory's checks with no
policy holds. It reads less of your machine to get there:

- `doctor` no longer reads your Claude Code settings file, which can hold
  keys. It checks what is installed (Claude Code's plugin list) and what
  actually ran: the Stop hook now logs each run, and two runs for one reply
  mean project-memory is set up twice. Its messages changed to match: "not
  installed" and "the Stop hook ran twice for one reply".
- The memory tool no longer reads the session id from the environment. The
  skill passes it as `--session`, and an id that isn't one is ignored. Run
  `/reload-plugins` in an open conversation to pick this up.
- Nothing in the repository reads your environment, apart from one setting the
  plugin uses: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. The tests used to copy the
  whole environment for the programs they start.
- The tests build their made-up keys and passwords while they run, so no file
  in the repository looks like it holds a secret.
- The plugin's icon is an SVG file. A PNG icon named in `plugin.json` is an
  image the directory's validator can't read as code.
- `wire.mjs`, the author's switch between the plugin and hook entries in
  `settings.json`, is removed. Nothing in the repository reads
  `settings.json` now.

## 1.0.6 (2026-10-27)

- A private message stays private. A message that starts with `<private>` was
  not counted as a message, so Claude's reply to it was saved as the reply to
  the message before. Now the reply to any message containing `<private>` is
  saved as `[private]`, in the handoff and in the compaction note, since a
  reply often repeats what it was told.
- `<private-session>` keeps a whole conversation out of the handoff. What it
  saved earlier is removed, and no compaction note is written for it.
- `superseded-by: <note>.md` in a note's frontmatter moves it to the archive,
  even when it's pinned, and `search` names the note that replaced it.
- `status` lists the notes added, changed or deleted in the last 7 days.
- More secrets are recognised: names that end in `PASSWORD`, `SECRET` or
  `API_KEY` (as in a `.env` file), Stripe keys, a password on the line after
  its label, lowercase `bearer`, and PGP private key blocks.
- A message that starts with a tag Claude Code added, such as an IDE's note of
  the open file, is recorded, without the tag. Before, it was skipped, and
  Claude's reply to it was saved as the reply to the message before.
- Fixed: a message cut in the middle of an emoji was saved again after every
  reply; `superseded-by:` with no value read the next line as its value, and a
  note's body could archive it; `status` left out notes with accented names;
  `doctor` run from a terminal said "waiting" even when the hooks had stopped.
- The README is honest about what Claude Code now does on its own, describes
  memory-toolkit and MemPalace, says how to open your notes, and puts the
  install steps before the comparison.

## 1.0.5 (2026-10-27)

- Secrets stay out of what the plugin saves. Keys, tokens and passwords pasted
  into a message are replaced with `[redacted]`, and anything between
  `<private>` and `</private>` is left out, in the handoff, the startup
  briefing and the compaction note.
- Each handoff entry names the files Claude changed in that turn.
- The README compares project-memory with five other memory tools, and gains
  a quick start, updating and pausing instructions, and a longer glossary.

## 1.0.4 (2026-10-27)

- Nothing in the plugin runs the `claude` command any more. The author's
  `wire.mjs` prints the install or uninstall command to run instead of running
  it, and `deploy.mjs` no longer validates or updates the plugin with it.
- The snapshot no longer hands git a copy of your environment.
- A privacy policy, and the directory's listing fields: icon, documentation,
  support and privacy policy links.
- The README explains the context window and auto-compaction, and how the
  plugin protects your work before, during and after one.

## 1.0.3 (2026-10-27)

- A short demo at the top of the README, replaying three real conversations
- The README explains what you get, who it's for, and a week with the plugin
- A display name, "Project Memory", and a plain-language description for the
  plugin directory

## 1.0.2 (2026-10-27)

- `doctor` no longer reports a problem right after you install. Until Claude
  finishes its first reply, it says it's waiting. It reports a problem only
  when a reply finished over a minute ago and nothing was saved.
- The README is a plain-language guide. The technical details are in
  `docs/how-it-works.md`, and tests and releasing in `CONTRIBUTING.md`.

## 1.0.1 (2026-10-27)

- A plugin icon, also shown in the README

## 1.0.0 (2026-10-27)

First public release.

- `MEMORY.md` tiered under a 7,000-byte budget, with an archive that stays searchable
- A rolling handoff of each session's last ten exchanges, and a startup briefing
- Mid-turn compactions deferred to the turn boundary, a memory nudge before
  one, and what a cut turn had in flight given back after
- Git snapshots of every memory change, with `history` and `restore`
- A shared store for lessons that hold in every project, and `promote`
- Ranked `search`, `status` and `doctor`, through the `memory` skill
- Safe with parallel sessions: a lock per store and compare-and-swap writes
