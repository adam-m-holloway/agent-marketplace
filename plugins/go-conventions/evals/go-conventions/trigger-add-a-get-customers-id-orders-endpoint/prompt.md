---
description: 'Should trigger go-conventions.'
tags: [go-conventions, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

add a GET /customers/{id}/orders endpoint to internal/api in our Go service, it should return 404 if the customer doesn't exist
