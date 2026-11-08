---
description: 'A new file docs/adr/0003-use-redis-for-caching.md (or a similar kebab-case title), numbered after the existing 0001-use-go.md and 0002-use-postgresql.md, in MADR format, recording Redis over an in-process LRU cache. The existing ADRs are untouched, and the context may link to 0002-use-postgresql.md. A docs/adr/README.md index is created listing 0001, 0002 and 0003.'
tags: [create-adr, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Add an ADR: we're putting a Redis cache in front of the product catalogue reads because Postgres read latency spikes during sales. We looked at an in-process LRU cache too but it doesn't share state across pods. Status accepted, decided by the platform team.
