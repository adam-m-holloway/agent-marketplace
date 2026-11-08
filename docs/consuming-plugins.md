# Consuming plugins

## 1. Choose a channel

| | latest (`agent-marketplace`) | stable (`agent-marketplace-stable`) |
|---|---|---|
| Ref | `main` | `stable` |
| Catalogue file | `.claude-plugin/marketplace.json` | `.claude-plugin/marketplace-stable.json` |
| Gets a new version | when it merges | when a promotion PR merges |
| Good for | teams that want fixes fast | teams that want reviewed, batched updates |

**Whole-catalogue pin.** A channel serves *every* plugin from one commit. You can't hold one
plugin back on stable while taking another from latest under the same name. If you need both
channels, register both names (they coexist on one machine) and enable each plugin from one
of them.

## 2. Commit it to your repo (recommended)

Put the snippet for your channel in `.claude/settings.json` (see the
[catalogue](https://adam-m-holloway.github.io/agent-marketplace/) for each plugin's snippet):

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
  "enabledPlugins": {
    "adr-helper@agent-marketplace-stable": true
  }
}
```

For latest, drop `ref` and `path` and use the name `agent-marketplace`.

**Folder trust.** Claude Code only reads `extraKnownMarketplaces` after you trust the folder.
After trusting it, teammates are prompted to install the enabled plugins.

**If a plugin doesn't load** (known issue: a project can enable a plugin that has no install
record yet), install it once per machine:

```sh
claude plugin install adr-helper@agent-marketplace-stable --scope project
```

## 3. Just me (not committed)

```sh
claude plugin install adr-helper --marketplace adam-m-holloway/agent-marketplace
```

or `/plugin install adr-helper@agent-marketplace` inside Claude Code. This writes **user**
settings only, uses the **latest** channel, and isn't counted by insights.

> The one-step `--marketplace` form can't select the stable catalogue: it reads the default
> `marketplace.json` even at `owner/repo@stable`. For stable, use the committed snippet above.

**Local scope.** `--scope local` writes `.claude/settings.local.json` (gitignored): use it to
try a plugin in a repo without committing it.

## 4. Update

Background auto-update is off by default. After a new version lands on your channel:

```sh
claude plugin marketplace update agent-marketplace          # or agent-marketplace-stable
claude plugin update adr-helper@agent-marketplace           # each plugin you use
```

Then restart Claude Code. Project installs can stay on their install-time version until you
run the update. To see what you have, look at `~/.claude/plugins/installed_plugins.json`
(`version` and `gitCommitSha` per plugin and project).

## 5. Switch channel

Change the key under `extraKnownMarketplaces` and the `@<marketplace>` suffix in
`enabledPlugins`, commit, then run the install command above for the new name.

## What insights measures

The nightly insights run reads each consumer repo's **committed** `.claude/settings.json`. It
records which plugins each repo enables, on which channel, at what version, since when (the
first commit touching the settings file), and how many versions behind latest it is.

It measures **committed intent per repo**, not what's installed on each laptop. A teammate who
hasn't run the update command may still be on an older version.
