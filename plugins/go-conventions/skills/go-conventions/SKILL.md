---
name: go-conventions
description: House conventions for writing, changing and reviewing Go code - errors wrapped with %w and checked with errors.Is/errors.As, sentinel vs typed errors, table-driven tests with t.Run subtests, small interfaces defined by the consumer, standard library first, context.Context as the first parameter - and running gofmt, go vet and go test before saying the work is done. Use this whenever the task touches .go files or a Go module (go.mod), even if the user never says "conventions" - for example "add an endpoint to the orders service", "fix the error handling in this handler", "write tests for this package", "refactor this to take an interface", "is this Go change done?", or a review of a Go diff. Not for other languages (TypeScript, Python, Rust, Java), for Go toolchain installation or version upgrades, for writing ADRs or docs, or for generic git questions.
compatibility: "Requires the Go toolchain: gofmt, go vet, go test"
---

# Go conventions

Apply these conventions to any Go code you write or change, and use them when reviewing
Go. They exist so that code written with Claude reads like the rest of a well-kept Go
codebase: errors that can be inspected, tests that are easy to extend, and dependencies
that are easy to fake. When the repo already does something differently and
consistently, follow the repo and mention the difference; consistency beats this list.

Longer worked examples are in `references/examples.md`. Read it when you need a full
pattern (for example a typed error with `errors.As`, or a test table with fakes).

## 1. Errors

### Wrap with `%w` and add context

When you return an error you received, wrap it with `fmt.Errorf` and `%w`, and say what
*this* function was trying to do. Do not just `return err`, and never use `%v` or `%s`
for the wrapped error, because that breaks `errors.Is` and `errors.As` for every caller.

```go
order, err := s.store.Get(ctx, id)
if err != nil {
    return Order{}, fmt.Errorf("get order %s: %w", id, err)
}
```

- Message style: lowercase, no trailing punctuation, no "failed to" or "error" prefix
  (the chain already says it failed). Read the full chain aloud: `create invoice: get
  order 42: sql: no rows in result set`.
- Handle an error once: either wrap and return it, or log it and stop. Not both.
- Never discard an error with `_` unless the reason is obvious or commented
  (for example a best-effort `Close` on a read-only file).

### Inspect with `errors.Is` and `errors.As`

Compare errors with `errors.Is(err, ErrNotFound)`, never `err == ErrNotFound` and never
by matching `err.Error()` strings. Extract typed errors with `errors.As`.

### Sentinel vs typed errors

- **Sentinel error** (`var ErrNotFound = errors.New("order not found")`): use when
  callers only need to know *which* condition happened. Name it `ErrXxx`, export it only
  if callers outside the package must check it.
- **Typed error** (a struct implementing `error`): use when callers need *data* about the
  failure (the field that failed validation, the retry-after duration). Name it
  `XxxError`, use a pointer receiver, and implement `Unwrap` if it wraps a cause.
- Do not export a sentinel or type just in case. Every exported error is API.
- Translate errors at boundaries: an HTTP handler maps `ErrNotFound` to 404 with
  `errors.Is`; it does not leak storage errors to clients.

### Panics

Do not panic for expected failures. `panic` is for programmer errors that cannot happen
in a correct program; `Must...` helpers are fine only at init time.

## 2. Tests

### Table-driven tests with `t.Run`

Write tests as a table of cases and run each case as a named subtest. Adding a case
should be one new struct literal, and a failure should name the case.

```go
func TestParseAmount(t *testing.T) {
    tests := []struct {
        name    string
        in      string
        want    int64
        wantErr error
    }{
        {name: "whole pounds", in: "12", want: 1200},
        {name: "pence", in: "12.34", want: 1234},
        {name: "empty", in: "", wantErr: ErrInvalidAmount},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseAmount(tt.in)
            if !errors.Is(err, tt.wantErr) {
                t.Fatalf("ParseAmount(%q) error = %v, want %v", tt.in, err, tt.wantErr)
            }
            if got != tt.want {
                t.Errorf("ParseAmount(%q) = %d, want %d", tt.in, got, tt.want)
            }
        })
    }
}
```

- Name cases in plain words; they appear in `go test -run` output.
- Messages follow `Func(input) = got, want want`. Use `t.Fatalf` when continuing makes
  no sense, `t.Errorf` otherwise.
- Check errors with `errors.Is` / `errors.As` in tests too, not string matching.
- Cover the error paths, not just the happy path. Every new branch that returns an error
  gets a case.
- Use the standard `testing` package. Use `t.Helper()` in helpers, `t.TempDir()` for
  files, `t.Cleanup` for teardown, and `httptest` for HTTP handlers. Do not add an
  assertion library unless the repo already uses one.
- Prefer hand-written fakes that satisfy a small interface over mocking frameworks.
- Call `t.Parallel()` only when cases share no mutable state.

## 3. Interfaces

- **Define interfaces where they are used**, in the consumer's package, not next to the
  implementation. The producer returns a concrete type.
- **Keep them small**: one to three methods, holding only what the consumer calls. A
  service that only reads orders depends on `interface{ Get(ctx, id) (Order, error) }`,
  not on a 15-method `Store`.
- Accept interfaces, return structs.
- Do not create an interface with a single implementation "for testability" until a test
  or a second implementation actually needs it.
- Name single-method interfaces after the method plus `-er` (`OrderGetter`) when that
  reads naturally.

## 4. Standard library first

Reach for the standard library before adding a dependency: `net/http` (with the Go 1.22+
`ServeMux` method and path patterns such as `"GET /orders/{id}"`), `encoding/json`,
`log/slog`, `context`, `errors`, `testing`, `httptest`, `slices`, `maps`. Add a module
only when the standard library genuinely cannot do the job or the repo already uses that
module for this purpose, and say why in your summary. Never add a dependency to save a
few lines.

## 5. `context.Context`

- `ctx context.Context` is the **first parameter** of any function that does I/O, blocks,
  or calls something that does. Name it `ctx`.
- Pass the caller's context down; do not create `context.Background()` in the middle of a
  request path. Handlers use `r.Context()`.
- Never store a context in a struct field.
- Whoever calls `context.WithTimeout` or `WithCancel` must `defer cancel()`.

## 6. Everyday style

- Code is `gofmt`-formatted, always. Imports are grouped standard library first.
- Short, clear names; receivers are one or two letters and consistent.
- Exported identifiers have doc comments starting with the identifier's name.
- Return early on errors to keep the happy path unindented.
- Make the zero value useful where reasonable.
- Every goroutine you start has a clear way to stop (a context or a closed channel).

## Before you say done

Only report the work as finished, fixed or passing after you have run these
three commands from the module root (the directory containing `go.mod`) and read their
output:

1. `gofmt -l .` - must print nothing. If it lists files, run `gofmt -w` on them and run
   it again.
2. `go vet ./...` - must exit cleanly. Fix what it reports.
3. `go test ./...` - must pass. Fix failures in your code; do not delete or weaken tests
   to make them pass.

Then report the results to the user: the command you ran and its actual output (or "no
output" for a clean `gofmt -l .`), including the `ok` lines from `go test`. If a command
cannot be run (no Go toolchain, no network for modules, a failure that predates your
change), say so plainly, show the error, and do not claim the work is done. Evidence,
not "should pass".

When the user asks "is it done?" or "can I merge this?", run the three checks again on
the current tree rather than relying on earlier runs.
