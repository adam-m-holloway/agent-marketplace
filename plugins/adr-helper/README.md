# adr-helper

Write Architecture Decision Records (ADRs) in [MADR](https://adr.github.io/madr/) format,
straight into your repo.

## Skills

### create-adr

Ask Claude to record a decision ("write an ADR for moving to gRPC", "document why we
chose Postgres") and it will:

- write `docs/adr/NNNN-kebab-title.md`, creating `docs/adr/` if it does not exist;
- number it after the highest existing ADR (four digits, zero-padded; the first is `0001`);
- use the MADR sections Status, Context and Problem Statement, Considered Options,
  Decision Outcome and Consequences, plus the date and the deciders;
- read the relevant code so the context names real modules and dependencies;
- ask you for the problem, the options or the decision when they are missing, instead of
  inventing them.

It works with any language or toolchain. The template is in
`skills/create-adr/references/madr-template.md`.

Not covered in 1.0.0: superseding or editing existing ADRs, and an ADR index.

## Install

### For a team repo (latest channel)

Add this to the repo's `.claude/settings.json`:

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

### For a team repo (stable channel)

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

### Just me

```
claude plugin install adr-helper --marketplace adam-m-holloway/agent-marketplace
```

## Changes

See [CHANGELOG.md](CHANGELOG.md).
