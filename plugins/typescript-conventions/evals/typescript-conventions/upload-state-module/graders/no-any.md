---
type: regex
pattern: ':\s*any\b|\bas any\b|<any>|\bany\[\]'
target:
  source: file
  path: src/upload.ts
match: not_contains
---
