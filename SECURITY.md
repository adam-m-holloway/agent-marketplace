# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub Security Advisories:
**[Report a vulnerability](https://github.com/adam-m-holloway/agent-marketplace/security/advisories/new)**
(Security → Report a vulnerability on this repository; private vulnerability reporting).
Include the plugin name and version, what you found, and steps to reproduce.

Published advisories: <https://github.com/adam-m-holloway/agent-marketplace/security/advisories>.
How each pull request is scanned, and what the scanners can't catch:
[docs/security-scanning.md](docs/security-scanning.md).

## What happens next (disclosure targets)

| Step | Target |
|---|---|
| Acknowledge your report | within **3 business days** |
| Triage (confirm, rate severity, tell you the plan) | within **7 days** |
| Fix or mitigation released, **HIGH** or above | within **30 days** of triage |
| Fix or mitigation, lower severity | best effort, normally the next release |

A mitigation can be deprecating or retiring the plugin, or reverting `stable` to an earlier
`main` commit, while the fix is made. We coordinate a disclosure date with you and credit you
in the advisory unless you ask us not to. These are targets for a small team, not a contract.

## Supported versions

Plugins are versioned individually, but each channel serves one commit:

| Channel | Supported |
|---|---|
| **latest** (`agent-marketplace`, `main`) — the newest version of each plugin | yes |
| **stable** (`agent-marketplace-stable`, `stable`) — the version currently promoted | yes |
| older plugin versions, and pinned `ref`/`sha` of past commits | no — update to latest or stable |

Fixes land on `main` first and reach `stable` by a normal promotion (or an expedited one for
HIGH issues).

## Scope

In scope:

- plugins in `plugins/` — skills, commands, agents, hooks and any bundled scripts;
- the generated catalogues in `.claude-plugin/`;
- the marketplace tooling in `scripts/` and the workflows in `.github/workflows/`
  (for example a way for a pull request to execute code in, or tamper with, `pr-gate`).

Out of scope: vulnerabilities in Claude Code itself (report those to Anthropic) and in
third-party tools we run (gitleaks, SkillSpector, actionlint, zizmor) — report those upstream.

## What every pull request is scanned with

The required `pr-gate` workflow runs from the base branch and treats PR content as data only:

- **Repo rules** (`scripts/check.mjs`): hidden/invisible content, dangerous command and
  prompt-injection patterns (`rules/patterns.json`), manifest and catalogue validation.
- **gitleaks** on the PR's plugin files, for committed secrets.
- **SkillSpector** (`--no-llm`), static risk scoring of each plugin; a risk score above 50
  fails. Baselines (`.skillspector-baseline.yaml`) need a reason, and changes to them are
  flagged on the PR.
- **actionlint**, **zizmor** and a SHA-pinning check on workflow files.
- `claude plugin validate --strict` on the catalogues and each plugin.

### How this is enforced

- `pr-gate`'s four jobs (`plugins`, `security`, `workflows`, `title`) are **required status
  checks** in the `main` and `stable` rulesets, with no bypass actors (not even admins), so a PR
  can't merge while any scanner fails. Changes go through PRs only (no force-push, no deletion).
- The gate runs the **base branch's** scripts and config, so a PR can't weaken the checks that
  judge it; tool versions are pinned, and every action is pinned to a full commit SHA.
- Changes to the scanners, rules and workflows (`.github/`, `rules/`, `scripts/`, `schema/`,
  `taxonomy.json`) and to plugin stages are owned by code owners in `.github/CODEOWNERS`.
  Requiring their approval is prepared but not yet switched on (it needs a second reviewer; see
  `docs/repo-setup.md`).
- **Dependabot** proposes weekly, grouped updates to the pinned actions and the hash-pinned
  Claude Code CLI; **CodeQL** (`codeql.yml`) analyses the tooling and workflows on every PR and
  push to `main`; **[OpenSSF Scorecard](https://scorecard.dev/viewer/?uri=github.com/adam-m-holloway/agent-marketplace)**
  (`scorecard.yml`) scores the repo's supply-chain practices weekly and on every push to `main`.
  The checks it flags that we accept, and why, are listed in
  [docs/security-scanning.md](docs/security-scanning.md#scorecard-known-and-accepted).

## Static scanning is not a guarantee

Passing these checks means no *known* bad pattern was found. It does **not** mean a plugin
is safe. Skills and hooks can instruct Claude to run commands with your permissions. Read
a plugin's skills and hooks before installing it, prefer the `stable` channel for
reviewed promotions, and report anything suspicious using the process above.
