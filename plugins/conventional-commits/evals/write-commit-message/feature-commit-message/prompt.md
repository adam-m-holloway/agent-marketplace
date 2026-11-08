---
description: 'A Conventional Commits message whose first line is feat(invoices): <imperative subject about PDF download/export of invoices>, at most 72 characters, a blank line, a short body wrapped at 72 characters describing the new GET /invoices/:id/pdf route and renderInvoicePdf, no BREAKING CHANGE footer and no AI attribution. A PR title identical to the first line. No commit is made.'
tags: [write-commit-message, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Can you write the commit message for what I've staged? This folder isn't a git checkout, so I saved the output of `git diff --cached` to staged.diff for you. I also need a PR title.
