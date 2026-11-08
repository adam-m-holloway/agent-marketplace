# ADR index format

The index is `docs/adr/README.md`. The `create-adr` and `supersede-adr` skills both keep it
up to date, so it always lists every ADR in the folder.

## Format

```markdown
# Architecture Decision Records

| # | Title | Status | Date |
|---|-------|--------|------|
| 0001 | [Use Go for backend services](0001-use-go.md) | Accepted | 2026-09-14 |
| 0002 | [Use PostgreSQL for service storage](0002-use-postgresql.md) | Superseded by ADR-0003 | 2026-09-21 |
| 0003 | [Use CockroachDB for service storage](0003-use-cockroachdb-for-service-storage.md) | Accepted | 2026-11-08 |
```

- **#**: the four-digit number from the file name.
- **Title**: the ADR's `# ` heading, linked to the file by its name (relative link).
- **Status**: the value of the ADR's `- Status:` metadata line as plain text, with any link
  removed, so `Superseded by [ADR-0003](0003-x.md)` becomes `Superseded by ADR-0003`.
- **Date**: the ADR's `- Date:` metadata line.
- One row per ADR file (a name that starts with four digits and a hyphen), sorted by number,
  ascending. `README.md` itself is not an ADR and has no row.

## Rules

- If `docs/adr/README.md` does not exist, create it with the heading and the table, and add
  a row for **every** ADR already in the folder, not only the one you just wrote. Read each
  ADR's title, status and date from the file; if a file has no date, write `Not recorded`.
- If it exists, update it in place: add the new row, change the rows whose status changed,
  and keep the rows sorted. Keep any text the team added above or below the table.
- If it exists but has no table in this format, ask the user before rewriting it.
- Escape a `|` in a title as `\|` so the table stays valid.
