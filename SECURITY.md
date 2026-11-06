# Security

project-memory runs only on your computer. It makes no internet connections,
never opens a credentials or settings file, and writes only inside Claude
Code's own folder (`~/.claude/projects`). It does read your conversations,
which can hold secrets you pasted: [PRIVACY.md](PRIVACY.md) says what it
reads and saves, and what it removes first. What could go wrong, and what
guards against it, is in the
[security assessment](docs/security-assessment.md).

## Reporting a problem

If you find a security or privacy problem, such as a secret saved in the
handoff, a write outside `~/.claude/projects`, or a way to make a hook run
something it shouldn't, please report it privately, not in a public issue:

1. Open <https://github.com/zdraveski/project-memory/security/advisories/new>
   (on the repository page: **Security**, then **Report a vulnerability**).
2. Say what you did, what happened, and the version (`claude plugin list`
   shows it).

The security contact is the maintainer, zdraveski on GitHub
([GOVERNANCE.md](GOVERNANCE.md)), who reads every private report.

## How a report is handled

- **Within a week**, you get an answer: whether the problem is confirmed, or
  what more is needed to tell.
- **Within 30 days** of confirming it, a fix is released. A problem that
  saves or shows a secret or private text is fixed first, as soon as its
  test passes. If a fix needs longer, you are told why and when to expect it.
- **Once the fix is out**, the problem is published as a GitHub security
  advisory at <https://github.com/zdraveski/project-memory/security/advisories>,
  with a CVE when one is assigned. It says which versions are affected, how
  to tell whether you are, and what to do. The [changelog](CHANGELOG.md)
  lists the fix under its version. You are credited, unless you would rather
  not be.
- Please keep the problem private until the advisory is published, or for
  90 days after your report, whichever comes first.

## Supported versions

Only the latest release gets fixes, security fixes included. A version
stops getting them the day the next one is released, so update to it: see
[Updating](README.md#updating). There are no older branches kept up to date.

## Verifying a release

From 1.2.4 on, a workflow ([`release.yml`](.github/workflows/release.yml))
attaches three files to every GitHub release, each named with the release's
tag:

- `project-memory-<tag>.tar.gz` and `project-memory-<tag>.zip`: the source
  at that tag, made with `git archive`;
- `SHA256SUMS`: the SHA-256 hash of both.

It also signs a [build-provenance attestation](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
of all three through Sigstore, which records that the workflow made them
from the tag's commit. Releases before 1.2.4 have no attestation and no
`SHA256SUMS`.

To check a release, download its files into one folder and run:

```
sha256sum -c SHA256SUMS
gh attestation verify project-memory-<tag>.tar.gz --repo zdraveski/project-memory --signer-workflow zdraveski/project-memory/.github/workflows/release.yml --source-ref refs/tags/<tag>
```

On macOS, the first line is `shasum -a 256 -c SHA256SUMS`. It should print
`OK` after each file name. The second needs the
[GitHub CLI](https://cli.github.com), signed in (`gh auth login`); run it
for the `.zip` and for `SHA256SUMS` too. It should print
`Verification succeeded!`. The expected signer is this repository's release
workflow, running for the tag:

- certificate identity:
  `https://github.com/zdraveski/project-memory/.github/workflows/release.yml@refs/tags/<tag>`
- certificate issuer: `https://token.actions.githubusercontent.com`

Any other identity, or a failed check, means the file did not come from
this project's release workflow: don't use it, and please report it as
above.

Installing with `/plugin` doesn't use these files: Claude Code fetches the
repository from GitHub with git over HTTPS.

## Checks on every change

Every change reaches `master` through a pull request, and the checks below
must pass before it can merge ([GOVERNANCE.md](GOVERNANCE.md#changes-reach-master-only-through-a-pull-request)).

### Code scanning

- CodeQL ([`codeql.yml`](.github/workflows/codeql.yml)) scans the
  JavaScript and the workflow files on every pull request, every push to
  `master`, and weekly. Its findings are under **Security > Code scanning**.
- A pull request with a new alert of high or critical security severity,
  or a new error, can't merge: `master`'s ruleset requires CodeQL's results.
- Before a release, every open high or critical alert is fixed, or
  dismissed in GitHub with a written reason why it can't be exploited here.
  Lower alerts are reviewed at each release, and fixed or dismissed the same
  way.

### Dependencies

- The plugin has no dependencies. It uses only Node.js's built-in modules,
  there is no `package.json`, and nothing is downloaded when it is
  installed or runs. No third-party code ships in a release.
- The only third-party code is the CI's: GitHub Actions from GitHub
  (`actions/*`, `github/*`) and OpenSSF (`ossf/scorecard-action`), each
  pinned to a full commit SHA with its version in a comment, and actionlint
  and zizmor, each downloaded at a pinned version and checked against its
  published SHA-256.
  Dependabot ([`dependabot.yml`](.github/dependabot.yml)) proposes new pins
  once a month, as pull requests that pass the same checks as any other,
  except the sign-off check, which Dependabot can't meet; the maintainer
  reviews those pull requests instead.
- A new dependency, for the plugin or the CI, must be needed, maintained,
  and under an OSI-approved license that allows MIT-licensed use. The
  maintainer decides, in its pull request. One whose license doesn't meet
  this is removed before the change merges.
- Every pull request runs dependency review
  ([`dependency-review.yml`](.github/workflows/dependency-review.yml)): a
  dependency it adds or changes with a known vulnerability or malware in
  GitHub's advisory database, of any severity, fails the check, and the
  pull request can't merge. An advisory that can't affect this project is
  let through only by its ID in the workflow's `allow-ghsas`, with a comment
  saying why.
- A Dependabot alert on `master` of high or critical severity is fixed
  within 7 days, and any other before the next release, unless it is
  dismissed with a written reason why it can't affect this project. No
  release goes out with an open alert.
- No third-party component ships, so there is no vulnerability in one to
  explain, and no VEX document is needed. If one ever ships, a
  vulnerability in it that doesn't affect project-memory will be published
  as a VEX statement with the release.

## Secrets

- The project keeps no secrets: no API keys, passwords, signing keys or
  tokens, in the repository or in GitHub's Actions secrets. The tests use
  made-up secret shapes only.
- The workflows use only GitHub's built-in `GITHUB_TOKEN`. GitHub makes it
  for each job and it expires when the job ends, so there is nothing to
  store or rotate. Each workflow gives it read access only, and a job gets
  more only for what it does (CodeQL's findings, Scorecard's, a release's
  files). Pull requests get no secrets and a read-only token.
- Releases are signed with a short-lived Sigstore certificate issued for
  that run: there is no long-lived signing key to guard.
- Secret scanning and push protection are on: GitHub refuses a push that
  holds a known kind of secret, and reports one it finds.
- The maintainer's GitHub account uses two-factor sign-in.
- If the project ever needs a secret, it is stored only in GitHub's Actions
  secrets, never in a file; it is given to the one job that needs it, never
  to a pull request's run; only the maintainer can read or change it; and it
  is rotated every year, and at once when anyone who could read it leaves.
- If a secret leaks (pushed, printed in a log, or found by someone): revoke
  it where it was issued first, then remove it from where it leaked, check
  whether it was used, and publish an advisory if anyone using the plugin
  was affected.
