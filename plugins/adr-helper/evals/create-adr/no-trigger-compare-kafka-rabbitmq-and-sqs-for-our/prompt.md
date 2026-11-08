---
description: 'Near miss: should not trigger create-adr.'
tags: [create-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

compare Kafka, RabbitMQ and SQS for our order events use case - throughput is about 2k msgs/sec. which would you pick?
