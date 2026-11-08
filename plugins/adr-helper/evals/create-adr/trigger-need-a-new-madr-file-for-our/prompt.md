---
description: 'Should trigger create-adr.'
tags: [create-adr, trigger]
runs: 1
max_turns: 4
allowed_tools: [Read, Glob, Grep, Skill]
---

need a new MADR file for our decision to deploy on ECS Fargate instead of EKS, the reasoning is we don't have anyone to run kubernetes
