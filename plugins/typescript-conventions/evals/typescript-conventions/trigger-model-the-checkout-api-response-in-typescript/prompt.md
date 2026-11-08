---
description: 'Should trigger typescript-conventions.'
tags: [typescript-conventions, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

model the checkout API response in TypeScript - it's either a success with an order id, a declined payment with a reason, or a validation error with field errors
