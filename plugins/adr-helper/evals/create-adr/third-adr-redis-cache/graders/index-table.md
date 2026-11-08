---
type: regex
pattern: '^(?=[\s\S]*\| # \| Title \| Status \| Date \|)(?=[\s\S]*0001[\s\S]*0002[\s\S]*0003)'
target:
  source: file
  path: docs/adr/README.md
---
