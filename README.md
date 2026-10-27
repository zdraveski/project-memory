![project-memory icon](docs/icon-128.png)

# project-memory

**Helps Claude remember your work from one conversation to the next.**

project-memory is a free add-on (a "plugin") for Claude Code. Once it's
installed, it works on its own in the background. You don't have to learn any
commands to get the benefit.

![A short demo. On Monday Claude saves a pricing decision. On Tuesday a new conversation knows where things stopped. Later, a note deleted by mistake comes back.](docs/demo.gif)

*The demo replays three real conversations in a sample project, with the
messages shortened to fit.*

## What you get

Every new conversation in Claude Code starts fresh. To carry things over,
Claude Code keeps a notebook for each project (it calls this *auto memory*),
where Claude writes down your preferences, decisions and corrections.
project-memory looks after that notebook, so Claude remembers more and loses
less.

| Without project-memory | With project-memory |
|---|---|
| You start a new conversation and explain again where you were. | Claude starts already knowing where the last conversation stopped. |
| The notebook's table of contents keeps growing, until Claude stops reading the newest notes. | The table of contents stays short, so Claude reads all of it. Older notes move to an archive that Claude can still search. |
| A very long conversation gets shortened, and the task Claude was in the middle of gets lost. | Claude saves its notes before that happens, and afterwards it's told what it was in the middle of. |
| A note deleted or overwritten by mistake is gone for good. | Every version of every note is kept. Ask Claude, and it brings one back. |
| You teach Claude how you like to work again in every project. | Lessons that apply everywhere are shared with all your projects. |
| Two Claude windows on the same project can overwrite each other's notes. | No window overwrites another's notes, and each new conversation is told what the other windows are doing. |

It runs on its own after every reply, with no waiting you'd notice, and
everything stays on your computer.

## Who it's for

project-memory helps most if you:

- come back to the same project over days or weeks,
- give Claude long tasks,
- keep more than one Claude window open,
- or work on several projects and want Claude to know your habits in all of
  them.

If you only ask Claude the occasional one-off question, you won't notice much
difference.

## A week with project-memory

- **Monday.** You tell Claude the bakery's cake prices, and that orders come
  by phone. Claude writes it down.
- **Tuesday.** You start a new conversation and ask *"Where did we leave
  off?"* Claude already knows.
- **Wednesday.** A big task runs so long that Claude Code shortens the
  conversation. Claude saved its notes first, and it's told what it was in the
  middle of, so it can carry on.
- **Thursday.** A note gets deleted by mistake. You ask Claude to bring it
  back, and it does.
- **Friday.** You open a different project. Claude already knows you like
  short, plain answers, because you shared that lesson with all your projects.

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

4. Check that it's working by typing:

   ```
   /project-memory:memory doctor
   ```

   Every line should start with `ok`. Until Claude finishes its first reply,
   one of them says it's waiting for that reply, which is normal. A line that
   starts with `PROBLEM` says what to do about it. See
   [If something seems wrong](#if-something-seems-wrong).

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

**The check says "its Stop hook is not running".** Claude finished a reply,
but project-memory didn't save after it. Restart Claude Code. If the line is
still there after Claude's next reply, ask Claude to check that Node.js is
installed.

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

The full details are in the [privacy policy](PRIVACY.md).

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
