# AGENTS.md

Instructions for AI coding agents (Claude Code, and any tool that reads `AGENTS.md`) working
in this repo. `CLAUDE.md` points here; this file is the source.

## What this repo is

A Claude Code **plugin marketplace monorepo**. Plugins live in `plugins/<name>/`. Two
catalogues are **generated** from them:

| Channel | Marketplace name | File | Tracks |
|---|---|---|---|
| latest | `agent-marketplace` | `.claude-plugin/marketplace.json` | `main` |
| stable | `agent-marketplace-stable` | `.claude-plugin/marketplace-stable.json` | `stable` (promotions only) |

Never edit the catalogue files by hand — run `npm run sync`.

## Rules

- **Feature branch + PR for every change.** Never commit to `main` or `stable`.
- **Conventional Commits** for commits and PR titles (`feat(adr-helper): …`). Squash-merge only.
- **One plugin per PR** (label `multi-plugin` to override, with a reason).
- Changing a plugin's files **requires a version bump** (`npm run bump <name> <level>`) and a
  `CHANGELOG.md` entry for the new version.
- Zero npm dependencies. Node ≥24. Tests use `node --test`.
- Run `npm run check` before pushing; `npm run check -- --full` for everything CI runs.
- Skills: `SKILL.md` ≤500 lines; frontmatter `name` = folder; description says
  **what / when / triggers / not-for**; ≥3 evals in `evals/evals.json` and a trigger set in
  `evals/trigger-evals.json`.
- Never add hidden Unicode, HTML comments, encoded blobs or pipe-to-shell commands to plugin
  files — the `security` job blocks them. See `docs/security-scanning.md`.

## Authoring a plugin

`npm run new-plugin <name>` → `/skill-creator` → `npm run check`. Full steps in
`CONTRIBUTING.md`.

## Layout

`scripts/` (Node CLIs, `scripts/lib/` shared), `schema/` (JSON Schemas), `rules/patterns.json`
(security patterns), `tests/` (+ `fixtures/`), `site/` (Pages catalogue), `insights/`,
`docs/`, `.github/workflows/` (`pr-gate.yml` is the only required workflow).
