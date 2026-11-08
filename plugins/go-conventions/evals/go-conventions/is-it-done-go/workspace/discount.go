package pricing

import "errors"

// ErrInvalidPercent is returned when a discount percentage is outside 0-100.
var ErrInvalidPercent = errors.New("percent must be between 0 and 100")

// ApplyDiscount returns the price in pence after taking percent off.
func ApplyDiscount(pence int64, percent int) (int64, error) {
    if percent < 0 || percent > 100 {
        return 0, ErrInvalidPercent
    }
    return pence * int64(100-percent) / 100, nil
}
