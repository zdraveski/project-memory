<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

# project-memory

Memory for Claude Code that holds up when you run several sessions at once,
and when a long session gets compacted.

Claude Code's auto memory keeps notes for each project in
`~/.claude/projects/<project>/memory/`, with an index, `MEMORY.md`, that is
loaded at the start of every session. This plugin looks after that folder:

- **The index stays small.** `MEMORY.md` is kept under 7,000 bytes. Older
  pointers move to `MEMORY-archive.md`, which is not loaded but can still be
  searched. A memory with no pointer gets one back, and duplicate lines go.
- **A rolling handoff.** After every turn, `handoff.md` records the last ten
  exchanges of each session, so the next session, or one running beside it,
  knows where things stopped.
- **A startup briefing.** Each session starts by learning who else is working
  in the project, where the last session stopped, what is failing, and the
  lessons shared by every project.
- **Compaction loses nothing in flight.** A mid-turn auto compaction waits for
  the end of the turn when that is safe. Before one, the model is asked once
  to write its memory. If a turn is cut anyway, what it had in flight (the ask,
  background tasks and their output files, the files it edited) comes back
  after the compaction.
- **Undo.** Every change to a memory is committed to a local git repo at
  `~/.claude/projects`. `history` and `restore` bring back a memory that was
  deleted or overwritten.
- **Shared lessons.** `~/.claude/projects/_shared/memory/` holds lessons that
  apply everywhere: how you work, tools installed on the machine. Its index is
  shown in every session of every project, capped at 3,000 bytes. `promote`
  moves a memory there.
- **Recall.** `search` ranks memories by name, then description, then body,
  archive included, in one project or all of them.
- **Safe in parallel.** Each store has a lock, and every write checks the file
  first, so an edit the hook did not see is never overwritten. Every hook exits
  0: a failure never blocks a session.

No dependencies: Node built-ins and git.

## Install

You need Claude Code with auto memory on, Node.js 20 or newer on your PATH
(Claude Code's native installer does not include Node), and git for the
snapshots. Without git everything else still works.

In Claude Code:

```
/plugin marketplace add zdraveski/project-memory
/plugin install project-memory@project-memory
```

Or in a terminal:

```
claude plugin marketplace add zdraveski/project-memory
claude plugin install project-memory@project-memory
```

Then restart Claude Code, or run `/reload-plugins` in each open session, and
check the result with `/project-memory:memory doctor`.

## Use

The hooks run on their own. The `memory` skill covers the rest, for you and
for the model:

| `/project-memory:memory …` | What it does |
|---|---|
| `status` | index size against its budget, hot and archived counts, problems, `[[links]]` to no memory |
| `search <words>` | ranked hits from this project and the shared store; `--all` searches every project |
| `history <memory>` | the snapshots that changed it |
| `restore <memory>` | brings it back from the snapshots, with its index line; `--rev <commit>` picks a version, `--force` replaces a file that exists |
| `promote <memory>` | moves it to the shared store |
| `doctor` | wiring, the Stop hook, locks, git, snapshots |

The model uses the skill without being asked: it searches before saying
something was never learned. It asks you before promoting anything.

The same commands work from a terminal: `node <plugin folder>/memory.mjs <command>`.

## What it writes

Everything stays on your machine. Nothing is sent anywhere.

| Where | What |
|---|---|
| `~/.claude/projects/<project>/memory/MEMORY.md` | pointers moved, restored or de-duplicated |
| `…/memory/MEMORY-archive.md` | the pointers `MEMORY.md` no longer lists |
| `…/memory/handoff.md` | the last ten exchanges of each session: the start of each prompt and of each reply |
| `…/memory/.lock`, `.tiered`, `.health` | the store's lock, a change fingerprint, problems for the startup briefing |
| `~/.claude/projects/_shared/memory/` | the shared store |
| `~/.claude/projects/.git` | the snapshot repo. It tracks only `*/memory/*.md` and is never pushed |
| `~/.claude/projects/.stop-ran`, `.snapshot-health`, `.nudge/` | bookkeeping |

The handoff holds the start of your prompts, and the snapshot repo keeps every
version of it. Bear that in mind before you share the folder.

## Compaction window

The memory nudge fires at 85% of the window Claude Code compacts against,
which this plugin assumes is 1,000,000 tokens. On a smaller window, put that
size in `CLAUDE_CODE_AUTO_COMPACT_WINDOW` under `env` in your settings, for
example `"200000"`. Otherwise the nudge never fires. A compaction under
200,000 tokens is never deferred.

## Limits

- Paths assume `~/.claude`. `CLAUDE_CONFIG_DIR` is not supported yet.
- Tested on Linux, macOS and Windows, with Node 20 and 24.
- A turn that is only a slash command gets no handoff entry.
- The snapshot repo only grows. Delete `~/.claude/projects/.git` to drop the
  history; the next change starts a new one.

## Uninstall

```
/plugin uninstall project-memory@project-memory
```

Your memories, the archive files and the snapshot repo stay where they are.

## Development

Each suite builds a throwaway home folder and never touches your `~/.claude`:

```
node store.test.mjs
node compact-gate.test.mjs
node handoff-log.test.mjs
node memory-tier.test.mjs
node memory.test.mjs
node wire.test.mjs
```

- `node mutate.mjs [text]` breaks one rule at a time and expects a suite to
  fail: all mutants, or those whose label contains the text. The full run
  takes several minutes.
- `node memory-tier.soak.mjs` and `node memory-tier.break.mjs` copy the
  largest store on the machine (or the one you pass) to a temp folder, then
  race it and break it.
- `node bench.mjs` times the hooks on copies of your largest transcript and
  store.

The design and its measurements are in `docs/specs/`.

The author runs this repo from `~/.claude/hooks`. `node deploy.mjs` runs every
check, then copies the plugin to `~/.claude/hooks-live`, which serves as a
local marketplace. `node wire.mjs --plugin` or `--settings` switches between
the plugin and hooks in `settings.json`. You need none of this to use the
plugin.

## License

MIT. See [LICENSE](LICENSE).
