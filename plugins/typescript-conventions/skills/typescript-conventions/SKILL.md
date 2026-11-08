---
name: typescript-conventions
description: House conventions for writing, changing and reviewing TypeScript - strict mode with noUncheckedIndexedAccess, no any (use unknown and narrow it), explicit return types on exported functions, discriminated unions instead of boolean flags or optional-field soup, and Vitest tests with describe/it and it.each tables rather than snapshot-only tests - and running tsc --noEmit plus the repo's test command before saying the work is done. Use this whenever the task touches .ts or .tsx files or a tsconfig.json, even if the user never says "conventions" - for example "add a function to src/billing", "get rid of these anys", "model this API response", "write Vitest tests for this module", "tighten the tsconfig", "is this TS change done?", or a review of a TypeScript diff. Not for other languages (Go, Python, Rust, plain shell), for choosing or migrating build tools and bundlers, for writing ADRs or docs, or for generic git questions.
compatibility: "Requires Node.js and the repo's TypeScript and test runner"
---

# TypeScript conventions

Apply these conventions to any TypeScript you write or change, and use them when
reviewing TypeScript. The goal is code where the compiler catches mistakes before tests
do, and tests that state behaviour rather than freeze output. When the repo already does
something differently and consistently, follow the repo and mention the difference.

Longer worked examples are in `references/examples.md`. Read it when you need a full
pattern (for example a type guard for an API response, or a state machine as a union).

## 1. Compiler settings: `strict` on

The repo's `tsconfig.json` should have at least:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- If either is off and the user asked you to work on types or config, propose turning
  it on and fix the errors that appear. If they asked for something else, mention it but
  do not flip it unasked: it can surface many errors across the codebase.
- With `noUncheckedIndexedAccess`, `arr[i]` and `record[key]` are `T | undefined`. Handle
  the `undefined` (a guard, a default, or `.at()` with a check). Do not silence it with `!`.
  When you meet an existing `arr[0]!` in code you are changing, replace it with an
  explicit check (throw a clear error, or return a union or `undefined`).
- Never add `// @ts-ignore`. If a suppression is truly unavoidable, use
  `// @ts-expect-error` with a reason on the same line.

## 2. No `any`

- Do not write `any`, explicitly or implicitly. Use `unknown` for values whose type you
  do not know yet (parsed JSON, `catch` variables, third-party callbacks), then **narrow**
  it with `typeof`, `in`, `Array.isArray`, `instanceof` or a type guard function.
- Validate data at the boundary (HTTP responses, `JSON.parse`, environment variables,
  message payloads) and give the rest of the code a precise type. If the repo already
  uses a schema library such as zod or valibot, use it; otherwise write a small type
  guard. Do not add a dependency just for this.
- `as` casts are a last resort. Never use `as any` or `as unknown as T` to make an error
  go away. `as const` and `satisfies` are fine and often better than annotations.
- Generic code uses type parameters (`<T>`), not `any`.

```ts
function parseUser(json: string): User {
  const data: unknown = JSON.parse(json);
  if (!isUser(data)) {
    throw new Error("invalid user payload");
  }
  return data;
}
```

## 3. Explicit return types on exported functions

Every exported function, method and arrow function has an explicit return type. It
documents the contract, stops an implementation change from silently changing the
public type, and gives better error messages. Local helpers can rely on inference.

```ts
export function totalPence(lines: readonly OrderLine[]): number { ... }
export async function fetchOrder(id: OrderId): Promise<Order> { ... }
```

## 4. Discriminated unions over flags

Model states that cannot coexist as a union with a literal `kind` (or `status`, `type`)
field, not as booleans and optional fields that allow impossible combinations.

```ts
// Avoid: isLoading true with an error and data at the same time is representable.
type State = { isLoading: boolean; error?: string; data?: Order[] };

// Prefer:
type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; orders: Order[] };
```

- Switch on the discriminant and make the switch exhaustive with a `never` check, so a
  new variant is a compile error everywhere it is not handled:

```ts
function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}
```

- Prefer a union of string literals over `enum` unless the repo already uses enums.
- The same applies to function results: return `{ ok: true; value } | { ok: false; error }`
  instead of `{ success: boolean; value?: T; error?: string }`.

## Changing exported types

"Keep the exports working" or "don't break callers" means callers still compile and
behave the same. It does not forbid tightening types. When you are asked to remove
unsafe typing, do it rather than asking first:

- Replace a boolean plus optional fields with a discriminated union, keeping the same
  discriminant name (for example `success`), so existing `if (r.success)` checks still
  work and narrow properly. Update the call sites in the same change.
- Replace `!` on indexed access with an explicit check, even in exported functions.
- Keep exported names and parameters as they are, and say in your reply which exported
  types got stricter.

## 5. Everyday style

- `const` by default, `let` only when reassigned, never `var`.
- `readonly` arrays and properties for data you do not mutate.
- `===` always. Use `??` for defaults, not `||`, when `0` or `""` are valid values.
- `import type` for type-only imports.
- Handle promise rejections: no floating promises; `await` or return them.
- In `catch (err)`, `err` is `unknown`; narrow with `err instanceof Error` before using
  `err.message`.

## 6. Tests with Vitest

Use the repo's test runner. When it is Vitest (or Jest, which has the same shape):

- Group with `describe` per unit, one behaviour per `it`, and name tests as sentences
  about behaviour: `it("rejects a negative quantity")`.
- Use `it.each` tables when the same behaviour is checked with several inputs. Adding a
  case is one new row; the name template shows which row failed.

```ts
import { describe, expect, it } from "vitest";
import { applyDiscount } from "./discount";

describe("applyDiscount", () => {
  it.each([
    { pence: 1000, percent: 0, want: 1000 },
    { pence: 1000, percent: 10, want: 900 },
    { pence: 1000, percent: 100, want: 0 },
  ])("takes $percent% off $pence", ({ pence, percent, want }) => {
    expect(applyDiscount(pence, percent)).toBe(want);
  });

  it("throws for a percent above 100", () => {
    expect(() => applyDiscount(1000, 101)).toThrow(RangeError);
  });
});
```

- **No snapshot-only tests.** A test whose only assertion is `toMatchSnapshot()` freezes
  whatever the code does today, including bugs, and reviewers approve snapshot diffs
  without reading them. Assert the specific values that matter. A snapshot is acceptable
  as an extra check alongside explicit assertions, or for large stable output the user
  asked to snapshot.
- Cover error and edge cases (empty input, `undefined` from an index, the error variant
  of a union), not only the happy path.
- Import `describe`, `it`, `expect` and `vi` from `vitest` explicitly unless the repo
  enables globals.
- Prefer passing fakes in over `vi.mock` of whole modules; restore spies and fake timers
  (`vi.restoreAllMocks()`, `vi.useRealTimers()`) after each test.
- Test code is TypeScript too: no `any` in tests either.

## Before you say done

Only report the work as finished, fixed or passing after you have run these
from the package root and read their output:

1. `npx tsc --noEmit` - must report no errors. If the repo has a `typecheck` script in
   `package.json`, running that is fine, as long as it runs `tsc --noEmit` (or
   `tsc -b` for project references).
2. The repo's test command - look in `package.json` scripts first (`npm test`,
   `pnpm test`, and so on); otherwise `npx vitest run`. Never use watch mode: use
   `vitest run`, not bare `vitest`. All tests must pass. Fix failures in your code; do
   not delete, skip (`it.skip`) or loosen tests to make them pass.

Then report the results to the user: each command you ran and its actual output (the
error list, or the pass/fail summary line from the test runner). If a command cannot be
run (dependencies not installed, no Node, a failure that predates your change), say so
plainly, show the error, and do not claim the work is done. Evidence, not "should pass".

When the user asks "is it done?" or "can I merge this?", run both checks again on the
current tree rather than relying on earlier runs.
