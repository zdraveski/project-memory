# Search, show, history, page: every detail

Read this when a search finds nothing you expected, when you need an option the
core does not name, or before you rely on a hit's date.

| Command | Use it when |
|---|---|
| `search [terms...] [--file <path>] [--asked] [--conversation <id>]` | before saying something was never learned or done: ranked hits from this project and the shared store, hot and archived, and journal entries (one per exchange), each with its date. Two-letter words (CI, PR) count as whole words, but a Chinese or Japanese word, even one character, matches inside text, and an English word right next to Chinese or Japanese text counts as whole; a line `no note or entry holds: <words>` names search words that nothing holds (drop them or try synonyms); an entry's branch is searched too. `--since`/`--until YYYY-MM-DD` limit it to those days, inclusive; with no terms, or only words like "what did I do", it lists the days' entries (not subagent reports). Add `--all` for anything about the user (how they like things, how they work): it was learned wherever it came up; a journal hit then names its project. A journal hit is a headline: its key, the request cut at 200 characters, `Result:` (the reply's first sentence, usually its outcome), and only short stretches of the reply, files and commands that hold a search word (from the 6th hit on only the request, `Result:` and key; run `show <key>` for the rest, before you quote or rely on a detail; for a request of 25 characters or less, `show` and the day list add `Reply to key <key>: …`, the end of the reply before it); a long request asked many times prints once, with how many more, their first and last day and their keys (`--same` with `show` or `forget --key` takes them all). The last line is `Not the entry you meant? Search again with other words.`, and the line before it says how many matched; `--limit N` shows more. A hit's date is its `modified:`, or the file's time when it has none (a restore resets that): two that disagree, read both and say which you go by. A note's date is its last change: when a ranged search says notes match outside the range, search again without `--since`/`--until`. Read the top notes. `--file` keeps the entries that changed a file (a name or a path as the session saw it), `--asked` scores only what the user asked (no helper reports, no private turns), `--conversation` keeps one conversation (the start of its id); any of them leaves notes out, and with no words they list the entries newest first. |
| `show <key...>` or `show <note>` | you need an entry's full text: every field, its day file and its conversation file (none for a private entry: don't look for it), by the key a search hit printed, in single quotes (a key can hold spaces). Run it instead of opening a day file. Several keys at once; `--same` adds every entry that asked the same; `--all` for another project's. A note's name in place of a key (no entry has it as its key) prints the note, the first exchange that changed it and the last one |
| `status` | sizes against budget, hot/archived counts, problems, `[[links]]` to no memory, the journal (its days since the first, its size, conversations still to import, a write that failed), and which memories the snapshots saw added, edited or deleted in the last 7 days |
| `history <memory>` | to see when a memory changed or was deleted; get its name from `search` first. "in the first snapshot" means it already existed then. Each snapshot also names the exchange behind it: when it was asked, the user's words (cut at 100 characters) and the entry's key for `show`; "no exchange found" means a change by hand, by a shell command, by a helper or by the plugin's own sorting, or that the match was a guess: "several exchanges" means more than one conversation changed it since the snapshot before; a shared note says it was not looked up. A name is printed only when it is sure. It lists the newest 30 (`--limit N` for more); its last line is the command that shows one change |
| `page [--days N] [--project NAME]` | the user wants to read their journal as a page, browse it by week, or look at it outside the terminal. It writes one HTML file on this machine (every project; helper entries and switched-off projects left out; private turns without text) and prints its `file://` link: give the link and tell the user to open it in a browser. The last 30 days unless `--days N` (or `--days all`). The page loads nothing from the network. `forget`, `incognito`, `off` and `rescan --apply` delete it; run `page` again to refresh it |

When nothing is found: other words (synonyms, a file's or a tool's name), no
`--since`/`--until`, then `--all`. For "what did I do last week", `--since`/`--until`
alone lists the days. A note's "decided" is a session's summary: the user's own words
are found with `search --asked <words>`, and `history <note>` shows the exchange
behind a note's change.

A flag (`-A`), a path (`src/hooks/pre.js`), a dotted name (`a.b`), an error code (`ENOENT`, `TS2345`) or a
whole query in quotes (`"exit code 137"`) is also matched as typed, in any case: those hits come first and carry an
`exact:` line naming what matched. Add `--words` for the plain word ranking alone. A word that starts with `--`
is an option: put it after `--` (`search -- --force-with-lease`).

## Options

A memory is named by its file name, with or without `.md`. `--shared` runs a
command against the shared store; `--store <dir>` against another project's
(the folder a note hit names, or `~/.claude/projects/<project>/memory` for the
project a journal hit names, `<project>` being the folder in its brackets,
e.g. to promote a lesson learned elsewhere);
`status` and `history` take `--all` too. An option the CLI does not know is
refused. Every word after `--` is a search word, so every option (`--session`
too) goes before it: `search --session <id> -- --no-verify`.
