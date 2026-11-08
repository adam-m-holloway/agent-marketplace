# Changelog

## [1.1.1] - 2026-11-08

### Fixed

- create-adr and supersede-adr no longer invent pros or cons for options to make a record look balanced: they list only what the user gave or the repo shows, and write "No pros/cons recorded." (or ask) otherwise. A new create-adr eval expectation catches invented pros.
- create-adr always asks what problem a decision solves when the user has not said, even if the repo hints at which option was chosen.
- The create-adr "missing context" eval now runs in a repo whose docker-compose.yml has a RabbitMQ service, and checks that the skill asks for the problem and decision and treats the RabbitMQ evidence as a question, not a fact.
- README: the one-step `--marketplace` install command uses the latest channel only; the stable channel is described in docs/consuming-plugins.md.

## [1.1.0] - 2026-11-08

### Added

- supersede-adr skill: replaces an existing ADR with a new numbered MADR record, linking the new ADR to the old one with `Supersedes` and marking the old one `Superseded by`, and asking for missing context instead of inventing it.
- ADR index `docs/adr/README.md` (number, title, status, date), created if missing and maintained by both skills.

## [1.0.0] - 2026-11-08

### Added

- create-adr skill: writes a numbered MADR Architecture Decision Record to `docs/adr/NNNN-kebab-title.md`, creating the folder when needed and asking for missing context instead of inventing it.
