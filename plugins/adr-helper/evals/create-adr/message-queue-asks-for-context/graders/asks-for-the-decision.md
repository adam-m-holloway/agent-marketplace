---
type: llm
---

PASS if the reply writes no ADR yet and asks what problem the queue solves, which options were considered, and which one was chosen and why. If it mentions RabbitMQ or docker-compose.yml, it asks whether that is the choice rather than stating it.
FAIL if it states that RabbitMQ (or any queue) was chosen or gives a rationale for choosing it.
