# Changelog

## 1.0.4 (2026-10-27)

- Nothing in the plugin runs the `claude` command any more. The author's
  `wire.mjs` prints the install or uninstall command to run instead of running
  it, and `deploy.mjs` no longer validates or updates the plugin with it.
- The snapshot no longer hands git a copy of your environment.
- A privacy policy, and the directory's listing fields: icon, documentation,
  support and privacy policy links.

## 1.0.3 (2026-10-27)

- A short demo at the top of the README, replaying three real conversations
- The README explains what you get, who it's for, and a week with the plugin
- A display name, "Project Memory", and a plain-language description for the
  plugin directory

## 1.0.2 (2026-10-27)

- `doctor` no longer reports a problem right after you install. Until Claude
  finishes its first reply, it says it's waiting. It reports a problem only
  when a reply finished over a minute ago and nothing was saved.
- The README is a plain-language guide. The technical details are in
  `docs/how-it-works.md`, and tests and releasing in `CONTRIBUTING.md`.

## 1.0.1 (2026-10-27)

- A plugin icon, also shown in the README

## 1.0.0 (2026-10-27)

First public release.

- `MEMORY.md` tiered under a 7,000-byte budget, with an archive that stays searchable
- A rolling handoff of each session's last ten exchanges, and a startup briefing
- Mid-turn compactions deferred to the turn boundary, a memory nudge before
  one, and what a cut turn had in flight given back after
- Git snapshots of every memory change, with `history` and `restore`
- A shared store for lessons that hold in every project, and `promote`
- Ranked `search`, `status` and `doctor`, through the `memory` skill
- Safe with parallel sessions: a lock per store and compare-and-swap writes
