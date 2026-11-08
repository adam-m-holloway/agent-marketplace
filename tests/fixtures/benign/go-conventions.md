---
name: go-conventions
description: Applies team Go conventions — error wrapping, table-driven tests, package layout. Use when writing or reviewing Go code.
compatibility: Go 1.22+
---

# Go conventions

## Errors

Wrap errors with context using `fmt.Errorf("load config: %w", err)`. Never discard an error
with `_` unless a comment explains why. Compare with `errors.Is` / `errors.As`.

```go
func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var c Config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return &c, nil
}
```

## Tests

Use table-driven tests with `t.Run(tc.name, ...)` and `t.Parallel()` where safe.
Run `go test ./... -race` before pushing. Read configuration from `os.Getenv("APP_ENV")`, and keep
example settings in `config.example.yaml`, never real credentials.

## Tooling

Install linters with `go install honnef.co/go/tools/cmd/staticcheck@2024.1.1`. Clean build output
with `rm -rf ./bin` — never from the repository root.
