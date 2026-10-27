# Security

project-memory runs only on your computer. It makes no internet connections,
reads no credentials or settings file, and writes only inside Claude Code's
own folder (`~/.claude/projects`). [PRIVACY.md](PRIVACY.md) says what it
reads and saves.

## Reporting a problem

If you find a security or privacy problem, such as a secret saved in the
handoff, a write outside `~/.claude/projects`, or a way to make a hook run
something it shouldn't, please report it privately, not in a public issue:

1. Open <https://github.com/zdraveski/project-memory/security/advisories/new>
   (on the repository page: **Security**, then **Report a vulnerability**).
2. Say what you did, what happened, and the version (`claude plugin list`
   shows it).

You'll get an answer within a week. A fix goes out as a new release, and the
[changelog](CHANGELOG.md) says what it fixed.

## Supported versions

Only the latest release gets fixes. To update, see
[Updating](README.md#updating).
