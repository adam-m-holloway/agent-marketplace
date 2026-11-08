---
description: 'No files are created or changed. The assistant says there is no ADR 0005 (and no Kafka ADR) in docs/adr, lists the ADRs that do exist (0001-use-go.md and 0002-use-postgresql.md), and offers to record the SQS decision as a new ADR with create-adr instead.'
tags: [supersede-adr, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

ADR 0005 about using Kafka is out of date, we've switched to SQS because nobody wants to run the Kafka cluster any more. Can you supersede it?
