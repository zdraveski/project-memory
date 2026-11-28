# Changelog

## Unreleased

### Search

- **`memory search` lists exact matches first.** A flag (`-A`), a path, a dotted name, an error code or a quoted phrase is matched as typed, in notes and in the journal (request, files, commands and answer), and its hits carry an `exact:` line. `--words` gives the old word ranking alone.

### Learning from mistakes

- **A correction detector, in English and Macedonian.** `src/correction.mjs` tells a prompt that corrects Claude and states a lasting rule from an everyday one, with filters for helpers, questions, thanks and quoted text. Nothing calls it yet.
- **`memory lessons` lists the lessons, `memory lessons replay` shows what they would have done.** The list gives each lesson note's counters (shown, followed, broken, not applicable, unknown), the retired ones too, the recurring errors past their startups and the lessons the scan hides. The replay runs each trigger over the last 31 days (`--days`) of the journal, knowing only what existed before each exchange: how often it fires, how many firings were probably followed by a correction on the same file or command, how many by a failure of the same command or a failed run with a change of the same file within the next 20 entries of the conversation (the journal has this signal when it has no corrections; the stuck streak and claim check have none, as their own retry would count; the failure hits have no baseline, so they show relevance, not that a lesson worked), and how many corrections it missed and why, with a 95% interval once there are 20 firings. With under 20 corrections in the window it says "No correction signal" and prints no share or miss count. It prints counts only; `--show` adds each firing's request, on this PC. `--all` replays every project, `--except <folder>` leaves one out. It writes one numbers-only line to `.replay-history` and nothing else.
- **Only command lessons are on by default.** Over 31 days of real journals, command lessons fired 122 times (median 2 a day, 4 followed by a failure of the same command); every other trigger fired 0 to 3 times, so they wait behind `PROJECT_MEMORY_LESSONS` (`edit,stuck`, or `1` for all) until notes carry `applies_to:` and `instead:`. `-command` turns command lessons off.

- **The startup briefing can list dead ends and recurring errors, and says where git stands.** With the triggers on (`PROJECT_MEMORY_LESSONS=deadend,recurring`), a startup lists up to three notes that name what to do `instead:` and up to two errors from your journal that keep coming back, each with its note or id; an error is dropped once a note `resolves:` it or after three startups. A startup also prints one line of git (the branch, how far it is from its remote, the uncommitted files) and says once when a lesson was retired; `PROJECT_MEMORY_LESSONS=0` turns those off. `memory preview` prints the briefing the next conversation would get, with its size, and changes nothing.
- **Lessons before an edit (`PROJECT_MEMORY_LESSONS=edit`), and `memory preview --file <path>`.** On Edit, Write and NotebookEdit, Claude is shown at most 2 lessons for that file with that edit's result (the edit itself still runs), a lesson once per context and 6 a context, never as a permission decision. Off by default until the replay shows it fires; `memory preview --file` prints what an edit of a file would show and why each lesson matched, writing nothing. `memory doctor` checks the new hook group.

### Lessons

- **Notes can say what they are about.** A note may carry `applies_to:`, `applies_when:`, `instead:` and `resolves:`, and `resolved-by:` archives a dead end once its fix has landed. Nothing speaks yet: the matching and the switch `PROJECT_MEMORY_LESSONS` come first.
- **`memory status` and `memory doctor` check the notes.** Coded lines name a gone index line, a note in no index, alike descriptions, clashing file names, a missing or unclosed header, a link to no note, an unread lesson key, an unknown `resolves:` id, feedback notes that can never fire, a lesson not shown and an index over budget (`N01` to `N11`), and a note whose path changed in 3 or more commits since it was written, or is gone (`S01`, `S02`). Only a clashing name or a missing header (`PROBLEM`) makes `doctor` exit non-zero.

### Learns from mistakes

- **Commands that failed and later worked, and files that change together, are found in your journal.** The Stop's background tidy-up rebuilds a cache, `.mistakes.json` in each project's memory folder, once a day: the last 90 days' failed commands with their error lines and the command that fixed them, secrets already replaced. Nothing reads it yet. `forget`, `incognito`, `memory off` and `rescan --apply --yes` delete it.

## 1.6.7 (2026-11-27)

A bug-fix release. Two more kinds of secret are cut, the compaction reminder reaches people on 200k models, and the project checks behind each release are faster. Nothing changes in how you use it.

### Secrets

- **Russian `токен` and `ключ` before a value are cut**, as `пароль` already was. Plain text such as `ключ: значение` is kept.
- **Three secret rules have their own tests now:** a quoted `.env` value with blanks, a PowerShell `$env:` secret, and a long `redis-cli` line, which stays fast.

### Compaction

- **The reminder before a compaction reaches 200k models.** A model picked with `/model` or the `model` setting (Haiku 4.5, or Opus and Sonnet before 4.6, without `[1m]`) was taken as a 1M window, so the reminder at 850k never came.

### Smaller fixes

- **A project folder path with a decomposed accent (as macOS writes it) names the same memory folder as Claude Code** when no transcript path is given.
- **Four more rules have tests:** the 900-character answer in the handoff, a missing proof-of-life file, the newest two working sessions at startup, and the transcript reader's text filter.
- **The project's own checks are slimmer:** pull requests run the tests on Linux, macOS and Windows only; the mutant, fuzz and workflow-lint jobs are gone from CI.

## 1.6.6 (2026-11-27)

A bug-fix release. Two kinds of password reached the journal and are now cut, forgotten text no longer survives in old copies, private conversations stay private when a file cannot be read, and several slow paths are fast again. Nothing changes in how you use it.

### Secrets and privacy

- **Passphrases are cut whole.** After `password:` or `password =`, only the first word of a passphrase such as `correct horse battery staple` was cut, and the rest was saved. Now the whole passphrase is cut.
- **A plain password after "is" is cut.** "my password is letmein" was saved as it was. Words like "wrong", "empty" or "required" after "password is" are still kept.
- **Forgotten text is really gone.** `forget --purge` left the copies that `restore --force` keeps, so the forgotten text could still be read from them. The purge now deletes those copies too.
- **A helper's report stays private when the conversation can't be read.** If the main conversation's file was busy or unreadable, a helper's report was saved even in a private conversation. Unknown now counts as private.
- **A long pasted prompt no longer hides a private mark.** A prompt over 64 KB that the read cut through was skipped, so the wrong turn's privacy was judged. It is now read whole.
- **Command output can't plant lines in the note after a compaction.** A line in `curl` output or an untrusted file could show up there as a running task. Only a real task file counts now.

### Snapshots

- **A purge no longer loses a snapshot.** A snapshot made while `forget --purge` ran could be overwritten by the purge. The purge now holds the snapshot lock for its whole run.
- **The first snapshot is labelled right.** A big first snapshot taken in parts showed its later parts as files added just now.

### Speed

- **Long turns are read fast.** A turn with many shell commands slowed down sharply (60,000 calls took 18 s). It is now read in linear time.
- **`forget <words>` is fast on large stores.** It read every transcript whole each time. It now reads only what is not yet saved.
- **A very long pasted prompt no longer stalls the look-up.** The matcher now uses the first 50 distinct words and stops at its time limit.
- **`show` and dated searches read less.** They read the whole journal; now they read only the days they need.

### Smaller fixes

- **Pointers after a compaction stay** when your last prompt is more than 512 KB back in the conversation.
- **A failed handoff save is retried** instead of being marked saved.
- **Only one background tidy-up runs at a time.**
- **A big session file is rewritten safely**, so a reader never sees it empty.
- **A quote in a shell comment no longer hides later git commands** from your enforce rules.
- **`memory doctor` gives a slow enforce hook 15 s** and reports it as a note, not a problem.
- **`memory doctor` shows where a slow helper-report save went** (read, lock or write).

## 1.6.5 (2026-11-27)

A bug-fix release. The secret detector catches more secrets and cuts less ordinary text, the reminder before a compaction now follows the window you set, and the recall pointers show on slow machines. Nothing changes in how you use it.

### Secrets

- **More secrets are cut.** A value after `password is:`, `password =>` or `password -`, a PIN such as `pin: 4821`, a `passcode`, an older Vault token after `vault login`, and keys and passwords named like `signing_key`, `githubToken`, `dbPass` or `GITHUB_PAT` reached the journal. Now they are replaced like any other secret.
- **Less ordinary text is taken for a secret.** "the token is expired!", "password: Required field", "token: required", "log in `reports/folder`" and a folder path after `PWD=` were cut as passwords. They are now kept.

### Compaction

- **The window you set in settings.json is used.** A compaction window set with `autoCompactWindow` (or `/autocompact`) was ignored, so the reminder to save before a compaction never came and `memory doctor` named the wrong size. Both now follow your setting.
- **Compaction switched off is seen.** With compaction off, `memory doctor` now says so, and the reminder no longer warns of a compaction that will not come.

### Recall

- **The recall pointers show on a machine slow to start Node.** Their time limit counted Node's start-up, so on a slow machine the look-up never answered. It now counts from when the look-up begins.

### Smaller fixes

- **A snapshot that runs long keeps its lock.** Another snapshot could take the lock of one still running after 30 seconds; it now waits as long as git may take.
- **A failed repair of the salt file no longer leaves a temporary file behind.**

### Tests

- **Two more timing tests no longer fail at random on busy test machines.**

## 1.6.4 (2026-11-27)

A bug-fix release, mostly about secrets. Four ways a password or key could reach the journal or the note history are closed, and the clean-up command no longer stops halfway. Nothing changes in how you use it.

### Secrets

- **A secret inside escaped quotes is now cut whole.** Commands such as `ssh host "export TOKEN=\"…\""`, `docker login -p \"…\"` or `mysql --password \"…\"` kept the value in the journal's record of what ran. Now it is replaced like any other secret.
- **A line ending in a backslash no longer hides a secret on the next line.** A note with, for example, a Windows folder path ending in `\` followed by a `NAME_KEY=…` line could be copied into the note history with the key in it.
- **Two snapshots taken at the same moment can no longer let a secret into the history.** When several conversations end a reply at once, their snapshots now take turns, so each one checks exactly what it saves.
- **A note whose file name is not valid text is no longer saved unchecked.** On Linux such a note could skip the secret check; it is now held out of the snapshot.
- **"log in" followed by a file path is no longer taken for a password.** Ordinary text like that kept a note out of the history for no reason.

### Memory commands

- **`memory rescan --apply` goes on past a note it cannot rewrite.** A note saved in an old text encoding stopped the whole clean-up, so later notes kept their secrets. That note is now reported and left as it is, and the rest is cleaned.
- **`memory restore <note> --rev` with no revision is refused.** It restored the newest version instead.
- **An empty salt file is repaired.** If the file that makes the journal's keys was left empty by a crash, keys changed on every reply; it is now rewritten once.
- **The moved-project notice skips a folder whose memory is turned off, and a long notice keeps its advice.** It lists up to five note names, then how many more.
- **A snapshot that saw a note change while it ran no longer says the first snapshot is being taken in parts.**

### Tests

- **Several speed and timing tests no longer fail at random on busy test machines.** They now wait for the real condition or take the best of a few runs, and still catch a slow version of the code.

## 1.6.3 (2026-11-27)

A bug-fix release. On Windows, console windows no longer flash after a reply, and a project you moved to a new place now tells you where its old notes are.

### What you notice

- **No more flashing console windows on Windows after a reply.** The background tidy-up now runs its git commands without opening a window.
- **A moved project points you to the notes it left behind.** Claude Code keeps memory by folder path, so a project moved to a new folder starts with an empty memory. When the project's folder and its parent folder kept their names, `memory doctor`, and the startup briefing once, now name the old memory folder and the notes it holds that the new one lacks, and say how to copy them over. Nothing is moved for you.

### Smaller fixes

- **A file whose look-up keeps running out of time is no longer looked up on every edit.** After two tries, it is left alone.
- **The end-of-session hook now declares a 1 second timeout, inside the 1.5 seconds Claude Code gives plugins there.** It said 3 seconds, which Claude Code does not honour. The hook takes a small fraction of that.
- **The memory skill's description is valid YAML.** Claude Code read it anyway; other agent tools would have refused it.
- **Two tests that failed at random on busy macOS and Windows machines are fixed.**

## 1.6.2 (2026-11-26)

This release mostly reorganises the code inside the plugin, so it is easier to keep safe and correct. It also fixes two small things you may notice. Nothing changes in how you use it, and your memory files keep their format.

### Privacy

- **A conversation whose private sweep has not run yet stays hidden.** Search, `memory show`, `memory history` and the journal page now leave it out until the sweep is done. Before, they could show it. If the list of private conversations cannot be read, they say so instead of showing everything.

### Notes and logs

- **Restoring or promoting a note keeps its index's line endings.** An index with Windows line endings no longer comes back with mixed ones.
- **The plugin's small logs are trimmed the same way.** The stop record, the timing log and the git-rule log are all cut by one routine, and a temporary copy left by a cut is cleared at the next save.

### Under the hood

The secret detector, privacy rules, transcript reading, journal reading, snapshots, the handoff, the run records, the session file and the Stop each moved into one module with a small interface and their own tests.

## 1.6.1 (2026-11-26)

This release fixes two ways a secret could reach the journal, a session that was called ended while it was still open, and a stuck lock that cost every save 30 seconds. It also stops notes from being left out of the history for no reason. Nothing changes in how you use it.

### Secrets and private conversations

- **Two secret shapes are now kept out of the journal:** a `tokens:` block written right after a line that ends in `\`, and `sshpass -p` glued to the word before it.
- **Ordinary text is no longer taken for a secret.** Words such as "pass:", "password was replaced", "tokens: restore", an IPv6 address, a `file:line` or a date after "PASS" kept whole notes out of the history.
- **A note is no longer held out of the history because of its folder's name.** A project under a folder named `pk`, `sk` or `rk` read as a key, and none of its notes were ever snapshotted.
- **A private turn stays private after a compaction in the middle of it.** Before, the files it changed could be shown to another session.

### Sessions and saving

- **The startup briefing no longer calls a session "ended" while it is still open** and waiting for its user. It names it as working here, as `memory status` does.
- **A save killed while it held the lock no longer blocks the project for 30 seconds.** The next save takes the lock at once.
- **A helper's report is no longer lost when many helpers finish at once.** It waits for the lock a second time.
- **A prompt written right after a crash is now saved.** Before, a line cut by the crash took the next prompt with it, and its reply was filed under the ask before.
- **A note deleted soon after it was written now shows in `memory history`.**

### Commands and the journal page

- **`memory forget --purge` works when the Claude folder's path is long** on Windows (about 166 characters or more).
- **The journal page shows `<` again** in code such as `List<String>`, where it showed `&lt;`.
- **`memory doctor` no longer counts runs while pointers are off** (`PROJECT_MEMORY_RECALL=0`).

### Pointers (opt-in)

- **A reply such as "go" or "yes" no longer brings up a pointer.**
- **A pointer that ran out of time is tried again** at the next change of that file, instead of the file being marked as seen.
- **The git rule check reads a very large conversation in pieces.** A 600 MB one took 14 seconds and then failed.

PRIVACY.md now lists the `PROJECT_MEMORY_RECALL` and `PROJECT_MEMORY_TIDY` settings and the `tidy` timing name.

Update with `claude plugin update project-memory@project-memory`, then restart Claude Code.

## 1.6.0 (2026-11-26)

This release lets two sessions on one project see each other. After a compaction, Claude is now told what the conversation already changed. A helper answers questions about the past, and the plugin got lighter. Pointers to earlier exchanges, given while Claude works, are in this release but switched off until they are measured: turn them on with one setting. Nothing changes in how you use it, and your existing memory works as it is.

### Sessions that see each other

- **Two sessions open on the same project now know about each other.** At your next message Claude is told once that another session is working here, since when, on what request and which files it changed.
- **When Claude changes a file the other session changed in the last 30 minutes, it is warned** with the result of that change. It never blocks the change.
- **The startup briefing and `memory status` name the other live sessions**, with the title you gave one with `/rename`. A private conversation or turn is never shown to the other session.

### After a compaction

- **After a compaction, Claude is told which files the conversation changed** and up to three earlier exchanges like the request in progress, its own from before the compaction included.

### Pointers to earlier exchanges (opt-in)

Off by default: they have not yet been measured on real sessions. To try them, add `"PROJECT_MEMORY_RECALL": "1"` to the `env` block of your Claude Code `settings.json` and restart Claude Code.

- **When Claude changes a file that earlier conversations changed too, it is told so.** With the result of the first change it sees the date, the conversation and the request of the newest two, and how to open them. Only when one of them shares a rare word with what you are asking now, once per file and conversation, and at most three such notes between two of your messages.
- **When your message names something old, Claude is told before it answers.** If your message shares a few rare words with an earlier exchange of another conversation in this project, Claude sees that request, up to three files it changed and the shared words. "go" or "yes" alone never triggers one.
- **With the setting on, the briefing also tells Claude to hand a hard question about the past to the `recall` helper.**
- **Nothing private or forgotten is ever named.** A message with a `<private>` block or the `<private-session>` mark triggers nothing and is not written down. A note already shown stays in the conversation that got it: `forget` cannot take it back.
- **`PROJECT_MEMORY_RECALL=0` turns all of these notes off, the other-session notes and the compaction lines included.**

### Ask memory a question

- **A new `recall` helper answers a question one search doesn't settle.** Ask it with `@agent-project-memory:recall`. It searches several ways, opens what it finds and reports back with dates and your own words. It only reads, and its report is not saved to the journal again.
- **A helper's journal entry now lists the files it changed**, so a file's past includes a helper's work. Entries saved before 1.6.0 list no files.

### Lighter

- **The `memory` skill Claude loads is 68% smaller**, and the startup briefing 3 to 12% smaller. The shared notebook's index and the rules stay whole on purpose.
- **The plugin's own share of a hook stays small:** about a quarter of a second for the save after a reply, and under two tenths for the briefing. Most of the time a hook takes is spent outside the plugin's own code.

### The history store

- **Restore, `forget --purge` and `rescan --apply` now say "busy" instead of racing a snapshot.** If a snapshot or git's own clean-up is under way they stop, change nothing and tell you to try again in a moment. A clean-up that was killed no longer keeps them waiting.
- **The plugin now tidies its own history store.** Git no longer starts a clean-up in the background at a random moment; the plugin runs it after a snapshot, when the store has grown enough to need it.

### Also part of 1.6.0

The journal page (`memory page`) and "who said it" (`history`, `show` and the `search` filters) shipped early, in 1.5.4.

### Requirements

- **Claude Code 2.1.78 or newer**, as before. The `recall` helper needs 2.1.271 or newer to start without your CLAUDE.md files; older versions run it with CLAUDE.md loaded.

Update with these two commands, then restart Claude Code:

```
claude plugin marketplace update project-memory
claude plugin update project-memory@project-memory
```

## 1.5.8 (2026-11-25)

This release fixes three privacy holes and two places where `memory doctor` said everything was fine when it wasn't.

### Private and forgotten conversations

- **A private conversation is now also private to the git rule check when its tag is typed in another form,** such as full-width brackets (`＜private-session＞`) or with a hidden character inside. The journal already read these forms as private. A helper's work no longer makes a conversation private either.
- **An exchange you forgot no longer comes back when the forget list can't be read.** The list could be locked by another program or damaged on disk. Until it can be read again, the end-of-reply save leaves that reply's exchanges out of `handoff.md`, and `memory forget` stops with a message saying it couldn't read the list. Before, it showed an exchange you had already forgotten as if it were new.
- **If the list of times memory was off can't be read, nothing is saved for that reply,** and the failure is recorded. This already worked; a test now keeps it that way.

### `memory doctor`

- **A damaged deploy record is now reported as a problem.** Before, `doctor` said the hooks matched the last deploy.
- **A lock file dated in the future is now listed as left behind,** the same way the plugin itself treats it. A computer clock that was set back can leave one.

### Removing from the history

- **`memory forget --purge` tries git's clean-up a second time** if a clean-up git started on its own gets in the way, instead of failing.

Update with `claude plugin update project-memory@project-memory`, then restart Claude Code.

## 1.5.7 (2026-11-24)

Nothing changes in the plugin you install from the marketplace. This release speeds up the project's own checks and deploys.

### For contributors

- **On a copy deployed with `tools/deploy.mjs`, `memory doctor` now names the release next to the commit**, for example `the plugin runs the last deploy, e8cdaf3 (v1.5.7), from ...`. The version number of such a copy ends in a deploy count (such as `1.5.1127`), not the release, which made it look like the wrong version was installed.
- **The test suites run side by side**, in CI and before a deploy, and the slowest one is split into three. A CI run now takes 1.5 to 4 minutes per system instead of 10 to 19.
- **Each pull request now gets the mutants and a short fuzz of its own changed lines** in CI. The full mutation check runs weekly and a longer fuzz nightly, on a schedule.
- **A deploy no longer runs the suites again:** it checks that CI passed on that exact commit (`--local-tests` runs them on your machine instead).

## 1.5.6 (2026-11-23)

This release fixes one privacy hole and tidies the project's files.

### Private questions

- **A message you type while Claude is still answering a `<private>` question is no longer saved with that answer.** Since 1.3.2 such a message started a turn of its own, and Claude's reply, which may repeat the private text, was saved to the journal and the handoff under it. Now that reply is not saved, the same as the private question.
- **A disk error while the plugin reads its backup-health record no longer stops the end-of-reply hook with an error.** The record is skipped for that reply and read again on the next one. This was there before 1.5.6 and showed only when the disk refused a read.

### Tidier files

- **The plugin's files now live in a `src` folder**, and the tests and developer tools in `test` and `tools`. Your notes, hooks, commands and the `memory` skill behave exactly as before. Update with `claude plugin update project-memory@project-memory` and restart Claude Code.
- **The path to the memory tool moves.** It is now `.../src/memory.mjs`, not `.../memory.mjs`. The skill and the commands already use the new path. **If you wrote your own permission rule, shell alias or hand-wired hook that points at the old path, update it**, or it will stop matching or fail.
- The download is the same plugin as before; tests and developer tools were already left out of it.

## 1.5.5 (2026-11-23)

This release stops Claude Code from waiting on the plugin's backup after a reply. On a busy computer that backup sometimes held the end of a reply for half a minute.

### Faster end of a reply

- **The tidy-up and backup after a reply now run in the background.** When a reply changed a memory file, the plugin sorted the index and saved a git snapshot before Claude Code could go on. That usually took under a second, but on a loaded computer it once took 38 seconds. Now it starts as a process of its own and Claude Code goes on at once. A reply that changed no memory starts nothing extra.
- **A manual `/compact` still waits for the tidy-up**, so the summary sees the sorted index. If the background process cannot start, the tidy-up runs in the hook as before.
- **`memory doctor` shows the background tidy-up as its own line**, `tidy`, next to `save`, so you can see how long it takes on your machine.

## 1.5.4 (2026-11-20)

This release lets you see your journal as one page in the browser, tells you which conversation and which of your requests changed a note, and starts measuring how long the plugin's hooks take on your machine. Everything stays on your computer.

### The journal page

- **`memory page` writes your journal as one web page on your computer and prints its link.** It shows a week at a time with a card for each project, and the day's exchanges with what you asked and what Claude answered. A search box filters as you type (`/` jumps to it). `--days N` or `--days all` sets how far back (30 days by default), and `--project NAME` picks one project.
- **The page loads nothing from the network and only you can read it.** It is one file, `project-memory/journal.html`. Private conversations show no text, forgotten entries are left out, and secrets are redacted as everywhere else. `forget`, `incognito`, `memory off` and `rescan --apply --yes` delete the page, so it never keeps what you removed; run `memory page` again for a fresh one.

### Who said it

- **`history <note>` names the exchange behind each change**: a `by:` line with the time, the conversation and what you asked. `show <note>` names the first and the last exchange that changed it. A change made by hand, by a shell command or by the plugin's own sorting says `no exchange found`.
- **`search` has three filters**: `--file <path>` lists the exchanges that changed that file, `--asked` searches only your own words, and `--conversation <id>` searches one conversation.
- **The briefing reminds Claude to check your own words** before it acts on a note it is not sure about.

### Hook times

- **`memory doctor` shows how long each hook takes**, for example the save after a reply and the briefing at the start. The hooks write one line of numbers per run to `~/.claude/projects/.timing`: hook names and milliseconds, never text or file names. Set `PROJECT_MEMORY_TIMING=0` to turn it off.

## 1.5.3 (2026-11-19)

This release makes the plugin tell you when an update is waiting to be loaded, catches git commands hidden inside quotes, and fixes a rare case where a conversation in a very long folder path was saved to the wrong project. Most of the work is out of sight: the tests now catch about 1,200 more kinds of mistake.

### Updates

- **After an update, an open conversation says once: `project-memory X is installed, run /reload-plugins to use it`.** A conversation keeps running the version it started with, so until now an update did nothing there until a restart, without a word.

### Checked lessons

- **The git rule check sees a command wrapped in quotes for a shell**, like `cmd /c "git add -A"`, `bash -c "git add -A"` or `powershell -Command "git add -A"`.
- **A single `&` separates two commands**, so `cd repo & git add -A` is checked like `cd repo && git add -A`.

### Saving

- **A conversation started in a subfolder of a project is saved to the project's memory even when the folder path is very long**, for example a deep path in Cyrillic or Chinese letters. Before, it could go to a separate memory for the subfolder.

### Asking Claude

- **Claude knows that a one-character Chinese or Japanese word can be searched**, and that turning off Claude Code's auto memory also turns off project-memory, so it answers questions about both correctly.

## 1.5.2 (2026-11-18)

This release fixes what an audit of 1.5.1 found: a few places where a private conversation or a forgotten entry could still leave text behind, a reply that could be lost without a trace, a `forget --purge` that timed out on a long history, and searches that came back empty when they should not have. Updating is recommended. Your existing memory works as it is.

### Private conversations and forget

- **A helper agent started in a private message is no longer saved to the journal**, even when it finishes after you have typed something else or the private turn is very long.
- **`forget` and private conversations also remove a half-written handoff backup**, `handoff.md.prev.tmp`, which could keep the text you asked to forget.
- **`forget --purge` finishes in seconds on a long snapshot history** instead of timing out. If it fails, it says the old snapshots still hold the text and to run the same command again.

### Saving

- **A reply is no longer lost without a trace when several sessions hold the memory store at once.** The briefing and `status` now warn about it.

### Search and the CLI

- **Search finds English words written next to Japanese or Chinese text**, like `CI` in `CIが落ちた`, and one-character Chinese or Japanese words.
- **Words like "make", "get", "put", "time", "use" and "new" are search words again.** With a date range they no longer list every entry, and a range listing says which filler words it ignored.
- **An option a command does not take, or a date range that ends before it starts, is refused with a message** instead of an answer of "nothing found". `show` also takes a key typed without quotes, and a mistyped command named like a built-in word no longer crashes.
- **`history <memory> --all` lists the changes in every project that has that memory**, each under its folder, instead of only the first.

### Checked lessons

- **The git rule check also sees commands run through `rtk bypass`, `sudo -u`, `cmd /c`, `cmd.exe /c` or `exec -a`.**
- **A rule written under `metadata:` is reported as a bad rule** instead of being ignored without a word. `enforce:` goes at the top level of the note's front matter.

### Doctor, deploy and docs

- **`memory doctor` marks "git not installed" and "snapshots off" as notes, not ok**, and names a history copy left behind by an interrupted purge, with the command that clears it.
- **A deploy removes files the old release shipped and the new one dropped**, and remembers where the repo came from, so a deleted clone can be found again. A stray folder in the old file list no longer stops it.
- **The plugin warns once at startup on Node older than 22.** The tests now also run on Windows with Node 22.
- **The docs say when the wait before a compaction applies:** only mid-turn, with a compaction window of about 233,000 to 933,000 tokens on a 1M model.

## 1.5.1 (2026-11-18)

This release fixes what the 1.5.0 review found: search that joined words that only look alike, a few things that were saved or kept when they should not have been, and a Stop that took seconds on a very long turn. Search also puts the right entry first more often, and prints less. Updating is recommended. Your existing memory works as it is.

### Search

- **Search no longer joins words that only look alike.** `git` no longer finds `github`, `cat` no longer finds `concatenated`, `stores` no longer finds `storage`, and `story` and `ready` no longer match inside `history` or `already`. `library` still finds `libraries`.
- **A hit's Result line shows the outcome.** It is the first sentence of Claude's last message in the turn, not the first words it said.
- **The right entry comes first more often.** Long pasted requests and long notes rank lower, so they stop crowding the top, and an entry that holds your whole phrase ranks higher. On 95 test questions, the right entry came first in 63 instead of 58. The score a hit shows is unchanged; only the order moves.
- **`1.4` finds 1.4.1 but no longer 1.45.** A three-part version still matches only itself.
- **Search results are shorter.** From the 6th journal hit on, a hit prints only its request, its Result line and its key.
- **A short request shows what it answered.** In `show` and the day list, a request of 25 characters or less (like "yes" or "go") gets a `Reply to key <key>: …` line with the end of the reply before it.
- **The day list with no search words leaves out subagent reports.** Searching by words still finds them.
- **A search that finds something ends with "Not the entry you meant? Search again with other words."**, so a first search with the wrong words gets a second try.

### Saving

- **A turn with hundreds of text blocks is saved in about a tenth of the time.** On a 300-block turn the Stop went from about 30 seconds to 3, so it no longer runs into its time limit. A Stop that saves nothing is also about 15% faster.
- **A command that Claude Code's safety check blocked no longer shows under Ran**, and nor does a subagent's refused report-file write.
- **A subagent report that is lost to a busy lock leaves a line in `journal/.failed`**, so `status` shows it.
- **A subagent report over 8,000 characters keeps its first 5,000 and its last 2,900**, with `(N chars cut)` between, so the conclusion at the end stays.
- **`handoff.md` is copied to `handoff.md.prev` at the first Stop of each day**, so one bad overwrite never loses it all. A private conversation makes no copy, a sweep (private, forget) deletes the old one, and `memory rescan` checks it.

### Private conversations and secrets

- **A subagent that ends while a private turn is open saves no report, and a private turn saves no pick.** Before, a report from such a subagent, and your answer to a question in a private turn, were saved.
- **A failed command's error is checked for secrets in its last 20,000 characters** (1.5.0 checked 2,000), and each pick of a multi-question answer is checked against its own question.
- **Two things that were cut as secrets are kept:** `same pass: worked` (a word like "pass" in a sentence) and IPv6 addresses.
- **`memory rescan` no longer reports a marker it wrote earlier** (`[redacted]` or `***REMOVED***`) as a new secret. `rescan --apply --yes` now writes `[redacted]`, as the rest of the plugin does, instead of `***REMOVED***`.
- **`forget --purge` and `rescan --apply --yes` keep their working copy of the snapshot history inside the snapshot repository's own `.git` folder**, not in the computer's temporary folder, and remove it when they finish. The next run removes one that a stopped run left.

### Settings, briefing and compaction

- **When auto memory is turned off in the settings, the startup line says so**, and where it found the switch. The environment variable gets no such line.
- **A settings.json that starts with a byte-order mark is read.**
- **Tagging in a project where memory is off no longer advises a reinstall.**
- **If saving the "wait" mark for a compaction fails, the compaction goes ahead** instead of being held.
- **Claude Code compacts 33,000 tokens short of its window, and the reminder to save notes now follows that.** In a window of 200,000 it comes at about 107,000 tokens, where it came at about 132,000. `memory doctor` prints a line with the compaction window.
- **`CLAUDE_CODE_MAX_CONTEXT_TOKENS` counts only when `DISABLE_COMPACT` is set, or when `ANTHROPIC_MODEL` names a model that is not a Claude one**, as Claude Code does. If you use a non-Claude model, also set `ANTHROPIC_MODEL`.
- **The briefing keeps room for the last session's exchanges.** When the shared lessons fill it, 1,500 characters are kept for them.

### Checked lessons

- **Checked lessons are a 30-day trial.** On 2026-12-18 the plugin's author checks whether the git rules caught anything useful (`memory enforce status`), and keeps the feature or cuts it.
- **A rule's `unless` word also matches one folder of a path.** `unless: [scratchpad]` now lets `cd .../scratchpad/repo && git add -A` through. `has` words are not split.

### Documentation

- **The docs name exactly which settings are read:** `autoMemoryEnabled` from the managed, project-local, project and user settings files, `autoMemoryDirectory` in `doctor`, and the `CLAUDE_CODE_DISABLE_AUTO_MEMORY` variable. Nothing else in a settings file is read.
- **The docs say where `forget --purge` and `rescan --apply --yes` keep their working copy**, and that a command is cut at 20,000 characters and a request or reply at 50,000.
- **The reminder in a 200,000 window is stated as about 54%, not 66%**, and the SessionStart and Stop timeouts match the hooks.
- **The README and the comparison no longer say that "nothing leaves your computer".** What it saves stays there, but what Claude reads of it goes to Anthropic with the conversation.
- **A long reply that was cut begins `… (N chars before)`**, as the 1.5.0 notes now say.

### To rebuild older journal entries

Entries saved before 1.5.0 lack the failed-command marks, the multiple-choice picks and the middle of replies. To rebuild them: once, in each store, delete `journal/.imported` and `journal/.looked`. The next Stops read your transcripts again, replace the entries and redact them under the newer rules. Forgotten entries stay gone and private conversations stay swept.


## 1.5.0 "Maat" (2026-11-17)

This release makes the journal true, then easier to search. It records what happened and only that: all of what Claude said in a turn, the real commands and errors, and subagent reports, and a command you refused is no longer saved as run. Search finds other forms of a word, and a new command finds secrets saved before a rule for them existed. Updating is recommended. Your existing memory works as it is.

### The journal records what happened

- **Everything Claude said in a turn is saved, not only its last message.** The lines in between ("Let me read the file.") are kept, and a reply after a background task adds to the answer instead of replacing it. When a reply is very long, the start is cut and the final answer stays.
- **A turn that hit a very long list of commands keeps the newest ones.** The earlier ones are replaced by one line, `[N earlier commands not kept]`, so the last command (a `git push`, say) is never the one lost.
- **A turn you stop with Escape keeps what it changed and ran.** Before, a turn with no reply saved nothing.
- **An API error no longer replaces the real answer.** A failed turn is saved at once, instead of 19 to 157 minutes later.
- **Your answers to Claude's multiple-choice questions are saved with your message** as `Picked: ...`, so search and forget find the entry by a word only in your pick.
- **A command you refused, or one a hook or the auto-mode check blocked, is no longer saved as run.** An edit that failed is no longer listed as changed, in the journal or in the note made before a compaction. A command that ran and failed stays.
- **A command that failed and was never fixed keeps the end of its error** (the last 300 characters) after it, so the next session sees what went wrong. If a later try of the same command worked, nothing extra is saved.
- **Code run through context-mode's ctx_execute and ctx_batch is saved with the commands**, where only Bash and PowerShell were before.
- **What a subagent reports back is saved.** Each report becomes its own journal entry ("Subagent <type>: <the task's first line>"), cut at 8,000 characters and cleaned of keys and passwords like everything else, so search and forget find it by a word only in the report.

Entries saved before this version are not rewritten.

### Search finds more

- **A version number is one word.** `memory search 1.4.3` finds entries that say 1.4.3 (and v1.4.3), not 1.4.30. Before, it said there was nothing to search for.
- **Search finds other forms of a word.** `migrated` finds `migrating` and `migration`, `releases` finds `release`, and the same works for common Macedonian endings (`базите` finds `базата`).
- **Rare words count for more.** A word only a few notes hold now ranks above one that nearly every note holds, and filler words such as "which", "many", "last" and "new" no longer count (unless the question is only such words). The number printed by each hit is its plain score: hits are ordered by how rare the words are, so the numbers can look out of order. On a real store, questions put in other words find the right entry more often (12 of 25 in the top five, up from 10), and questions in your own words still find it (25 of 25).
- **A question made only of small words still searches.** `memory search what did we do` looks for those words instead of giving up.
- **Search reads what you wrote in handoff.md.** The automatic log in that file repeats the journal and is still left out.

### Claude checks memory first

- **Claude looks in the journal before answering a question you may have settled before.** This includes advice questions ("should I", "is it worth") and relative dates ("last week"). In a test of 14 questions, it searched on 4 of 5 advice questions, up from 2 of 5, and still left plain questions alone.
- **The briefing tells Claude to trust the code over an old note, and to save a correction you give.** One short line, shown at startup and after a compaction.

### The briefing and compaction

- **The startup briefing names your last session for 30 days, not 7.** Coming back to a project after a few weeks still shows where you left off.
- **The pointer to your journal is also shown after a compaction**, so Claude still knows it can search earlier work.
- **If the briefing cannot load, it says so in one line** instead of showing nothing. Set `PROJECT_MEMORY_BRIEFING=0` to turn the briefing off. This now covers a failure while the briefing is being printed, not only a failed load.
- **A search that finds nothing during the first import says the journal is still importing**, instead of "nothing matches".
- **A compaction is put off at most once for the same point in a turn, and not at all once you have sent a new prompt.** A stuck turn can no longer hold a compaction until the context is full.

### Old secrets

- **`memory rescan` finds secrets that were saved before a redaction rule existed.** It checks your notes, journal days, handoff and every snapshot with today's rules, and prints counts and file names, never the text. Nothing changes unless you add `--apply --yes`.
- **`memory rescan --apply --yes` replaces each one with `[redacted]` and removes it from the snapshot history.** It first saves a backup (a copy of the old history and the changed files) and tells you where it is. The backup still holds the secrets, so delete it when you have checked the result. Revoke the secret with the service that issued it first; every snapshot that held one gets a new ID.

### Settings and size

- **Turning auto memory off in Claude Code now turns project-memory off too.** It follows `autoMemoryEnabled: false` in the settings files Claude Code reads, and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=0` turns it back on. `doctor` and `status` say where they found the switch.
- **`status` and `doctor` warn when a project's `handoff.md` is over 64 KB**, and say how to trim it.
- **A long request or reply that was cut now says how much was lost.** A request ends `… (+1,240 chars)`; a reply, cut at its start so the final answer stays, begins `… (1,240 chars before)`.
- **`doctor` says whether auto-update is on for the plugin's marketplace**, and where to switch it on.

### Documentation

- **The README now says that a marketplace you add yourself has auto-update off**, and how to turn it on.
- **The privacy policy lists every setting the plugin reads**: nine names from the environment and two values (`autoMemoryEnabled`, `autoMemoryDirectory`) from Claude Code's settings files. It also names each new kind of saved text and the backup that `memory rescan --apply --yes` makes.
- **Gateway and non-Claude model users are told to set `CLAUDE_CODE_MAX_CONTEXT_TOKENS`** to the real window, so the reminder to save notes comes at the right time.
- **The docs say that `forget --purge` works on a temporary copy of the history**, that `.hash-salt` is one of the files to delete, and that a shorter `cleanupPeriodDays` shortens what the journal can catch up on.

## 1.4.3 (2026-11-16)

This release fixes problems found in a full review of 1.4.2. Three of them kept some of your notes out of the snapshots, the backups project-memory uses to bring back a lost or overwritten note. Updating is recommended. Nothing changes in how you use the plugin, and your existing memory works as it is.

### Snapshots

- **Notes that Claude Code edits are backed up again.** When Claude Code edits a memory note, it adds a line with its session ID (`originSessionId:`). Since 1.4.1, project-memory took that line for a login cookie and left the note out of the snapshots. Real session cookies, such as `sessionid=` or `JSESSIONID`, are still kept out.

- **Notes that only explain the `<private>` tag are backed up.** A note that describes the tag, for example "wrap a secret in `<private>` and `</private>`", was treated as if it held a secret. It is now snapshotted like any other note, and `promote` shares it without asking for `--force`. A note with anything real between the tags, such as a PIN or a password, is still kept out, and so is text after a self-closing `<private/>`.

- **The first snapshot of a large memory finishes in time.** It used to check each note for secrets one at a time. Checking 80 notes took 14 seconds, and with about 1,500 notes the snapshot ran past its two-minute time limit and was cut off. It now checks all the notes in one pass.

### Everyday use

- **The session briefing no longer calls a busy session finished.** When another session's latest transcript entry was very large, such as a screenshot over 512 KB, the briefing at the start of a session said that session had ended while it was still working.

- **A broken file no longer stops the memory tidy-up.** A broken link in a memory folder, or a note deleted while the tidy-up was running, made the tidy-up of that folder fail after every reply. It now carries on. A note that another program has open still stops it, and it tries again after the next reply.

- **`forget --purge` works after a plain `forget`.** After `forget <words> --yes`, project-memory says the snapshots still hold the entry and suggests `forget --purge`. That command then found nothing, because the entry was already gone from the journal. It now searches the snapshots for the days that contain all of your words, in upper or lower case, and removes those. With `--key`, `--conversation`, `--since` or `--until`, it still removes only what matches.

### Messages and documentation

- `promote <note> --shared` on a note that exists only in the project now says the note isn't in the shared store and that you can drop `--shared`. Before, it said the note was already there.
- `incognito` without `--session` now tells you to use `/project-memory:incognito`, which passes it for you.
- The FAQ and the memory skill now mention `forget --purge`. The skill explains that `promote --force` moves a note that holds a secret, and the docs give the watcher's time limit as 5 seconds.

## 1.4.2 (2026-11-15)

This release makes project-memory better at finding and removing secrets before it saves anything, and it fixes a few problems with snapshots and the memory tidy-up.

### Secrets

- **Cookies and passwords after `curl -b` and `redis-cli -a` are cut again in more cases.** They were missed when a word ending in curl or redis-cli came before them (`pycurl`, `libcurl.so`, `-h myredis-cli`). A password typed on the line after `mysql -u root -p` is now cut as well.
- **Harmless text is no longer mistaken for `host:port user:pass`.** A time, ratio, score or `file.js:42` before a label (`at 14:05 Deploy:started`) is now left alone. A shell reference after `redis-cli -a` or `curl -u user:` (`$PASS`, `${API_PASS}`) is kept, and a run of `//x:` is no longer slow to save.
- **More secrets are redacted, and fewer harmless names are erased.** A password on the line after `mysql -p` is redacted (a database name or statement there is kept). Voyage AI keys of 40 to 46 characters are redacted, while long `pa-` kebab-case names are kept. IFTTT `/use/<key>` and `/json/with/key/<key>` URLs and Zapier `/hooks/standard/` URLs are redacted. `glft-` branch names and Nix store hashes (52 characters) are no longer erased.
- **Saving a long run of hostile text is faster.** The redaction rules for `curl -u`, `curl -b`, `redis-cli`, `htpasswd`, `?key=` and a `host:port user:pass` line used to cost 300 to 900 ms per MB. They no longer do.
- **A `forget` that follows more than 64 options of `memory.mjs` is now seen.** That turn now stays out of the journal.

### Snapshots and tidy-up

- **A tracked note that you edit to hold a secret is no longer reported as "busy" on every reply.** It is also no longer counted as "still to add" after a good snapshot.
- **A note with a key or token in its file name is no longer added to MEMORY.md by the tidy-up.** `doctor` tells you to rename it. A line already in MEMORY.md, and the name shown by search and status, are not changed yet.
- **A note held out of the snapshots because it holds a secret is now named at startup too.** The message also says how to release it: remove the secret.
- **A broken `handoff-log.mjs` no longer stops the memory tidy-up.**

## 1.4.1 (2026-11-14)

This release is mostly about secrets. Saved text now drops far more kinds of passwords, tokens and keys, memory notes that hold a secret are kept out of the snapshots, and the memory files are private on Linux and macOS. It also makes the `enforce:` rule watcher read more kinds of git commands.

### Redaction and what is saved

- **Messages between sessions are no longer saved as something you asked.** A message another session or a subagent sends (cross-session-message, agent-message) used to be stored as your request. A forked session also no longer lists its parent's turns again in `handoff.md`.
- **Harmless lines are kept again.** These had been cut as secrets: URL and path settings (`TOKEN_URL=https://...`), a secret's name or reference (`secretName: x`), code that makes a token (`secrets.token_hex(16)`), schema types (`password: z.string().min(8)`), variable and template references, `theme=dark` cookies, "Password" labels, and prose after a key (`password: required`).
- **A password typed alone as the answer to a password question is no longer kept.** This covers one token or a passphrase of plain words, in the compaction note and after a question asked with AskUserQuestion. "Passwort ist x", "mot de passe est x" and quoted passphrases are cut. One-time-code prose and `creds: file.js:42` are kept.
- **Passwords written in chat are no longer kept.** Examples are `pw: x`, `DBPW=x`, `credential=x`, `creds: bob / x`, `set the password to x`, `the PIN is 123456`, backup codes and `the password is correct horse battery staple`. The same goes for passwords in German, French, Spanish, Russian, Swedish, Danish, Dutch, Portuguese, Polish, Japanese, Chinese or Korean (`Passwort: x`), and for a password typed alone as the answer to "what is the password?".
- **Session ids and cookies are no longer kept outside the Cookie header.** This covers sessionid, JSESSIONID, connect.sid, PHPSESSID, cookie-jar lines, HAR, and Chrome and Playwright cookie objects. It also covers secrets in JSON and YAML keys (token, credentials, key, short passwords, Postman, `::add-mask::`), secrets in code (Python, JS, PHP, Java, Go, C#), `.env` lines after a `$ ` prompt or in chat and log lines, a base64 credential piped to `base64 -d`, and echoed password and passphrase prompts.
- **Database, mail, Windows and network logins are covered.** Passwords and keys are no longer kept from database logins (Oracle, SQL Server, MongoDB, Redis, Mosquitto, Confluent), mail and file protocols (IMAP, POP3, FTP, lftp, postfix, curl -K), Windows tools (net user, net use, psexec, rdesktop, Wi-Fi keys), Wi-Fi and VPN settings, PowerShell parameters, .pgpass, LDAP, Jenkins and machineKey settings, openssl and similar commands, and password hashes (apr1, bcrypt, SHA-crypt, argon2, NTLM, DPAPI blobs).
- **Passwords given to more command-line tools are no longer kept.** The tools are ssh-keygen -P, a password piped to docker login, sudo -S, kinit, chpasswd and similar, helm, skopeo, crane, oras, mc, rclone, az, aws and gcloud secret flags, terraform -var, sqlcmd, bcp, mycli, cqlsh, keytool, jarsigner, 7z, unzip, rar, ccrypt, plink, pscp, sshpass, smbclient, xfreerdp, rabbitmqctl, dotnet user-secrets, redis ACL SETUSER, reg add, curl `pw=` and HTTPie `password:=` fields, and htpasswd -nb.
- **Tokens from about 40 more vendors are no longer kept.** They include Terraform, Vault, Doppler, DigitalOcean, Heroku, Cloudflare, Sentry, Grafana, New Relic, Okta, Splunk, CircleCI, 1Password and more. This includes the ones given to `doctl -t`, `netlify --auth`, `ngrok add-authtoken`, `cargo login`, `composer config` and `bundle config`.
- **Tokens from about 30 more vendors are no longer kept.** They include GitLab, Discord, Teams, Twilio, Sidekiq, Dropbox, Azure and AI keys. The secret catalog lists them.
- **More credential formats are redacted.** Authorization headers of any scheme (Digest, Hawk, OAuth1, AWS Signature V4, Negotiate, NTLM, SSWS, ApiKey), unsigned JWTs, webhook signature headers, and `?auth=`, `?token=` and `?Authorization=` in a URL are redacted. So are Docker `config.json` auth and identity tokens, `httpie -a`, Flask `SECRET_KEY`, HMAC, Fernet and hex keys in code, `aws configure set --profile p ...`, a bare 40-character AWS secret key, seed phrases, Bitcoin WIF keys, Solana keypair arrays, base64 private keys without a header, `oathtool` secrets, and sops and ansible-vault blobs.
- **Known limits.** A bare 32-hex Rails `master.key` with no keyword, and a key given as `key=<hex>` with no vendor or secret word, are kept. A long list of small numbers in code is cut as a possible Solana key.
- **Look-alike spellings no longer hide a secret.** Secrets are now redacted behind full-width letters, hidden characters, accents, HTML entities, and percent and unicode escapes. They are also caught in JSON inside strings, in values with commas, semicolons, escaped quotes, braces, line wraps or blank lines, in long quoted values, and behind wrappers such as arrays, CDATA, shell quotes and `-p'..'`. A Cyrillic or Greek look-alike letter is still not caught.
- **Redaction leaves the rest of an entry as written.** When a secret is found, the rest of the entry keeps its accents, entities and escapes. A long run of backslashes no longer slows redaction.

### Notes and the files on disk

- **A note that holds a key, token or password is kept out of the memory snapshots.** `status` and the startup line say which one. A note with a secret in its file name is kept out too.
- **`memory promote` refuses such a note.** `--force` copies it anyway.
- **`memory history`, `restore` and `promote` print no secret from a note's name.** `memory search` and `memory status` no longer print a secret that sits in a note's file name or `[[link]]`.
- **Index lines for notes without an entry no longer copy a secret.** Before, a secret in the description or file name could end up there.
- **`compact-gate --state` and the gate's messages no longer print secrets.** Stored failure reasons no longer keep a secret that an error message quoted.
- **`memory forget --purge` also removes the forgotten entry from the snapshot history.**
- **Journal keys and the Stop run log no longer hold a plain hash of your prompt or reply.** A short password could be guessed from it.
- **On Linux and macOS the memory files are private.** Files are 0600, folders 0700, and the snapshot `.git` is 0700. An older install is made private too at the next Stop, and `forget --purge` waits for a snapshot in progress instead of overwriting it.
- **The README and FAQ now say which saved files the redaction promise covers.**

### Enforce rules

- **The enforce log is better behaved.** It no longer stops at 256 KB (the oldest half is dropped instead), and one line is capped in size. Nothing is logged in a private-session turn, and a missing plugin file no longer makes the hook print an error.
- **Rules are read more reliably.** A rule after a long description is no longer ignored. A note with a long run of blanks can no longer stall every git call, and a command with many unclosed heredocs is read in linear time.
- **Rules now see more forms of a git command.** They see a command after an escaped quote, after git options like `--no-optional-locks`, inside `{ }` or `( )`, after a line continuation, after a quoted `<<`, and behind `env`, `sudo`, `command`, `rtk`, `git.exe` or a full path to git.

### Speed

- **A very long or hostile prompt, command or answer no longer stalls the memory hooks.** A slash command's name, `memory.mjs` options, a JWT-like run, a value with many slashes and a long `SetEnvironmentVariable` value are read in linear time. Saved text is cut to 64 KB before secrets are removed.

## 1.4.0 (2026-11-14)

This release adds a watcher for the `enforce:` rules in your notes, plus two commands to see what those rules do. The watcher only logs. It blocks nothing and prints nothing.

### New

- **A new hook watches git commands against your `enforce:` rules.** It logs which note matched, in `.enforce-log` in the store, and never logs the command text. It does nothing while memory is off or the conversation is private.
- **`memory enforce status` shows how each rule is doing.** For every rule note it lists the hits of the last 30 days from the live log (main and sub-agent), bad rules with the reason, and whether the log is full or memory is off.
- **`memory doctor` checks the enforce hook.** The new line runs the enforce hook of the installed plugin and checks it is wired, even when memory is off.
- **`memory enforce replay <note>` shows what a rule would have caught.** It lists matches from the last 30 days of your conversations. It is read-only, and it skips private sessions and projects with memory off.

## 1.3.3 (2026-11-14)

This release fixes a problem where two hooks could work in the same memory store at once. It undoes a change made in 1.3.2.

- **A lock left by a gone process is no longer taken over at once.** A hook could take over a lock just as it was being released, and two hooks then worked in a store at once. The lock of a killed hook is taken over after 30 seconds again, as before 1.3.2.

## 1.3.2 (2026-11-13)

This bug-fix release makes `forget`, `promote` and `restore` safer with unusual notes, keeps more secrets out of what is saved, and fixes several cases where a message or a snapshot could be lost.

### Commands

- **`forget` finds text with accents whichever way the accent is stored,** as `search` does.
- **`forget --conversation ""` is refused.** Before, it forgot in every conversation.
- **`--store ~/...` works in PowerShell and cmd too.**
- **`promote` of a folder says it is a folder,** instead of printing an error trace.
- **`promote` refuses a note that is not UTF-8 text.** Before, it copied the note with broken letters and deleted the original.
- **`promote` and `restore` move a long index line as a whole** when it wraps onto a second line.
- **`restore` brings back a note that is not UTF-8 byte for byte,** not with broken letters.
- **`restore --force` keeps the text it replaced under a git ref,** so a later `git gc` does not delete it.
- **`doctor` warns when the `autoMemoryDirectory` setting is set,** because the plugin does not follow it.

### Locks and snapshots

- **A lock left by a killed hook is taken over at once,** not after 30 seconds.
- **A Stop that finds the store held waits once more,** so twenty Stops at once lose fewer turns.
- **The first snapshot works with a very large store** (more than about 15,000 notes). The file list used to overflow git's output buffer.
- **A snapshot that finds files changed after its commit keeps the next Stop owing one.** This happens when another session writes at the same moment. `MEMORY.md` is no longer left out of the history.

### Secrets kept out of the notes

- **More secrets are cut before they are saved.** These are SQL passwords (`PASSWORD '…'`, `IDENTIFIED BY`), and redis, mongo, zip, ldap and mosquitto passwords. They also include a Telegram bot token inside the API URL, `curl -u user:"pass"`, `--proxy-user`, XML `<password>`, PowerShell `ConvertTo-SecureString` and `$pw =`, `net use`, `schtasks /rp`, a short Basic credential, a URL password with `/`, `?` or `#`, npm `_auth`, more vendor tokens, a `?key=` or `?code=` in a URL, and a password after a full-width colon.
- **One very long value after `NAME=` or `--password` no longer slows a Stop down** for seconds.

### Recording

- **A session no longer writes into another project's memory after a `cd`.** This happened when the session's first folder was recorded after the first 64 KB of its transcript.
- **A message you type while Claude is working is kept.** It now opens its own entry in the handoff and the journal. It was lost before.
- **Running the `memory` skill no longer freezes the handoff.** The answer to your real question is saved.
- **A message that starts with your own tag is kept as your question.** This covers a tag such as `<my-card>` and a message starting with `[SYSTEM_SERVICE]`. Before, it was dropped as an automatic one.
- **A turn with no time in the transcript is no longer saved after you had turned memory off.**
- **One huge request, reply or command no longer fills the journal.** Each is cut at 20 to 50 KB.
- **A transcript too big to find your last request in now leaves a failure note,** instead of saving nothing in silence.
- **A `handoff.md` saved with a byte-order mark (BOM) keeps the "Last session" line in the briefing.**

### Documentation

- The README says `MEMORY.md` is rewritten in place as a plain file and that `##` headings in it are not kept.

## 1.3.1 (2026-11-13)

This release fixes bugs found in a five-part audit (correctness, security, Windows/macOS/Linux, data loss with parallel sessions, test gaps) and in the review that followed. After upgrading, each note is read again once, so earlier misreadings of your notes are corrected.

### Keeping notes safe

- **A store lock is released only while it is still this session's.** An unlock that meets `ENOTEMPTY` is retried.
- **`restore --force` replaces nothing when it cannot keep a copy of what it replaces.**
- **A `MEMORY.md` or `handoff.md` that is not UTF-8 is left as it is.** This covers files saved by PowerShell 5.1's `>` or `Add-Content`, as journal days already were. Before, such a file was written back with its accented letters gone.
- **`.health` and `.snapshot-health` are written through a temp file.** On Windows, a rename that a scanner holds busy is retried for up to 1 s.

### Tiering

- **A hook wrapped over several lines stays under its pointer.** All its lines now count toward the 200 lines Claude Code loads.
- **A note is archived as superseded only when `superseded-by` names a replacement.** A note stamped in the future ages by its file time.
- **An index line whose title holds `[brackets]` reads back correctly, nested brackets too.**
- **`modified: YYYY-MM-DD HH:MM` keeps its time.**
- **Each note is read again once after the upgrade.** The cache 1.3.0 kept in `.facts` held these misreadings for notes unchanged since. A note that 1.3.0 archived by misreading `superseded-by: none` comes back while its age allows.

### Redaction

- **Secrets given as `--api-key`, `--passphrase`, `ssh-keygen -N`, `redis-cli AUTH user pass` and similar flags are redacted.** `find -name '*.7z' -print` is no longer mistaken for one.

### Platforms

- **A relative `CLAUDE_CONFIG_DIR` is resolved once,** so every hook uses the same folder.
- **Snapshots pass `safe.directory`.** Git no longer refuses a snapshot repository that was first made from an elevated shell or under `sudo`.

### Documentation

- **PRIVACY now says what snapshots keep and that notes are not scrubbed of secrets.**

### For contributors

- Stale mutants now point at the current code, with new ones for these fixes.
- Three tests that a busy Windows runner failed are steadier.

## 1.3.0 (2026-11-09)

This release adds ways to stop project-memory saving a conversation or a whole project, and makes search find short Chinese and Japanese words. Hooks now have time limits, so a stuck one no longer holds Claude Code up for 10 minutes.

### New

- **`/project-memory:incognito` stops saving the current conversation.** It also sweeps what was already saved from the journal and `handoff.md`. If it did not work, it says so (`NOT applied`) instead of claiming success. Claude Code by default still keeps its own transcript, its own auto memory may still save notes, and snapshots of days already over keep a copy.
- **`/project-memory:memory-off` and `memory-on` turn project-memory off and on for one project.** They use a `.project-off` marker. Off stops adding, but it doesn't hide: `search` and `show` still answer. `status` and `doctor` say when a project is off, and a marker that can't be read counts as off. What was said while it was off stays out afterwards (`.off-periods`), and a conversation that ran across off and on keeps its turns before and after.
- **The docs say what each way of turning it off covers.** README, PRIVACY and how-it-works say what each way does and does not cover. Incognito holds across a resume. `/clear` starts a new conversation, which is not incognito.

### Search

- **`search` finds two-character Chinese and Japanese words.** In a test of eight queries, three missed on 1.2.7 (记忆, 部署, 設計) and none miss now. Two-letter words in other scripts still match only standing alone, so `ci` does not match "decision".
- **Search tells you which words found nothing.** When some search words are held by no note or entry, one line after the hits names them, such as `no note or entry holds: hetzner`.

### Memory index

- **A project notebook gets a `MEMORY.md` if it lacks one.** This applies to a notebook the plugin has written to. The new file has a title only, and it is made in the reply that made the handoff. A manual run does the same for every project.
- **Journal links are removed from the index.** A line like `- [title](journal/2026-11-01.md)` is removed, including one written by hand. A line with text after the link stays.
- **A note with no index line is filed by its age.** A recent one goes in the index and an old one in the archive, like any other note. Before, it always went to the archive.

### Hooks

- **Each hook now has a time limit.** It is 120 seconds for Stop and `/compact`, 60 for the automatic compaction check, and 30 for the startup briefing. Before, Claude Code waited 10 minutes. Each hook shows a short status message while it runs.
- **`/compact` no longer prints the tidy-up report.** What a PreCompact hook prints becomes part of the instructions for the summary. The work itself is unchanged.
- **The "Stop hook is not running" line names more causes.** It now also names a `disableAllHooks` setting, `--bare`, `--settings` and `CLAUDE_CODE_SKIP_PROMPT_HISTORY` as possible causes.

### For contributors

- The checks now fit the size of the plugin. A pull request runs the normal tests on three setups and the sign-off check. Before a release the changes get one code review, and what it finds is fixed.
- Mutation tests and the long fuzz are no longer part of a pull request or a release, and stay in the repo to run by hand. `node check.mjs` and `node deploy.mjs` run mutants only with `--full`, and `deploy.mjs --mutants-checked-on-github` is gone.
- CodeQL and Scorecard run weekly and block nothing. Dependency review is gone, because the plugin has no dependencies.
- New tests pin that a Stop stopped during git loses nothing, that a reply missing at one Stop is journaled by the next, and that copied turns which keep their ids add no second journal entry. The startup briefing still skips forks.

## 1.2.7 (2026-11-08)

This release changes only the tools that build and check the plugin. The plugin itself is unchanged.

### For contributors

- **Two stale ignores are gone.** Two ignored automatic mutants whose code no longer exists left the ignore list.
- **Hand-written mutants moved from `mutate.mjs` to `mutants/`.** There is one file per source file, so adding a mutant reruns only that file's mutants, not all of them.
- **A push to `master` no longer reruns mutants its pull request already ran.**
- **The release steps are clearer.** They give the commands for the big mutant run and the fuzz, start the mutants first so the two queue less, and run both on the release branch before the merge, as 1.2.6 did.
- **`mutate.mjs --list` keeps every line when its reader is slow.** A busy Linux machine lost the end of the list and failed the check at random.
- **`check.mjs` catches a mutant label given twice when no space comes before its `[`.** Nine labels were written that way, and none was doubled.

## 1.2.6 (2026-11-06)

This bug-fix release comes from a full audit of the repository and an independent review of its four riskiest files. Every confirmed finding is fixed. One of them: the memory snapshot could be written into your own project's repository when Claude ran from inside a git hook.

### Your own repository

- **The memory snapshot no longer lands in your project's repository.** When Claude ran from inside a git hook in one of your projects (a commit hook, say), git settings pointing at that project (`GIT_DIR`, `GIT_INDEX_FILE` and others) reached the memory snapshot's git. The snapshot could then be written into your project's repository, or break its index. The plugin's git now clears them first.

### Secrets kept out of the notes

- **More secrets are replaced with `[redacted]` before anything is saved.** These are Slack `xoxe-` tokens, Perplexity `pplx-` keys, Discord webhook URLs, and Telegram, Linear, Postman, Replicate, Supabase, Databricks, Sentry, Twilio, Mailgun and Mapbox keys. They also include cookies (a `Cookie` or `Set-Cookie` header, and curl's `-b`/`--cookie`), the signature in a signed URL (Azure, S3, Google Cloud), an `Authorization` value with no scheme word, `redis-cli -a`, and "API key: …", "Secret key: …" or "Access key: …" written with a space. Text saved before this update stays as it was.

### Notes and the index

- **A note can no longer be archived by a stray line in its body.** A note that starts with a `----` line, or holds a `---x` line, was read as if that line closed its frontmatter. A body line `tier: archive` could then archive it, and search skipped its first lines. Only a line of exactly `---` opens or closes the frontmatter now. A `tier:` line quoted inside a `description: |` block no longer sets the tier.
- **A note named `MEMORY-something.md` is now indexed, archived and found.** Before, it never was. Only `MEMORY.md` and `MEMORY-archive.md` are indexes now.
- **A second tidy-up run leaves the index alone.** With nothing changed, it still rewrote the index. It now leaves it as the first run wrote it.

### Recording and compaction

- **A cut-off or refused reply no longer counts as still working.** A reply cut off at the token limit, stopped by a stop sequence, or refused made the compaction gate hold off, and the turn read as open. Only a tool call or a server pause keeps a turn open now. Pressing Escape after a tool call ends the turn too.
- **A subagent's reply can no longer close the main conversation's turn.** Subagent records are now skipped there, as they already were elsewhere.
- **The briefing never cuts a long line mid-word.** It cuts at the end of a sentence, else at a word, so a fact keeps the condition that follows it.

### Search

- **Words with combining marks are found.** Hindi words, or an accent typed as a separate mark, were split apart and never found. They are whole words now, and `café` typed either way finds the other. The line of the reply that holds it is shown too.

### Checked

- **`--session` finds the project from any folder.** The memory skill receives the session id (`${CLAUDE_SESSION_ID}`).

### For contributors

- New tests: a fake `[User]:` line in a file or tool output never shows up as your words, and what survives a compaction is checked without a model.
- The "8 writers at once" test no longer fails on a crowded machine, and `mutate.mjs` reruns a timed-out mutant once, alone, before counting it. A test that runs git after a slow snapshot waits for its lock to go.
- README and SECURITY.md now describe the release checks and the CI tools as they are. CONTRIBUTING's release steps hold merges until the tag.

## 1.2.5 (2026-11-06)

This release keeps every exchange in the journal in full, starts a new conversation with the last conversation's own exchanges, and makes search results shorter. It also closes a number of privacy gaps (secrets that were saved, private tags that were ignored) and fixes snapshots that never started on very large memories. Entries written earlier stay as they were.

### New

- **The journal keeps every exchange whole.** It now holds your whole message, Claude's whole reply, every file Claude changed and every command it ran, each in full. It used to cut the message at 2,000 characters, the reply at 6,000, and keep only the last 20 commands at 400 characters each. Entries written before this update stay as they were. The journal grows faster: measured on real conversations, half the entries are under about 5 KB, and a very busy project adds about 110 MB a year (it was 40 MB).

- **A new conversation starts with the last conversation's own exchanges.** The briefing now shows what you asked, what Claude did and the files changed, not only one line saying where the last conversation stopped. They fill the briefing up to 3,500 characters, under 1,000 tokens, with the oldest left out first, so the briefing stays as short as before. With a full shared notebook there may be room for none. For this, `handoff.md` keeps more of each exchange: 500 characters of your message (was 240) and 900 of the reply (was 400).

- **A journal search hit is now a headline.** It shows the request cut at 200 characters (was 400) and a `Result:` line with the first sentence of the reply, so the outcome shows even when the search words sit further in. Short stretches around the search words follow, 240 characters in all (was 800). The transcript's path moved to `show <key>`, and the last line says so. Ten hits are about a third smaller, which is less for Claude to read every time it searches.

### Private conversations and forgotten entries

- **The start of a conversation never shows a private conversation.** The words of a conversation marked `<private-session>` never appear, whether it is the last conversation or one still working. An exchange you had Claude forget is never listed, even when removing it from `handoff.md` failed. If the list of private conversations can't be read, the briefing names no last conversation. If the list of forgotten exchanges can't be read, it lists none.

- **Exchanges from a conversation held with auto memory off are never listed at the start.**

- **A forgotten entry no longer shows when `forget` could not rewrite its day file.** The entry stayed there, and `search`, `show` and the day's listing still showed it until `forget` ran again. They now leave it out. When the list of forgotten entries can't be read, they show none of that project's journal, and say so.

- **A conversation held with auto memory off stays out of `handoff.md` too.** It already stayed out of the journal. Before, if you went on with it after turning auto memory back on, the first reply saved its last exchanges to `handoff.md`, including those typed while auto memory was off, and the next briefing could show them. Claude also does not get the reminder to save its notes in such a conversation, and no note of a turn cut by a compaction is kept for it. If the list of such conversations can't be read after a reply, nothing is saved for that reply, and the next briefing says so.

- **`<private>` and `<private-session>` work in answers to Claude's questions.** They now count when you type them as your answer to a question Claude asks, or as what you tell Claude when you turn down something it was about to do. Before, they were ignored there: Claude's reply, which could repeat the private text, and the names of the files it then changed were saved, and `<private-session>` marked nothing. A tag that only appears in a file Claude reads, in a command's output or in Claude's own question still counts for nothing.

- **The tags work with any invisible character inside them.** This covers a soft hyphen, the left-to-right and right-to-left marks that a right-to-left keyboard or a paste can add, and the like. Before, only zero-width spaces and joiners were looked past, and a tag with one of the others kept nothing private.

- **The journal ignores subagent transcripts as conversations.** It no longer takes in a subagent's own transcript as a conversation of its own, and no longer reads a subagent's messages inside a conversation's transcript as yours. Claude Code keeps subagents elsewhere today, so nothing changes now. An older layout could have had a private conversation's subagent journaled.

- **The FAQ now says correctly when auto memory stops project-memory.** It said project-memory saves nothing when auto memory is turned off. It follows only the `CLAUDE_CODE_DISABLE_AUTO_MEMORY` environment variable. Turning auto memory off in Claude Code with `/memory` or its `autoMemoryEnabled` setting doesn't stop it, since it never reads Claude Code's settings. The FAQ, the privacy policy and How it works now say so, and that disabling the plugin is the way to stop it.

- **The privacy policy now describes `forget --yes` correctly.** It said the command removes the matches when there are too many. It removes nothing then and asks you to narrow the search, as the command always did.

### Secrets

- **A password under a settings key such as `secret:` is now redacted.** This covers `secret:`, `secrets:`, `passwords:` and `tokens:`, as in a YAML file with `secret:` on one line and `password: …` indented on the next. The value is replaced with `[redacted]`. Before, the child's name was taken for the secret and the real value after it was saved. Every entry indented under such a key whose value looks like a password or a token is now redacted, not only one whose own name says password. Names, settings and the lines after the key are kept.

- **A quoted password or token is now redacted too.** This covers a password or token Claude passes to a command in quotes: `--password "…"`, `--token '…'`, `-p "…"` after `docker login` or `sshpass`, `curl -u "user:…"` and `aws configure set … "…"`. Before, only unquoted ones were. A quoted value goes whole, spaces and all, here, in `export`, `setx`, `$env:` and `.env` lines, and in a setting such as `api_key: "…"` or `password = '…'`, where only a first word of 6 characters or more went before.

- **More secret shapes are replaced with `[redacted]`.**
  - PowerShell's `$env:NAME = "…"` where the name says key, secret, token or password (as `export NAME=…` already was).
  - A `.env` file's `NAME=…` line whose name ends in such a word, and the same in cmd's `set NAME=…`, after `&&` in a command, in a compose list item and in a Kubernetes `- name:` / `value:` pair.
  - A JSON object under a key such as `"secrets"`.
  - An Azure connection string's `SharedAccessKey=…`.

- **A token after `Bearer`, `Basic` or `Token` is redacted in two more cases.** The token is replaced with `[redacted]` when it has no digit in it (32 characters or more), and when an invisible character sits between the word and the token. Before, both were saved as they were.

### Saving and recording

- **A very long turn is written at once.** A turn with more than 32 MB of tool output after its request (for example a long browser task's screenshots) was never written by its own conversation's replies. It did not reach `handoff.md`, and reached the journal only once another conversation took it in, half an hour later. The request is now found further back, up to 256 MB, and the turn is written at once.

- **A conversation in a folder with a very long path now saves.** Before, a conversation started in a subfolder of a repository with a very long path (a folder name past 200 characters, which Claude Code shortens) saved nothing and said nothing, because its handoff went to a folder name too long for the disk. It is now kept in the conversation's own folder, as the docs say.

- **A save cut off half way no longer leaves a copy behind.** If Claude Code closed right after a reply, a temp copy of the journal day or `handoff.md` was left on disk for good, and `forget` didn't reach it, so words you had forgotten stayed on disk. The next reply now removes such copies, once the process that wrote one is gone or the copy is over 30 seconds old, and so does `forget`.

- **A journal folder that refuses writes no longer fails in silence.** Before, every reply's entry was lost, because the record of the failure, `journal/.failed`, is in that same folder. It is now kept beside the projects folder (`.journal-failed-<project folder>`) when the journal won't take it, and the startup briefing and `status` say it.

- **A full disk is now reported as a failed save.** A full disk, or a projects folder that refused writes, was reported as "Memory hooks look stopped … if project-memory was turned off meanwhile". The briefing and `doctor` now say the save failed, and why: the disk is full, or the folder refuses writes (with the code).

- **A note of a cut turn is no longer dropped without a clear message.** When another window changed `handoff.md` while a note of a cut turn was being written, the note was dropped and the hook said the file had no place for it. It now says the handoff changed meanwhile.

### Compaction reminder

- **The reminder to save notes comes early enough with a smaller window.** With a smaller compaction window, such as the 200,000 tokens the FAQ suggests for a 200k model, the reminder came only about 22,000 tokens before the compaction, too late for a long reply. It now comes early enough to leave at least 60,000 tokens: at about 66% of a 200k window, counted from where the compaction really comes, also when `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` moves it earlier. A window too small for that gets it halfway to the compaction. A 1M window still gets it at 85%.

- **An error in the transcript no longer hides the reminder.** An error Claude Code adds to the transcript (an entry with no real token counts) was read as a conversation of 0 tokens, so the reminder could be skipped after it. Such entries are now passed over.

### Snapshots

- **The history now starts on a large memory.** On a large store (about 5,000 files on Windows), the history never started: the first snapshot's `git add` ran past its 30 seconds, was stopped, and left git's lock behind. Every later try then found the lock and gave up as "busy", which was never counted, so `doctor` said "none recorded yet" and the startup briefing said nothing. Also, the tidy-up was only marked done after a snapshot, so every reply redid it (14 s at 6,000 notes). What changed:
  - The first snapshot is taken in parts, 1,000 files a reply, the indexes first.
  - A git command stopped at its time limit makes the next replies go on in parts.
  - The tidy-up is marked done whatever the snapshot did, and a snapshot that didn't go through is tried again alone after the next reply.
  - Waiting on another git for more than 10 minutes counts as a failure.
  - `doctor` says when the first snapshot is still being taken or none has been taken yet.

### Several windows at once

- **Two windows no longer take over the same lock.** When a window left a lock behind (it was closed mid-save), two others waiting for it could both take it over and write at the same time. Now only one takes it over, short of three windows racing within the same few microseconds.

- **No more lost lines in the Stop hook's log.** When the Stop hook cut its own log (`.stop-ran`) back, a line another window added at that moment could be lost, and `doctor` could then miss hooks set up twice. The log is now cut only if nothing was added meanwhile.

### Speed

- **The tidy-up after a reply is faster.** After a reply that changed a note, the Stop hook read the top of every note to tidy the index, about a second at 1,000 notes on Windows. It now keeps what it read of each note (its type, `tier:` and date, in `.facts`) and reads a note again only once it changes. It also looks at each note's size and time once a reply instead of three times. On Windows, such a Stop took 0.45 s at 100 notes, 1.1 s at 500 and 1.3 s at 1,000. It now takes 0.32 s, 0.40 s and 0.46 s.

- **Waiting for another window is shorter.** While another window held the notebook, one Stop waited up to 2 seconds for each of its locks: 6.4 seconds, 8.5 with the shared notebook. The 2 seconds are now for the whole Stop, as documented: 2.4 and 2.5 seconds.

### `forget`

- **`forget <words>` finds an exchange the journal doesn't hold yet.** This is an exchange whose reply came while another window held the project's memory folder, and which is saved at the next reply. Before, the command said nothing matched, and the next reply saved the exchange. It is now listed as not in the journal yet, as with `--key`. It leaves out conversations marked `<private-session>` or held with auto memory off, and reads an exchange whole even when it sits across one of the 64 MB parts a long conversation is read in.

- **`forget --key` no longer says "removed" for an unreadable day file.** While a day file can't be read, such a key is named as in no day that could be read, nothing is removed for it, and the command fails.

- **Running `forget --key ... --yes` again finishes the job.** After a first run couldn't update `handoff.md`, a second run said "already forgotten" and left the exchange there for the next conversation's start. It now takes it out of `handoff.md`, and says so.

- **`forget` says where your data still is.** After removing entries, it says that Claude Code's own conversation files still hold them: it changes only project-memory's files.

### Commands

- **`promote journal` is refused**, as `promote handoff` is. It moved the journal's own pointer into the shared notebook.

- **A note's name of several words works without quotes.** `restore my note` used to answer about `my.md`.

- **`history`, `restore` and `promote` find a note in another letter case.** This works on Windows and macOS (`history Pricing`, `PRICING.MD`), and in either Unicode form everywhere (`café` typed one way, the file named the other), deleted notes too. When two names read alike, neither is taken. The letter case is ignored only where the folder itself ignores it: a case-sensitive folder (possible on macOS and Windows) gets the exact name.

- **`history` and `restore` say plainly when they can't work.** They now say when there are no snapshots yet, when Git isn't installed, or when no snapshot holds a note, instead of git's own error. Without Git, `restore` no longer offers to replace a note "with the snapshot".

- **Bad input is refused.** A date that isn't on the calendar (`--since 2026-02-30`) is refused, and so is an option that needs a value with none after it (`forget --key --yes`).

- **Under `--all`, a journal hit names its project better.** It uses the folder you worked in, then the folder name `--store` takes.

- **`status` is more accurate.** It says "1 day", doesn't count `handoff.md` and `journal.md` as notes without an index line, and says when the conversation `--session` names isn't on this computer.

### `doctor` and the start of a conversation

- **`doctor` no longer stops with an error** when it can't read the time of the last Stop.

- **`doctor` no longer reports hooks as set up twice by mistake.** This happened when two replies of one conversation came less than 2 seconds apart. Each run now notes a short fingerprint of its reply to tell them apart.

- **The start of a conversation names another working window by its last request.** It uses the last request recorded for it, and says so: what it works on now may be newer.

### Small fixes

- **The tidy-up's line no longer shows a negative saving.** It is printed by a manual run, and on the Stop's own output, which nobody sees. An index that grew showed as `(~-26 tokens/session)`. It now says `(grew ~26 tokens/session)`.

- **`MEMORY.md` keeps its Windows line endings.** A file saved with CRLF was rewritten with LF, and the blank line under its heading was dropped, when the plugin added its lines. It now keeps the file's line endings, and the blank line.

- **A note named with an impossible date is no longer archived.** A name with a date that isn't on the calendar (`2026-02-31-…`) was read as a real date, so the tidy-up could archive it. Such a name now counts as having no date.

- **A note whose closing `---` is the file's last line is read correctly.** With no line break after it, the note was read as all body, header included, so a search could match words of its header. Its body is now empty.

## 1.2.4 (2026-11-01)

This release fixes two privacy gaps in how forgotten and private conversations are handled. It also makes releases easier to verify and records the project's security practices.

### Privacy

- **`forget --key` now works on a reply that was not saved yet.** A reply that comes while another window holds the project's memory folder is saved after the next reply. If you forgot that exchange by its key before then, `forget --key` said no entry had the key and kept nothing out, and the next reply saved the exchange in the journal and the handoff. It now finds the exchange in its conversation, lists it as not in the journal yet, and with `--yes` keeps it out of both. A key you forgot before is named as already forgotten, and nothing more is removed.
- **A private conversation no longer keeps its earlier journal entries when the list of auto-memory-off conversations cannot be read.** The journal's look for older conversations used to stop at the first one that needed that list. A conversation you had marked private, met after it in the same look, kept its earlier journal entries until the list could be read again. The look now goes on past it, and still reads the list only once.

### Releases

- **Each GitHub release now comes with its source as a `.tar.gz` and a `.zip`, a `SHA256SUMS` file, and a signed attestation that the project's release workflow made them.** How to check them is in [SECURITY.md](SECURITY.md#verifying-a-release). Installing with `/plugin` works as before.
- **Changes now reach `master` only through pull requests that pass the tests.** Every commit in one must be signed off ([CONTRIBUTING.md](CONTRIBUTING.md#developer-certificate-of-origin)).

### Project

- **GitHub's CodeQL scan and the OpenSSF Scorecard run on every change.** The project holds the OpenSSF Best Practices passing badge and Baseline level 2. The answers and their evidence are in `.bestpractices.json`.
- **New documents:** [GOVERNANCE.md](GOVERNANCE.md), [SUPPORT.md](SUPPORT.md) and a [security assessment](docs/security-assessment.md). The README has a "Security and trust" section, and its pictures now come in a phone version too.

## 1.2.3 (2026-11-01)

project-memory now needs Node.js 22 or newer. Node 20 reached its end of life in April 2026 and gets no more security fixes. If `node --version` says v20, install the current LTS from nodejs.org. The rest of this release closes gaps in how private conversations and secrets are kept out of the journal, and fixes a few smaller problems.

### Privacy

- **A `<private-session>` conversation stays private after a very long tool output.** When you went back to it, even once it had dropped off the list of private conversations (which keeps the newest 1,000), each new exchange of it was saved. Now it stays out of the journal, the handoff and the next session's briefing.
- **The same now holds for what you add while project-memory is disabled.** The journal no longer takes it in later. Entries an earlier version saved from such a conversation are removed when the journal next meets it. A conversation held with auto memory off that has lost its tag is now tagged private, so it also leaves the handoff.
- **An unreadable list of private conversations no longer lets one be saved.** If the list of private conversations, or of those held with auto memory off, couldn't be read after a reply (another program, such as a virus scanner, had it open), that conversation was saved as if it were not private. Now nothing is saved or removed for it until the list can be read again, at a later reply.
- **A list that stays unreadable is now reported.** If it stayed unreadable (a folder in its place, or a permission taken away), nothing more was saved, but nothing said so, and an earlier warning that the handoff couldn't be saved was cleared. Now the next briefing says the store needs attention and names the list, and `status` names it too (for the memory-off list, in its journal line). The warning goes at the next reply that reads the list again. For the memory-off list, it goes at the next reply the journal records.
- **A failed write of the memory-off list is now reported.** With auto memory off, if the list of conversations held that way couldn't be written after a reply, nothing said so, and a conversation whose tag was never written could later be taken into the journal. Now the next briefing with auto memory on, and `status`, say the store needs attention. They say the conversation could not be marked, so the journal may take it in later, and they name the list. A conversation that got no tag at all can still be taken in.
- **A private mark that could not be saved no longer leaks.** If the reply where you typed `<private-session>` couldn't save the mark (a full or busy disk), a later reply near the compaction limit could still ask Claude to write the conversation into memory, and a note kept across a compaction could quote its last request. Now, before either is shown, the whole conversation is checked for the mark.
- **A password or token after extra whitespace is now redacted.** If it was written after two spaces, a tab or a line break instead of one space (`--token`, two spaces, then the token), it was saved whole in the journal, and so in its snapshots. It is now replaced by `[redacted]`, as it was after one space.
- **`forget` now covers a `<private>` message sent mid-turn.** If a turn ran `forget` after a `<private>` message you sent while Claude was still working, the forget went unnoticed. The turn's request was saved in the handoff and the journal, and search could show it. Now a turn that runs `forget` saves none of its words, wherever the private message sits.
- **A reply after a mid-turn `<private>` message is no longer saved at a read boundary.** The journal reads a long conversation it takes in later 64 MB at a time. If a part ended between a `<private>` message you sent while Claude was working and the reply to it, the reply was saved. It now stays out.
- **The clean-up of a newly private conversation is retried.** If the journal folder couldn't be listed just when a conversation was marked private or held with auto memory off, its earlier entries stayed, and the clean-up was taken as done, so they stayed for good. The clean-up is now tried again at the next reply until it goes through.
- **`forget` no longer says "nothing matches" when it can't list the journal folder.** Before, the exchange stayed. It now says the folder could not be listed, with the disk's reason, removes nothing and fails, so you can run it again.

### Fixes

- **A lock that the disk refused to remove no longer blocks saving for 30 seconds.** When the disk briefly refused to remove a store's lock after a write, the replies in that time were neither saved nor cleaned up. Removing the lock is now retried.
- **A leftover duplicate after a time-zone change is now removed.** If removing a copy of an entry from the day next to it failed (the copy a time-zone change leaves), the duplicate stayed in the journal for good. The next reply that saves that exchange now removes it.
- **A stale `backfill: …` warning in `status` now clears.** The warning said that taking in older conversations had failed. It stayed after a later look went through with nothing left to take in.
- **`status` and the briefing no longer name a temporary file.** They could show a name such as `….tmp1234` in the reason a write failed. They now leave that name out.
- **Two more ways the handoff listed every exchange twice after a time-zone change are closed.** One was a request cut off in the middle of something shaped like a secret (`api_key = process.env…`). The other was a moment when another program held `handoff.md` and it couldn't be read.

## 1.2.2 (2026-10-30)

This release fixes five problems found in a bug hunt, which used reviews of the code and a new fuzz test that sends thousands of random, hostile conversations through the plugin. Two of them could save text you had asked it to forget.

### Privacy

- **A compaction note no longer quotes what you were forgetting.** If a conversation was compacted while Claude was carrying out a `forget`, the note quoted the forgotten words, both in the handoff and in the briefing after the compaction. It now says `[private]`.
- **`/memory --shared forget <words>` is now recognised as a forget.** That covers an option before `forget`, quoted the way the memory skill quotes what you type. Before, the exchange was saved whole, the forgotten words with it. A negative number after an option (`--limit -5`) no longer hides a forget either.

### The handoff

- **After your computer's time zone changes, a long conversation lists each exchange once, and the newest stays.** Before, each was listed twice and the newest could drop out.
- **An exchange you forgot, listed under another time zone's clock, now leaves the handoff too.**
- **After you forget an exchange and the time zone changes, another exchange no longer disappears from the handoff.** Before, it could vanish just because its time reads the same on the new clock.

### Notes

- **A note saved with Windows line endings keeps its whole description.** `status`, search and the index showed only its first line before.

### For contributors

- A quick check for every edit (`check.mjs`).
- A fuzz test with a 17-machine GitHub workflow.
- The mutation check on every push.
- The CLI's tests run in-process, about 40% faster.

## 1.2.1 (2026-10-30)

This release fixes problems found in three reviews of the code and makes the README readable on a phone. The first group of fixes is about privacy: an exchange you asked Claude to forget could still be saved or come back.

### Privacy

- **Asking Claude to forget something through the memory skill now keeps that exchange out of the record.** The skill puts quotes around the words you type, and only a bare `forget` was recognised, so the exchange was saved whole.
- **A forgotten exchange no longer comes back into the handoff.** It returned after your computer's time zone changed, or when Windows spelled the project's folder in another case.
- **The handoff, the journal and the compaction note now decide what is private the same way.** A `<private>` tag inside some reminder tags hid an answer in one and kept it in another.
- **A conversation you mark with `<private-session>` is taken out of the journal once.** Before, it was swept again after each of the next 25 or so replies, which took up to 1.5 seconds each with years of journal.
- **The README and the privacy policy now say to keep the memory folder on one computer.** Synced between two (Dropbox, OneDrive), an exchange you forgot on one can come back on the other.

### The handoff

- **After a time-zone change, such as a flight, the last exchanges are listed once each and the newest stays.** Before, each was listed twice, and the newest could drop out for hours.
- **The reply after one that ran `forget` no longer reads a long conversation up to four times over.**
- **The startup briefing names a journal that keeps failing to save.** It also gives the last good snapshot in your local time.

### Search and the memory tool

- **Search no longer shows a broken character where it cut through an emoji.**
- **`status` and `search` show the description of a note whose header was never closed or starts with a BOM.**
- **A note named like `[draft] plan.md` keeps a working line in the shared index when you promote it.**
- **A `forget` whose words match nothing, and one over a long date range, are much faster.**
- **A note with a very long run of blank lines in its header no longer slows every reply.** 50,000 blank lines used to cost 11 seconds.
- **A disk that fills up mid-write no longer leaves half a copy of the handoff or a journal day behind.**
- **Several messages are clearer.** `--limit ten` is refused with a reason instead of ignored. A usage error says what was wrong first. An unknown option points to help. `status` no longer lists journal days as notes. `doctor` allows for a reply finished before the install.

### The README

- **The README is a third of the length, with the journal first.** Its four pictures are drawn to read on a phone, and the old ones and the demo animation are gone.
- **The privacy policy says which files to delete only once project-memory is gone for good.** It also says what uninstalling leaves behind.

## 1.2.0 "Bastet" (2026-10-29)

This release adds a journal of your work. project-memory now keeps every exchange, so you can ask Claude what you decided or worked on earlier and get an answer with the date. Passwords and tokens that Claude passes to a command are now kept out of the saved text too.

### New

- **A journal of every exchange.** After each reply, project-memory saves your message (up to 2,000 characters), Claude's reply (up to 6,000; of a longer one, its first 4,000 and its last 2,000, where it says what was done), the files Claude changed (up to 20) and the last 20 commands it ran (up to 400 characters each). It keeps one file per day in each project's notebook. Before, only the last few exchanges were kept, and work Claude didn't write a note about was hard to find again.
- **Ask about earlier work in your own words.** Questions such as "What did we decide about the logo in September?" or "What did I work on last week?" make Claude search the journal and answer with the date.
- **Older conversations are taken in.** After each reply, a few at a time, project-memory reads the project's conversations it hasn't read yet that Claude Code still keeps on your computer, however long. On a new install it takes in about the last month. After a pause, it takes in the conversations held while project-memory was off. A worktree kept outside its repository's folder has its conversations taken in once Claude has finished a reply there.
- **`search` looks in the journal too.** It takes `--since` and `--until` dates. With dates and no words, it lists what you asked on those days. A journal hit shows its request and only the lines around your words, so ten hits fit in a short answer. A long request asked many times, such as a script's prompt, shows once, with how many more and their keys. Two-letter words such as CI and PR are found, and so is an entry's branch.
- **`show <key>` prints one journal entry in full.** Use the key that a search hit shows.
- **`forget` removes journal entries when you ask.** It lists each match with its key, and after you confirm, removes exactly those (`--key <key> --yes`). It works on one project at a time and names the words no entry holds. A forget by dates alone is confirmed by its range, so `forget --since 1970-01-01 --yes` empties the journal. The same exchanges also go from the record of where you left off, so the next briefing doesn't show them.
- **The journal isn't loaded when a conversation starts.** The briefing gets one line saying it's there, and `status` shows its size, first day, conversations still to import and any failure.
- **Finished days go into the history of your notes.** Today's file stays out until the day is over, so the history doesn't keep a copy after every reply. A day left with no entries is deleted.
- **Your edits to a day's file are safe.** The file stays readable after an editor or a Markdown formatter saves it, and a note you write under an entry stays there. A day's file that isn't UTF-8 text is left as it is, and `status` names it.
- **`--help` prints the memory tool's commands.** An option it doesn't know is now refused instead of ignored.

### Privacy

- **The journal follows the same privacy rules as the record of where you left off.** Secrets are replaced with `[redacted]`, and `<private>` and `<private-session>` keep text out. While auto memory is off, only the conversation's short tag is saved, when it starts and after every reply, so the journal never takes it in.
- **Passwords and tokens that Claude passes to a command are replaced with `[redacted]` too.** This covers values after `--password`, `--token` or `--secret`, `az login -p`, `aws configure set`, `htpasswd`, `gh secret set` and an npm `_authToken`. It also covers `export`, `setx` or `SetEnvironmentVariable` of a name that says key, secret, token or password. A reference such as `$TOKEN`, a file's path and a count stay.
- **`<private-session>` keeps a conversation out wherever in it you type the mark,** however long the conversation is. When project-memory takes in other conversations, it leaves out those marked `<private-session>`, even if the mark was typed while project-memory was off. It also leaves out those held while `CLAUDE_CODE_DISABLE_AUTO_MEMORY` was set. A conversation held with auto memory off while this version wasn't installed and on has no tag, and is taken in.
- **A conversation marked private, or held with auto memory off, loses its entries even after the journal took it in.** This happens at the journal's next look, even with no reply of its own after the mark.
- **An exchange in which Claude runs `forget` is kept without its words,** in the journal and in the record of where you left off, so the list of what it removes isn't saved again.
- **An entry removed later stays in the history for days already over.** This applies to a removal by `forget` or by a later `<private-session>`. The privacy policy says how to remove it, and what's left behind after you uninstall.

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

project-memory now passes the Anthropic plugin directory's checks with no policy holds, and it reads less of your machine to get there. In a conversation that is already open, run `/reload-plugins` to pick up the change to the memory tool.

### What you will notice

- **`doctor` no longer reads your Claude Code settings file,** which can hold keys. It checks what is installed (Claude Code's plugin list) and what actually ran: the Stop hook now logs each run, and two runs for one reply mean project-memory is set up twice. Its messages changed to match: "not installed" and "the Stop hook ran twice for one reply".
- **The memory tool no longer reads the session id from your environment.** The skill passes it as `--session`, and an id that is not one is ignored. In a conversation that is already open, run `/reload-plugins` to pick this up.

### For contributors

- Nothing in the repository reads your environment, apart from one setting the plugin uses: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. The tests used to copy the whole environment for the programs they start.
- The tests build their made-up keys and passwords while they run, so no file in the repository looks like it holds a secret.
- The plugin's icon is now an SVG file. A PNG icon named in `plugin.json` is an image the directory's validator can't read as code.
- `wire.mjs`, the author's own switch between the plugin and hook entries in `settings.json`, is removed. Nothing in the repository reads `settings.json` now.

## 1.0.6 (2026-10-27)

This release adds more privacy controls, makes the README honest about what Claude Code now does on its own, and fixes problems found in an independent review.

### New

- **`superseded-by: <note>.md` in a note's frontmatter moves the note to the archive,** even when it is pinned. `search` names the note that replaced it. Ask Claude to "replace the old note" and it does this.
- **`status` shows this week's changes:** the notes added, changed or deleted in the last 7 days.
- **`<private-session>` keeps a whole conversation out of the record of where you left off.** What it saved earlier is removed (older versions in the note history keep theirs), and no compaction note is written for it.

### Privacy

- **A private message stays private.** Claude's reply to any message containing `<private>` is saved as `[private]`, in the handoff and in the compaction note, since a reply often repeats what it was told. Before, a message that started with `<private>` was not counted as a message, and Claude's reply to it was saved in full as the reply to the message before.
- **More secrets are recognised:** names that end in `PASSWORD`, `SECRET` or `API_KEY` (as in a `.env` file), Stripe keys, a password on the line after its label, lowercase `bearer`, and PGP private key blocks.

### Fixes

- **A message that starts with a tag Claude Code added is now recorded, without the tag.** An example is an IDE's note of the open file. Before, it was skipped, and Claude's reply to it was saved as the reply to the message before.
- **A message cut in the middle of an emoji is no longer saved again after every reply.**
- **`superseded-by:` with no value no longer reads the next line as its value,** and a note's body can no longer archive it.
- **`status` no longer leaves out notes with accented names.**
- **`doctor` run from a terminal no longer says "waiting" when the hooks had stopped.**

### Documentation

- **The README is honest about what Claude Code now does on its own.** It describes two more tools (memory-toolkit and MemPalace), explains how to open your notes, and puts the install steps before the comparison.

## 1.0.5 (2026-10-27)

This release keeps secrets out of what the plugin saves, and each handoff entry now says which files Claude changed. It also improves the README.

- **Secrets are never saved.** Keys, tokens and passwords you paste into a message are replaced with `[redacted]` before the plugin saves anything: the record of where you left off, the startup briefing and the compaction note. Anything you put between `<private>` and `</private>` is left out entirely. Before this, a key pasted into a message stayed in the note history for good.
- **Each entry names the files Claude changed** in that turn, so "where did we leave off?" also tells you what was touched.
- **The README is clearer.** It has a quick start, a comparison with five other memory tools (claude-mem, Mem0, Supermemory, Basic Memory, context-mode), updating and pausing instructions, and a longer glossary.

## 1.0.4 (2026-10-27)

This release makes the plugin ready for Anthropic's plugin directory. The plugin's own behaviour is unchanged.

- **Nothing in the plugin runs the `claude` command any more.** The directory's security scan counted that as using a credential from your machine. The author's `wire.mjs` now prints the install or uninstall command to run instead of running it, and `deploy.mjs` no longer validates or updates the plugin with it.
- **The memory snapshot no longer hands git a copy of your environment.**
- **There is now a [privacy policy](https://github.com/zdraveski/project-memory/blob/master/PRIVACY.md).** It says what the plugin reads, what it saves on your computer, and that it sends nothing anywhere.
- **The directory listing has its details.** These are an icon and links to the documentation, support and the privacy policy.
- **The README explains the context window and auto-compaction.** It says in plain words what they are, and how the plugin protects your work before, during and after a compaction.
- **The plugin browser in Claude Code shows plain-language descriptions.**

## 1.0.3 (2026-10-27)

This release gives the plugin a clearer front page. Nothing changes in the hooks or the `memory` skill.

- **The README opens with a short demo.** It replays three real conversations: Claude saves a decision, a new conversation knows where things stopped, and a note deleted by mistake comes back.
- **The README explains what you get.** It says in plain language what the plugin does, who it's for, and what a week with it looks like.
- **The plugin has a display name and a plain description.** The name is "Project Memory", and both show in the plugin directory.

## 1.0.2 (2026-10-27)

This release makes the first check after installing friendlier, and turns the README into a guide for people who don't write code.

- **`doctor` no longer reports a problem right after you install.** Before, running `/project-memory:memory doctor` before Claude had finished a reply raised an alarm. Now it says it's waiting for Claude's first reply. It reports a problem only when a reply finished over a minute ago and nothing was saved.
- **The README is now a plain-language guide.** The technical details moved to [How it works](https://github.com/zdraveski/project-memory/blob/master/docs/how-it-works.md). Tests and releasing are described in `CONTRIBUTING.md`.

## 1.0.1 (2026-10-27)

This release adds a plugin icon. Nothing changes in how you use the plugin.

- **The plugin now has an icon.** It is a page inside a restore arrow, at `.claude-plugin/icon.png` and at the top of the README. There is no change to the hooks or the `memory` skill.

## 1.0.0 (2026-10-27)

This is the first public release of project-memory: memory for Claude Code that holds up when you run several sessions at once, and when a long session gets compacted.

### Install

```
claude plugin marketplace add zdraveski/project-memory
claude plugin install project-memory@project-memory
```

Then restart Claude Code, or run `/reload-plugins`, and check it with `/project-memory:memory doctor`. It needs Node.js 20+ on your PATH, and git for snapshots.

### What's in it

- **Your notes stay within a size limit.** `MEMORY.md` is tiered under a 7,000-byte budget, and an archive keeps the older notes searchable.
- **Claude picks up where you left off.** A rolling handoff keeps each session's last ten exchanges, and a startup briefing gives them to the next session.
- **Compaction no longer cuts a turn in half.** Mid-turn compactions are held until the turn ends. A memory nudge comes before one, and what a cut turn had in flight is given back afterwards.
- **Every memory change is snapshotted in git.** You can look back with `history` and bring a note back with `restore`.
- **Lessons that hold in every project go in a shared store.** `promote` moves a note there.
- **You can search and check your memory.** The `memory` skill gives you ranked `search`, `status` and `doctor`.
- **Parallel sessions do not overwrite each other.** Each store has a lock, and writes are compare-and-swap.

Tested on Linux, macOS and Windows, Node 20 and 24. Everything stays on your machine. See the [README](https://github.com/zdraveski/project-memory#readme) for what it writes and where.
