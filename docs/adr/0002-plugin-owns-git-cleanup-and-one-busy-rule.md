# 0002: The plugin runs git's clean-up itself, and one busy rule covers every git write

Status: accepted, 2026-11-24 (maintainer, in the architecture review of 1.5.7).
Takes effect with 1.6.0 step 16, PR C.

## Context

The snapshots live in one git repository at the projects root. Several things
write to it:
- the Stop hook's background snapshot;
- the `forget --purge` and `rescan --apply` history rewrites;
- `restore`;
- git's own automatic clean-up (`gc --auto`). Git may start it detached after
  any commit.

By 1.5.7, each plugin writer had its own check for whether the repo was busy:
- the snapshot checked five lock files;
- purge checked two, then held `config.lock`;
- rescan checked three;
- restore checked none.

Git's clean-up took none of those locks. A purge then ran into a clean-up that
was still going, and CI failed with "unable to mark recent objects". PR #230
covered this with a retry.

## Decision

1. Every git call the plugin makes sets `gc.auto=0`. The snapshot runs
   `gc --auto --no-detach` itself after it commits, so the clean-up happens
   inside a writer the plugin knows about, and git's `gc.pid` is there while it
   runs.
2. One rule in `src/snapshot.mjs` answers "is the repo busy". It covers the
   index, HEAD, config and packed-refs locks, `refs/heads/*.lock` and `gc.pid`.
   It runs before every git write: snapshot, purge, rescan and restore.
3. Every git call goes through `snapshot.mjs`'s seam. No other module runs git
   against the projects root.

## Consequences

- A purge waits for a clean-up instead of crashing into it, and the retry from
  #230 can go once tests show nothing else needs it.
- Restore can now say "try again in a moment" while a snapshot runs.
- Do not turn git's automatic clean-up back on. Do not add a git write that
  skips the busy rule. Do not run git against the projects root from outside
  `snapshot.mjs`.
