---
description: 'Should trigger create-adr.'
tags: [create-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

Please create a new architecture decision record for adopting OpenTelemetry instead of our custom metrics lib in pkg/telemetry. We compared it against Datadog's agent-only approach and just keeping the custom code.
