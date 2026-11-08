# Changelog

## [1.1.0] - 2026-11-08

### Added

- supersede-adr skill: replaces an existing ADR with a new numbered MADR record, linking the new ADR to the old one with `Supersedes` and marking the old one `Superseded by`, and asking for missing context instead of inventing it.
- ADR index `docs/adr/README.md` (number, title, status, date), created if missing and maintained by both skills.

## [1.0.0] - 2026-11-08

### Added

- create-adr skill: writes a numbered MADR Architecture Decision Record to `docs/adr/NNNN-kebab-title.md`, creating the folder when needed and asking for missing context instead of inventing it.
