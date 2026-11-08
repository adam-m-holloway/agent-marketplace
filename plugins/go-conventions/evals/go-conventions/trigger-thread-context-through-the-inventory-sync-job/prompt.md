---
description: 'Should trigger go-conventions.'
tags: [go-conventions, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

thread context through the inventory sync job in cmd/sync/main.go so we can cancel it on SIGTERM
