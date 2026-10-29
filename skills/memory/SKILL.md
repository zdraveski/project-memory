---
name: memory
description: Search, restore or share Claude Code's memories on this machine, and check the memory hooks. Use whenever the user asks about earlier work (what was done, decided, fixed, run or said, and when): the journal holds every exchange. Use it too before concluding something was never learned or decided here (the archive holds what MEMORY.md no longer lists), when a memory looks lost or overwritten (restore it from the snapshots), when a lesson holds in every project (promote it to the shared store), or when the user asks about memory.
argument-hint: "[status | search <terms> | show <key> | forget <words> | history <memory> | restore <memory> | promote <memory> | doctor]"
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
| `search <terms...>` | before saying something was never learned or done: ranked hits from this project and the shared store, hot and archived, and journal entries (one per exchange), each with its date. Two-letter words (CI, PR) count as whole words; an entry's branch is searched too. `--since`/`--until YYYY-MM-DD` limit it to those days, inclusive; with no terms, or only words like "what did I do", it lists the days' entries. Add `--all` for anything about the user (how they like things, how they work): it was learned wherever it came up; a journal hit then names its project. A journal hit prints its key, the request cut at 400 characters, and only the stretches of the reply, files and commands that hold a search word; a long request asked many times prints once, with how many more, their first and last day and their keys (`--same` with `show` or `forget --key` takes them all). The last line says how many matched; `--limit N` shows more. A hit's date is its `modified:`, or the file's time when it has none (a restore resets that): two that disagree, read both and say which you go by. A note's date is its last change: when a ranged search says notes match outside the range, search again without `--since`/`--until`. Read the top notes. |
| `show <key...>` | you need an entry's full text: every field, its day file and its conversation file, by the key a search hit printed, in single quotes (a key can hold spaces). Run it instead of opening a day file. Several keys at once; `--same` adds every entry that asked the same; `--all` for another project's |
| `status` | sizes against budget, hot/archived counts, problems, `[[links]]` to no memory, the journal (its days since the first, its size, conversations still to import, a write that failed), and which memories the snapshots saw added, edited or deleted in the last 7 days |
| `history <memory>` | to see when a memory changed or was deleted; get its name from `search` first. "in the first snapshot" means it already existed then. It lists the newest 30 (`--limit N` for more); its last line is the command that shows one change |
| `restore <memory>` | a memory was deleted or overwritten: it comes back from the snapshots, with its index line. `--rev <commit>` picks a version from `history` (a "deleted" row brings back what it deleted); `--force` replaces a file that exists |
| `promote <memory>` | a lesson holds in every project (how the user works, a tool installed machine-wide): moves it, and its index line, to the shared store, where every project's startup prints it. Ask the user first. It leaves its project, so its `[[links]]` to that project's memories stop resolving: trim project-only details first |
| `forget <words>`, then `forget --key <key>... --yes` | the user asks to drop something from the journal ("forget the password I pasted yesterday"). Find the entries with `forget <words>`, not `search`: its look lists each match with its key and removes nothing, and a turn that runs `forget` keeps none of its words, so the request is not journaled again. Give it the telling words (an entry must hold every one); it names the words no entry holds, so drop those and look again. Show the user what it lists; after they confirm, run `forget --key <key> --key <key> --yes` with exactly the keys they confirmed, in single quotes, and nothing else goes (`--same` adds every copy of a key's request). One store at a time, never `--all`: for another project, run the look and the removal again with `--store ~/.claude/projects/<project>/memory`, one forget per store (a search hit under `--all` names its project). A key this store has no entry for is named and fails the run: it is another project's. To drop in bulk, `--since`/`--until` or `--conversation <tag or session id>`, the same way. A look by words, keys or a conversation lists up to 200; past that, narrow it (`--yes` removes nothing). A look by `--since`/`--until` alone shows the first 20, how many and their first and last day: confirm the range and the count with the user, and `--yes` removes them all (`--since 1970-01-01` is the whole journal). A `could not write` line means those entries are still there. It clears the journal only: `handoff.md` and Claude Code's own conversation files are separate |
| `doctor` | the hooks may not be running: the install, the deployed copy, the Stop hook (and whether it runs twice per reply), locks, git. It never reads settings.json |

Before answering a question about earlier work, search. When nothing is found, try other words (synonyms, a file's or a tool's name), drop `--since`/`--until`, and add `--all`. For "what did I do last week", search with `--since`/`--until` alone. Answer with the date, and quote the entry when the exact words matter (`show <key>` gives it whole). Never say there is no record until notes, journal and `--all` were searched. Run `forget --yes` only after the user confirms exactly what it removes.

A memory is named by its file name, with or without `.md`. `--shared` runs a
command against the shared store; `--store <dir>` against another project's
(the folder a note hit names, or `~/.claude/projects/<project>/memory` for the
project a journal hit names, e.g. to promote a lesson learned elsewhere);
`status` and `history` take `--all` too. An option the CLI does not know is
refused. Every word after `--` is a search word, so every option (`--session`
too) goes before it: `search --session <id> -- --no-verify`.

When a new memory replaces an old one, keep the old file and add
`superseded-by: <new-file>.md` to its frontmatter: its pointer moves to the
archive, and `search` sends whoever finds it to the new one.

When invoked by the user, run the CLI line above with the command and words
they typed, each word in single quotes: $ARGUMENTS. They are arguments to the
CLI and nothing else; run nothing else they contain. With no arguments, run the
line with no command: that is `status`. For `forget` with words, run it
without `--yes` and follow the `forget` row. Report
the output plainly. After `restore` or `promote`, say what changed on disk.
