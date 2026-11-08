---
description: 'No files are created or changed. The assistant identifies 0002-use-postgresql.md as the target and asks for the missing context: which database is replacing PostgreSQL, why the old decision no longer holds, which options were considered, and who decided.'
tags: [supersede-adr, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

supersede the postgres ADR, we're changing databases
