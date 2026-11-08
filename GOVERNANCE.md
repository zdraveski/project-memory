# Governance

project-memory has one maintainer and takes contributions from anyone. This
page says who can change what, how decisions are made, and what happens if
the maintainer is gone.

## Members with access to sensitive resources

| Who | GitHub | Role | Access |
|---|---|---|---|
| KIRE | [zdraveski](https://github.com/zdraveski) | Sole maintainer | Admin: the repository and its settings, rulesets, releases, security advisories, workflows and project page, and the project's OpenSSF Best Practices entry |

Nobody else has write access, or any other access to these.

## Roles and responsibilities

- **The maintainer** reviews and merges pull requests, decides what goes in,
  makes the releases ([CONTRIBUTING.md](CONTRIBUTING.md#releasing)), and
  answers issues, discussions and security reports
  ([SECURITY.md](SECURITY.md)). The maintainer keeps the repository's
  protections on: two-factor sign-in, `master`'s ruleset, secret scanning
  and push protection, and private vulnerability reporting. The maintainer
  also keeps the CI's pinned actions current.
- **Contributors**, anyone, open issues, discussions and pull requests. A
  pull request follows [CONTRIBUTING.md](CONTRIBUTING.md), and each of its
  commits is signed off under the
  [Developer Certificate of Origin](CONTRIBUTING.md#developer-certificate-of-origin).
  Contributors need no access to the repository.
- **Security reporters** report privately, as [SECURITY.md](SECURITY.md)
  says.

Everyone follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## How decisions are made

The maintainer decides. A proposed change is discussed in the open, in its
issue, discussion or pull request, and the reason for a decision is written
there. Anyone may disagree in the same place; the maintainer has the last
word. A security report is discussed in its private advisory until the fix
is published.

## Changes reach master only through a pull request

`master` is protected by a GitHub ruleset that applies to everyone, the
maintainer included, with no one allowed to bypass it:

- nobody can push to `master`: every change is a pull request;
- a pull request merges only when its required checks pass: the test suites
  on Linux, macOS and Windows, actionlint, the sign-off check (skipped for
  Dependabot's pin updates, which the maintainer reviews), dependency
  review, the changed files' mutants, zizmor, and CodeQL's code scanning
  results;
- `master` can't be deleted or force-pushed.

With one maintainer, there is no second person to approve a pull request,
so the ruleset doesn't require an approval. Each change is still reviewed
from its diff alone before it merges, as
[CONTRIBUTING.md](CONTRIBUTING.md#sending-a-change) says.

## Granting access

Nobody gets more than a contributor's access (write access, a maintainer
role, admin, or a secret) before the maintainer has reviewed them:

- they have a record of good contributions here, over months, not weeks;
- their identity can be traced: a GitHub account with a history, and
  two-factor sign-in on;
- they get the least access that does the job: triage before write, write
  before admin;
- the maintainer adds them to the table above, with their role, in the pull
  request that records the decision, before granting the access.

## Removing access

Access is removed when a member asks, has been inactive for a year, breaks
the Code of Conduct, or may have lost control of their account. The
maintainer removes them from the repository's collaborators, revokes and
replaces any secret they could read, and takes them out of the table above.
A possibly compromised account is removed at once, and handled as a
security problem.

## If the maintainer is unavailable

- Everything is public and MIT-licensed: the code, its history, the issues
  and the releases. Anyone can fork it and carry it on.
- Nothing depends on a secret only the maintainer holds: there are no
  signing keys (releases are signed by the release workflow with a
  short-lived certificate), and the project uses no service but GitHub.
- The maintainer names a successor in GitHub's account settings
  (**Settings > Account > Successor settings**). If the maintainer dies or
  can't act, GitHub lets the successor archive the repository or hand it
  on.
- If the maintainer stops answering for 90 days, treat the project as
  unmaintained: use a fork, and report security problems to the fork's
  maintainers.
