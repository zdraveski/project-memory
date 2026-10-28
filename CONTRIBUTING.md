# Contributing

project-memory is plain Node.js with no dependencies. Start with
[How it works](docs/how-it-works.md), then the design documents in
[`docs/specs/`](docs/specs/).

## Tests

Each suite builds a throwaway home folder and never touches your `~/.claude`:

```
node store.test.mjs
node compact-gate.test.mjs
node handoff-log.test.mjs
node memory-tier.test.mjs
node memory.test.mjs
```

CI runs all five on Linux, macOS and Windows, with Node 20 and 24.

Beyond the suites:

- `node mutate.mjs [text]` breaks one rule at a time and expects a suite to
  fail: all mutants, or those whose label contains the text. Every mutant
  must be killed. A change to a line a mutant targets needs the mutant
  updated too. The full run takes several minutes.
- `node memory-tier.soak.mjs [store]` copies a store (by default the largest
  on the machine) to a temp folder, then simulates a month of new notes and
  sessions ending at the same moment.
- `node memory-tier.break.mjs [store]` breaks a copy of a store in 14 ways
  and checks that no line is lost.
- `node bench.mjs [runs]` times each hook on copies of the machine's largest
  transcript and store.

## Changing the code

- A hook must exit 0 whatever happens, and finish fast: it runs after every
  reply. The one deliberate exception is the compaction gate's exit 2, its
  request to wait.
- Write through `replaceIfUnchanged` under `withLock` (`store.mjs`), never
  straight to a file another process may be editing.
- Keep the numbers at the top of each file; the comments say why each is
  what it is.
- Add a test with the change, and a mutant for any new rule.
- Don't run the `claude` command, read a credential or Claude Code's
  `settings.json`, copy the whole environment, or connect to anything. The
  plugin directory's security scan holds a plugin that does, and it reads
  every file, tests included.

## Releasing

1. Bump `version` in `.claude-plugin/plugin.json` and add the entry to
   `CHANGELOG.md`.
2. Run `claude plugin validate . --strict`. It should find nothing to report.
3. Push to `master` and wait for CI to pass on every job.
4. Tag the commit `vX.Y.Z`, push the tag, and publish a GitHub release.

## The author's setup

The author keeps this repository at `~/.claude/hooks` and runs the hooks from
a checked copy. `node deploy.mjs` runs only on `master` with nothing
uncommitted. It runs the five suites, the mutation check, the soak and the
break harness, then compares a dry run of the tidy-up with the live copy's,
and copies the plugin to `~/.claude/hooks-live`, which also serves as a local
marketplace the plugin is installed from. It doesn't run the validator or the
benchmark. None of this is needed to use or to change the plugin.
