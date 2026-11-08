---
description: 'main.go is fixed so that errors are wrapped with %w (not %v or %s), the json.Unmarshal error is checked and wrapped, Get no longer both logs and returns, the not-found error wraps ErrNotFound so the handler can use errors.Is instead of comparing err.Error() strings, the strconv.Atoi error yields a 400, and internal errors are not leaked to clients. A table-driven test is added or proposed, and gofmt, go vet and go test are run with output reported.'
tags: [go-conventions, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Can you fix the error handling in main.go? The 404s never fire and when the JSON file is broken we just return an empty list.
