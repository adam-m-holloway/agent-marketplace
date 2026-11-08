---
description: 'Should trigger go-conventions.'
tags: [go-conventions, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

the error handling in pkg/payments/client.go is a mess, half the errors are fmt.Errorf with %v and the callers can't tell a timeout from a decline. can you clean it up?
