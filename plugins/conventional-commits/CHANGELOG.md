# Changelog

All notable changes to this plugin are documented here (Keep a Changelog).

## [1.0.1] - 2026-11-08

### Changed
- Eval cases moved to the native `claude plugin eval` format in `evals/<skill>/`: deterministic regex, file and tool graders (plus a few judge-model rubrics) for the behaviour cases, and one case per trigger query with a `tool_used: Skill` grader. Fixtures moved into each case's `workspace/`. The skill itself is unchanged.

## [1.0.0] - 2026-11-08

### Added

- write-commit-message skill: writes a Conventional Commits message (type(scope) subject of 72 characters or fewer, body wrapped at 72, `!` and a `BREAKING CHANGE:` footer for breaking changes) from the staged diff, plus a matching PR title. It takes the scope from the changed paths, asks when the intent is not clear from the diff, never adds AI attribution trailers, and commits only when asked.
