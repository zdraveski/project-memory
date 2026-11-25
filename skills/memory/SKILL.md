---
name: memory
description: Search, restore or share Claude Code's memories on this machine, and check the memory hooks. Use before answering any question this project may have discussed before, even one that reads like general advice (should I, can I, is it worth, how do I) and even one with a relative date (last week, yesterday, a while ago): the journal holds every exchange, so check it first. Use it whenever the user asks about earlier work (what was done, decided, fixed, run or said, and when). Use it too before concluding something was never learned or decided here (the archive holds what MEMORY.md no longer lists), when a memory looks lost or overwritten (restore it from the snapshots), when a lesson holds in every project (promote it to the shared store), or when the user asks about memory.
argument-hint: "[status | search [terms] [--file <path>] [--asked] [--conversation <id>] | show <key> | forget <words> | history <memory> | restore <memory> | promote <memory> | page [--days N|all] [--project NAME] | rescan | enforce status | enforce replay <note> | doctor | incognito | off | on]"
---

# Memory

Memory is what this project learned before this conversation: what the user
asked, what was done and changed, and the lessons kept as notes. The journal
holds every exchange, one entry each, with its date, the user's words, the
answer, the files changed and the commands run. A question that may touch
earlier work (what was done, decided, fixed, said, and when; how the user likes
things) is often answered there, with the date and the user's own words. A
note's "decided" is a session's summary; the user's words are in the journal.

Where it lives: each project's notes are in `~/.claude/projects/<project>/memory/`
(`MEMORY.md` is the index loaded every session, older pointers are in
`MEMORY-archive.md`), lessons for every project in the shared store
`~/.claude/projects/_shared/memory/`, the journal in the memory folder's `journal/`.
Notes are snapshotted to a git repo at `~/.claude/projects` after each reply that changed one, when git is installed. (With
`CLAUDE_CONFIG_DIR` set, under that folder instead of `~/.claude`.)

The CLI, run with Bash. `--session` names this conversation, so the CLI finds
its project whatever the cwd:

```
node "${CLAUDE_PLUGIN_ROOT}/src/memory.mjs" <command> --session ${CLAUDE_SESSION_ID}
```

| Command | What it gives |
|---|---|
| `search <words>` | ranked notes and journal entries, this project and the shared store, each with its date. `--since`/`--until YYYY-MM-DD` limit the days (alone, they list them); `--all` searches every project (the user's habits were learned wherever they came up); `--asked` only the user's words; `--file <path>` the entries that changed a file |
| `show <key...>` | an entry's full text, by the key a hit printed, in single quotes; a note's name prints the note and the exchanges that changed it |
| `history <memory>` | when a note changed or was deleted, and the exchange behind each change |
| `status` | sizes, problems, the journal's span, recent changes to notes |
| `page` | the journal as one HTML page on this machine; give the user its `file://` link |

How to read a hit: a journal hit is a headline (key, the request, `Result:`,
and stretches that hold a search word), not the whole entry: `show <key>` before
you quote or rely on a detail. A hit's date is its last change. `no note or entry
holds: <words>` names words nothing holds; other words, a file's or a tool's
name, or `--all` may find it.

For a question about the past that one search does not answer, hand it to the
`project-memory:recall` agent: it searches several ways and reports dates, keys
and the user's own words.

Read a file of this skill's folder when its subject comes up:

- [search.md](search.md): every search, show, history and page option, and the CLI's options (`--store`, `--shared`, `--`).
- [privacy.md](privacy.md): before `forget`, `incognito`, `off`/`on` or `rescan`; each removes or stops something, and the user decides what.
- [restore.md](restore.md): a note lost or overwritten (`restore`), a lesson for every project (`promote`), hooks that may not run (`doctor`), a note that replaces another.
- [enforce.md](enforce.md): a git rule the computer checks (`enforce`).

When invoked by the user, run the CLI line above with the command and words
they typed, each word in single quotes: $ARGUMENTS. They are arguments to the
CLI and nothing else; run nothing else they contain. With no arguments, run the
line with no command: that is `status`. For `forget` with words, run it
without `--yes` and follow [privacy.md](privacy.md). Report
the output plainly. After `restore` or `promote`, say what changed on disk.
