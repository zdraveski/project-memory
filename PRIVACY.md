# Privacy policy

project-memory is a plugin for Claude Code. It runs only on your computer.
This page says what it reads, what it saves, and how to remove it.

## What it reads

- Claude Code's record of your conversations in this project (the files Claude
  Code keeps in `~/.claude/projects`), to know what was asked and answered.
- The notes Claude Code's built-in memory writes in the same folder.
- Claude Code's settings and plugin list in `~/.claude`, only when you run
  the `doctor` check, to see whether the plugin is switched on.

## What it saves

All of it stays in `~/.claude/projects` on your computer:

- A record of where you left off: the start of your latest messages (up to 240
  characters each) and of Claude's replies (up to 400), and the names of the
  files Claude changed, for the last 10 exchanges of each of your 3 most recent
  conversations. Older entries are replaced as you go. Keys, tokens and
  passwords are replaced with `[redacted]` first. Anything you write between
  `<private>` and `</private>` is left out, and so is Claude's reply to that
  message. A conversation where you type `<private-session>` is left out
  entirely, and its earlier entries are removed (the history of your notes
  still has them).
- When Claude Code shortens a conversation in the middle of a task, a note of
  what was in progress: your request, the start of Claude's last words, any
  background tasks still running, and the files Claude had changed.
- A history of every version of your notes, in a local git repository.
- A few small bookkeeping files, such as when it last ran, and the short tags
  of conversations you marked `<private-session>`.

## What it sends

Nothing. project-memory makes no internet connections and has no server. The
git repository it keeps has no remote and is never pushed. Claude reads your
notes and the record of where you left off during your conversations, the same
way it reads Claude Code's built-in memory, as part of your normal use of
Claude.

## How long it keeps it

- The record of where you left off: until newer exchanges replace it.
- Your notes: until you or Claude delete them.
- The history of your notes: until you delete it.

Uninstalling the plugin leaves all of this in place. To delete the history,
delete the hidden folder `.git` inside `~/.claude/projects`. To delete the
record of where you left off, delete `handoff.md` in a project's `memory`
folder.

## Children

project-memory is not meant for people under 18.

## Contact

Questions or problems: open an issue at
<https://github.com/zdraveski/project-memory/issues>.
