---
type: regex
pattern: '"dependencies"'
target:
  source: file
  path: package.json
match: not_contains
---
