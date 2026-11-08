---
type: llm
---

PASS if the reply says ADR 0005 (or a Kafka ADR) could not be found and offers to record the SQS decision as a new ADR instead.
FAIL if it invents or supersedes a record that does not exist.
