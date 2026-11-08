---
description: 'Should trigger create-adr.'
tags: [create-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

we decided in the arch review to move the billing service from REST to gRPC because of the payload sizes, can you write that up as an ADR? options were REST+gzip, gRPC, and GraphQL
