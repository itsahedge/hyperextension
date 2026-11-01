// Package hlfeed streams Hyperliquid's mark and mid prices for every market
// over one websocket subscription (fastAssetCtxs), reconnecting on its own.
//
// The feed counts as up only while prices arrive. A connection that stays
// open but goes quiet for StaleAfter is closed and redialed, and reported
// down, so nothing downstream acts on old prices.
package hlfeed

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

const (
	MainnetURL = "wss://api.hyperliquid.xyz/ws"
	TestnetURL = "wss://api.hyperliquid-testnet.xyz/ws"

	subscribeMsg = `{"method":"subscribe","subscription":{"type":"fastAssetCtxs"}}`
	pingMsg      = `{"method":"ping"}`
	// The snapshot of all ~2,000 markets is about 50 KB compressed.
	readLimit   = 16 << 20
	dialTimeout = 15 * time.Second
)

type Options struct {
	URL string
	// Hyperliquid closes a connection that has sent nothing for 60 s.
	PingEvery time.Duration
	// No price for this long means the feed is down. Prices normally
	// arrive about once a second.
	StaleAfter             time.Duration
	MinBackoff, MaxBackoff time.Duration
	// OnQuotes gets each update: the first after (re)connecting is a snapshot
	// of every market; later ones hold only markets that changed.
	OnQuotes func(quotes map[string]Quote, at time.Time)
	// OnStatus is called when the feed goes up (first price on a connection)
	// or down.
	OnStatus   func(Status)
	HTTPClient *http.Client
	Log        *slog.Logger
}

type Status struct {
	Connected bool      `json:"connected"`
	LastPrice time.Time `json:"lastPrice"`
	Err       string    `json:"error,omitempty"`
}

type Feed struct {
	o      Options
	mu     sync.Mutex
	status Status
}

func New(o Options) *Feed {
	if o.URL == "" {
		o.URL = MainnetURL
	}
	if o.PingEvery <= 0 {
		o.PingEvery = 30 * time.Second
	}
	if o.StaleAfter <= 0 {
		o.StaleAfter = 30 * time.Second
	}
	if o.MinBackoff <= 0 {
		o.MinBackoff = time.Second
	}
	if o.MaxBackoff < o.MinBackoff {
		o.MaxBackoff = 30 * time.Second
	}
	if o.OnQuotes == nil {
		o.OnQuotes = func(map[string]Quote, time.Time) {}
	}
	if o.OnStatus == nil {
		o.OnStatus = func(Status) {}
	}
	if o.Log == nil {
		o.Log = slog.New(slog.DiscardHandler)
	}
	return &Feed{o: o}
}

func (f *Feed) Status() Status {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.status
}

// Run connects and keeps reconnecting until ctx is done.
func (f *Feed) Run(ctx context.Context) {
	backoff := f.o.MinBackoff
	for {
		gotPrices, err := f.session(ctx)
		if ctx.Err() != nil {
			f.setDown("stopped")
			return
		}
		f.setDown(err.Error())
		f.o.Log.Warn("price feed down; reconnecting", "err", err, "in", backoff)
		if gotPrices {
			backoff = f.o.MinBackoff
		}
		select {
		case <-ctx.Done():
			f.setDown("stopped")
			return
		case <-time.After(backoff):
		}
		backoff = min(backoff*2, f.o.MaxBackoff)
	}
}

var errStale = errors.New("no prices")

// session runs one connection until it fails. gotPrices reports whether it
// delivered any.
func (f *Feed) session(ctx context.Context) (gotPrices bool, err error) {
	dctx, cancelDial := context.WithTimeout(ctx, dialTimeout)
	c, _, err := websocket.Dial(dctx, f.o.URL, &websocket.DialOptions{HTTPClient: f.o.HTTPClient})
	cancelDial()
	if err != nil {
		return false, fmt.Errorf("connecting: %w", err)
	}
	defer func() { _ = c.CloseNow() }()
	c.SetReadLimit(readLimit)

	sctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	if err := c.Write(sctx, websocket.MessageText, []byte(subscribeMsg)); err != nil {
		return false, fmt.Errorf("subscribing: %w", err)
	}

	var mu sync.Mutex
	last := time.Now() // the stale clock starts at connect
	go f.keepAlive(sctx, cancel, c, func() time.Time { mu.Lock(); defer mu.Unlock(); return last })

	for {
		_, b, err := c.Read(sctx)
		if err != nil {
			if cause := context.Cause(sctx); cause != nil && ctx.Err() == nil {
				err = cause
			}
			return gotPrices, err
		}
		var m struct {
			Channel string          `json:"channel"`
			Data    json.RawMessage `json:"data"`
		}
		if json.Unmarshal(b, &m) != nil || m.Channel != "fastAssetCtxs" {
			continue // pongs, subscription acks, anything unparseable
		}
		quotes, err := Decode(string(m.Data))
		if err != nil {
			f.o.Log.Warn("skipping a bad price update", "err", err)
			continue
		}
		now := time.Now()
		mu.Lock()
		last = now
		mu.Unlock()
		if !gotPrices {
			gotPrices = true
			f.setUp(now)
		} else {
			f.touch(now)
		}
		f.o.OnQuotes(quotes, now)
	}
}

// keepAlive pings on schedule and ends the session when prices stop.
func (f *Feed) keepAlive(ctx context.Context, cancel context.CancelCauseFunc, c *websocket.Conn, lastPrice func() time.Time) {
	ping := time.NewTicker(f.o.PingEvery)
	defer ping.Stop()
	check := time.NewTicker(max(f.o.StaleAfter/4, 10*time.Millisecond))
	defer check.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			if err := c.Write(ctx, websocket.MessageText, []byte(pingMsg)); err != nil {
				cancel(fmt.Errorf("ping: %w", err))
				return
			}
		case <-check.C:
			if quiet := time.Since(lastPrice()); quiet > f.o.StaleAfter {
				cancel(fmt.Errorf("%w for %s", errStale, quiet.Round(time.Second)))
				return
			}
		}
	}
}

func (f *Feed) setUp(at time.Time) {
	f.mu.Lock()
	f.status = Status{Connected: true, LastPrice: at}
	s := f.status
	f.mu.Unlock()
	f.o.Log.Info("price feed up")
	f.o.OnStatus(s)
}

func (f *Feed) touch(at time.Time) {
	f.mu.Lock()
	f.status.LastPrice = at
	f.mu.Unlock()
}

func (f *Feed) setDown(reason string) {
	f.mu.Lock()
	was := f.status.Connected
	f.status.Connected, f.status.Err = false, reason
	s := f.status
	f.mu.Unlock()
	if was {
		f.o.OnStatus(s)
	}
}
