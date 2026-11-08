---
description: 'A src/upload.ts that models the upload state as a discriminated union on a literal field (for example kind: ''idle'' | ''uploading'' | ''done'' | ''failed'') rather than booleans and optional fields, exported functions with explicit return types, an exhaustive switch with a never check, no any, and a Vitest file using describe/it with it.each for the label or transition cases and explicit assertions (not snapshot-only). npx tsc --noEmit and the test command are run and their output reported.'
tags: [typescript-conventions, behaviour]
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---

Add a src/upload.ts module to this TypeScript project that tracks the state of a file upload: it can be idle, uploading with a progress percentage, done with the stored URL, or failed with an error message. I need a reducer-style function that takes the current state and an event and returns the next state, and a function that turns a state into a status label for the UI. Add tests too. The repo uses Vitest.
