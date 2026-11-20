# How project-memory compares

The side-by-side behind the [README](../README.md)'s short summary.

Claude Code's own memory keeps improving. It now asks Claude to shorten the
table of contents when it nears its limit, and after a compaction it reloads
your notes, re-reads recent files and reminds Claude of jobs still running.
project-memory adds what it still doesn't do: a new conversation that starts
knowing where the last one stopped, a journal of every exchange you do not mark
private that Claude searches when you ask about earlier work, a history of
every note, a shared notebook for all your projects, safe use of several
windows at once, and switches to stop it saving one conversation or one
project, with keys, tokens and passwords replaced before the journal or the handoff
saves them.

**In short**

- Your memories stay in Claude Code's own notebook on your computer. project-memory itself never goes online.
- It needs no account and no API key.
- It uses no AI model of its own to write memories.
- It searches by words, not by meaning. Most of the tools below can also search by meaning.
- It works in Claude Code only, and it does not share memories with a team.

project-memory isn't the only add-on either. This table compares it with the
six memory tools for Claude Code that have the most GitHub stars, going only
by each one's own README and setup page on 20 November 2026. Stars on that
day: claude-mem 118,600, Mem0 69,300, Hindsight 62,300, MemPalace 60,600,
Supermemory 31,700, agentmemory 30,500. "Not stated" means that documentation
doesn't say. These tools change often, so check their pages before you choose.

| | project-memory | [claude-mem](https://github.com/thedotmack/claude-mem) | [Mem0](https://docs.mem0.ai/integrations/claude-code) | [Hindsight](https://github.com/vectorize-io/hindsight) | [MemPalace](https://github.com/MemPalace/mempalace) | [Supermemory](https://github.com/supermemoryai/claude-supermemory) | [agentmemory](https://github.com/rohitg00/agentmemory) |
|---|---|---|---|---|---|---|---|
| What it is | Claude Code plugin | Claude Code plugin with a background service | Claude Code plugin for a cloud service | Memory server, added to Claude Code by an installer | Memory server (MCP) with optional Claude Code hooks | Claude Code plugin for a cloud service | Memory server with a Claude Code plugin |
| Main job | Looking after Claude Code's own memory | A second AI takes notes as you work | Memory in the cloud | Memory that "learns" from past sessions and git history | Every conversation kept word for word | Memory in the cloud | One memory for all your coding tools |
| Where your memories live | Claude Code's own notebook, on your computer | Its own database, on your computer; cloud sync if you turn it on | Mem0's servers | Hindsight's cloud by default, or a server you run | Its own database, on your computer | Supermemory's servers, or a server you run | Its own database, on your computer |
| Account or API key | No | Optional (sign-in offered, can be skipped) | Required | Required: a cloud token, or an AI model key | No | Required | No |
| Extra software | Node.js 22 or newer (Git optional, for snapshots) | Bun, uv and a background service | Python, and your project must be a Git repository | Docker or Python, or a local service | Python | Node.js | Node.js 20 or newer and a background service |
| Uses an AI model to write memories | No | Yes: its paid service, your own key, or your Claude plan | Yes, on Mem0's side | Yes, one you choose | No | Yes, on Supermemory's side | No, unless you turn it on |
| How memories are made | Claude writes notes, and every exchange you do not mark private is saved to a journal after every reply | Automatically, from everything Claude does | Automatically, from your conversations | Automatically, from your conversations | Automatically with its hooks, or when you import past conversations | Automatically, at the end of each reply | Automatically, from what Claude does |
| Search | By words | By words and by meaning | By words and by meaning | Not stated | By meaning | By words and by meaning | By words; by meaning too if you add a model |
| Picks up where you left off | Yes | Yes | Brings back up to 5 memories with your first message | Yes | Not stated for Claude Code | Yes, and searches memory on every message | Yes, if you turn it on |
| Protects work when a conversation is compacted | Before and after; during too, with one setting (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, see [Compaction](how-it-works.md#compaction)) | Not stated | Saves pending memories when it happens | Not stated | Saves before it happens | Not stated | Brings memory back before it happens |
| Old versions kept, so you can undo | Yes, of notes and of each finished day of the journal: Git history on your computer (needs Git) | Not stated | Not stated | Not stated | Partly: facts keep the dates they were true | Not stated | Yes, a chain of every version |
| Lessons shared across your projects | Yes | Not stated | No, kept per repository | Optional | Yes | A personal profile | Not stated |
| Shared with a team | No | Optional, paid | Yes | Yes, in its cloud | Yes, with a team server | Yes | Yes |
| Safe with several windows open | Yes, and each window is told about the others | Not stated | Not stated | Not stated | Not stated | Not stated | Not stated |
| Sends your data anywhere | No | To the AI service you pick, plus anonymous usage data unless you turn it off | To Mem0, plus usage data tied to your account | To the cloud and AI service you pick | No | To Supermemory | No, unless you turn on an option |
| Works outside Claude Code | No | Yes: Codex, Cursor, OpenCode and more | Yes: Claude.ai, Cursor, Codex and more | Yes: Codex, Cursor, Copilot CLI and more | Yes: Cursor, Codex, Gemini CLI and any MCP app | Yes: Cursor, Codex, Claude Desktop and more | Yes: Codex, Cursor, Gemini CLI and any MCP app |
| License | MIT | Apache-2.0 | Apache-2.0 | MIT | MIT | MIT | Apache-2.0 |

In plain words:

- **project-memory** suits you if you want Claude Code's own memory kept
  tidy, safe from mistakes and intact through long conversations, with nothing
  to sign up for and no server of its own: what it saves stays on your computer,
  and only what Claude reads of it goes to Anthropic with the rest of the
  conversation. It keeps a journal of
  every exchange you do not mark private for Claude to search, and you can turn
  it off for one conversation or one project. It replaces keys, tokens and
  passwords before saving, though no tool catches every secret. It searches by
  words only, works in Claude Code only, and doesn't sync between computers or
  teammates.
- **claude-mem** is the most popular. A second AI watches what Claude does
  and writes notes, which you search by meaning. It runs a background service,
  and the note-taking AI uses its paid service, your own key or your Claude plan.
- **Mem0** and **Supermemory** keep memory in the cloud, so it can be shared
  with a team and with other tools. Both need an account, and your
  conversations are sent to their servers. Both publish high scores on memory
  benchmarks such as LongMemEval.
- **Hindsight** is a heavier memory server that builds lessons from your past
  sessions and git history. It needs either its cloud or a server you run, and
  an AI model to do the work.
- **MemPalace** keeps your conversations word for word and searches them by
  meaning, without calling any online service. It needs Python, and Claude
  reaches it as an MCP server (a tool Claude can call).
- **agentmemory** is a local server that gives Claude Code, Codex, Cursor and
  other tools one shared memory, with a history of every version. It runs as a
  background service on your computer.

Also worth knowing:

- **[context-mode](https://github.com/mksglu/context-mode)** (34,300 stars)
  mainly keeps long tool output out of the context window. Its session memory
  is a bonus. It does a different job, and it runs fine alongside
  project-memory.
- **[Basic Memory](https://github.com/basicmachines-co/basic-memory)** builds a
  knowledge base of readable text files that many AI apps can use. Claude adds
  notes when you ask it to, rather than on its own.
