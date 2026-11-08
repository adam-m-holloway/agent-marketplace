# TypeScript conventions: worked examples

## Narrowing an unknown API response with a type guard

```ts
export type Order = {
  readonly id: string;
  readonly totalPence: number;
  readonly status: "pending" | "shipped" | "cancelled";
};

const STATUSES = ["pending", "shipped", "cancelled"] as const;

function isOrder(value: unknown): value is Order {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.totalPence === "number" &&
    typeof v.status === "string" &&
    (STATUSES as readonly string[]).includes(v.status)
  );
}

export async function fetchOrder(id: string): Promise<Order> {
  const res = await fetch(`/api/orders/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`fetch order ${id}: HTTP ${res.status}`);
  }
  const body: unknown = await res.json();
  if (!isOrder(body)) {
    throw new Error(`fetch order ${id}: unexpected response shape`);
  }
  return body;
}
```

The single `as Record<string, unknown>` inside the guard is acceptable: it is local,
follows an `object` check, and every field is still checked before the guard returns true.

## A result type instead of success flags

```ts
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function parseQuantity(input: string): ParseResult<number> {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: `invalid quantity: ${input}` };
  }
  return { ok: true, value: n };
}

const r = parseQuantity(raw);
if (r.ok) {
  use(r.value); // narrowed: value is number here
} else {
  report(r.error);
}
```

## An exhaustive switch over a discriminated union

```ts
type PaymentEvent =
  | { kind: "authorised"; amountPence: number }
  | { kind: "declined"; reason: string }
  | { kind: "refunded"; amountPence: number; refundId: string };

function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}

export function describeEvent(e: PaymentEvent): string {
  switch (e.kind) {
    case "authorised":
      return `authorised ${e.amountPence}p`;
    case "declined":
      return `declined: ${e.reason}`;
    case "refunded":
      return `refunded ${e.amountPence}p (${e.refundId})`;
    default:
      return assertNever(e);
  }
}
```

Adding a `"disputed"` variant now fails `tsc --noEmit` at `assertNever(e)` until it is
handled.

## Index access under noUncheckedIndexedAccess

```ts
export function firstLine(text: string): string {
  const line = text.split("\n")[0]; // string | undefined
  return line ?? "";
}
```

## A Vitest table that covers the error variant

```ts
import { describe, expect, it } from "vitest";
import { parseQuantity } from "./quantity";

describe("parseQuantity", () => {
  it.each([
    { input: "1", want: 1 },
    { input: "42", want: 42 },
  ])("parses $input", ({ input, want }) => {
    expect(parseQuantity(input)).toEqual({ ok: true, value: want });
  });

  it.each(["0", "-3", "2.5", "abc", ""])("rejects %j", (input) => {
    const r = parseQuantity(input);
    expect(r.ok).toBe(false);
  });
});
```

## Reporting the checks

A good "done" message ends with the evidence, for example:

```
$ npx tsc --noEmit
(no output)
$ npx vitest run
 Test Files  4 passed (4)
      Tests  27 passed (27)
```
