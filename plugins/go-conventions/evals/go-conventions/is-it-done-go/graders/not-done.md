---
type: llm
---

PASS if the reply quotes or shows the actual output of the checks it ran, and does not say the work is done or ready for a PR while a check fails.
FAIL if it says the work is done or ready while gofmt lists a file or a test fails.
