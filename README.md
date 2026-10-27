<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

# project-memory

**Helps Claude remember your work from one conversation to the next.**

project-memory is a free add-on (a "plugin") for Claude Code. Once it's
installed, it works on its own in the background. You don't have to learn any
commands to get the benefit.

## Why you might want it

Each new conversation in Claude Code starts fresh. To carry things over,
Claude Code keeps a notebook for each project, called *auto memory*. Claude
writes down what's worth keeping, like your preferences, decisions and
corrections, and reads the notebook's table of contents at the start of every
conversation.

That works well until:

- The table of contents gets too long, and Claude stops reading the newest
  notes.
- A conversation ends in the middle of a task, and the next one doesn't know
  where you stopped.
- A conversation gets very long. Claude Code then shortens it into a summary to
  make room, and work in progress can get lost.
- A note gets deleted or overwritten by mistake, with no way to get it back.
- Something you taught Claude in one project, like "keep answers short", is
  unknown in your other projects.
- You have two Claude windows open on the same project, and one overwrites the
  other's notes.

project-memory takes care of all of these.

## What it does for you

- It keeps the table of contents short, so Claude always reads all of it.
  Older entries move to an archive page that Claude can still search.
- After every reply it saves a short record of your latest exchanges, and the
  next conversation starts by reading it.
- Before Claude Code shortens a conversation, it reminds Claude to save its
  notes. If a task gets cut off anyway, Claude is told afterwards what it was
  in the middle of.
- It keeps every version of every note, so a note that was deleted or changed
  by mistake can be brought back.
- Notes that apply everywhere, such as how you like to work, go into a shared
  notebook that every project reads.
- With several windows open, no window overwrites another's notes, and each
  new conversation is told what the other windows are working on.

Everything stays on your computer.

## Before you install

You need three things. If you already use Claude Code, you probably have
them.

1. Claude Code, with its built-in memory switched on. It's on unless you
   turned it off. To check, type `/memory` in Claude Code.
2. Node.js 20 or newer. This free program is what runs project-memory.
3. Git. This free program keeps the history of your notes. Without it,
   everything works except bringing back old versions of a note.

If you're not sure about the last two, ask Claude: *"Do I have Node.js 20 or
newer, and Git?"* Claude will check for you. If one is missing, download it from
[nodejs.org](https://nodejs.org) (choose the LTS version) or
[git-scm.com](https://git-scm.com).

## Install

1. In Claude Code, type this line and press Enter:

   ```
   /plugin marketplace add zdraveski/project-memory
   ```

2. Then type this one and press Enter:

   ```
   /plugin install project-memory@project-memory
   ```

3. Close Claude Code and open it again.

4. Ask Claude anything, for example *"hello"*, and wait for the answer.
   project-memory does its first save when Claude finishes a reply.

5. Check that it's working by typing:

   ```
   /project-memory:memory doctor
   ```

   Every line should start with `ok`. A line that starts with `PROBLEM` says
   what to do about it. See [If something seems wrong](#if-something-seems-wrong).

## Using it day to day

There's nothing you have to do. Keep working with Claude as you always have.

When you want something from your notes, just ask in your own words:

| You say | What happens |
|---|---|
| *"Remember that I prefer short answers."* | Claude saves a note. |
| *"Where did we leave off?"* | Claude reads the record of your last conversation. |
| *"Did we decide anything about the logo?"* | Claude searches your notes, the archive too. |
| *"I deleted the note about pricing by mistake. Can you bring it back?"* | Claude restores it from the history. |
| *"Make the note about short answers apply to all my projects."* | Claude asks you to confirm, then moves it to the shared notebook. |

If you'd rather type a command, these do the same things:

| Type | What it does |
|---|---|
| `/project-memory:memory status` | A quick health check of this project's notes |
| `/project-memory:memory search logo colors` | Finds notes about "logo colors" |
| `/project-memory:memory history pricing` | Shows when the note called "pricing" changed |
| `/project-memory:memory restore pricing` | Brings back the note called "pricing" |
| `/project-memory:memory promote pricing` | Moves the note called "pricing" to the shared notebook |
| `/project-memory:memory doctor` | Checks that project-memory is set up and running |

A note's name is the name of its file, without the ending. `search` shows
them.

## If something seems wrong

**Claude doesn't remember the last conversation.** Ask *"Where did we leave
off?"* If Claude still doesn't know, type `/project-memory:memory doctor`.

**The check says "not wired".** project-memory isn't installed or isn't
switched on. Go through the [Install](#install) steps again.

**The check says "no Stop hook has run on this machine yet".** project-memory
saves when Claude finishes a reply. Ask Claude anything, wait for the answer,
then check again.

**Any other line that starts with `PROBLEM`.** The line ends with what to do.
If it's unclear, ask Claude: *"What does this line mean, and how do I fix it?"*

**A note seems to be gone.** It may have moved to the archive, where it's still
kept. Ask Claude to search for it. If it was deleted, ask Claude to bring it
back.

**"node" is not found.** Install Node.js (see
[Before you install](#before-you-install)), then restart Claude Code.

## Your privacy

- project-memory never connects to the internet. What it saves stays on your
  computer, in Claude Code's own folder (`.claude`, in your home folder).
- Claude reads your notes during your conversations. Claude Code's built-in
  memory works the same way.
- The record of where you left off includes the start of your messages and of
  Claude's replies, and the history keeps old versions of every note. If you
  copy or share your `.claude` folder, all of that goes with it.

## Removing it

In Claude Code, type:

```
/plugin uninstall project-memory@project-memory
```

Your notes stay where they are, and Claude Code keeps using them. To delete
the history of your notes as well, delete the hidden folder `.git` inside
`.claude/projects` in your home folder.

## Words used here

- **Conversation**: one session with Claude, from when you start it until you
  close or clear it.
- **Note**: a short file where Claude writes down something worth keeping.
  Claude Code calls these *memories*.
- **Notebook**: all of one project's notes, with their table of contents (a
  file called `MEMORY.md`).
- **Project**: the folder you open Claude Code in.
- **Shortening**: what Claude Code does when a conversation gets too long. It
  replaces the older part with a summary. Claude Code calls this
  *compacting*.
- **Plugin**: an add-on for Claude Code.

## More

- [How it works](docs/how-it-works.md): the technical details, for the curious.
- [Contributing](CONTRIBUTING.md): running the tests and changing the code.
- License: [MIT](LICENSE). Free to use, change and share.
