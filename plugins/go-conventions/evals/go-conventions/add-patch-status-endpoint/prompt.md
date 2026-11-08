---
description: 'A new handler registered on the existing ServeMux using the Go 1.22+ pattern "PATCH /orders/{id}/status", depending on a small consumer-side interface rather than *MemoryStore, mapping ErrNotFound with errors.Is, plus a table-driven test with t.Run subtests and httptest covering success, not found and bad body. gofmt -l ., go vet ./... and go test ./... are run and their output reported.'
tags: [go-conventions, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Add a PATCH /orders/{id}/status endpoint to the orders package. The body is JSON like {"status": "shipped"}. Return 204 on success, 404 if the order doesn't exist, 400 for a bad body. MemoryStore already has SetStatus.
