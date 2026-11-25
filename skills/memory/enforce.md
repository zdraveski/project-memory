# Git rules: enforce

Read this when the user wants a lesson about a git command checked by the
computer, or asks what their git rules caught.

| Command | Use it when |
|---|---|
| `enforce status` | the user asks what their git rules caught: each note with an `enforce:` rule, its hits in the last 30 days (main and sub-agent) and the last one, bad rules with the reason, and whether the log is full or memory is off. It holds no command text: for that, `enforce replay` |
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

`on` is `git <subcommand>`; `has` is one word or up to 8; `unless` is optional. Then run `enforce replay <note>` and show the hits before the user relies on it. The hook only logs which note matched: it blocks nothing. Say plainly that few lessons fit this form.
