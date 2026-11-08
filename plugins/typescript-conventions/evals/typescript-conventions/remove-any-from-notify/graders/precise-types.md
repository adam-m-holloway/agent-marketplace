---
type: llm
focus:
  source: file
  path: src/notify.ts
---

PASS if the JSON.parse result is narrowed from unknown with a type guard or validation, the catch variable is narrowed before reading message or status, transport has an explicit type describing deliver, SendResult is a discriminated union, every exported function has an explicit return type, and firstRecipient handles an empty list without the non-null assertion !.
FAIL otherwise.
