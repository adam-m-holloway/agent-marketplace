package orders

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

type orderGetter interface {
	Get(ctx context.Context, id string) (Order, error)
}

// Handler serves the orders HTTP API.
type Handler struct {
	store orderGetter
}

// NewHandler returns a Handler backed by store.
func NewHandler(store orderGetter) *Handler {
	return &Handler{store: store}
}

// Register adds the order routes to mux.
func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /orders/{id}", h.getOrder)
}

func (h *Handler) getOrder(w http.ResponseWriter, r *http.Request) {
	o, err := h.store.Get(r.Context(), r.PathValue("id"))
	if errors.Is(err, ErrNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(o)
}
