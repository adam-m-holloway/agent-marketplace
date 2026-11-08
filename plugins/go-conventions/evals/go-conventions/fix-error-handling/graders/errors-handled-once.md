---
type: llm
focus:
  source: file
  path: main.go
---

PASS if Store.Get no longer both logs and returns the same error, the 500 response does not write the raw internal error message to the client, and error messages are lowercase and do not start with 'error' or 'failed to'.
FAIL otherwise.
