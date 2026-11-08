# Changelog

## [1.0.2] - 2026-11-08

### Changed
- Eval cases moved to the native `claude plugin eval` format in `evals/<skill>/`: deterministic regex, file and tool graders (plus a few judge-model rubrics) for the behaviour cases, and one case per trigger query with a `tool_used: Skill` grader. Fixtures moved into each case's `workspace/`. The skill itself is unchanged.

## [1.0.1] - 2026-11-08

### Fixed

- "Keep the exports working" no longer stops Claude tightening types: the skill now says callers must still compile and behave the same, and that a boolean plus optional fields should become a discriminated union (call sites updated in the same change) and `!` on indexed access should become an explicit check.
- The "is it done?" eval now tells the two configurations apart: `npm test` passes and only `npx tsc --noEmit` finds the error.
- README: the one-step `--marketplace` install uses the latest channel only; stable is covered in docs/consuming-plugins.md.

## [1.0.0] - 2026-11-08

### Added

- typescript-conventions skill: `strict` and `noUncheckedIndexedAccess`, no `any` (use `unknown` and narrow), explicit return types on exported functions, discriminated unions over flags, Vitest patterns (`describe`/`it`, `it.each` tables, no snapshot-only tests), and running `npx tsc --noEmit` plus the repo's test command before claiming done.
