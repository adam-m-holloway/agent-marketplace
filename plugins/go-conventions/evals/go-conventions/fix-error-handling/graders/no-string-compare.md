---
type: regex
pattern: 'err\.Error\(\)\s*=='
target:
  source: file
  path: main.go
match: not_contains
---
