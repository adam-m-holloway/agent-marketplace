---
description: 'No ADR file is written. The repo has a docker-compose.yml with a rabbitmq service, but the user stated no problem, options or decision. The assistant asks what problem the queue solves, which options were considered, which one was chosen and why (and who decided). If it mentions RabbitMQ from docker-compose.yml, it does so as a question (for example ''Is RabbitMQ, which I see in docker-compose.yml, the one you chose?''), never as the decision.'
tags: [create-adr, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

write an ADR for our message queue decision
