# Go conventions: worked examples

## A typed error checked with errors.As

```go
package orders

import (
    "errors"
    "fmt"
)

// ErrNotFound is returned when no order has the requested ID.
var ErrNotFound = errors.New("order not found")

// ValidationError reports which field of an order is invalid.
type ValidationError struct {
    Field  string
    Reason string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("invalid %s: %s", e.Field, e.Reason)
}

func validate(o Order) error {
    if o.Quantity <= 0 {
        return &ValidationError{Field: "quantity", Reason: "must be positive"}
    }
    return nil
}
```

The caller decides what each error means at its boundary:

```go
func (h *Handler) createOrder(w http.ResponseWriter, r *http.Request) {
    o, err := h.svc.Create(r.Context(), decode(r))
    var verr *orders.ValidationError
    switch {
    case errors.As(err, &verr):
        http.Error(w, verr.Error(), http.StatusBadRequest)
        return
    case errors.Is(err, orders.ErrNotFound):
        http.Error(w, "not found", http.StatusNotFound)
        return
    case err != nil:
        h.log.ErrorContext(r.Context(), "create order", "err", err)
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    writeJSON(w, http.StatusCreated, o)
}
```

## A small consumer-side interface with a fake

```go
package billing

// orderGetter is the only part of the order store that billing needs.
type orderGetter interface {
    Get(ctx context.Context, id string) (orders.Order, error)
}

type Service struct {
    orders orderGetter
}

func (s *Service) Invoice(ctx context.Context, id string) (Invoice, error) {
    o, err := s.orders.Get(ctx, id)
    if err != nil {
        return Invoice{}, fmt.Errorf("invoice order %s: %w", id, err)
    }
    return newInvoice(o), nil
}
```

```go
type fakeOrders struct {
    order orders.Order
    err   error
}

func (f fakeOrders) Get(context.Context, string) (orders.Order, error) {
    return f.order, f.err
}

func TestServiceInvoice(t *testing.T) {
    tests := []struct {
        name    string
        orders  fakeOrders
        wantErr error
    }{
        {name: "existing order", orders: fakeOrders{order: orders.Order{ID: "42", Quantity: 1}}},
        {name: "missing order", orders: fakeOrders{err: orders.ErrNotFound}, wantErr: orders.ErrNotFound},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            s := &Service{orders: tt.orders}
            _, err := s.Invoice(context.Background(), "42")
            if !errors.Is(err, tt.wantErr) {
                t.Fatalf("Invoice() error = %v, want %v", err, tt.wantErr)
            }
        })
    }
}
```

## A table-driven HTTP handler test

```go
func TestGetOrder(t *testing.T) {
    tests := []struct {
        name     string
        path     string
        store    fakeOrders
        wantCode int
    }{
        {name: "found", path: "/orders/42", store: fakeOrders{order: orders.Order{ID: "42"}}, wantCode: http.StatusOK},
        {name: "not found", path: "/orders/7", store: fakeOrders{err: orders.ErrNotFound}, wantCode: http.StatusNotFound},
        {name: "store failure", path: "/orders/42", store: fakeOrders{err: errors.New("db down")}, wantCode: http.StatusInternalServerError},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            mux := http.NewServeMux()
            NewHandler(tt.store).Register(mux)
            rec := httptest.NewRecorder()
            mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, nil))
            if rec.Code != tt.wantCode {
                t.Errorf("GET %s status = %d, want %d", tt.path, rec.Code, tt.wantCode)
            }
        })
    }
}
```

## Reporting the checks

A good "done" message ends with the evidence, for example:

```
$ gofmt -l .
(no output)
$ go vet ./...
(no output)
$ go test ./...
ok      example.com/shop/internal/orders    0.012s
ok      example.com/shop/internal/billing   0.009s
```
