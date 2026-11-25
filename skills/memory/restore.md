# Restore, promote, doctor

Read this when a memory looks lost or overwritten, when a lesson holds in every
project, or when the hooks may not be running.

| Command | Use it when |
|---|---|
| `restore <memory>` | a memory was deleted or overwritten: it comes back from the snapshots, with its index line. `--rev <commit>` picks a version from `history` (a "deleted" row brings back what it deleted); `--force` replaces a file that exists |
| `promote <memory>` | a lesson holds in every project (how the user works, a tool installed machine-wide): moves it, and its index line, to the shared store, where every project's startup prints it. Ask the user first. It leaves its project, so its `[[links]]` to that project's memories stop resolving: trim project-only details first. It refuses a note that holds a key, token or password; `--force` moves it anyway, so use it only if the user says so |
| `doctor` | the hooks may not be running: the install, the deployed copy, the Stop hook (and whether it runs twice per reply), the enforce hook (it fails open, so this line is the only sign it broke), locks, git. It reads only two settings from settings.json, `autoMemoryEnabled` and `autoMemoryDirectory`, and never prints what the file holds |

After `restore` or `promote`, say what changed on disk. A lesson learned in
another project is promoted with `--store ~/.claude/projects/<project>/memory`
(options: [search.md](search.md)).

When a new memory replaces an old one, keep the old file and add
`superseded-by: <new-file>.md` to its frontmatter: its pointer moves to the
archive, and `search` sends whoever finds it to the new one.
