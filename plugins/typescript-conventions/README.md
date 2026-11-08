# typescript-conventions

House conventions for TypeScript written or reviewed with Claude, plus a rule that Claude
type-checks and runs the tests before it says the work is done.

## Skills

### typescript-conventions

Used whenever Claude writes, changes or reviews TypeScript. It covers:

- **Compiler settings**: `strict` and `noUncheckedIndexedAccess` on; no `@ts-ignore`.
- **No `any`**: use `unknown` and narrow it with type guards; validate data at the
  boundary; `as` casts only as a last resort.
- **Explicit return types** on exported functions.
- **Discriminated unions** over boolean flags and optional-field combinations, with
  exhaustive `never` checks.
- **Vitest patterns**: `describe`/`it`, `it.each` tables, explicit assertions rather than
  snapshot-only tests, error cases covered.
- **Before you say done**: Claude runs `npx tsc --noEmit` and the repo's test command
  (for example `npx vitest run`), and reports their output. No "should pass".

Longer examples are in `skills/typescript-conventions/references/examples.md`.

Requires Node.js and the repo's TypeScript and test runner on the machine running Claude.

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
  "enabledPlugins": { "typescript-conventions@agent-marketplace": true }
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
  "enabledPlugins": { "typescript-conventions@agent-marketplace-stable": true }
}
```

### Just me

```
claude plugin install typescript-conventions --marketplace adam-m-holloway/agent-marketplace
```

## Changes

See [CHANGELOG.md](CHANGELOG.md).
