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
  inventing them;
- add the new ADR to the index (see below).

It works with any language or toolchain. The template is in
`skills/create-adr/references/madr-template.md`.

### supersede-adr

When a recorded decision is replaced ("supersede ADR 0002, we're moving to CockroachDB"),
Claude will:

- check that the ADR exists, and stop without changing anything if it does not;
- ask for what changed, the options and the new decision when they are missing;
- write the new decision as the next numbered MADR file, with
  `Supersedes [ADR-0002](0002-use-postgresql.md)` in its Status section;
- set the old ADR's status to `Superseded by [ADR-0003](0003-....md)` and leave the rest of
  it as history;
- update the index. Only those three files change.

### The ADR index

Both skills keep `docs/adr/README.md` up to date: a `| # | Title | Status | Date |` table
with one row per ADR, sorted by number. It is created (listing every existing ADR) the
first time either skill runs. The format is in `skills/create-adr/references/adr-index.md`.

Not covered: editing the wording of an existing ADR, or deprecating one without a
replacement.

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
