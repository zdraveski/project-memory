# Changelog

## Unreleased

- Secrets are now redacted behind look-alike spellings (full-width letters, hidden characters, accents, HTML entities, percent and unicode escapes), in JSON inside strings, in values with commas, semicolons, escaped quotes, braces, line wraps or blank lines, in long quoted values, and behind wrappers such as arrays, CDATA, shell quotes and `-p'..'`; a Cyrillic or Greek look-alike letter is still not caught.

- A very long or hostile prompt, command or answer no longer stalls the memory hooks: a slash command's name, `memory.mjs` options, a JWT-like run, a value with many slashes and a long `SetEnvironmentVariable` value are read in linear time, and saved text is cut to 64 KB before secrets are removed.
- Enforce rules: a rule after a long description is no longer ignored; a note with a long run of blanks can no longer stall every git call; a command with many unclosed heredocs is read in linear time.
- Enforce rules now see a command after an escaped quote, after git options like `--no-optional-locks`, inside `{ }` or `( )`, after a line continuation, after a quoted `<<`, and behind `env`, `sudo`, `command`, `rtk`, `git.exe` or a full path to git.

## 1.4.0 (2026-11-14)

- A new hook watches git commands against the `enforce:` rules in your notes and logs which note matched (`.enforce-log` in the store, no command text). It blocks nothing, prints nothing, and does nothing while memory is off or the conversation is private.
- `memory enforce status`: per rule note, its hits of the last 30 days from the live log (main and sub-agent), bad rules with the reason, and whether the log is full or memory is off. `memory doctor` gets a line that runs the enforce hook of the installed plugin and checks it is wired, even when memory is off.
- `memory enforce replay <note>`: lists what a rule in a note would have caught in the last 30 days of your conversations. Read-only; private sessions and projects with memory off are skipped.

## 1.3.3 (2026-11-14)

- A lock whose owner process is gone is no longer taken over at once (undoes a 1.3.2 change). A hook could take over a lock just as it was being released, and two hooks then worked in a store at once. A killed hook's lock is taken over after 30 seconds again.

## 1.3.2 (2026-11-13)

- `forget` finds text with accents whichever way the accent is stored, as `search` does.
- `forget --conversation ""` is refused, instead of forgetting in every conversation.
- `--store ~/...` works in PowerShell and cmd too.
- `promote` of a folder says it is a folder, instead of printing an error trace.
- `doctor` warns when the `autoMemoryDirectory` setting is set, because the plugin does not follow it.
- `promote` refuses a note that is not UTF-8 text, instead of copying it with broken letters and deleting the original.
- `promote` and `restore` move a long index line that wraps onto a second line as a whole.
- `restore` brings back a note that is not UTF-8 byte for byte, not with broken letters.
- A lock left by a killed hook is taken over at once, not after 30 seconds.
- A Stop that finds the store held waits once more, so twenty Stops at once lose fewer turns.
- The first snapshot works with a very large store (more than about 15,000 notes), where the file list used to overflow git's output buffer.
- `restore --force` keeps the text it replaced under a git ref, so a later `git gc` does not delete it.
- A snapshot that finds files changed after its commit (another session writing at the same moment) keeps the next Stop owing one, so MEMORY.md is not left out of the history.
- The README says MEMORY.md is rewritten in place as a plain file and that `##` headings in it are not kept.
- More secrets are cut before they are saved: SQL passwords (`PASSWORD '…'`, `IDENTIFIED BY`), redis, mongo, zip, ldap and mosquitto passwords, a Telegram bot token inside the API URL, `curl -u user:"pass"`, `--proxy-user`, XML `<password>`, PowerShell `ConvertTo-SecureString` and `$pw =`, `net use`, `schtasks /rp`, a short Basic credential, a URL password with `/`, `?` or `#`, npm `_auth`, more vendor tokens, a `?key=` or `?code=` in a URL, and a password after a full-width colon.
- One very long value after `NAME=` or `--password` no longer slows a Stop down for seconds.
- A session whose first folder is recorded after the first 64 KB of its transcript no longer writes into another project's memory after a `cd`.
- A message you type while Claude is working now opens its own entry in the handoff and the journal. It was lost before.
- Running the `memory` skill no longer freezes the handoff: the answer to your real question is saved.
- A message that starts with your own tag (such as `<my-card>`) or with `[SYSTEM_SERVICE]` is kept as your question, not dropped as an automatic one.
- A turn with no time in the transcript is no longer saved after you had turned memory off.
- One huge request, reply or command no longer fills the journal: each is cut at 20 to 50 KB.
- A transcript too big to find your last request in now leaves a failure note, instead of saving nothing in silence.
- A handoff.md saved with a byte-order mark (BOM) no longer loses the "Last session" line in the briefing.

## 1.3.1 (2026-11-13)

Bug fixes from a five-part audit (correctness, security, Windows/macOS/Linux,
data loss with parallel sessions, test gaps) and the review after it.

**Keeping notes safe**

- A store lock is released only while it is still this session's, and an
  unlock that meets `ENOTEMPTY` is retried.
- `restore --force` replaces nothing when it cannot keep a copy of what it
  replaces.
- A `MEMORY.md` or `handoff.md` that is not UTF-8 (saved by PowerShell 5.1's
  `>` or `Add-Content`) is left as it is, as journal days already were;
  before, it was written back with its accented letters gone.
- `.health` and `.snapshot-health` are written through a temp file, and on
  Windows a rename a scanner holds busy is retried for up to 1 s.

**Tiering**

- A hook wrapped over several lines stays under its pointer, and all its
  lines count toward the 200 lines Claude Code loads.
- A note is archived as superseded only when `superseded-by` names a
  replacement. A note stamped in the future ages by its file time.
- An index line whose title holds `[brackets]` reads back, nested ones too.
- `modified: YYYY-MM-DD HH:MM` keeps its time.
- Each note is read again once after the upgrade: 1.3.0's cache in `.facts`
  kept these misreadings for notes unchanged since. A note 1.3.0 archived
  by misreading `superseded-by: none` comes back while its age allows.

**Redaction**

- Secrets given as `--api-key`, `--passphrase`, `ssh-keygen -N`, `redis-cli
  AUTH user pass` and similar flags are redacted. `find -name '*.7z' -print`
  is no longer mistaken for one.

**Platforms**

- A relative `CLAUDE_CONFIG_DIR` is resolved once, so every hook uses the
  same folder.
- Snapshots pass `safe.directory`, so git does not refuse the snapshot
  repository first made from an elevated shell or under `sudo`.

**Docs and tests**

- PRIVACY says what snapshots keep and that notes are not scrubbed of
  secrets.
- Stale mutants point at the current code, with new ones for these fixes,
  and three tests a busy Windows runner failed are steadier.

## 1.3.0 (2026-11-09)

**Turning it off**

- `/project-memory:incognito` stops saving the current conversation and
  sweeps what it already saved from the journal and `handoff.md`. It says
  it did not work (`NOT applied`) rather than claim success. Claude Code by
  default still keeps its own transcript, its own auto memory may still save
  notes, and snapshots of days already over keep a copy.
- `/project-memory:memory-off` and `memory-on` turn it off and on for one
  project with a `.project-off` marker. Off stops adding; it doesn't hide:
  search and show still answer. `status` and `doctor` say when a project is
  off, and a marker that can't be read counts as off. What was said while it
  was off stays out afterwards (`.off-periods`), and a conversation that ran
  across off and on keeps its turns before and after.
- Docs: README, PRIVACY and how-it-works say what each way of turning it off
  does and does not cover. Incognito holds across a resume; `/clear` starts a
  new conversation, which is not incognito.

**Search**

- `search` finds two-character Chinese and Japanese words. In the repro of
  eight queries, three missed on 1.2.7 (记忆, 部署, 設計) and none miss now.
  Two-letter words in other scripts still match only standing alone, so `ci`
  does not match "decision".
- When some search words are held by no note or entry, one line after the
  hits names them: `no note or entry holds: hetzner`.

**Tests and tooling**

- The checks now fit the size of the plugin. A pull request runs the normal
  tests on three setups and the sign-off check. Before a release the changes
  get one code review, and what it finds is fixed. Mutation tests and the long
  fuzz are no longer part of a pull request or a release, and stay in the repo
  to run by hand. CodeQL and Scorecard run weekly and block nothing. Dependency
  review is gone: the plugin has no dependencies. `node check.mjs` and
  `node deploy.mjs` run mutants only with `--full`, and `deploy.mjs
  --mutants-checked-on-github` is gone.

**Memory index**
- A project's notebook that the plugin has written to, but that has no
  `MEMORY.md`, now gets one with a title only, in the reply that made the
  handoff. A manual run does the same for every project.
- A line like `- [title](journal/2026-11-01.md)` is removed from the index,
  including one written by hand. A line with text after the link stays.
- A note that has no line is filed by its age, like any other: a recent one in
  the index, an old one in the archive. Before, it always went to the archive.

**Hooks**
- Each hook now has a time limit: 120 seconds for Stop and `/compact`, 60 for
  the automatic compaction check, 30 for the startup briefing. Before, Claude
  Code waited 10 minutes. Each hook shows a short status message while it runs.
- `/compact` no longer prints the tidy-up report. What a PreCompact hook prints
  becomes part of the instructions for the summary; the work itself is unchanged.
- The "Stop hook is not running" line now also names a `disableAllHooks`
  setting, `--bare`, `--settings` and `CLAUDE_CODE_SKIP_PROMPT_HISTORY` as
  possible causes.
- Tests now pin that a Stop stopped during git loses nothing, that a reply
  missing at one Stop is journaled by the next, and that copied turns which
  keep their ids add no second journal entry. The startup briefing still skips
  forks.

## 1.2.7 (2026-11-08)

A bug-fix release for the tools that build and check the plugin. The plugin
itself is unchanged.

**Tests and tooling**
- Two ignored automatic mutants whose code is gone left the ignore list.
- The hand-written mutants moved from `mutate.mjs` to `mutants/`, one file
  per source file. Adding one now reruns only that file's mutants, not all
  of them.
- A push to `master` no longer reruns the mutants its pull request already
  ran.
- The release steps give the commands for the big mutant run and the fuzz,
  start the mutants first so the two queue less, and run both on the release
  branch before the merge, as 1.2.6 did.
- `mutate.mjs --list` keeps every line when its reader is slow. A busy Linux
  machine lost the end of the list and failed the check at random.
- `check.mjs` catches a mutant label given twice when no space comes before
  its `[`. Nine labels were written that way, and none was doubled.

## 1.2.6 (2026-11-06)

A bug-fix release: a full audit of the repository and an independent
review of its four riskiest files, and every confirmed finding fixed.

**Your own repository**
- When Claude ran from inside a git hook in one of your projects (a commit
  hook, say), git settings pointing at that project (`GIT_DIR`,
  `GIT_INDEX_FILE` and others) reached the memory snapshot's git. The
  snapshot could then be written into your project's repository, or break
  its index. The plugin's git now clears them first.

**Secrets kept out of the notes**
- More secrets are now replaced with `[redacted]` before anything is saved:
  Slack `xoxe-` tokens, Perplexity `pplx-` keys, Discord webhook URLs,
  Telegram, Linear, Postman, Replicate, Supabase, Databricks, Sentry,
  Twilio, Mailgun and Mapbox keys, cookies (a `Cookie` or `Set-Cookie`
  header, and curl's `-b`/`--cookie`), the signature in a signed URL
  (Azure, S3, Google Cloud), an `Authorization` value with no scheme word,
  `redis-cli -a`, and "API key: …", "Secret key: …" or "Access key: …"
  written with a space. Text saved before this update stays as it was.

**Notes and the index**
- A note that starts with a `----` line, or holds a `---x` line, was read as
  if that line closed its frontmatter, so a body line `tier: archive` could
  archive it, and search skipped its first lines. Only a line of exactly
  `---` opens or closes the frontmatter now. A `tier:` line quoted inside a
  `description: |` block no longer sets the tier.
- A note named `MEMORY-something.md` was never indexed, archived or found.
  Only `MEMORY.md` and `MEMORY-archive.md` are indexes now.
- A second tidy-up run, with nothing changed, still rewrote the index. It
  now leaves it as the first run wrote it.

**Recording and compaction**
- A reply cut off at the token limit, stopped by a stop sequence, or
  refused counted as still working, so the compaction gate held off and
  the turn read as open. Only a tool call or a server pause keeps a turn
  open now. Pressing Escape after a tool call ends the turn too.
- A subagent's reply could close the main conversation's turn. Subagent
  records are now skipped there, as they already were elsewhere.
- The briefing cuts a long line at the end of a sentence, else at a word,
  never mid-word, so a fact keeps the condition that follows it.

**Search**
- Words with combining marks (Hindi, or an accent typed as a separate
  mark) were split apart and never found. They are whole words now, and
  `café` typed either way finds the other.
  The line of the reply that holds it is shown too.

**Checked**
- The memory skill receives the session id (`${CLAUDE_SESSION_ID}`), so
  `--session` finds the project from any folder.

**Tests and tooling**
- New tests: a fake `[User]:` line in a file or tool output never shows up
  as your words; what survives a compaction is checked without a model.
- The "8 writers at once" test no longer fails on a crowded machine, and
  `mutate.mjs` reruns a timed-out mutant once, alone, before counting it.
  A test that runs git after a slow snapshot waits for its lock to go.
- README and SECURITY.md now describe the release checks and the CI tools
  as they are; CONTRIBUTING's release steps hold merges until the tag.

## 1.2.5 (2026-11-06)

**More detail kept**
- The journal now keeps every exchange whole: your whole message, Claude's
  whole reply, every file it changed and every command it ran, each in full.
  It used to cut the message at 2,000 characters, the reply at 6,000, and
  keep the last 20 commands at 400 characters each. Entries written before
  this update stay as they were. The journal grows faster for it: measured
  on real conversations, half the entries are under about 5 KB and a very
  busy project adds about 110 MB a year (was 40 MB).
- A new conversation now starts with the last conversation's own exchanges
  (what you asked, what Claude did, the files changed), not only one line
  saying where it stopped. They fill the briefing up to 3,500 characters,
  under 1,000 tokens, the oldest left out first, so the briefing stays as
  short as before; with a full shared notebook there may be room for none.
  `handoff.md` keeps more of each exchange for this: 500 characters of your
  message (was 240) and 900 of the reply (was 400).

**Search**
- A journal hit is now a headline: the request cut at 200 characters (was
  400), a `Result:` line with the first sentence of the reply, so the outcome
  shows even when the search words sit further in, and short stretches
  around the search words, 240 characters in all (was 800). The transcript's
  path moved to `show <key>`, and the last line says so. Ten hits are about
  a third smaller, which is less for Claude to read every time it searches.

**Recording**
- A turn with more than 32 MB of tool output after its request (a long
  browser task's screenshots) was never written by its own conversation's
  replies: not to `handoff.md`, and to the journal only once another
  conversation took it in, half an hour later. The request is now found
  further back, up to 256 MB, and the turn is written at once.
- A conversation started in a subfolder of a repository with a very long
  path (a folder name past 200 characters, which Claude Code shortens) saved
  nothing and said nothing: its handoff went to a folder name too long for
  the disk. It is now kept in the conversation's own folder, as the docs
  say.

**Privacy**
- The start of a conversation never shows the words of a conversation
  marked `<private-session>`, as the last conversation or as one still
  working, and never lists an exchange you had Claude forget, even when
  removing it from `handoff.md` failed. If the list of private
  conversations can't be read, it names no last conversation; if the list
  of forgotten exchanges can't be read, it lists none.
- The exchanges listed at the start never include those of a conversation
  held with auto memory off.
- When `forget` couldn't rewrite a day's file, the entry stayed there and
  `search`, `show` and the day's listing still showed it until `forget` ran
  again. They now leave it out. When the list of forgotten entries can't be
  read, they show none of that project's journal, and say so.
- A reply's save stopped half way (Claude Code closed right after a reply)
  left a temp copy of the journal day or `handoff.md` behind for good, and
  `forget` didn't reach it, so words you had forgotten stayed on disk. The
  next reply now removes such copies, once the process that wrote one is
  gone or the copy is over 30 seconds old, and so does `forget`.
- `<private>` and `<private-session>` now work when you type them as your
  answer to a question Claude asks you, or as what you tell Claude when you
  turn down something it was about to do. Before, they were ignored there:
  Claude's reply, which could repeat the private text, and the names of the
  files it then changed were saved, and `<private-session>` marked nothing.
  A tag that only appears in a file Claude reads, in a command's output or
  in Claude's own question still counts for nothing.
- A conversation held with auto memory off now stays out of the record of
  where you left off (`handoff.md`) too when you go on with it after turning
  auto memory back on, as it already stayed out of the journal. Before, the
  first reply with auto memory on saved its last exchanges there, including
  those typed while auto memory was off, and the next briefing could show
  them. Nor does Claude get the reminder to save its notes in it, and no
  note of a turn cut by a compaction is kept for it. If the list of such
  conversations can't be read after a reply, nothing is saved for that
  reply, and the next briefing says so.
- A password under a settings key such as `secret:`, `secrets:`,
  `passwords:` or `tokens:` (as in a YAML file: `secret:` on one line,
  `password: …` indented on the next) is now replaced with `[redacted]`.
  Before, the child's name was taken for the secret and the real value
  after it was saved. Every entry indented under such a key whose value
  looks like a password or a token is now redacted, not only one whose own
  name says password; names, settings and the lines after the key are kept.
- A password or token Claude passes to a command in quotes is now replaced
  with `[redacted]` too: `--password "…"`, `--token '…'`, `-p "…"` after
  `docker login` or `sshpass`, `curl -u "user:…"` and
  `aws configure set … "…"`. Before, only unquoted ones were. A quoted
  value goes whole, spaces and all, here, in `export`, `setx`, `$env:` and
  `.env` lines, and in a setting such as `api_key: "…"` or
  `password = '…'`, where only a first word of 6 characters or more went
  before.
- The FAQ said project-memory saves nothing when auto memory is turned off.
  It follows only the `CLAUDE_CODE_DISABLE_AUTO_MEMORY` environment
  variable: turning auto memory off in Claude Code with `/memory` or its
  `autoMemoryEnabled` setting doesn't stop it, since it never reads Claude
  Code's settings. The FAQ, the privacy policy and How it works now say so,
  and that disabling the plugin is the way to stop it.
- `<private>` and `<private-session>` now work with any invisible character
  inside them: a soft hyphen, the left-to-right and right-to-left marks a
  right-to-left keyboard or a paste can add, and the like. Before, only
  zero-width spaces and joiners were looked past, and a tag with one of the
  others kept nothing private.
- More secret shapes are replaced with `[redacted]`: PowerShell's
  `$env:NAME = "…"` where the name says key, secret, token or password (as
  `export NAME=…` already was); a `.env` file's `NAME=…` line whose name
  ends in such a word, and the same in cmd's `set NAME=…`, after `&&` in a
  command, in a compose list item and in a Kubernetes `- name:` / `value:`
  pair; a JSON object under a key such as `"secrets"`; and an Azure
  connection string's `SharedAccessKey=…`.
- The journal no longer takes in a subagent's own transcript as a
  conversation of its own, nor reads a subagent's messages inside a
  conversation's transcript as yours. Claude Code keeps subagents
  elsewhere today, so nothing changes now; an older layout could have had a
  private conversation's subagent journaled.
- A token after `Bearer`, `Basic` or `Token` is now replaced with
  `[redacted]` when it has no digit in it (32 characters or more), and when
  an invisible character sits between the word and the token. Before, both
  were saved as they were.
- The privacy policy said `forget --yes` removes the matches when there are
  too many; it removes nothing then and asks you to narrow the search, as
  the command always did.

**Compaction**
- With a smaller compaction window, such as the 200,000 tokens the FAQ
  suggests for a 200k model, the reminder to save notes came only about
  22,000 tokens before the compaction, too late for a long reply. It now
  comes early enough to leave at least 60,000 tokens: at about 66% of a
  200k window, counted from where the compaction really comes, also when
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moves it earlier. A window too small
  for that gets it halfway to the compaction. A 1M window still gets it at
  85%.
- An error Claude Code adds to the transcript (an entry with no real
  token counts) was read as a conversation of 0 tokens, so the reminder
  could be skipped after it. Such entries are now passed over.
- When another window changed `handoff.md` while a note of a cut turn was
  being written, the note was dropped and the hook said the file had no
  place for it. It now says the handoff changed meanwhile.

**Several windows at once**
- When a window left a lock behind (it was closed mid-save), two others
  waiting for it could both take it over and write at the same time. Now
  only one takes it over, short of three windows racing within the same few
  microseconds.
- When the Stop hook cut its own log (`.stop-ran`) back, a line another
  window added at that moment could be lost, and `doctor` could then miss
  hooks set up twice. The log is now cut only if nothing was added
  meanwhile.

**Failures said**
- A `journal` folder that refused writes lost every reply's entry in
  silence: the record of the failure, `journal/.failed`, is in that same
  folder. It is now kept beside the projects folder
  (`.journal-failed-<project folder>`) when the journal won't take it, and
  the startup briefing and `status` say it.
- A full disk, or a projects folder that refused writes, was reported as
  "Memory hooks look stopped … if project-memory was turned off
  meanwhile". The briefing and `doctor` now say the save failed, and why:
  the disk is full, or the folder refuses writes (with the code).

**Snapshots**
- On a large store (about 5,000 files on Windows), the history never
  started: the first snapshot's `git add` ran past its 30 seconds, was
  stopped, and left git's lock behind. Every later try then found the lock
  and gave up as "busy", which was never counted, so `doctor` said "none
  recorded yet" and the startup briefing said nothing; and since the tidy-up
  was only marked done after a snapshot, every reply redid it (14 s at
  6,000 notes). The first snapshot is now taken in parts, 1,000 files a
  reply, the indexes first; a git command stopped at its time limit makes
  the next replies go on in parts; the tidy-up is marked done whatever the
  snapshot did, and a snapshot that didn't go through is tried again alone
  after the next reply. Waiting on another git for more than 10 minutes
  counts as a failure, and `doctor` says when the first snapshot is still
  being taken or none has been taken yet.

**Speed**
- After a reply that changed a note, the Stop hook read the top of every
  note to tidy the index, about a second at 1,000 notes on Windows. It now
  keeps what it read of each note (its type, `tier:` and date, in `.facts`)
  and reads a note again only once it changes, and it looks at each note's
  size and time once a reply instead of three times. On Windows, such a
  Stop took 0.45 s at 100 notes, 1.1 s at 500 and 1.3 s at 1,000; it now
  takes 0.32 s, 0.40 s and 0.46 s.
- While another window held the notebook, one Stop waited up to 2 seconds
  for each of its locks: 6.4 seconds, 8.5 with the shared notebook. The 2
  seconds are now for the whole Stop, as documented: 2.4 and 2.5 seconds.

**Small fixes**
- The tidy-up's line (printed by a manual run, and on the Stop's own output,
  which nobody sees) showed an index that grew as a negative saving,
  `(~-26 tokens/session)`. It now says `(grew ~26 tokens/session)`.
- A `MEMORY.md` saved with Windows line endings (CRLF) was rewritten with
  LF ones, and the blank line under its heading was dropped, when the
  plugin added its lines. It now keeps the file's line endings, and the
  blank line.
- A note named with a date that isn't on the calendar (`2026-02-31-…`) was
  read as a real date, so the tidy-up could archive it. Such a name now
  counts as having no date.
- A note whose closing `---` was the file's very last line, with no line
  break after it, was read as all body, header included, so a search could
  match words of its header. Its body is now empty.

**Forget**
- `forget <words>` now also finds an exchange the journal doesn't hold yet
  (its reply came while another window held the project's memory folder,
  and is saved at the next reply). It used to say nothing matched, and the
  next reply saved the exchange. It's listed as not in the journal yet, as
  with `--key`. It leaves out conversations marked `<private-session>` or
  held with auto memory off, and reads an exchange whole even when it sits
  across one of the 64 MB parts a long conversation is read in.
- `forget --key` of an entry whose day file can't be read said "removed".
  While a day file can't be read, such a key is named as in no day that
  could be read, nothing is removed for it, and the command fails.
- Running `forget --key ... --yes` again, after a first run couldn't update
  `handoff.md`, said "already forgotten" and left the exchange there for the
  next conversation's start. It now takes it out of `handoff.md`, and says
  so.
- After removing entries, `forget` says that Claude Code's own conversation
  files still hold them: it changes only project-memory's files.

**Commands**
- `promote journal` is refused, as `promote handoff` is: it moved the
  journal's own pointer into the shared notebook.
- A note's name of several words works without quotes: `restore my note`
  used to answer about `my.md`.
- `history`, `restore` and `promote` find a note in another letter case on
  Windows and macOS (`history Pricing`, `PRICING.MD`), and in either Unicode
  form everywhere (`café` typed one way, the file named the other), deleted
  notes too. When two names read alike, neither is taken. The letter case
  is ignored only where the folder itself ignores it: a case-sensitive
  folder (possible on macOS and Windows) gets the exact name.
- `history` and `restore` say plainly when there are no snapshots yet, when
  Git isn't installed, or when no snapshot holds a note, instead of git's own
  error. Without Git, `restore` no longer offers to replace a note "with the
  snapshot".
- A date that isn't on the calendar (`--since 2026-02-30`) is refused, and so
  is an option that needs a value with none after it (`forget --key --yes`).
- Under `--all`, a journal hit names its project by the folder you worked
  in, then the folder name `--store` takes.
- `status` says "1 day", doesn't count `handoff.md` and `journal.md` as notes
  without an index line, and says when the conversation `--session` names
  isn't on this computer.

**Doctor and the start of a conversation**
- `doctor` no longer stops with an error when it can't read the time of the
  last Stop.
- `doctor` no longer reports the hooks as set up twice when two replies of
  one conversation come less than 2 seconds apart. Each run now notes a short
  fingerprint of its reply to tell them apart.
- The start of a conversation names another working window by the last
  request recorded for it, and says so: what it works on now may be newer.

## 1.2.4 (2026-11-01)

**Privacy**
- A reply that comes while another window holds the project's memory folder
  is saved after the next reply. If you forgot that exchange by its key
  before then, `forget --key` said no entry had the key, kept nothing out,
  and the next reply saved the exchange in the journal and the handoff. It
  now finds the exchange in its conversation, lists it as not in the journal
  yet, and with `--yes` keeps it out of both. A key you forgot before is
  named as already forgotten, and nothing more is removed.
- When the list of conversations held with auto memory off couldn't be read,
  the journal's look for older conversations stopped at the first one that
  needed that list. A conversation you had marked private, met after it in
  the same look, kept its earlier journal entries until the list could be
  read again. The look now goes on past it, and still reads the list only
  once.

**Releases**
- Each GitHub release now comes with its source as a `.tar.gz` and a
  `.zip`, a `SHA256SUMS` file, and a signed attestation that the project's
  release workflow made them. How to check them is in
  [SECURITY.md](SECURITY.md#verifying-a-release). Installing with `/plugin`
  works as before.
- Changes now reach `master` only through pull requests that pass the
  tests, and every commit in one must be signed off
  ([CONTRIBUTING.md](CONTRIBUTING.md#developer-certificate-of-origin)).

**Project**
- GitHub's CodeQL scan and the OpenSSF Scorecard run on every change. The
  project holds the OpenSSF Best Practices passing badge and Baseline level
  2; the answers and their evidence are in `.bestpractices.json`.
- New: [GOVERNANCE.md](GOVERNANCE.md), [SUPPORT.md](SUPPORT.md) and a
  [security assessment](docs/security-assessment.md). The README has a
  "Security and trust" section, and its pictures now come in a phone
  version too.

## 1.2.3 (2026-11-01)

project-memory now needs Node.js 22 or newer. Node 20 reached its end of life
in April 2026 and gets no more security fixes; if `node --version` says v20,
install the current LTS from nodejs.org.

**Privacy**
- A conversation you marked `<private-session>` now stays out of the journal,
  the handoff and the next session's briefing when you go back to it after a
  very long tool output, even once it has dropped off the list of private
  conversations (which keeps the newest 1,000). Before, each new exchange of
  it was saved.
- The same now holds for what you add to such a conversation while
  project-memory is disabled: the journal no longer takes it in later.
  Entries an earlier version saved from such a conversation are removed when
  the journal next meets it. A conversation held with auto memory off that
  has lost its tag is now treated the same way: it is tagged private, so it
  also leaves the handoff.
- If the list of private conversations, or of those held with auto memory
  off, couldn't be read after a reply (another program, such as a virus
  scanner, had it open), that conversation was saved as if it were not
  private. Now nothing is saved or removed for it until the list can be read
  again, at a later reply.
- If such a list stayed unreadable (a folder in its place, or a permission
  taken away), nothing more was saved, as above, but nothing said so, and an
  earlier warning that the handoff couldn't be saved was cleared. Now the
  next briefing says the store needs attention and names the list, and
  `status` names it too (for the memory-off list, in its journal line). The
  warning goes at the next reply that reads the list again; for the
  memory-off list, at the next reply the journal records.
- With auto memory off, if the list of conversations held that way couldn't
  be written after a reply, nothing said so, and a conversation whose tag
  was never written could later be taken into the journal. Now the next
  briefing with auto memory on, and `status`, say the store needs attention:
  the conversation could not be marked, so the journal may take it in later,
  and they name the list. A conversation that got no tag at all can still be
  taken in.
- If the reply where you typed `<private-session>` couldn't save the mark (a
  full or busy disk), a later reply near the compaction limit could still ask
  Claude to write the conversation into memory, and a note kept across a
  compaction could quote its last request. Now, before either is shown, the
  whole conversation is checked for the mark.
- A password or token written after two spaces, a tab or a line break,
  instead of one space (`--token`, two spaces, then the token), was saved
  whole in the journal, and so in its snapshots. It is now replaced by
  `[redacted]`, as it was after one space.
- If a turn ran `forget` after a `<private>` message you sent while Claude
  was still working, the forget went unnoticed: the turn's request was saved
  in the handoff and the journal, and search could show it. Now a turn that
  runs `forget` saves none of its words, wherever the private message sits.
- The journal reads a long conversation it takes in later 64 MB at a time.
  If a part ended between a `<private>` message you sent while Claude was
  working and the reply to it, the reply was saved. It now stays out.
- If the journal folder couldn't be listed just when a conversation was
  marked private or held with auto memory off, its earlier entries stayed,
  and the clean-up was taken as done, so they stayed for good. The clean-up
  is now tried again at the next reply until it goes through.
- `forget` said "nothing matches" when it couldn't list the journal folder,
  and the exchange stayed. It now says the folder could not be listed, with
  the disk's reason, removes nothing and fails, so you can run it again.

**Fixes**
- When the disk briefly refused to remove a store's lock after a write, the
  lock stayed for 30 seconds, and the replies in that time were neither
  saved nor cleaned up. Removing the lock is now retried.
- If removing a copy of an entry from the day next to it failed (the copy a
  time-zone change leaves), the duplicate stayed in the journal for good.
  The next reply that saves that exchange now removes it.
- A warning in `status` that taking in older conversations had failed
  (`backfill: …`) stayed after a later look went through with nothing left
  to take in. It now clears then.
- `status` and the briefing could name a temporary file (`….tmp1234`) in the
  reason a write failed. They now leave that name out.
- Two more ways the handoff listed every exchange twice after a time-zone
  change are closed: a request cut off in the middle of something shaped
  like a secret (`api_key = process.env…`), and a moment when another
  program held `handoff.md` and it couldn't be read.

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
