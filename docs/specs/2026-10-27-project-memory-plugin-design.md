# project-memory: shared lessons, recall, undo, and a plugin

2026-10-27. Status: the owner asked for autonomous work (plan, build, gap pass,
polish x3, speed x3, looped for 5 h, no questions). Calls marked *(my call)*
are the builder's.

## Why

The hooks keep each project's memory well: tiering, the rolling handoff,
compaction recovery, snapshots, parallel-session safety. What they cannot do
is anything *across* projects, or anything a person asks of them. What was
measured on 2026-10-27 (19 stores, ~290 memories, 149 transcripts, 128 MB):

| Finding | Evidence |
|---|---|
| Lessons about the owner are trapped in one project | of 57 `user`/`feedback` memories, at least 10 hold everywhere ("never `git add -A` in the owner's repos", "finish inline when subagents stall", "Fable plans, Opus implements", "my test is wrong when the user says it is broken"), each visible in one project only. The Fable/Opus rule was learned twice, in two projects, worded differently |
| The snapshots have no way back out | the git repo under `~/.claude/projects` holds every memory's history; nothing reads it |
| Recall is a raw grep | the model is told to grep the archive; one project alone has 194 memories, 670 `[[links]]` |
| Links rot unseen | 3 dangling `[[links]]` today |
| No way to ask "is memory OK?" | health is only the startup line; wiring, drift, stale locks need reading code |
| The deploy gate takes ~20 min | `mutate.mjs` runs ~100 mutants one after another; the four suites alone are 54 s |
| Hooks are wired by absolute path in settings.json | not installable, not a plugin |

## Goals

1. **Shared memory.** A lesson that holds in every project is written once and
   reaches every session in every project, at a bounded token cost.
2. **Recall, undo, promote, status, doctor** as one CLI (`memory.mjs`) the
   model and the owner can run, exposed as a skill and a slash command.
3. **A plugin**, `project-memory`, installable from the deployed copy, with the
   deploy gate unchanged in spirit: nothing runs that the full check did not pass.
4. **Faster**: Stop and SessionStart latency down, measured; the deploy gate
   well under its 20 minutes.

Non-goals: prompt-time automatic recall (measured 2026-10-26: 0 of 27 prompts
matched an unopened archived memory; `search` covers it on demand), offsite
backup (declined), embeddings or any dependency, moving the owner's existing
memories into the shared store (the owner's or model's call, one command each).

Anti-goals — a failure even if it works: a hook that fails or blocks a
session; startup context that grows without a ceiling; a lost pointer, memory
or handoff turn; a write to another project's store (the shared store is the
one, deliberate exception, under its own lock).

## Constraints

Unchanged from the 2026-10-26 spec: Node built-ins only; Windows (EPERM on
rename over an open file); the model's Edit/Write take no lock; every hook
exits 0; work in a worktree (branch `plugin`), live changes only through
`deploy.mjs` after every gate passes.

## Design

### 1. The shared store

- Path: `~/.claude/projects/_shared/memory/` *(my call)*. A project slug
  replaces every non-alphanumeric with `-`, so no cwd can map to `_shared`;
  the snapshot repo already tracks `*/memory/*.md`; a manual tiering run
  already walks it. `store.mjs` exports `sharedStore()` and `isShared(dir)`.
- Same file format and index as a project store, tiered by the same `tier()`
  with its own budget: `SHARED_BUDGET = 3000` bytes *(my call: it is printed
  into every session of every project)*. The 7000 B project budget is unchanged.
  No age window applies there: a shared lesson stays hot until the ceiling
  evicts it (marked, so it returns) or it says `tier: archive`. With the
  project windows a `reference` lesson was archived a week after sharing and
  never printed again (review, 2026-10-27).
- `--stop` tiers the session's own store and then the shared store, each only
  when its fingerprint changed, each under its own lock.
- SessionStart prints it (sources `startup`, `clear`, `compact`):
  ```
  Shared memory, every project (<abs dir>): open a file there when its line applies.
  - [Title](file.md) — hook
  ...
  ```
  Every line is printed, even one whose file name the project also has:
  auto-memory names repeat across projects, and hiding the shared line for a
  different memory of the same name lost the lesson (review). The printed
  lines are capped at 3000 B themselves, with a count of the rest: tiering
  never evicts a pin. With no shared store, or an
  empty one, one line instead *(my call — without it the store is never
  learned)*: `Shared memory: lessons that hold in every project (how the user
  works, machine-wide tools) go in <abs dir>, same format, pointer in its
  MEMORY.md.` The archive line is printed too: it says how much is greppable.
- `clear` is treated as `startup` (fresh context). Settings matcher becomes
  `startup|clear|compact`.

### 2. `memory.mjs`, the CLI

`node memory.mjs <command> [args] [--store <dir> | --shared] [--all]`. The
store defaults to the session's own, found as the hooks find it: Claude Code
puts `CLAUDE_CODE_SESSION_ID` in every Bash command's environment, and the
transcript `<id>.jsonl` sits in the project folder it chose. Outside a
session: the cwd's project, or the nearest folder above it with a store (a
subdirectory's own slug has none). The cwd alone let a session whose Bash had
moved into another project write that project's store (review). Output is
plain text; exit 0 on success, 1 on a refused or failed command (the CLI is
not a hook).

- `search <terms…> [--all] [--limit N]`: the project store and the shared
  store (`--all`: every store), hot and archived. Terms are lower-cased words
  of 3+ characters. Score per term: +3 in the file name or `name:`, +2 in
  `description`, +1 per body hit capped at 2. Every term in the name or
  description: +5; every term somewhere: +2 (a month-long log that mentions
  everything outranked the memory named for the thing). Ties: newer first.
  Prints the top `N` (default 8; zero, negative or not a number is 8):
  `score  [shared] hot|archived|unindexed  <date>  <abs path>` (the date is
  `modified:`, else the file's mtime), then `  description`, then
  `  links: a, b` when it has any; last, `N of M match(es) in <stores>`, with
  `--limit N shows more` when some were left out and `--all searches every
  project` without `--all`. No hit names the stores searched the same way.
- `status [--all]`: per store: index bytes / budget, hot / archived / files,
  `.health` lines, dangling `[[links]]` (resolved against the store's and the
  shared store's file names and `name:` slugs), memories with no
  `description:` or no `type:`; handoff sessions and newest entry; snapshot
  health (`lastOk`, `failures`). Shared store always included.
- `history <file>`: snapshot commits touching it (`<hash> <date>  added|changed|deleted`;
  the root commit's take-in reads `in the first snapshot`), looked up in the
  current store, then the shared store; `--all` any store. Paths go to git in
  their on-disk case (`realpathSync.native`). Last line: the `git show`
  command for one change, with the repo folder and the path git tracks. Not
  found: says to find the name with `search`, and `--all` unless given.
- `restore <file> [--rev <hash>] [--force]`: writes the file back from the
  snapshot — by default the newest snapshot that has it: HEAD's, or when HEAD
  has it deleted, the version before that deletion. Refuses to overwrite an existing file
  without `--force`. If no index line points at it, the line it had at that
  revision (main or archive, overflow mark stripped) is appended to MEMORY.md;
  failing that, tiering's orphan recovery gives it one. Under the store lock.
- `promote <file>`: moves a memory from the current store to the shared store.
  Copy the file (refuse if the shared store has that name), add its own index
  line to the shared MEMORY.md, then remove the line from the project index and
  delete the project copy. Locks: project, then shared, always that order.
  A failure part-way leaves the memory in both stores, never in neither.
- `doctor`: wiring (settings.json entries for these hooks; plugin
  `project-memory` enabled; both = "runs twice"; neither = "not wired"), live
  copy drift (`edited()`), Stop hook liveness (`stalled()`), stale `.lock`
  folders, `git` on PATH, snapshot health. One line per finding, `ok` lines
  included; exit 1 when any finding is a problem.

### 3. The plugin

- Repo root is the plugin root: `.claude-plugin/plugin.json` (`name:
  project-memory`, version), `.claude-plugin/marketplace.json` (one plugin,
  `source: "./"`), `hooks/hooks.json` (the same four entries as settings.json,
  through `${CLAUDE_PLUGIN_ROOT}`; wire.test checks they match `rewire()`),
  and one skill, `skills/memory/SKILL.md`: model-invoked (search before
  assuming something was never learned; restore; promote) and user-invoked as
  `/project-memory:memory <command>`, which runs the CLI. No commands folder:
  the docs prefer skills, and one file does both (proven end to end).
- Installing from a directory marketplace copies the plugin into
  `~/.claude/plugins/cache/<marketplace>/<name>/<version>/`, but runs it from
  the folder: `claude plugin list --json` says `readFromFolder` (measured
  2026-10-27; a first reading of the cache folder had it the other way).
  `claude plugin update` re-copies only for a new version. So the
  marketplace is `~/.claude/hooks-live`, which only `deploy.mjs` writes: the
  cache is filled from checked files, `.deployed.json` included. Each deploy
  stamps the live `plugin.json` version's patch with master's commit count and,
  when the plugin is installed, runs `claude plugin update` to refresh the cache
  copy (a failure is a warning: the live copy is what runs). `doctor` names
  the folder the plugin runs from, and says when it is not the live copy or
  is older than the last deploy.
- `wire.mjs --plugin | --settings [--dry-run]` switches the live wiring:
  `--plugin` backs up settings.json, removes this repo's hook entries (and only
  those), adds the marketplace and installs the plugin with the `claude` CLI;
  `--settings` puts the entries back. Doctor flags both-wired.

### 4. Smaller fixes

- Handoff `did`: markdown noise (`#` heading marks, `**`, table pipes) is
  stripped before clipping, so the 400 characters carry words.
- Doctor and status report dangling links; the startup line does not (it is
  silent unless something is failing).

### 4b. Found while building (2026-10-27)

- The shared header names the folder for new lessons whether or not the store
  has any; the shared store's `.health` is said in every project's startup line.
- The in-flight note's "last said" goes through `plain()` too.
- git's `warning:` lines are not a failure's reason: this machine's snapshot
  repo has three `.idx` files whose `.pack` a Windows repack could not replace
  (fsck clean), and git warns of them on every command. `doctor` names them.
- `mutate.mjs` runs its mutants side by side, reads every file once at start,
  copies the plugin files beside each mutant, and first runs each suite
  unmutated under the same load: a suite that cannot pass kills every mutant
  (132 "killed" in 6 s once).
- Proven end to end (`claude -p --plugin-dir <copy> --setting-sources project
  --debug=hooks`): the plugin's SessionStart and Stop hooks run, status 0,
  with `node` from PATH. The exec form (`command` + `args`) runs too. The
  deployed copy, node by absolute path, runs the same way (startup 243 ms,
  Stop 143 ms).
- From the final whole-branch review: `restore` that would change nothing
  says so (it said "restored" over a bad version already snapshotted), and
  what `--force` replaces is kept as a git blob, its `cat-file` command
  printed; a promoted memory is not restored into its old project without
  `--force`, and its history there says where it went; an index line behind
  a BOM is a pointer to promote and restore too. A `/clear` names neither the
  conversation it cleared nor its ask. A shared lesson with no pointer is
  recovered hot (filed cold, no session ever printed it). `wire.mjs
  --settings` takes the live copy's `hooks.json`, which the check passed.
  The skill pre-approves no command (`allowed-tools: Bash(node:*)` let every
  node command run unprompted, `wire.mjs` and `deploy.mjs` included), and
  every fix doctor or the startup line names is said to be the user's.
- Search ranking stays as it is. Weighting each word by its rarity (BM25's
  idf, scaled so a one-word search scores as before) lifted the probes that
  went wrong -- the user's design preference 15th to 8th -- but over all 286
  real memories, each searched by the first 4 or 2 words of its description,
  it ranked slightly worse (MRR 0.979 to 0.974, 0.844 to 0.830). Stemming
  and gentler weightings did no better. What the probes lacked was knowing
  more existed: the match count and the `--all` advice now say so.

### 5. Speed (three measured passes)

`bench.mjs` (new, test-only): a throwaway HOME holding a copy of the largest
real transcript and the largest store; runs Stop, SessionStart (startup,
compact) and PreCompact N times; prints p50/p90. Each pass: measure, change
one thing, measure, keep it only if it wins and every suite passes.
Candidates, in expected order of payoff: parallel mutants in `mutate.mjs`;
Node's compile cache; skipping `JSON.parse` on transcript lines that cannot
matter; one transcript read shared by the handoff and the nudge in a Stop;
`git add` limited to the memory pathspec.

## Data on disk (new)

| Path | Owner | Written |
|---|---|---|
| `~/.claude/projects/_shared/memory/` | any session, under its lock | by the model, `promote`, tiering |
| `~/.claude/hooks-live/{.claude-plugin,hooks,skills}/`, `memory.mjs` | deploy.mjs | at deploy |
| `~/.claude/plugins/cache/project-memory-local/project-memory/<version>/` | `claude plugin install/update` | from the live copy, per version |
| `~/.claude/settings.json.bak-<date>` | wire.mjs | before a wiring switch |

## Testing

As before: a failing check first in the `ok()` style, then the code, then a
mutant in `mutate.mjs` the check kills. New `memory.test.mjs` for the CLI;
shared-store checks in memory-tier.test and handoff-log.test; wire.mjs against
a throwaway settings.json; `claude plugin validate` on the repo when the CLI
is on PATH. Gate before merge: every suite, mutate (all killed), soak, break
harness, dry run same as live.

## Results (measured 2026-10-27)

| What | Before | After |
|---|---|---|
| Stop, through Claude Code (median, steady state) | ~245 ms (shell form, settings.json) | ~175 ms (exec form, plugin) |
| SessionStart startup, through Claude Code | ~330 ms | ~300 ms |
| Stop, nothing changed (bench p50, 42 MB transcript) | 170 ms | 156 ms |
| SessionStart compact (bench p50) | 147 ms | 118 ms |
| The deployed copy against the original f13bb3c, one process each, same copy of the largest store, median of 9 (bare `node -e 0`: 119 ms) | Stop 225, compact 202, startup 155 ms | Stop 198, compact 171, startup 149 ms (the startup now also reads the shared store) |
| A snapshotting Stop's git starts | 3 (add, status, commit) | 2: with a change, status's 100–300 ms on the real repo; with none, one git start (the commit scans as status did) |
| Deploy gate | ~20 min | ~9 min (suites 61 → 20 s; mutation check sequential ~15 min → 8 min) |
| Checks / mutants | 204 checks, 132 mutants | 318 checks, 223 mutants, all killed |

The live copy names node by its absolute path in `hooks.json` (deploy stamps
it), as settings.json always did: a Claude Code started without node on its
PATH would otherwise run no hook, the warning included.

## Rollout

1. All green in the worktree; back up `~/.claude/hooks-live` and
   settings.json; fast-forward `master`; `node deploy.mjs` (in the
   background: ~9 minutes). Running sessions run the new code at their next hook.
2. `node wire.mjs --settings`: settings.json's own entries rewritten from
   hooks.json -- exec form, `startup|clear|compact`. The file watcher hands
   them to running sessions at once.
3. The plugin switch (`wire.mjs --plugin`) is proven end to end in throwaway
   HOMEs, but it is left for the owner: Claude Code's file watcher takes the
   settings.json hooks out of every running session at once, and a plugin
   loads only at a session's start or `/reload-plugins` (rollout review). Done
   unattended at night, every open session would run no memory hook until
   someone restarted it. Run it with the sessions at hand: `node wire.mjs
   --plugin`, then `/reload-plugins` in each.
