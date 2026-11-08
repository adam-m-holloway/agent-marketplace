---
type: regex
pattern: '\bis(Uploading|Done|Failed|Idle)\b'
target:
  source: file
  path: src/upload.ts
match: not_contains
---
