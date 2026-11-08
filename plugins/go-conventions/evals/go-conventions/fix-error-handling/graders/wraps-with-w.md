---
type: regex
pattern: 'fmt\.Errorf\([^)]*%[vs][^)]*\berr\b'
target:
  source: file
  path: main.go
match: not_contains
---
