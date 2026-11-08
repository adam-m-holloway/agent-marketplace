package pricing

import (
	"errors"
	"testing"
)

func TestApplyDiscount(t *testing.T) {
	tests := []struct {
		name    string
		pence   int64
		percent int
		want    int64
		wantErr error
	}{
		{name: "no discount", pence: 1000, percent: 0, want: 1000},
		{name: "ten percent", pence: 1000, percent: 10, want: 900},
		{name: "free", pence: 1000, percent: 100, want: 0},
		{name: "over 100", pence: 1000, percent: 101, wantErr: ErrInvalidPercent},
		{name: "half price odd pence", pence: 999, percent: 50, want: 500},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ApplyDiscount(tt.pence, tt.percent)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("ApplyDiscount(%d, %d) error = %v, want %v", tt.pence, tt.percent, err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("ApplyDiscount(%d, %d) = %d, want %d", tt.pence, tt.percent, got, tt.want)
			}
		})
	}
}
