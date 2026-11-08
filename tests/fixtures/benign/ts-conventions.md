---
name: ts-conventions
description: Applies team TypeScript conventions — strict mode, error handling, Vitest. Use when writing or reviewing TypeScript.
compatibility: TypeScript 5.4+, Node 20+
---

# TypeScript conventions

- Enable `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.json`.
- Prefer `unknown` over `any`; narrow with type guards.
- Read configuration from `process.env.API_URL` once at start-up and validate it.
- Throw `Error` subclasses; never throw strings.

```ts
export class NotFoundError extends Error {
  constructor(readonly id: string) {
    super(`not found: ${id}`);
  }
}

const res = await fetch(`${baseUrl}/items/${id}`);
if (!res.ok) throw new NotFoundError(id);
```

## Tests

Run `npx vitest run` locally and `npm test` in CI. Pin dev tools in `package.json`; for one-off
tools use an explicit version such as `npx -y prettier@3.3.3 --check .`.
Use `eval`-free code: no `new Function(...)` or dynamic `import()` of user input.
