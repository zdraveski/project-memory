# Changelog

## 1.2.2 (2026-10-30)

Five fixes from a bug hunt: reviews of the code, and a new fuzz test that
sends thousands of random, hostile conversations through the plugin.

**Privacy**
- If a conversation was compacted while Claude was carrying out a `forget`,
  the compaction note quoted what was being forgotten, both in the handoff
  and in the briefing after the compaction. It now says `[private]`.
- `/memory --shared forget <words>` is now recognised as a forget. That
  covers an option before `forget`, quoted the way the memory skill quotes
  what you type. Before, the exchange was saved whole, the forgotten words
  with it. A negative number after an option (`--limit -5`) no longer hides
  a forget either.

**The handoff**
- After your computer's time zone changes, a long conversation lists each
  exchange once, and the newest stays. Before, each was listed twice and the
  newest could drop out.
- An exchange you forgot, listed under another time zone's clock, now leaves
  the handoff too.
- After you forget an exchange and the time zone changes, another exchange
  no longer disappears from the handoff just because its time reads the same
  on the new clock.

**Notes**
- A note saved with Windows line endings keeps its whole description in
  `status`, search and the index, not just its first line.

For contributors: a quick check for every edit (`check.mjs`); a fuzz test
with a 17-machine GitHub workflow; the mutation check on every push; and the
CLI's tests run in-process, about 40% faster.

## 1.2.1 (2026-10-30)

Fixes from three reviews of the code, and a README that reads on a phone.

**Privacy**
- Asking Claude to forget something through the memory skill now keeps that
  exchange out of the record. The skill puts quotes around the words you
  type, and only a bare `forget` was recognised, so the exchange was saved
  whole.
- An exchange you had forgotten no longer comes back into the handoff after
  your computer's time zone changes, or when Windows spells the project's
  folder in another case.
- The handoff, the journal and the compaction note now decide what is
  private the same way. A `<private>` tag inside some reminder tags hid an
  answer in one and kept it in another.
- A conversation you mark with `<private-session>` is taken out of the
  journal once. Before, it was swept again after each of the next 25 or so
  replies, which took up to 1.5 seconds each with years of journal.
- The README and the privacy policy now say to keep the memory folder on one
  computer. Synced between two (Dropbox, OneDrive), an exchange you forgot on
  one can come back on the other.

**The handoff**
- After a time-zone change, such as a flight, the last exchanges are listed
  once each and the newest stays. Before, each was listed twice, and the
  newest could drop out for hours.
- The reply after one that ran `forget` no longer reads a long conversation
  up to four times over.
- The startup briefing names a journal that keeps failing to save, and gives
  the last good snapshot in your local time.

**Search and the memory tool**
- Search no longer shows a broken character where it cut through an emoji.
- `status` and `search` show the description of a note whose header was
  never closed or starts with a BOM.
- A note named like `[draft] plan.md` keeps a working line in the shared
  index when you promote it.
- A `forget` whose words match nothing, and one over a long date range, are
  much faster.
- A note with a very long run of blank lines in its header no longer slows
  every reply (11 seconds for 50,000).
- A disk that fills up mid-write no longer leaves half a copy of the handoff
  or a journal day behind.
- Clearer messages: `--limit ten` is refused with a reason instead of
  ignored, a usage error says what was wrong first, an unknown option points
  to help, `status` no longer lists journal days as notes, and `doctor`
  allows for a reply finished before the install.

**The README**
- A third of the length, with the journal first. Its four pictures are
  drawn to read on a phone, and the old ones and the demo animation are gone.
- The privacy policy says which files to delete only once project-memory is
  gone for good, and what uninstalling leaves behind.

## 1.2.0 "Bastet" (2026-10-29)

**A journal of your work**
- project-memory now keeps a journal of every exchange: after each reply it
  saves your message (up to 2,000 characters), Claude's reply (up to 6,000;
  of a longer one, its first 4,000 and its last 2,000, where it says what
  was done), the files Claude changed (up to 20) and the last 20 commands it
  ran (up to 400 characters each), one file per day in each project's
  notebook. Before, only the last few exchanges were kept, and work Claude
  didn't write a note about was hard to find again.
- Ask about earlier work in your own words, such as "What did we decide
  about the logo in September?" or "What did I work on last week?", and
  Claude searches the journal and answers with the date.
- After each reply, a few at a time, it takes in the project's conversations
  it hasn't read yet that Claude Code still keeps on your computer, however
  long: on a new install, about the last month; after a pause, the
  conversations held while project-memory was off. A worktree kept outside
  its repository's folder has its conversations taken in once Claude has
  finished a reply there.
- `search` looks in the journal too, and takes `--since` and `--until`
  dates. With dates and no words, it lists what you asked on those days. A
  journal hit shows its request and only the lines around your words, so
  ten hits fit in a short answer. A long request asked many times, such as
  a script's prompt, shows once, with how many more and their keys.
  Two-letter words such as CI and PR are found, and so is an entry's
  branch.
- `show <key>` prints one journal entry in full, by the key a search hit
  shows.
- `forget` removes journal entries when you ask: it lists each match with
  its key, and after you confirm, removes exactly those
  (`--key <key> --yes`). It works on one project at a time and names the
  words no entry holds. A forget by dates alone is confirmed by its range,
  so `forget --since 1970-01-01 --yes` empties the journal. The same
  exchanges go from the record of where you left off, so the next briefing
  doesn't show them.
- The journal isn't loaded when a conversation starts. The briefing gets one
  line saying it's there, and `status` shows its size, first day,
  conversations still to import and any failure.
- Each finished day goes into the history of your notes. Today's file stays
  out until the day is over, so the history doesn't keep a copy after every
  reply. A day left with no entries is deleted.
- A day's file stays readable after an editor or a Markdown formatter saves
  it, and a note you write under an entry stays there. A day's file that
  isn't UTF-8 text is left as it is, and `status` names it.
- `--help` prints the memory tool's commands, and an option it doesn't know
  is refused instead of ignored.

**Privacy**
- The journal follows the same rules as the record of where you left off:
  secrets are replaced with `[redacted]`, and `<private>` and
  `<private-session>` keep text out. While auto memory is off, only the
  conversation's short tag is saved, when it starts and after every reply,
  so the journal never takes it in.
- Passwords and tokens Claude passes to a command are replaced with
  `[redacted]` too: after `--password`, `--token` or `--secret`, in
  `az login -p`, `aws configure set`, `htpasswd`, `gh secret set` and an
  npm `_authToken`, and in `export`, `setx` or `SetEnvironmentVariable` of
  a name that says key, secret, token or password. A reference such as
  `$TOKEN`, a file's path and a count stay.
- `<private-session>` keeps a conversation out wherever in it you type the
  mark, however long the conversation is. When it takes in other
  conversations, it leaves out those marked `<private-session>`, even if
  the mark was typed while project-memory was off, and those held while
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY` was set. A conversation held with auto
  memory off while this version wasn't installed and on has no tag, and is
  taken in.
- A conversation marked private or held with auto memory off after the
  journal took it in loses its entries at the journal's next look, even
  with no reply of its own after the mark.
- An exchange in which Claude runs `forget` is kept without its words, in
  the journal and in the record of where you left off, so the list of what
  it removes isn't saved again.
- An entry removed later, by `forget` or by a later `<private-session>`,
  stays in the history for days already over. The privacy policy says how
  to remove it, and what's left behind after you uninstall.

## 1.1.0 "Cronos" (2026-10-28)

Cronos is the hunt for bugs before the directory listing: about 200 were
found and fixed. It began with two four-way reviews. The first: hostile input,
security and privacy, the docs against the code, and a new user's first week.
The second: many windows and killed processes, upgrades and months of use,
Claude Code's own documentation, and a privacy red team. Then came eight hours
of rounds, each from a new angle: real conversations replayed, random input,
linked folders, crashes. A fresh reviewer checked every fix again.

**Works the way Claude Code does**
- A conversation started in a subfolder or a worktree of a git repository
  uses the repository's notebook, as Claude Code's auto memory does. Before,
  it wrote its record to a folder Claude Code never loads.
- While auto memory is turned off with `CLAUDE_CODE_DISABLE_AUTO_MEMORY`, the
  hooks do nothing, and `doctor` says so.
- `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PROJECT_DIR_NAME` are followed, as
  Claude Code takes them. Before, with them set, nothing was saved and nothing
  said why.
- The reminder before a compaction is sent as feedback, so it no longer shows
  as a hook error. It reads the window sizes as Claude Code does: `200k` and
  `1M` work, and `CLAUDE_CODE_MAX_CONTEXT_TOKENS`,
  `CLAUDE_CODE_DISABLE_1M_CONTEXT` and `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` count.
  With `CLAUDE_CODE_MAX_CONTEXT_TOKENS` set (a gateway or a custom model), the
  compaction gate no longer asks to wait past that window.
- Finished background tasks leave the "still running" list. Claude Code now
  reports a task's end in a record the list never read, so after a
  compaction Claude was told not to rerun tasks that had already finished.
- The briefing after a compaction stays within the 10,000 characters Claude
  Code passes on whole, so the shared notes at its end are no longer cut off.
- The startup briefing also stays within the 10,000 characters Claude Code
  passes on whole. `doctor` understands an install from claude.ai.
- The table of contents is held to 200 lines as well as 7,000 bytes, since
  Claude Code loads only its first 200 lines. Many short lines used to pass
  that while under the byte limit.

**Privacy**
- The history of your notes no longer keeps the record of your latest
  exchanges (`handoff.md`): it lasts only until newer exchanges replace it, as
  the privacy policy said. Copies an earlier version put in the history stay
  there until you delete the history (see [PRIVACY.md](PRIVACY.md)).
- More secrets are recognized and replaced with `[redacted]`: passwords in web
  addresses, GitLab, npm and Hugging Face tokens, Slack webhooks, Azure account
  keys, `mysql -p…`, "my password is …" (when it holds a digit or a symbol, as
  a password does), names like `PGPASSWORD=`, `dbPassword`, `clientSecret` and
  `stripeApiKey`, and a `token=` value with letters in it.
- A `<private>` message's turn no longer records the names of the files it
  changed. `<private-session>` also works inside a slash command's arguments,
  and is remembered for the newest 1,000 conversations, not 50.
- After a compaction, a conversation is shown only its own exchanges, never
  another conversation's.
- A private conversation gets no reminder to write notes and no recovery
  note. The reminder had Claude write the private work into `handoff.md`.
- `<private>` and `<private-session>` work in more spellings: self-closed,
  with spaces, fullwidth, with hidden characters, nested, inside another tag,
  never closed, and in a message typed while Claude is working. A prompt that mentions
  `<command-name>` is no longer taken for a slash command, which turned both
  off. An agent's report quoting the tags no longer marks a conversation.
- Over a hundred common secret shapes were tested. Newly recognized: PyPI,
  Stripe webhook, SendGrid, AWS STS, Google OAuth, Groq, xAI, Shopify,
  DigitalOcean, Notion, Atlassian, Vault and Docker tokens, base64 private
  keys, `curl -u`, `--password`, `docker login -p`, `DB_PASS=`, passwords in
  web addresses with no user name, and "the password for … is …". Code that
  only looks like a secret (`password: string`, `jwt.sign(…`, `${VAR}`) is no
  longer cut, nor are "Basic" and "Bearer" in plain prose.
- The compaction note keeps file names, not paths, and a task's output path
  is checked for secrets. A web page Claude read can no longer add a
  "task" with its own instructions to that note.
- An entry from before 1.0.5 whose question was private loses its saved
  answer too.
- Everything the startup briefing and the note after a compaction print is
  checked for secrets, the shared table of contents and the health lines
  included. A key written into one of those was printed as it was.

**Safety**
- Text from an earlier conversation can no longer pose as Claude Code's own
  message in the startup briefing: a tag in it is written `&lt;`.
- The compaction reminder is labelled `[project-memory: …]`, not `[SYSTEM: …]`.
- `--store` only accepts a memory folder inside `~/.claude/projects`, and
  `--rev` only a commit. Before, `promote --store` could delete a file
  anywhere, `--rev --format=…` wrote git's output into a note, and a range
  (`A..B`) wrote an empty one.
- If `~/.claude/projects` is a git repository you made, project-memory leaves
  it alone, its lock included, instead of committing into it.
- `<private>` works in capitals and with attributes too.
- An index line can no longer point outside its notebook, or at a web page.
- Hostile input no longer slows the hooks down: a crafted message took 35
  seconds a hook, and a store of 10,000 notes 24 seconds a tidy-up.
- A security policy, [SECURITY.md](SECURITY.md), says how to report a problem
  privately.

**Things that went wrong**
- A hand-written index line moving back from the archive (a pin, or a line
  that fits again) could be lost if the index changed at that moment. It now
  stays in the archive until the index has it.
- Taking `handoff.md` out of the history is retried until it succeeds. If
  the first try was interrupted, it stayed in every snapshot.
- Stale git locks a killed commit leaves (`HEAD.lock`, a branch's lock) are
  cleared like `index.lock`, and a lock dated in the future no longer reads as
  busy for days. Two windows committing at once no longer count as a failure.
- A note dated ahead of the clock is indexed. Note settings written with
  quotes or capitals (`tier: "hot"`), a `# comment`, a list or a folded
  description is read as YAML reads it; a quoted pin used to age out.
- A turn skipped while another window held the notebook is saved at the next
  turn, even after a very long one. A window still on 1.0.7 no longer
  multiplies entries, and upgrading no longer records old turns twice.
- A line in the archive whose note was deleted no longer warns at every
  start. Merge-conflict markers in the table of contents do.
- Promoting a lesson into a full shared notebook says it may move to the
  archive, and how to keep it in view.
- A record of where you left off that could not be saved (a notebook folder
  that takes no new files) is reported at the next start, not skipped in
  silence.
- Two windows committing or starting the history at the same moment, and a
  restore while another window saves, no longer fail.
- A health warning that names hundreds of files is shortened, so the startup
  briefing keeps the shared lessons after it.
- After the reminder to save notes, the record kept the answer from before
  it until you typed again. In a turn that went on for hours with background
  tasks, every result after the reminder was missing. It now picks up again
  once the notes are saved and the next piece of work starts.
- A compaction summary that mentioned the `<private>` tag stopped the record
  of the rest of that turn, and the compaction note showed Claude's last words
  as `[private]`, with no reminder after it. A summary is Claude Code's recap,
  not your message, and no longer counts.
- `restore` brought back an empty note for a name with `[`, `*` or `?` in
  it (`notes[1].md`), and with `--force` it emptied the note it replaced. git
  read the name as a pattern; `history` listed other notes' changes for the
  same reason. Both read names literally now.
- `restore MEMORY` would not bring back a deleted table of contents while the
  shared notebook had one: it said the file had been promoted, and `history`
  said so too. A table of contents is never promoted.
- `promote ALPHA` on Windows moved `alpha.md` but left its line in the table
  of contents, pointing at nothing. A note is now found by its name on disk:
  in any letter case on Windows and macOS, only as written on Linux.
- A note `restore` or `promote` cannot write (read-only, or a name Windows
  cannot hold) is reported in one line that says what was left, instead of a
  crash.
- The history keeps a note's line endings as written. On Windows, a note
  could come back from `restore` with its line endings changed.
- A damaged git index in the history (after a crash or a full disk) is
  rebuilt from the last snapshot. Before, every snapshot after it failed
  until someone repaired it by hand. A note another window deletes while a
  snapshot reads it is tried once more instead of failing the snapshot.
- The first snapshot is taken before the first tidy-up, so the table of
  contents as you wrote it can come back. Before, the history started with it
  already tidied.
- When two lines in the table of contents point at the same note, the newer
  (lower) one is kept, where the first one was. Keeping the first threw an
  updated line away.
- On Windows, a line written `(Kase.md)` counts as `kase.md`'s line. Before,
  `kase.md` got a second, machine-written line in the archive.
- Snapshots no longer use your own git settings. With commit signing or a
  global hooks folder set, every snapshot failed, and your hooks ran on the
  memory history. Long paths on Windows are saved too.
- Without Git, everything else works quietly, as the README says, instead of
  warning at every start and redoing the whole tidy-up after every reply.
- A git lock that cannot be cleared counts as a failure; it used to read as
  "busy" forever while nothing was saved.
- A prompt that starts with pasted text or with `<`, one that is a single
  element like `<template>`, one of images only, and a slash command are all
  recorded. Each used to be skipped, and its answer saved under the question
  before.
- With four or more windows on one project, a window's own turn is no longer
  dropped from the record.
- A project gets its record of where you left off from the first reply, not
  only after Claude saves its first note.
- "Another session is working" means a turn is still open in it, so a window
  you just closed (for example to restart after installing, or with `/exit`)
  isn't reported as working. `doctor` checks the same windows the startup
  briefing does.
- `doctor` no longer reports "ran twice" for a `/compact` typed right after a
  reply, or for the reply to the compaction reminder. "Memory hooks look
  stopped" says that a pause explains it, and doctor no longer tells you to
  run doctor.
- Notes with the same date no longer swap in and out of the index on every
  pass. File names with brackets (`lesson (1).md`) are reported instead of
  getting a new index line every pass.
- `status` no longer lists every note as "added" in the first week. `restore
  --rev` works with a commit `history` lists as "deleted". Dates of notes are
  no longer shown a day early west of Greenwich. The skill run with no
  arguments shows `status`.
- The README, the how-it-works page and the graphics say what the code does:
  the compaction wait needs room set aside, and the history keeps old
  versions, not every version.
- A sentence in `handoff.md` that quotes the record's two markers no longer
  takes the record's place. Before, the next reply wrote the record into that
  sentence, and the hand-written text between the quoted markers was lost.
- A conversation you stopped with Escape is no longer reported at the next
  start as "another session is working" for half an hour.
- A note's settings are read as YAML reads them. A pin set after a long
  description is seen (the note used to be moved to the archive),
  `superseded-by: null` no longer counts as replaced, and a quoted name or
  description keeps its own quotes.
- `status` and `search` count a table of contents line written in another
  letter case on Windows. `[[note.md]]` and a `[[...]]` inside code are no
  longer listed as links to nothing, and `--store=<folder>` works like
  `--store <folder>`.
- Two windows with replies in the same minute no longer rewrite the record
  after every reply.
- A memory folder, or a project folder, that is a link to a folder
  elsewhere (a synced folder) is in the snapshots once, where git follows
  the link, as it does a junction on Windows; `restore` and `history` work
  through any link to it. Where git does not follow it, `doctor` and the
  startup say the folder is left out, and how to fix it. Before, it was left
  out while `doctor` said ok.
- A conversation started in a subfolder of a repository is recorded from its
  first reply, also when no conversation has started at the repository's
  root yet.

**Going back to 1.0.7**
- It works, with two limits until newer exchanges replace the old ones: some
  turns are listed twice, and 1.0.7 records secrets that 1.1.0 would replace
  with `[redacted]`. 1.0.7 also puts the record of where you left off back in
  the history.

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
