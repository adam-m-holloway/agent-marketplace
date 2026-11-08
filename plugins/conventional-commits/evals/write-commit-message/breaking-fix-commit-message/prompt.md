---
description: 'A message whose first line is fix(dates)!: <imperative subject about parsing timestamps in a given/explicit time zone>, at most 72 characters; a body wrapped at 72 explaining that timestamps without an offset were read in the server''s local zone; a BREAKING CHANGE: footer saying parseDate() now requires a timeZone argument and what callers should pass; a reference to #142. A PR title identical to the first line, including the ''!''. No commit is made.'
tags: [write-commit-message, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

write me a conventional commit for my staged change, it fixes the timezone bug from issue #142. git isn't set up in this sandbox so the staged diff is in staged.diff
