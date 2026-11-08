---
description: 'src/notify.ts has no any left: parseWebhook returns a precise type after narrowing an unknown from JSON.parse (with a type guard or the repo''s validation), the catch variable is treated as unknown and narrowed, transport gets a small typed interface, SendResult becomes a discriminated union instead of success plus optional fields, exported functions have explicit return types, and firstRecipient handles undefined instead of using the non-null assertion. tsc --noEmit and the tests are run (or the assistant explains that dependencies must be installed first) with output reported.'
tags: [typescript-conventions, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Get rid of the anys in src/notify.ts. The webhook body is JSON with a 'to' field and either 'phone' or 'deviceToken', transport.deliver(channel, payload) returns a Promise of the message id. Keep the exports working for callers.
