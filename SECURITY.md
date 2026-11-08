# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub Security Advisories:
**Security → Report a vulnerability** on this repository (private vulnerability reporting).
Include the plugin name and version, what you found, and steps to reproduce.

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

## Static scanning is not a guarantee

Passing these checks means no *known* bad pattern was found. It does **not** mean a plugin
is safe. Skills and hooks can instruct Claude to run commands with your permissions. Read
a plugin's skills and hooks before installing it, prefer the `stable` channel for
reviewed promotions, and report anything suspicious using the process above.
