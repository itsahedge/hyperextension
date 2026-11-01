//go:build live

package hlfeed

import (
	"context"
	"sync"
	"testing"
	"time"
)

// Reads Hyperliquid mainnet prices (public, read-only):
//
//	go test -tags live -run Live -v ./internal/hlfeed/
func TestLiveMainnet(t *testing.T) {
	var mu sync.Mutex
	updates, coins := 0, map[string]bool{}
	var btc Quote
	f := New(Options{OnQuotes: func(q map[string]Quote, _ time.Time) {
		mu.Lock()
		defer mu.Unlock()
		updates++
		for c, v := range q {
			coins[c] = true
			// Updates carry only the fields that changed.
			if c == "BTC" && v.HasMark {
				btc.Mark, btc.HasMark = v.Mark, true
			}
			if c == "BTC" && v.HasMid {
				btc.Mid, btc.HasMid = v.Mid, true
			}
		}
	}})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	f.Run(ctx)

	mu.Lock()
	defer mu.Unlock()
	t.Logf("%d updates, %d markets, BTC mark %v mid %v", updates, len(coins), btc.Mark, btc.Mid)
	if updates < 5 || len(coins) < 500 || !btc.HasMark || !btc.HasMid {
		t.Fatal("expected a snapshot of every market and about one update a second")
	}
	if d := btc.Mid/btc.Mark - 1; d > 0.01 || d < -0.01 {
		t.Fatalf("BTC mid and mark are more than 1%% apart: %v vs %v", btc.Mid, btc.Mark)
	}
}
