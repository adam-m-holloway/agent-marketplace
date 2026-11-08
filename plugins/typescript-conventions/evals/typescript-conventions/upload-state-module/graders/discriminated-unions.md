---
type: llm
focus:
  source: file
  path: src/upload.ts
---

PASS if the upload state is a union of object types sharing a literal discriminant field (no boolean flags or optional-field flags), events are also a discriminated union or otherwise avoid optional-field flags, and every exported function has an explicit return type.
FAIL otherwise.
