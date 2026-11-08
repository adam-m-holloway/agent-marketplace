---
description: 'Should trigger write-commit-message.'
tags: [write-commit-message, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

give me a conventional commit message for the staged diff, our commitlint is strict about scopes
