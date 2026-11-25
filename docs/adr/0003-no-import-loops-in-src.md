# 0003: No import loops in `src/`; the briefing sits on top

Status: accepted, 2026-11-25 (maintainer, in round 2 of the architecture
review). Takes effect with 1.6.0 step 18.

## Context

By 1.5.8, `handoff-log.mjs` both wrote the handoff and built the briefing.
`journal.mjs` and `compact-gate.mjs` import from it, and the briefing needs
both, so it loaded them with `import(` at run time to dodge the loop. That
loop once caused an "unsettled top-level await" failure. The handoff also
searched the journal's day files for the journal's own marker.

## Decision

1. `src/briefing.mjs` builds the briefing. It imports the handoff, the journal
   and compact-gate. None of them imports it.
2. `src/` has no import loop, counting run-time `import(` as an import.
   `tools/check.mjs` enforces it. A run-time import stays allowed as a guard
   that keeps a broken file from stopping a hook (ten of them at 1.5.8), never
   as a way around a loop.
3. Only `journal.mjs` reads or writes the journal's marker. Other modules ask it.

## Consequences

- A new need that would make a module import upwards is solved by moving code
  down or passing a function in, the way the Stop hook passes the journal's
  functions to `handoff()`.
- Do not use a run-time import between `src/` files to get around a loop.
  Do not search journal files for the marker outside `journal.mjs`.
