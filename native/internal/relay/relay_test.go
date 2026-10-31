package relay

import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// upstream is a TLS server that answers for "example.com"; route sends every
// relayed connection to it, the way the tunnel would reach the real host.
func upstream(t *testing.T, h http.Handler) *staticRouter {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	pool := x509.NewCertPool()
	pool.AddCert(srv.Certificate())
	return &staticRouter{rt: &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
		},
		TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
	}}
}

type staticRouter struct {
	rt  http.RoundTripper
	err error
}

func (s *staticRouter) RoundTripper() (http.RoundTripper, error) { return s.rt, s.err }

func newRelay(r Router) *Relay {
	return New("/relay/", []string{"example.com"}, r, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestForwardsToTheAllowedHost(t *testing.T) {
	var got *http.Request
	var body string
	router := upstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.Header().Set("Set-Cookie", "track=1")
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	req := httptest.NewRequest(http.MethodPost, "/relay/example.com/info?x=1", strings.NewReader(`{"type":"meta"}`))
	for k, v := range map[string]string{
		"Content-Type":         "application/json",
		"Cookie":               "session=secret",
		"Origin":               "https://mini.example.ts.net:8443",
		"Referer":              "https://mini.example.ts.net:8443/",
		"Tailscale-User-Login": "don@example.com",
		"Tailscale-User-Name":  "Don",
		"X-Forwarded-For":      "100.64.0.7",
		"Forwarded":            "for=100.64.0.7",
	} {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	newRelay(router).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK || rec.Body.String() != `{"ok":true}` {
		t.Fatalf("response %d %q", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Error("upstream Set-Cookie passed through")
	}
	if got.Host != "example.com" || got.URL.Path != "/info" || got.URL.RawQuery != "x=1" || body != `{"type":"meta"}` {
		t.Fatalf("upstream saw host %q path %q query %q body %q", got.Host, got.URL.Path, got.URL.RawQuery, body)
	}
	if got.Header.Get("Content-Type") != "application/json" {
		t.Error("Content-Type was dropped")
	}
	for _, h := range []string{"Cookie", "Origin", "Referer", "Tailscale-User-Login", "Tailscale-User-Name", "X-Forwarded-For", "Forwarded"} {
		if v := got.Header.Get(h); v != "" {
			t.Errorf("upstream received %s: %q", h, v)
		}
	}
}

func TestRefusesHostsOutsideTheAllowlist(t *testing.T) {
	router := upstream(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("upstream reached") }))
	for _, path := range []string{"/relay/evil.com/info", "/relay/EXAMPLE.COM.evil.com/", "/relay/example.com:8443/info", "/relay/", "/relay/example.com@evil.com/"} {
		rec := httptest.NewRecorder()
		newRelay(router).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d, want 403 or 404", path, rec.Code)
		}
	}
}

// The kill switch: when the router says the tunnel is down, nothing is sent.
func TestBlockedRouterSendsNothing(t *testing.T) {
	router := upstream(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("upstream reached") }))
	router.err = errors.New("VPN is on but not connected")
	rec := httptest.NewRecorder()
	newRelay(router).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/relay/example.com/info", nil))
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "not connected") {
		t.Fatalf("%d %q", rec.Code, rec.Body.String())
	}
}

func TestLimitsRequestBodies(t *testing.T) {
	router := upstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			t.Log("upstream read:", err)
		}
	}))
	rec := httptest.NewRecorder()
	big := strings.NewReader(strings.Repeat("x", MaxBody+1))
	newRelay(router).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/relay/example.com/exchange", big))
	if rec.Code == http.StatusOK {
		t.Fatal("oversized body relayed")
	}
}

// Hyperliquid's feeds are websockets: the relay must pass an Upgrade through
// and then copy bytes both ways.
func TestRelaysUpgrades(t *testing.T) {
	router := upstream(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Upgrade") != "websocket" || r.URL.Path != "/ws" {
			http.Error(w, "want an upgrade to /ws", http.StatusBadRequest)
			return
		}
		conn, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer func() { _ = conn.Close() }()
		_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = rw.Flush()
		line, _ := rw.ReadString('\n')
		_, _ = rw.WriteString("echo " + line)
		_ = rw.Flush()
	}))
	front := httptest.NewServer(newRelay(router))
	t.Cleanup(front.Close)

	conn, err := net.Dial("tcp", front.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close() }()
	_, _ = io.WriteString(conn, "GET /relay/example.com/ws HTTP/1.1\r\nHost: front\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status %d", resp.StatusCode)
	}
	_, _ = io.WriteString(conn, "hello\n")
	line, err := br.ReadString('\n')
	if err != nil || line != "echo hello\n" {
		t.Fatalf("got %q, %v", line, err)
	}
}
