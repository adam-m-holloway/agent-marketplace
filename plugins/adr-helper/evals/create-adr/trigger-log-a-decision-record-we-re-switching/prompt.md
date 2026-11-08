---
description: 'Should trigger create-adr.'
tags: [create-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

log a decision record: we're switching the monorepo from npm to pnpm workspaces because installs take 6 minutes in CI. yarn berry was the other option.
