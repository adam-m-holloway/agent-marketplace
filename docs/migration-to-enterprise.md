# Migrating to GitHub Enterprise Cloud

The POC runs on public github.com repos at $0. The design moves to an organisation on GitHub
Enterprise Cloud by changing the owner and auth, not by redesigning.

## What changes

| Area | POC | Enterprise |
|---|---|---|
| Owner | `adam-m-holloway` | the organisation |
| Marketplace names | `agent-marketplace`, `agent-marketplace-stable` | something distinctive (e.g. `<org>-plugins`, `<org>-plugins-stable`) — names are global on a machine |
| Visibility | public | internal or private |
| Developer auth | none (public clone) | `gh auth login` / git credential helper with SSO; Claude Code clones private marketplaces with the user's git credentials |
| Actions minutes | free (public) | billed — the gate is a few minutes per PR |
| Pages | public | private Pages (access-controlled) |
| Security tooling | gitleaks, SkillSpector, zizmor, actionlint (free CLIs) | the same, GHAS-free; optionally add GHAS secret scanning + push protection |

## Governance upgrades

- **Required-workflows rulesets** (org-level) so `pr-gate.yml` is enforced centrally rather
  than per repo.
- **CODEOWNERS** on `.github/`, `scripts/`, `rules/`, `taxonomy.json` and
  `plugins/*/status.json`, with "require code-owner review" in the ruleset (the post-POC staged
  approval design).
- **Managed settings** for developer machines:
  - `strictKnownMarketplaces` to allow only the org's marketplaces;
  - `extraKnownMarketplaces` with `autoUpdate` so every machine knows the channels.
- **claude.ai org sync** for org-wide plugin availability where applicable.

## Insights at org scale

- Replace `insights/consumers.json` with **org code search** for `.claude/settings.json` files
  that reference the marketplace.
- Use a **GitHub App** (installation token, read-only Contents + Metadata) instead of
  `GITHUB_TOKEN`, which can't read other private repos.
- Optionally ship the Athena-ready `data` branch layout to S3 + Athena.

## Deferred items to pick up

- OpenSSF Scorecard.
- A Renovate manager for consumers' marketplace refs.
- release-please for changelogs/versions.
- Reusing Anthropic's `validate-plugins` / `scan-plugins` actions if they fit.
- The post-POC sections of the plan: staged approval (Q28) and discovery & reporting (Q29).
