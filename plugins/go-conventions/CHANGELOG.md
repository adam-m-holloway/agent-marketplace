# Changelog

## [1.0.2] - 2026-11-08

### Removed
- The old skill-creator `evals.json` and `trigger-evals.json` files; the native `claude plugin eval` cases in `evals/` replace them. The skill itself is unchanged.

## [1.0.1] - 2026-11-08

### Changed
- Eval cases moved to the native `claude plugin eval` format in `evals/<skill>/`: deterministic regex, file and tool graders (plus a few judge-model rubrics) for the behaviour cases, and one case per trigger query with a `tool_used: Skill` grader. Fixtures moved into each case's `workspace/`. The skill itself is unchanged.

## [1.0.0] - 2026-11-08

### Added

- go-conventions skill: error wrapping with `%w` and `errors.Is`/`errors.As`, sentinel vs typed errors, table-driven tests with `t.Run`, small consumer-side interfaces, standard library first, `context.Context` first, and running `gofmt -l .`, `go vet ./...` and `go test ./...` before claiming done.
