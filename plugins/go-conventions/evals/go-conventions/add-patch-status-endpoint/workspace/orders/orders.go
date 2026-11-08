// Package orders stores and serves customer orders.
package orders

import (
	"context"
	"errors"
	"sync"
)

// ErrNotFound is returned when no order has the requested ID.
var ErrNotFound = errors.New("order not found")

// Order is a customer order.
type Order struct {
	ID       string `json:"id"`
	Customer string `json:"customer"`
	Status   string `json:"status"`
}

// MemoryStore keeps orders in memory.
type MemoryStore struct {
	mu     sync.Mutex
	orders map[string]Order
}

// NewMemoryStore returns a store holding the given orders.
func NewMemoryStore(orders ...Order) *MemoryStore {
	m := &MemoryStore{orders: make(map[string]Order)}
	for _, o := range orders {
		m.orders[o.ID] = o
	}
	return m
}

// Get returns the order with the given ID, or ErrNotFound.
func (m *MemoryStore) Get(ctx context.Context, id string) (Order, error) {
	if err := ctx.Err(); err != nil {
		return Order{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	return o, nil
}

// SetStatus updates the status of an existing order, or returns ErrNotFound.
func (m *MemoryStore) SetStatus(ctx context.Context, id, status string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[id]
	if !ok {
		return ErrNotFound
	}
	o.Status = status
	m.orders[id] = o
	return nil
}
