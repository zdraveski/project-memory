![project-memory: Give Claude Code a memory. Remember, restore, continue.](docs/banner.png)

# project-memory

**Claude remembers your work: where you left off, and anything you did
before.**

project-memory is a free add-on (a "plugin") for Claude Code. It works on its
own after every reply, keeps everything on your computer, and needs no
account or API key.

![The problem: every new conversation starts fresh. Close Claude Code today, and tomorrow you explain again where you were. On Monday Claude says the launch email is half written and pricing comes next. On Tuesday, asked to carry on, it says: "What were we working on?"](docs/problem.webp)

## What you get

Claude Code keeps a notebook of notes for each project (it calls this *auto
memory*). project-memory looks after that notebook and adds a journal of
everything you did.

| Without project-memory | With project-memory |
|---|---|
| Work from a few weeks ago is hard to find again. | Every exchange is kept in a journal on your computer. Ask about earlier work in your own words, and Claude finds it and tells you when it happened. |
| Each new conversation starts from zero. | Claude starts already knowing where the last conversation stopped. |
| A note deleted or overwritten by mistake is gone. | Every version of your notes is kept, and Claude brings an old one back when you ask. |
| A long conversation is cut down to a summary, and the task in progress can get lost. | Claude saves its notes first, and afterwards it's told what you asked and what it last said. |
| You teach Claude your habits again in every project. | Lessons that apply everywhere are shared with all your projects. |

It also keeps the notebook's table of contents short without dropping a note,
and lets two Claude windows on one project work without overwriting each
other. It helps most when you come back to the same project over days or
weeks. For a quick one-off question, you won't notice much difference.

![What project-memory does for you: it picks up where you left off, keeps old versions of your notes (needs Git), keeps long tasks on track, and shares what you teach it with all your projects. It works on its own after every reply, and it never goes online. It's free, needs no account or API key, and uses Claude Code's own notebook.](docs/what-you-get.webp)

![A short demo. On Monday Claude saves a pricing decision. On Tuesday a new conversation knows where things stopped. Later, a note deleted by mistake comes back.](docs/demo.gif)

## Install

You need Claude Code with its built-in memory on (it is, unless you turned it
off) and [Node.js](https://nodejs.org) 20 or newer (choose the LTS version).
[Git](https://git-scm.com) is optional: without it, everything works except
bringing back old versions of notes. Not sure? Ask Claude: *"Do I have
Node.js 20 or newer, and Git?"*

1. In Claude Code, type these two lines. When the second one opens a menu,
   choose to install it for you (user scope), so it works in every project.

   ```
   /plugin marketplace add zdraveski/project-memory
   /plugin install project-memory@project-memory
   ```

2. Close Claude Code and open it again.
3. Type `/project-memory:memory doctor`. Every line should start with `ok`.
   Until Claude finishes its first reply, one line says it's waiting for
   that reply, which is normal.

## Using it

There's nothing to learn. Ask in your own words:

| You say | What happens |
|---|---|
| *"What did we decide about the logo in September?"* | Claude searches your notes and the journal, and answers with the date. |
| *"What did I work on last week?"* | Claude lists what you asked each day, from the journal. |
| *"Where did we leave off?"* | Claude reads the record of your last conversation. |
| *"Remember that I prefer short answers."* | Claude saves a note. |
| *"I deleted the note about pricing by mistake. Bring it back."* | Claude restores it from the history. |
| *"Forget the password I pasted yesterday."* | Claude lists the journal entries that match, and removes the ones you confirm. |
| *"Remember for all my projects that I like plain language."* | Claude saves it to the shared notebook. |

If you'd rather type a command, start with `/project-memory:memory`:

| Type after it | What it does |
|---|---|
| `search logo colors` | Finds notes and journal entries about "logo colors" |
| `show 'key'` | Shows one journal entry in full, by the key `search` printed |
| `forget password` | Lists the journal entries that mention "password" and removes the ones you confirm |
| `history pricing` / `restore pricing` | Shows when the note "pricing" changed / brings it back |
| `promote pricing` | Moves the note "pricing" to the shared notebook |
| `status` / `doctor` | A health check of this project's notes / of project-memory itself |

To read your notes yourself, type `/memory` in Claude Code and open the auto
memory folder. The journal is its `journal` folder, one file per day.

## Your privacy

![What it saves stays on your computer. It never goes online: everything it saves stays in Claude Code's own folder on your computer. Common secrets are blanked out: keys, tokens and passwords you paste become [redacted] before anything is saved. Keep part of a message out: put it between <private> and </private>, and it isn't saved. Keep a whole conversation out: type <private-session> in any message. Claude still sees what you write, and your conversation goes to Anthropic as usual.](docs/privacy.webp)

- project-memory never goes online. What it saves stays in Claude Code's own
  folder (`.claude`, in your home folder). What Claude reads during a
  conversation goes to Anthropic with the rest of it, as with Claude Code's
  own memory.
- The journal keeps each exchange: your message, Claude's reply (up to 6,000
  characters), the files it changed and the commands it ran. It stays until
  you delete it or ask Claude to forget part of it.
- Keys, tokens and passwords are replaced with `[redacted]` before anything
  is saved. No tool catches every secret, so use the tags below for anything
  else.
- Put text between `<private>` and `</private>` to keep it out. Type
  `<private-session>` in any message to keep the whole conversation out; what
  was saved of it before is removed.
- *"Forget …"* removes the journal entries you confirm. For days that are
  already over, a copy stays in the history until you delete the history.

Everything it reads and saves, and how to delete it, is in the
[privacy policy](PRIVACY.md).

## Good to know

- **Room.** Each conversation starts with a short briefing for Claude, usually
  under 1,000 tokens. The journal isn't loaded, only searched when needed.
- **Disk space.** A journal entry is usually under 3 KB. A very busy project
  adds up to about 40 MB a year.
- **Your notes.** The first run may move older lines of the table of contents
  to an archive. No note is deleted, and Claude can still search them.
- **Where.** Windows, macOS and Linux. Notes stay on the computer they were
  made on, and don't sync.
- **Your files.** It writes only inside Claude Code's own folder, never in
  your project.

## Long conversations

When a conversation fills up, Claude Code shortens it to a summary, and the
details of a task in progress can get lost. project-memory has Claude save
its notes before that, asks Claude Code to let Claude finish the step it's
on, and afterwards tells Claude what you asked and what it last said.

![Long conversations, kept on track. Before: at 85% full, Claude is asked to write its notes while there's still room. During: if the conversation fills up in the middle of a task, project-memory asks Claude Code to wait until the step ends. With no room to wait, it writes the step down instead. After: once it's shortened to a summary, Claude is told what you asked, what it last said and what was still running.](docs/long-conversations.webp)

**If your model holds 200,000 tokens,** the reminder to save notes never
comes, because project-memory assumes 1,000,000. Ask Claude: *"Is my context
window 200,000 tokens?"* If it is, ask: *"Add CLAUDE_CODE_AUTO_COMPACT_WINDOW
set to 200k under env in my Claude Code settings,"* then restart Claude Code.
The details are under [Compaction](docs/how-it-works.md#compaction).

## Updating

In a terminal (Terminal on a Mac, PowerShell on Windows), run these two
commands, or ask Claude to run them, then restart Claude Code:

```
claude plugin marketplace update project-memory
claude plugin update project-memory@project-memory
```

What changed in each version is in the [changelog](CHANGELOG.md).

## Pausing or removing it

To pause it, run `claude plugin disable project-memory@project-memory` in a
terminal and restart Claude Code; `enable` turns it back on. To remove it,
type `/plugin uninstall project-memory@project-memory` in Claude Code. If you
added it from claude.ai, use `/plugin` in Claude Code for both.

Your notes, the journal and the history stay either way. The privacy policy
lists what to delete by hand: [Deleting it](PRIVACY.md#deleting-it).

## If something seems wrong

Type `/project-memory:memory doctor`. A line that starts with `PROBLEM` says
what to do. If it's unclear, ask Claude: *"What does this line mean, and how
do I fix it?"*

- **Claude doesn't remember the last conversation.** Ask *"Where did we leave
  off?"*, then run the check.
- **A note seems to be gone.** It may have moved to the archive. Ask Claude to
  search for it, or to bring it back.
- **"node" is not found.** Install Node.js, then restart Claude Code.

What each message means:
[When something seems wrong](docs/how-it-works.md#when-something-seems-wrong).

## Compared with other tools

Claude Code's own memory doesn't keep a journal, a history of your notes or a
shared notebook, and doesn't keep two windows from overwriting each other.
project-memory adds those, with no account and nothing leaving your
computer. It searches by words, not by meaning, and works in Claude Code
only. The side-by-side with claude-mem, Mem0, Supermemory, Basic Memory,
context-mode and two more is in [Comparison](docs/comparison.md).

## More

- [How it works](docs/how-it-works.md): the technical details.
- [Changelog](CHANGELOG.md): what changed in each version.
- [Privacy policy](PRIVACY.md): what it reads and saves, in full.
- [Contributing](CONTRIBUTING.md): running the tests and changing the code.
- Questions or problems:
  [open an issue](https://github.com/zdraveski/project-memory/issues).
- License: [MIT](LICENSE). Free to use, change and share.
