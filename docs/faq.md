# Questions people ask

Short answers, with a link to the full one. Something missing? Ask in
[Discussions](https://github.com/zdraveski/project-memory/discussions).

Jump to a question:

- **The basics**: [What is project-memory?](#what-is-project-memory); [How is it different from Claude Code's own memory?](#how-is-it-different-from-claude-codes-own-memory); [Claude Code can already resume a conversation. Why add this?](#claude-code-can-already-resume-a-conversation-why-add-this); [What does it cost?](#what-does-it-cost)
- **Privacy and secrets**: [Does it send anything over the internet?](#does-it-send-anything-over-the-internet); [What if I paste a password or a key?](#what-if-i-paste-a-password-or-a-key); [How do I stop it saving a conversation or a project?](#how-do-i-stop-it-saving-a-conversation-or-a-project)
- **Setup and requirements**: [Does it work on Windows, macOS and Linux?](#does-it-work-on-windows-macos-and-linux); [Do I need Git?](#do-i-need-git); [My model holds 200,000 tokens. Do I need to change anything?](#my-model-holds-200000-tokens-do-i-need-to-change-anything); [How do I update it, pause it, or remove it?](#how-do-i-update-it-pause-it-or-remove-it); [How much disk space does it use?](#how-much-disk-space-does-it-use)
- **Everyday use**: [Does it slow Claude down or fill the conversation?](#does-it-slow-claude-down-or-fill-the-conversation); [Does search understand meaning?](#does-search-understand-meaning); [What about two Claude windows on the same project?](#what-about-two-claude-windows-on-the-same-project); [Can I use it on two computers?](#can-i-use-it-on-two-computers); [What are "checked lessons"?](#what-are-checked-lessons)
- **When something seems off**: [Claude doesn't remember the last conversation. Why?](#claude-doesnt-remember-the-last-conversation-why); [What happens when auto memory is turned off?](#what-happens-when-auto-memory-is-turned-off)

## The basics

### What is project-memory?

A free plugin for Claude Code that remembers your work for you. After each
reply it saves a journal of the exchange, a short "where we left off" record
and a tidy index of Claude's own notes. A new conversation starts already
knowing where the last one stopped, and you can ask Claude about earlier work
in your own words. It runs on your computer only. The
[README](../README.md) has the tour.

### How is it different from Claude Code's own memory?

Claude Code's memory is a set of notes that Claude writes. project-memory keeps
those notes tidy and adds what they lack: a journal of every exchange you do
not mark private, a briefing about where the last conversation stopped, a
history so a deleted or overwritten note comes back, a shared notebook for
lessons that hold in every project, and safe use of two windows at once. It
needs no account. It searches by words, not by meaning, and works in Claude
Code only. [Comparison](comparison.md).

### Claude Code can already resume a conversation. Why add this?

`/resume` (or `claude --continue`) reopens one earlier conversation with its
whole history, so it comes back as long as it was when it ended. project-memory
starts a fresh conversation with a short briefing on where you stopped, about
900 tokens, and its journal covers every conversation you don't keep private,
not only the one you reopen. Claude Code also deletes its own conversation
files after 30 days unless you change that setting; the journal keeps each
exchange until you delete it.

### What does it cost?

Nothing. It is free (MIT license), needs no account and no API key, and uses no
AI model of its own. The short briefing at the start of a conversation is read
by Claude like any other text, so it uses a little of the conversation's room
(see below).

## Privacy and secrets

### Does it send anything over the internet?

No. project-memory makes no internet connections, and what it saves stays in
Claude Code's own folder (`.claude`, in your home folder). What Claude reads
during a conversation goes to Anthropic with the rest of it, as with Claude
Code's own memory. [Privacy policy](../PRIVACY.md).

### What if I paste a password or a key?

Before anything is saved, passwords, keys and tokens are replaced with
`[redacted]`: those of many services, passwords you type in chat (in several
languages), cookies and session ids, and look-alike spellings of them. A note
Claude writes itself is not rewritten, but a note that holds one is kept out of
the history and cannot be moved to the shared notebook by accident. No tool
catches every secret, so put anything sensitive between `<private>` tags. To
take back something already saved, ask: *"Forget the password I pasted
yesterday."* [Secrets in detail](how-it-works.md#the-handoff),
[Privacy policy](../PRIVACY.md).

### How do I stop it saving a conversation or a project?

- Put text between `<private>` and `</private>` to keep that text out.
- Type `<private-session>` in any message to keep the whole conversation out.
  What was saved of it before is removed, except the history's copy of days
  that are already over.
- Type `/project-memory:incognito` to stop saving the current conversation and
  sweep what it already saved.
- Type `/project-memory:memory-off` to turn it off for a whole project, and
  `/project-memory:memory-on` to turn it back on.
- Ask Claude to forget something: *"Forget the password I pasted
  yesterday."* It lists the journal entries that match and removes the ones
  you confirm. A copy in the history of days that are already over stays
  unless you ask for `forget --purge`, which drops those days from the history
  too. To clean out a secret saved before a redaction rule existed, ask for
  `memory rescan`: it counts first and changes nothing until you add
  `--apply --yes`.

None of these reaches Claude Code's own conversation files. All four levels,
including the setting for every project: [Turning it
off](how-it-works.md#turning-it-off).

## Setup and requirements

### Does it work on Windows, macOS and Linux?

Yes, all three. It needs [Node.js](https://nodejs.org) 22 or newer and Claude
Code. It does not work in other tools.

### Do I need Git?

No. Without Git everything works except bringing back an old version of a
note. With Git, a version of your notes is saved after each reply that
changes them.

### My model holds 200,000 tokens. Do I need to change anything?

Yes, for long conversations. project-memory assumes a window of 1,000,000
tokens, so the reminder to save notes before a conversation is shortened
never comes. Ask Claude: *"Add CLAUDE_CODE_AUTO_COMPACT_WINDOW set to 200k
under env in my Claude Code settings,"* then restart Claude Code.
[Compaction](how-it-works.md#compaction).

### How do I update it, pause it, or remove it?

To update, run `claude plugin marketplace update project-memory` and then
`claude plugin update project-memory@project-memory` in a terminal, and
restart Claude Code. To pause it, run
`claude plugin disable project-memory@project-memory` and restart; `enable`
turns it back on. To remove it, type
`/plugin uninstall project-memory@project-memory` in Claude Code. Your notes
and the journal stay either way, and so do the lines it added to each
`MEMORY.md`, which keep being loaded.
[Deleting it](../PRIVACY.md#deleting-it) lists what to delete by hand.

### How much disk space does it use?

The journal keeps each exchange whole, so an entry is as long as what was
said: half are under about 5 KB, and one in a hundred is over about 60 KB. A
very busy project adds up to about 110 MB a year. The journal stays until
you delete it or ask Claude to forget part of it.

## Everyday use

### Does it slow Claude down or fill the conversation?

Each conversation starts with a short briefing for Claude. The last
conversation's exchanges fill it up to 3,500 characters (at most 3,499 on 13
real projects), and when the shared lessons already take that, the newest
exchanges still get about 1,500 characters of their own. A long list of shared
lessons or warnings can pass 3,500, but never 9,500. After a compaction it is larger: 8,481 characters at the median
and 9,366 at most on 8 projects, never over 9,500. The journal isn't loaded;
Claude searches it only when you ask about earlier work. What the plugin does
after each reply runs outside the conversation and uses none of its room.
Every hook has a time limit, and a hook that fails never blocks Claude Code
([When it runs](how-it-works.md#when-it-runs)).

### Does search understand meaning?

No. It searches by words, not by meaning: ask with words that were used, and
Claude can try a few. Other forms of a word match (`migrated` finds
`migration`; Macedonian endings too), but a synonym does not. It covers your notes, the shared notebook, the archive
and the journal. Chinese and Japanese words are found even at one character, and English
words written next to that text are found too (`CI` in `CIが落ちた`); in
other scripts a two-letter word is found only standing alone.

### What about two Claude windows on the same project?

That's fine. Only one window writes at a time, and a write that would replace
something Claude just changed is skipped and done after the next reply, so
Claude's own edit is never overwritten.
[Several conversations at once](how-it-works.md#several-conversations-at-once).

### Can I use it on two computers?

Each computer keeps its own notes and journal; they don't sync. Don't sync
the memory folder yourself (Dropbox, OneDrive): each computer would undo the
other's *"forget"*.

### What are "checked lessons"?

An experimental small extra. You can add a rule to a note, such as "do not
`git add -A`", and a hook logs when a git command matches it. It only
watches: it never blocks a command. Few lessons fit the form.
[Checked lessons](how-it-works.md#checked-lessons-experimental).

## When something seems off

### Claude doesn't remember the last conversation. Why?

Ask *"Where did we leave off?"*: Claude reads the record of your last
conversation in this project. If that finds nothing, type
`/project-memory:memory doctor` in Claude Code. A line that starts with
`PROBLEM` says what to do. Right after installing, one line says it's waiting
for Claude's first reply, which is normal: the record is written after each
reply. [What each message means](how-it-works.md#when-something-seems-wrong).

### What happens when auto memory is turned off?

project-memory follows one switch only: the environment variable
`CLAUDE_CODE_DISABLE_AUTO_MEMORY`, set to `1`, `true`, `yes` or `on`. While it is set,
project-memory reads and saves nothing on its own, except a short tag for
the conversation, so neither the journal nor the record of where you left
off takes that conversation in later, even if you go on with it after
turning auto memory back on. If that tag can't be written, the next
briefing with auto memory on says so, and until it is written the journal
may take that conversation in. [Privacy policy](../PRIVACY.md).

Turning auto memory off in Claude Code itself, with `/memory` or the
`autoMemoryEnabled` setting, stops project-memory too. It reads that one
setting (`false`) from the settings files Claude Code reads: managed, the
project's `.claude/settings.local.json` and `.claude/settings.json`, and
`~/.claude/settings.json`. The environment variable wins over all of them
(`0` turns it back on). It cannot see `--settings`, `--bare`, safe mode or
server-managed settings; `doctor` says where it found the switch. To stop it
for one project, use `/project-memory:memory-off`, or disable the plugin
([Pausing or removing it](how-it-works.md#pausing-or-removing-it)).
