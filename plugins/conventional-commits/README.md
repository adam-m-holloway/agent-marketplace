# conventional-commits

Commit messages and PR titles in [Conventional Commits](https://www.conventionalcommits.org/)
format, written from what you have actually staged.

## Skills

### write-commit-message

Stage your changes and ask Claude for a message ("write a commit message", "what should I
commit this as?", "PR title for this?"). It will:

- read `git diff --cached` (or a diff you paste) and reuse the scopes in `git log` and any
  commitlint config;
- pick the type (`feat`, `fix`, `refactor`, `docs`, `perf`, `test`, `build`, `ci`, `chore`, ...)
  from what the change does, and the scope from the changed paths (`src/payments/...` gives
  `payments`; no scope for repo-wide changes);
- keep the first line to 72 characters or fewer and wrap the body at 72;
- mark breaking changes with `!` and a `BREAKING CHANGE:` footer that tells callers what
  to do, including a `fix` that changes a public signature;
- give a PR title that matches the first line, for squash merges;
- ask you what the change is for when the diff doesn't say, instead of inventing a reason;
- never add `Co-Authored-By` or "Generated with" lines for Claude or any AI (human
  co-authors you name are fine).

It only proposes the message. It runs `git commit` only when you explicitly ask it to.

Works with any language. Needs `git` on the machine running Claude.

Not covered: PR descriptions, release notes and changelogs, rewriting history, or setting up
commitlint and git hooks.

## Stage

This plugin starts at `sandbox` (not listed) and moves to `incubating`, which lists it on
the latest channel only. The stable channel lists it once it reaches `published`, so the
stable install below will not find it until then.

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
  "enabledPlugins": { "conventional-commits@agent-marketplace": true }
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
  "enabledPlugins": { "conventional-commits@agent-marketplace-stable": true }
}
```

### Just me

```
claude plugin install conventional-commits --marketplace adam-m-holloway/agent-marketplace
```

This one-step `--marketplace` command installs from the latest channel only; for the
stable channel, see [docs/consuming-plugins.md](../../docs/consuming-plugins.md).

## Changes

See [CHANGELOG.md](CHANGELOG.md).
