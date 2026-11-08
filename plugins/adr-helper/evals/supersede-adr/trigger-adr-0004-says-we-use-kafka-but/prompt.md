---
description: 'Should trigger supersede-adr.'
tags: [supersede-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

ADR-0004 says we use Kafka but we've switched to SQS since nobody wants to run the cluster. can you replace that ADR with the new decision?
