# go-conventions

House conventions for Go code written or reviewed with Claude, plus a rule that Claude
runs the Go toolchain before it says the work is done.

## Skills

### go-conventions

Used whenever Claude writes, changes or reviews Go code. It covers:

- **Errors**: wrap with `fmt.Errorf("...: %w", err)`, inspect with `errors.Is` and
  `errors.As`, choose between sentinel errors and typed errors, handle each error once.
- **Tests**: table-driven tests with `t.Run` subtests, error paths covered, standard
  `testing` and `httptest` rather than assertion or mocking libraries.
- **Interfaces**: small, defined by the consumer; accept interfaces, return structs.
- **Standard library first**, and `context.Context` as the first parameter.
- **Before you say done**: Claude runs `gofmt -l .` (must print nothing), `go vet ./...`
  and `go test ./...`, and reports their output. No "should pass".

Longer examples are in `skills/go-conventions/references/examples.md`.

Requires the Go toolchain (`gofmt`, `go vet`, `go test`) on the machine running Claude.

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
  "enabledPlugins": { "go-conventions@agent-marketplace": true }
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
  "enabledPlugins": { "go-conventions@agent-marketplace-stable": true }
}
```

### Just me

```
claude plugin install go-conventions --marketplace adam-m-holloway/agent-marketplace
```

## Changes

See [CHANGELOG.md](CHANGELOG.md).
