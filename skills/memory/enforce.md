# Git rules: enforce

Read this when the user wants a lesson about a git command checked by the
computer, or asks what their git rules caught.

| Command | Use it when |
|---|---|
| `enforce status` | the user asks what their git rules caught: each note with an `enforce:` rule, its hits in the last 30 days (main and sub-agent) and the last one, bad rules with the reason, and whether the log is full or memory is off. It holds no command text: for that, `enforce replay` |
| `enforce block <note> [--yes]` / `enforce unblock <note>` | the user wants a rule to stop its command, not only log it. Needs an `instead:` line in the note (what to do, 10 to 200 characters). Without `--yes` it shows the rule's replay and changes nothing: show the hits, ask, and run it with `--yes` only on the user's yes. `unblock` takes it back |
| `enforce replay <note> [--all]` | the user wants to try a rule: a note's name, or the path of any `.md` file with an `enforce:` block, read against the git commands of the last 30 days of this project's conversations (`--all`: every project; about a minute on a big history). Read-only. Show the hits and let the user judge: a hit is a catch only if they agree the command broke the lesson |

Writing a rule: add this at the top level of the note's front matter (not under
`metadata:`), with the lines under `enforce:` indented two spaces (git only; one
rule per note; words are exact, no patterns):

```
enforce:
  on: git add
  has: [-A, --all, .]
  unless: [mktemp, init]
```

`on` is `git <subcommand>`; `has` is one word or up to 8; `unless` is optional. Then run `enforce replay <note>` and show the hits before the user relies on it. By default the hook only logs which note matched; with an `instead:` line it also says that line, and only a rule the user allowed with `enforce block` denies its command (the line is shown as the reason). It does not block when the user's latest request names the command, in a private turn, after 3 blocked calls in a turn, when the rule's text changed since it was allowed, or with `PROJECT_MEMORY_ENFORCE=watch`; a denied command that the user did ask for is theirs to run or to unblock. Say plainly that few lessons fit this form.
