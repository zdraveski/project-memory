# How project-memory compares

The side-by-side behind the [README](../README.md)'s short summary.

Claude Code's own memory keeps improving. It now asks Claude to shorten the
table of contents when it nears its limit, and after a compaction it reloads
your notes, re-reads recent files and reminds Claude of jobs still running.
project-memory adds what it still doesn't do: a new conversation that starts
knowing where the last one stopped, a journal of every exchange that Claude
searches when you ask about earlier work, a history of every note, a shared
notebook for all your projects, and safe use of several windows at once.

project-memory isn't the only add-on either. This table compares it with five
popular tools, going only by each one's own documentation on 27 October 2026.
"Not stated" means that documentation doesn't say. These tools change often,
so check their pages before you choose.

| | project-memory | [claude-mem](https://github.com/thedotmack/claude-mem) | [Mem0](https://docs.mem0.ai/integrations/claude-code) | [Supermemory](https://github.com/supermemoryai/claude-supermemory) | [Basic Memory](https://github.com/basicmachines-co/basic-memory) | [context-mode](https://github.com/mksglu/context-mode) |
|---|---|---|---|---|---|---|
| What it is | Claude Code plugin | Claude Code plugin | Claude Code plugin | Claude Code plugin | Memory server for many AI apps | Claude Code plugin |
| Main job | Looking after Claude Code's own memory | Recording and summarising sessions | Memory in the cloud | Memory in the cloud | A knowledge base of notes | Saving context window space |
| Where your memories live | Claude Code's own notebook, on your computer | Its own database, on your computer | Mem0's servers | Supermemory's servers | Text files on your computer, or a paid cloud | A database on your computer, cleared after 14 days |
| Account or API key | No | Optional | Required | Required | No, unless you use the paid cloud | No |
| Extra software | Node.js and Git | Node.js, Bun, uv and a background service | Python and Git | Node.js | Python | Node.js |
| Uses an AI model to write memories | No | Yes: your Claude plan, your own key, or its paid service | Yes, on Mem0's side | Yes, on Supermemory's side | No | No |
| How memories are made | Claude writes notes, and every exchange is saved to a journal after every reply | Automatically, from everything Claude does | Automatically, from your conversations | Automatically, from your conversations | Claude writes notes when asked | Automatically, from what happens in a session |
| Search | By words | By words and by meaning | By meaning | By meaning | By words and by meaning, plus links between notes | By words |
| Picks up where you left off | Yes | Yes | Brings back up to 5 memories at the start | Searches memory on every message | When Claude reads the notes | Yes |
| Protects work when a conversation is compacted | Before, during and after | Not stated | Not stated | Not stated | Not stated | Yes |
| Old versions kept, so you can undo | Yes, of notes and of each finished day of the journal | Not stated | Not stated | Not stated | Paid cloud only | No |
| Lessons shared across your projects | Yes | Not stated | No, kept per repository | A personal profile | Yes, one knowledge base | Search across projects |
| Shared with a team | No | Optional | Yes | Yes | Not stated | No |
| Safe with several windows open | Yes, and each window is told about the others | Not stated | Not stated | Not stated | Not stated | Not stated |
| Sends your data anywhere | No | To the AI service you pick | To Mem0, plus usage data tied to your account | To Supermemory | No, unless you use the paid cloud | No |
| Works outside Claude Code | No | Yes | Through other Mem0 integrations | Shares memory with Codex and OpenCode | Yes: Claude Desktop, Cursor, ChatGPT, Obsidian and more | Yes |
| License | MIT | Apache-2.0 | Apache-2.0 | MIT | AGPL-3.0 | Elastic License 2.0 |

In plain words:

- **project-memory** suits you if you want Claude Code's own memory kept
  tidy, safe from mistakes and intact through long conversations, with nothing
  to sign up for and nothing leaving your computer. It keeps a journal of
  every exchange for Claude to search. It searches by words only, works in
  Claude Code only, and doesn't sync between computers or teammates.
- **claude-mem** records everything Claude does and searches it by meaning. It
  runs a background service, and an AI model writes its summaries, which uses
  your Claude plan, your own key or its paid service.
- **Mem0** and **Supermemory** keep memory in the cloud, so it can be shared
  with a team and with other tools. Both need an account, and your
  conversations are sent to their servers.
- **Basic Memory** builds a knowledge base of readable text files that many AI
  apps can use. Claude adds notes when you ask it to, rather than on its own.
- **context-mode** mainly keeps long tool output out of the context window.
  Its session memory is a bonus. It does a different job, and it runs fine
  alongside project-memory.

Two more are worth knowing about:

- **[memory-toolkit](https://github.com/IlyaGorsky/memory-toolkit)** is a
  Claude Code plugin that works on the same notebook. It sorts your work into
  "workstreams", each with its own record of where you left off. It also logs
  your git commits into daily notes, and before a compaction it notes your
  branch and the changes you haven't committed yet. Every few minutes it
  sends the latest part of the conversation to Claude's small Haiku model,
  which picks out corrections, decisions and plans.
- **[MemPalace](https://github.com/MemPalace/mempalace)** keeps your
  conversations word for word and searches them by meaning, without calling
  any online service. It needs Python, keeps everything in its own database,
  and Claude reaches it as an MCP server (a tool Claude can call).
