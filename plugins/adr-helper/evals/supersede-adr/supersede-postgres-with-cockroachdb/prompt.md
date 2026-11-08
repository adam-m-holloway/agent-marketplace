---
description: 'A new file docs/adr/0003-use-cockroachdb-for-service-storage.md (or a similar kebab-case slug starting with 0003-) in MADR format whose Status section says Accepted and Supersedes [ADR-0002](0002-use-postgresql.md). docs/adr/0002-use-postgresql.md has its Status metadata line and Status section changed to Superseded by [ADR-0003](...) and nothing else changed. docs/adr/README.md gains a 0003 row and shows 0002 as superseded. 0001-use-go.md is untouched.'
tags: [supersede-adr, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Supersede ADR 0002. We're moving service storage from PostgreSQL to CockroachDB because we now need multi-region writes for the EU launch and single-primary Postgres can't do that. We also looked at Postgres with logical replication and at Spanner, but replication conflicts were a mess in the trial and Spanner locks us into GCP. Decided by the platform team, it's accepted.
