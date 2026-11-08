---
description: 'Should trigger write-commit-message.'
tags: [write-commit-message, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

here's my git diff --cached output, can you turn it into a proper feat/fix style commit message with a body?

diff --git a/src/cli/flags.ts b/src/cli/flags.ts
+  '--dry-run': Boolean,
