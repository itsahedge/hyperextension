package hlfeed

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// fakeHL is a websocket server speaking enough of Hyperliquid's protocol:
// each connection is handed to the test's script after the subscribe.
type fakeHL struct {
	t      *testing.T
	srv    *httptest.Server
	conns  atomic.Int32
	mu     sync.Mutex
	subs   []string
	pings  atomic.Int32
	script func(ctx context.Context, n int, c *websocket.Conn)
}

func newFakeHL(t *testing.T, script func(ctx context.Context, n int, c *websocket.Conn)) *fakeHL {
	f := &fakeHL{t: t, script: script}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer func() { _ = c.CloseNow() }()
		n := int(f.conns.Add(1))
		ctx := r.Context()
		// Read the subscribe, then keep reading pings in the background.
		_, msg, err := c.Read(ctx)
		if err != nil {
			return
		}
		f.mu.Lock()
		f.subs = append(f.subs, string(msg))
		f.mu.Unlock()
		go func() {
			for {
				_, m, err := c.Read(ctx)
				if err != nil {
					return
				}
				if strings.Contains(string(m), `"ping"`) {
					f.pings.Add(1)
				}
			}
		}()
		f.script(ctx, n, c)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeHL) url() string { return "ws" + strings.TrimPrefix(f.srv.URL, "http") }

func sendCtxs(t *testing.T, ctx context.Context, c *websocket.Conn, payload string) {
	t.Helper()
	msg := `{"channel":"fastAssetCtxs","data":` + encodeForTest(t, payload) + `}`
	_ = c.Write(ctx, websocket.MessageText, []byte(msg))
}

type recorder struct {
	mu       sync.Mutex
	quotes   []map[string]Quote
	statuses []Status
	gotQuote chan struct{}
}

func newRecorder() *recorder { return &recorder{gotQuote: make(chan struct{}, 100)} }

func (r *recorder) opts(url string) Options {
	return Options{
		URL:        url,
		PingEvery:  50 * time.Millisecond,
		StaleAfter: 300 * time.Millisecond,
		MinBackoff: 10 * time.Millisecond,
		MaxBackoff: 50 * time.Millisecond,
		OnQuotes: func(q map[string]Quote, _ time.Time) {
			r.mu.Lock()
			r.quotes = append(r.quotes, q)
			r.mu.Unlock()
			r.gotQuote <- struct{}{}
		},
		OnStatus: func(s Status) {
			r.mu.Lock()
			r.statuses = append(r.statuses, s)
			r.mu.Unlock()
		},
	}
}

func (r *recorder) waitQuotes(t *testing.T, n int) {
	t.Helper()
	for i := 0; i < n; i++ {
		select {
		case <-r.gotQuote:
		case <-time.After(3 * time.Second):
			t.Fatalf("timed out waiting for quote update %d", i+1)
		}
	}
}

func (r *recorder) connectedTransitions() (up, down int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, s := range r.statuses {
		if s.Connected {
			up++
		} else {
			down++
		}
	}
	return
}

func run(t *testing.T, o Options) (cancel func()) {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { New(o).Run(ctx); close(done) }()
	return func() {
		stop()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Fatal("Run did not return after cancel")
		}
	}
}

func TestSubscribesAndDeliversQuotes(t *testing.T) {
	hl := newFakeHL(t, func(ctx context.Context, _ int, c *websocket.Conn) {
		sendCtxs(t, ctx, c, `{"BTC":{"markPx":"100","midPx":"100.5"},"ETH":{"markPx":"10"}}`)
		sendCtxs(t, ctx, c, `{"BTC":{"markPx":"101"}}`)
		<-ctx.Done()
	})
	rec := newRecorder()
	stop := run(t, rec.opts(hl.url()))
	defer stop()
	rec.waitQuotes(t, 2)

	var sub struct {
		Method       string
		Subscription struct{ Type string }
	}
	hl.mu.Lock()
	_ = json.Unmarshal([]byte(hl.subs[0]), &sub)
	hl.mu.Unlock()
	if sub.Method != "subscribe" || sub.Subscription.Type != "fastAssetCtxs" {
		t.Fatalf("subscribe message %+v", sub)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if rec.quotes[0]["BTC"] != (Quote{Mark: 100, HasMark: true, Mid: 100.5, HasMid: true}) || rec.quotes[1]["BTC"].Mark != 101 {
		t.Fatalf("quotes %+v", rec.quotes)
	}
	if len(rec.statuses) == 0 || !rec.statuses[0].Connected {
		t.Fatalf("statuses %+v", rec.statuses)
	}
}

func TestReconnectsAndResubscribesAfterClose(t *testing.T) {
	hl := newFakeHL(t, func(ctx context.Context, n int, c *websocket.Conn) {
		sendCtxs(t, ctx, c, `{"BTC":{"markPx":"100"}}`)
		if n == 1 {
			_ = c.Close(websocket.StatusGoingAway, "restart")
			return
		}
		<-ctx.Done()
	})
	rec := newRecorder()
	stop := run(t, rec.opts(hl.url()))
	defer stop()
	rec.waitQuotes(t, 2)
	if hl.conns.Load() < 2 {
		t.Fatalf("connections %d", hl.conns.Load())
	}
	hl.mu.Lock()
	subs := len(hl.subs)
	hl.mu.Unlock()
	if subs < 2 {
		t.Fatalf("did not resubscribe: %d subscribes", subs)
	}
	if up, down := rec.connectedTransitions(); up < 2 || down < 1 {
		t.Fatalf("status transitions up=%d down=%d", up, down)
	}
}

// A connection that stays open but stops sending prices is as bad as a
// closed one: report it down and reconnect.
func TestStaleFeedIsReportedAndReconnected(t *testing.T) {
	hl := newFakeHL(t, func(ctx context.Context, n int, c *websocket.Conn) {
		sendCtxs(t, ctx, c, `{"BTC":{"markPx":"100"}}`)
		<-ctx.Done() // then silence
	})
	rec := newRecorder()
	stop := run(t, rec.opts(hl.url()))
	defer stop()
	rec.waitQuotes(t, 1)
	deadline := time.Now().Add(3 * time.Second)
	for hl.conns.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if hl.conns.Load() < 2 {
		t.Fatal("did not reconnect a silent feed")
	}
	if _, down := rec.connectedTransitions(); down < 1 {
		t.Fatal("did not report the silent feed as down")
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for _, s := range rec.statuses {
		if !s.Connected && s.Err == "" {
			t.Errorf("down status without a reason: %+v", s)
		}
	}
}

// Pongs and other channels keep the connection open but do not count as
// prices: only fastAssetCtxs data proves the feed is fresh.
func TestOnlyPricesCountAsFresh(t *testing.T) {
	hl := newFakeHL(t, func(ctx context.Context, n int, c *websocket.Conn) {
		sendCtxs(t, ctx, c, `{"BTC":{"markPx":"100"}}`)
		tick := time.NewTicker(20 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				_ = c.Write(ctx, websocket.MessageText, []byte(`{"channel":"pong"}`))
			}
		}
	})
	rec := newRecorder()
	stop := run(t, rec.opts(hl.url()))
	defer stop()
	rec.waitQuotes(t, 1)
	deadline := time.Now().Add(3 * time.Second)
	for hl.conns.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if hl.conns.Load() < 2 {
		t.Fatal("pongs kept a price-less feed alive")
	}
}

func TestBadPayloadIsSkipped(t *testing.T) {
	hl := newFakeHL(t, func(ctx context.Context, _ int, c *websocket.Conn) {
		_ = c.Write(ctx, websocket.MessageText, []byte(`{"channel":"fastAssetCtxs","data":"!!!"}`))
		_ = c.Write(ctx, websocket.MessageText, []byte(`not json`))
		sendCtxs(t, ctx, c, `{"BTC":{"markPx":"100"}}`)
		<-ctx.Done()
	})
	rec := newRecorder()
	stop := run(t, rec.opts(hl.url()))
	defer stop()
	rec.waitQuotes(t, 1)
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.quotes) != 1 || rec.quotes[0]["BTC"].Mark != 100 {
		t.Fatalf("quotes %+v", rec.quotes)
	}
	if hl.conns.Load() != 1 {
		t.Fatalf("a bad message dropped the connection: %d connections", hl.conns.Load())
	}
}

func TestSendsPings(t *testing.T) {
	hl := newFakeHL(t, func(ctx context.Context, _ int, c *websocket.Conn) {
		tick := time.NewTicker(20 * time.Millisecond)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				sendCtxs(t, ctx, c, `{"BTC":{"markPx":"100"}}`)
			}
		}
	})
	rec := newRecorder()
	stop := run(t, rec.opts(hl.url()))
	defer stop()
	time.Sleep(300 * time.Millisecond)
	if hl.pings.Load() < 2 {
		t.Fatalf("pings %d", hl.pings.Load())
	}
}

func TestStatusReflectsTheConnection(t *testing.T) {
	hl := newFakeHL(t, func(ctx context.Context, _ int, c *websocket.Conn) {
		sendCtxs(t, ctx, c, `{"BTC":{"markPx":"100"}}`)
		<-ctx.Done()
	})
	rec := newRecorder()
	o := rec.opts(hl.url())
	o.StaleAfter = 5 * time.Second
	f := New(o)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { f.Run(ctx); close(done) }()
	rec.waitQuotes(t, 1)
	if s := f.Status(); !s.Connected || s.LastPrice.IsZero() {
		t.Fatalf("status %+v", s)
	}
	cancel()
	<-done
	if s := f.Status(); s.Connected {
		t.Fatalf("status after stop %+v", s)
	}
}
