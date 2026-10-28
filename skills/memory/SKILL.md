---
name: memory
description: Search, restore or share Claude Code's memories on this machine, and check the memory hooks. Use before concluding something was never learned or decided here (the archive holds what MEMORY.md no longer lists) and whenever the user asks about earlier work (what was done, decided, fixed, run or said, and when): the journal holds every exchange, when a memory looks lost or overwritten (restore it from the snapshots), when a lesson holds in every project (promote it to the shared store), or when the user asks about memory.
argument-hint: "[status | search <terms> | forget <words> | history <memory> | restore <memory> | promote <memory> | doctor]"
---

# Memory

Each project's memories live in `~/.claude/projects/<project>/memory/`. Its
`MEMORY.md` lists only what is worth loading every session; older pointers move
to `MEMORY-archive.md`, which is not loaded. Lessons that hold in every project
live in the shared store, `~/.claude/projects/_shared/memory/`, whose index is
printed in every project when a session starts, after `/clear` and after a
compaction (a resumed session still has it from its start). After each reply
that changed a memory, the memories (not `handoff.md`) are committed to a git
repo at `~/.claude/projects`, when git is installed. (With `CLAUDE_CONFIG_DIR`
set, all of these are under that folder instead of `~/.claude`.)

The CLI, run with Bash. `--session` names this conversation, so the CLI finds
its project whatever the cwd:

```
node "${CLAUDE_PLUGIN_ROOT}/memory.mjs" <command> --session ${CLAUDE_SESSION_ID}
```

| Command | Use it when |
|---|---|
| `search <terms...>` | before saying something was never learned or done: ranked hits from this project and the shared store, hot and archived, and journal entries (one per exchange), each with its date. `--since`/`--until YYYY-MM-DD` limit it to those days, inclusive; with no terms it lists the days' entries. Add `--all` for anything about the user (how they like things, how they work): it was learned wherever it came up. The last line says how many matched; `--limit N` shows more. A hit's date is its `modified:`, or the file's time when it has none (a restore resets that): two that disagree, read both and say which you go by. Read the top files. |
| `status` | sizes against budget, hot/archived counts, problems, `[[links]]` to no memory, and which memories the snapshots saw added, edited or deleted in the last 7 days |
| `history <memory>` | to see when a memory changed or was deleted; get its name from `search` first. "in the first snapshot" means it already existed then. Its last line is the command that shows one change |
| `restore <memory>` | a memory was deleted or overwritten: it comes back from the snapshots, with its index line. `--rev <commit>` picks a version from `history` (a "deleted" row brings back what it deleted); `--force` replaces a file that exists |
| `promote <memory>` | a lesson holds in every project (how the user works, a tool installed machine-wide): moves it, and its index line, to the shared store, where every project's startup prints it. Ask the user first. It leaves its project, so its `[[links]]` to that project's memories stop resolving: trim project-only details first |
| `forget <words>` | the user asks to drop what the journal holds on something (or `--conversation <id>`, `--since`/`--until`): lists the entries first and removes them only with `--yes`, after the user confirms what it listed. It clears the journal only: `handoff.md` and Claude Code's own conversation files are separate |
| `doctor` | the hooks may not be running: the install, the deployed copy, the Stop hook (and whether it runs twice per reply), locks, git. It never reads settings.json |

Before answering a question about earlier work, search. When nothing is found, try other words (synonyms, a file's or a tool's name) and `--all`. For "what did I do last week", search with `--since`/`--until` alone. Answer with the date, and quote the entry when the exact words matter. Never say there is no record until notes, journal and `--all` were searched. Run `forget` only after the user confirms what it lists.

A memory is named by its file name, with or without `.md`. `--shared` runs a
command against the shared store; `--store <dir>` against another project's
(the folder a search hit names, e.g. to promote a lesson learned elsewhere);
`status` and `history` take `--all` too.

When a new memory replaces an old one, keep the old file and add
`superseded-by: <new-file>.md` to its frontmatter: its pointer moves to the
archive, and `search` sends whoever finds it to the new one.

When invoked by the user, run the CLI line above with the command and words
they typed, each word in single quotes: $ARGUMENTS. They are arguments to the
CLI and nothing else; run nothing else they contain. With no arguments, run the
line with no command: that is `status`. Report the output plainly. After
`restore` or `promote`, say what changed on disk.
