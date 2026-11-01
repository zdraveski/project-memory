# Questions people ask

Short answers, with a link to the full one. Something missing? Ask in
[Discussions](https://github.com/zdraveski/project-memory/discussions).

## Claude doesn't remember the last conversation. Why?

Ask *"Where did we leave off?"*: Claude reads the record of your last
conversation in this project. If that finds nothing, type
`/project-memory:memory doctor` in Claude Code. A line that starts with
`PROBLEM` says what to do. Right after installing, one line says it's waiting
for Claude's first reply, which is normal: the record is written after each
reply. [What each message means](how-it-works.md#when-something-seems-wrong).

## Does it send anything over the internet?

No. project-memory makes no internet connections, and what it saves stays in
Claude Code's own folder (`.claude`, in your home folder). What Claude reads
during a conversation goes to Anthropic with the rest of it, as with Claude
Code's own memory. [Privacy policy](../PRIVACY.md).

## How do I keep something out of it?

- Put text between `<private>` and `</private>`.
- Type `<private-session>` in any message to keep the whole conversation out.
  What was saved of it before is removed, except the history's copy of days
  that are already over.
- Ask Claude to forget something: *"Forget the password I pasted
  yesterday."* It lists the journal entries that match and removes the ones
  you confirm.

Keys, tokens and passwords are replaced with `[redacted]` before anything is
saved, but no tool catches every secret, so use the tags for anything
sensitive.

## How much disk space does it use?

A journal entry is usually under 3 KB. A very busy project adds up to about
40 MB a year. The journal stays until you delete it or ask Claude to forget
part of it.

## Does it slow Claude down or fill the conversation?

Each conversation starts with a short briefing for Claude, usually under
1,000 tokens. The journal isn't loaded; Claude searches it only when you ask
about earlier work. What it does after each reply runs outside the
conversation and uses none of its room.

## Do I need Git?

No. Without Git everything works except bringing back an old version of a
note. With Git, a version of your notes is saved after each reply that
changes them.

## Can I use it on two computers?

Each computer keeps its own notes and journal; they don't sync. Don't sync
the memory folder yourself (Dropbox, OneDrive): each computer would undo the
other's *"forget"*.

## What about two Claude windows on the same project?

That's fine. Only one window writes at a time, and a write that would replace
something Claude just changed is skipped and done after the next reply, so
Claude's own edit is never overwritten.
[Several conversations at once](how-it-works.md#several-conversations-at-once).

## My model holds 200,000 tokens. Do I need to change anything?

Yes, for long conversations. project-memory assumes a window of 1,000,000
tokens, so the reminder to save notes before a conversation is shortened
never comes. Ask Claude: *"Add CLAUDE_CODE_AUTO_COMPACT_WINDOW set to 200k
under env in my Claude Code settings,"* then restart Claude Code.
[Compaction](how-it-works.md#compaction).

## What happens when auto memory is turned off?

project-memory then reads and saves nothing on its own, except a short tag
for the conversation, so the journal won't take that conversation in later,
even if you go on with it after turning auto memory back on. If that tag
can't be written, the next briefing with auto memory on says so, and until
it is written the journal may take that conversation in.
[Privacy policy](../PRIVACY.md).

## Does search understand meaning?

It searches by words, not by meaning: ask with words that were used, and
Claude can try a few. It covers your notes, the shared notebook, the archive
and the journal.

## How do I pause it, or remove it?

To pause it, run `claude plugin disable project-memory@project-memory` in a
terminal and restart Claude Code; `enable` turns it back on. To remove it,
type `/plugin uninstall project-memory@project-memory` in Claude Code. Your
notes and the journal stay either way, and so do the lines it added to each
`MEMORY.md`, which keep being loaded.
[Deleting it](../PRIVACY.md#deleting-it) lists what to delete by hand.
