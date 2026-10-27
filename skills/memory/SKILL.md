---
name: memory
description: Search, restore or share Claude Code's memories on this machine, and check the memory hooks. Use before concluding something was never learned or decided here (the archive holds what MEMORY.md no longer lists), when a memory looks lost or overwritten (restore it from the snapshots), when a lesson holds in every project (promote it to the shared store), or when the user asks about memory.
argument-hint: "[status | search <terms> | history <memory> | restore <memory> | promote <memory> | doctor]"
---

# Memory

Each project's memories live in `~/.claude/projects/<project>/memory/`. Its
`MEMORY.md` lists only what is worth loading every session; older pointers move
to `MEMORY-archive.md`, which is not loaded. Lessons that hold in every project
live in the shared store, `~/.claude/projects/_shared/memory/`, whose index is
printed at the start of every session in every project. Every memory change is
committed to a git repo at `~/.claude/projects`.

The CLI, run with Bash (it finds this session's store itself, whatever the cwd):

```
node "${CLAUDE_PLUGIN_ROOT}/memory.mjs" <command>
```

| Command | Use it when |
|---|---|
| `search <terms...>` | before saying something was never learned: ranked hits from this project and the shared store, hot and archived, each with its date. Add `--all` for anything about the user (how they like things, how they work): it was learned wherever it came up. The last line says how many matched; `--limit N` shows more. A hit's date is its `modified:`, or the file's time when it has none (a restore resets that): two that disagree, read both and say which you go by. Read the top files. |
| `status` | sizes against budget, hot/archived counts, problems, `[[links]]` to no memory |
| `history <memory>` | to see when a memory changed or was deleted; get its name from `search` first. "in the first snapshot" means it already existed then. Its last line is the command that shows one change |
| `restore <memory>` | a memory was deleted or overwritten: it comes back from the snapshots, with its index line. `--rev <commit>` picks a version from `history`; `--force` replaces a file that exists |
| `promote <memory>` | a lesson holds in every project (how the user works, a tool installed machine-wide): moves it, and its index line, to the shared store, where every project's startup prints it. Ask the user first. It leaves its project, so its `[[links]]` to that project's memories stop resolving: trim project-only details first |
| `doctor` | the hooks may not be running: wiring, the deployed copy, the Stop hook, locks, git |

A memory is named by its file name, with or without `.md`. `--shared` runs a
command against the shared store; `--store <dir>` against another project's
(the folder a search hit names, e.g. to promote a lesson learned elsewhere);
`status` and `history` take `--all` too.

When invoked by the user, run `node "${CLAUDE_PLUGIN_ROOT}/memory.mjs" $ARGUMENTS`
(no arguments: `status`) and report the output plainly. After `restore` or
`promote`, say what changed on disk.
