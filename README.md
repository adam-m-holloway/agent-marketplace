# agent-marketplace

A [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces) for
our teams: publish a plugin once, version it, let each team choose a release channel, and see
who uses what.

- **Catalogue site:** <https://adam-m-holloway.github.io/agent-marketplace/> — fuzzy search over
  a minimal grid of plugin cards (name, short description, latest version, stage, one score
  line). Each whole card opens a detail page (`#/plugin/<name>`) that puts the key facts, an
  Install button (latest/stable commands for you or your team's repo) and a score summary first,
  then collapsible sections, each with a one-line preview: score breakdown and history, used-by
  table, release timeline and full CHANGELOG, trend charts, rendered README, skills, related
  plugins and how scores are calculated. `#plugin=<name>` still filters the grid to one plugin. README/CHANGELOG are rendered at build time by `scripts/build-site.mjs` (a small
  Markdown subset; raw HTML is escaped); adoption comes from the `data` branch's daily
  `consumers/` snapshots.
- **Usage report:** [`CATALOGUE.md` on the `data` branch](https://github.com/adam-m-holloway/agent-marketplace/blob/data/CATALOGUE.md)
  (written nightly by `insights.yml`).
- **OpenSSF Scorecard:** [scorecard.dev viewer](https://scorecard.dev/viewer/?uri=github.com/adam-m-holloway/agent-marketplace)
  (weekly supply-chain score from `scorecard.yml`).
- **Usage issues:** the same nightly run keeps a pinned **"Plugin usage report"** issue
  (commented only on days something changed) and opens one **"Behind: …"** issue per plugin a
  consumer is behind on, closing it when they catch up. Both carry the `insights` label;
  behind issues also carry `behind`. The site warns when usage data is over 36 hours old.

## Channels

| Channel | Marketplace name | Ref | Who it's for |
|---|---|---|---|
| **latest** | `agent-marketplace` | `main` | teams that want new versions as soon as they merge |
| **stable** | `agent-marketplace-stable` | `stable` | teams that want reviewed promotions only |

A channel serves **every** plugin from one commit, so a team picks a channel, not a version
per plugin. See [`docs/consuming-plugins.md`](docs/consuming-plugins.md).

### Use a plugin in your team's repo (committed, counted by insights)

Latest:

```json
{
  "extraKnownMarketplaces": {
    "agent-marketplace": {
      "source": { "source": "github", "repo": "adam-m-holloway/agent-marketplace" }
    }
  },
  "enabledPlugins": { "adr-helper@agent-marketplace": true }
}
```

Stable:

```json
{
  "extraKnownMarketplaces": {
    "agent-marketplace-stable": {
      "source": {
        "source": "github",
        "repo": "adam-m-holloway/agent-marketplace",
        "ref": "stable",
        "path": ".claude-plugin/marketplace-stable.json"
      }
    }
  },
  "enabledPlugins": { "adr-helper@agent-marketplace-stable": true }
}
```

Commit it as `.claude/settings.json`. Teammates are prompted to install after they trust the
folder. If a plugin doesn't load, run the one-off `--scope project` install in
[`docs/consuming-plugins.md`](docs/consuming-plugins.md#2-commit-it-to-your-repo-recommended).

### Just me

```sh
claude plugin install adr-helper --marketplace adam-m-holloway/agent-marketplace
```

(Latest channel, user scope, not counted by insights.)

## Plugins

| Plugin | What | Languages |
|---|---|---|
| [`adr-helper`](plugins/adr-helper) | Architecture Decision Records (MADR) | any |
| [`go-conventions`](plugins/go-conventions) | Go conventions + toolchain checks | Go |
| [`typescript-conventions`](plugins/typescript-conventions) | Strict TypeScript + Vitest conventions | TypeScript |

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). Short version:

```sh
npm run new-plugin my-plugin   # scaffold
/skill-creator                  # in Claude Code: draft SKILL.md, evals and the trigger set
npm run check                   # same plugin verdict as CI
```

## How it's protected

One required workflow, [`pr-gate.yml`](.github/workflows/pr-gate.yml), runs on every PR to
`main` and `stable` from the **base** branch's definitions, so a PR cannot weaken the checks
that judge it. It validates plugins, scans for hidden content, dangerous patterns, prompt
injection and secrets, and lints workflows. See
[`docs/security-scanning.md`](docs/security-scanning.md) and [`SECURITY.md`](SECURITY.md).

## Prerequisites (contributors)

Node ≥24, git ≥2.31, Claude Code ≥2.1.292. Optional for `npm run check -- --full`: gitleaks,
actionlint, zizmor, and `uv` for SkillSpector. macOS or Linux.

> **Note:** GitHub disables scheduled workflows on public repos after 60 days without
> activity. If the nightly insights run stops, re-enable it from the Actions tab.

## License

MIT
