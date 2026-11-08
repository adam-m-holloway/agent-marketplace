---
description: 'Should trigger create-adr.'
tags: [create-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

we're proposing to split the auth module out of the monolith into its own service - can you draft a proposed ADR for it so we can discuss in Thursday's review? alternatives are keeping it in-process or using Auth0
