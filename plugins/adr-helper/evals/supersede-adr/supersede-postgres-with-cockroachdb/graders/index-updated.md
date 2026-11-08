---
type: regex
pattern: '^(?=[\s\S]*\| ?0002 ?\|[^\n]*[Ss]uperseded[^\n]*0003)(?=[\s\S]*\| ?0003 ?\|[^\n]*Accepted)'
target:
  source: file
  path: docs/adr/README.md
---
