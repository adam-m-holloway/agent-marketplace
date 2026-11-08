---
type: llm
focus:
  source: file
  path: orders/http.go
---

PASS if the new PATCH status handler depends on a small interface (one to three methods) defined in the orders package rather than on *MemoryStore, and any error it returns up the stack is wrapped with fmt.Errorf and %w.
FAIL otherwise.
