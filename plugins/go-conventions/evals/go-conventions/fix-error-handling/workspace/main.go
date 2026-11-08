package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
)

var ErrNotFound = errors.New("item not found")

type Item struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Stock int    `json:"stock"`
}

type Store struct {
	path string
}

func (s *Store) load() ([]Item, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, fmt.Errorf("error reading file: %v", err)
	}
	var items []Item
	json.Unmarshal(data, &items)
	return items, nil
}

func (s *Store) Get(id int) (Item, error) {
	items, err := s.load()
	if err != nil {
		log.Printf("load failed: %v", err)
		return Item{}, err
	}
	for _, it := range items {
		if it.ID == id {
			return it, nil
		}
	}
	return Item{}, fmt.Errorf("item %d: %s", id, ErrNotFound)
}

func itemHandler(s *Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, _ := strconv.Atoi(r.PathValue("id"))
		it, err := s.Get(id)
		if err != nil {
			if err.Error() == "item not found" {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(it)
	}
}

func main() {
	s := &Store{path: "items.json"}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /items/{id}", itemHandler(s))
	log.Fatal(http.ListenAndServe(":8080", mux))
}
