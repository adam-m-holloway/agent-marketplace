---
description: 'Should trigger go-conventions.'
tags: [go-conventions, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

refactor the billing service so it takes an interface instead of the concrete *postgres.Store, I want to be able to fake it in tests
