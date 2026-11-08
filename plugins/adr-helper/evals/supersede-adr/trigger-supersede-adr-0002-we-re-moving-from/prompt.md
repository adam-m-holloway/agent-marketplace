---
description: 'Should trigger supersede-adr.'
tags: [supersede-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

supersede ADR 0002, we're moving from Postgres to CockroachDB for multi-region writes. options were cockroach, spanner, or postgres with logical replication
