---
description: 'Should trigger supersede-adr.'
tags: [supersede-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

mark docs/adr/0003-use-rest-for-billing.md as superseded by a new decision to use gRPC, the payloads got too big. platform team decided
