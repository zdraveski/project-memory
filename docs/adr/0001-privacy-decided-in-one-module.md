# 0001: Privacy is decided in one module, and unreadable means private

Status: accepted, 2026-11-24 (maintainer, in the architecture review of 1.5.7)

## Context

By 1.5.7 the question "may this turn be saved or shown?" was answered in five
modules: `handoff-log.mjs`, `journal.mjs`, `compact-gate.mjs`, `enforce.mjs` and
`memory.mjs`. Each read the marker files (`.private-sessions`, `.memory-off`,
`.project-off`, `.off-periods`, `journal/.forgotten`) and chose for itself what
an unreadable file meant. `enforce.mjs` held a hand copy of the
`<private-session>` pattern so that the git-rule hook would start fast.

The copies had drifted apart:

- the git-rule hook did not normalize text (fullwidth or zero-width forms of the
  tag slipped through) and read helper records;
- one reader of `.forgotten` (`handoff-log.mjs:847`) took an unreadable list as
  empty, so a forgotten exchange could come back into the handoff, while
  another (`:1183`) showed nothing.

## Decision

1. One module, `src/privacy.mjs`, answers every privacy question and owns the
   marker files' formats, both reading and writing them. The six sources are
   private turn, private conversation (incognito and the `<private-session>`
   tag), conversation switched off, project switched off, off period and
   forgotten exchange. The auto memory setting stays in `store.mjs`: it is
   Claude Code's switch.
2. A marker file that exists but cannot be read means private, for every
   caller. No caller can choose to fail open. A caller may also record the
   failure (the Stop hook does).
3. The module imports only Node built-ins and `store.mjs`, so the git-rule hook
   can use it and still start within its bench budget (`tools/bench.mjs`,
   ratio 7).
4. One deliberate difference stays, written in the module: the compaction note
   hides any text holding `<private` in any spelling (`compact-gate.mjs`), wider
   than the private-turn rule.

## Consequences

- A privacy fix is made once. New hooks (1.6.0 steps 4 to 7) call the module
  instead of adding copies six to eight.
- Do not suggest splitting the rule back into its callers, inlining it into a
  hook for speed, or letting a caller fail open. If a hook is too slow with the
  module, make the module lighter.
- Whether a transcript holds a typed `<private-session>` is read from the
  transcript, so it lives in `transcript.mjs` (`typedMark`, `markFrom`), not
  here: rule 3 keeps this module off the transcript reader. The git-rule hook,
  the compaction gate and the journal all call it; none keeps its own copy.
