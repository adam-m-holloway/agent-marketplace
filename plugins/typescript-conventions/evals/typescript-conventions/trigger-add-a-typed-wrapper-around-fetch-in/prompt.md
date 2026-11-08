---
description: 'Should trigger typescript-conventions.'
tags: [typescript-conventions, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

add a typed wrapper around fetch in src/http.ts that parses the JSON body safely and throws on non-2xx
