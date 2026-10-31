package webvpn

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/itsahedge/hyperextension/native/internal/vpn/vpntest"
)

const tunnelOnly = "http://" + vpntest.ServerIP + "/json"

// rig is a WireGuard peer whose ipinfo answers inside the tunnel only, and a
// "direct" ipinfo that reports the home IP.
func rig(t *testing.T, tunnelIP string) (conf string, opts Options) {
	t.Helper()
	conf = vpntest.Server(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprintf(w, `{"ip":%q,"city":"Tunnelville","country":"ZZ"}`, tunnelIP)
	}))
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"ip":"203.0.113.9","city":"Home","country":"US"}`)
	}))
	t.Cleanup(direct.Close)
	return conf, Options{
		StatePath:       filepath.Join(t.TempDir(), "web-vpn.json"),
		TunnelIPInfoURL: tunnelOnly,
		DirectIPInfoURL: direct.URL,
		Log:             slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func newManager(t *testing.T, opts Options) *Manager {
	t.Helper()
	m, err := New(opts)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(m.Close)
	return m
}

// get fetches the tunnel-only ipinfo with the manager's current route.
func get(m *Manager) (string, error) {
	rt, err := m.RoundTripper()
	if err != nil {
		return "", err
	}
	res, err := (&http.Client{Transport: rt}).Get(tunnelOnly)
	if err != nil {
		return "", err
	}
	defer func() { _ = res.Body.Close() }()
	b, err := io.ReadAll(res.Body)
	return string(b), err
}

func TestOffSendsDirect(t *testing.T) {
	conf, opts := rig(t, vpntest.ServerIP)
	opts.Conf = conf
	m := newManager(t, opts)
	st := m.State()
	if st.Enabled || st.Connected || !st.Configured || st.Config == nil || st.Config.Endpoint == "" {
		t.Fatalf("initial state %+v", st)
	}
	rt, err := m.RoundTripper()
	if err != nil || rt == nil {
		t.Fatalf("off: %v", err)
	}
}

func TestUpRoutesThroughTheTunnel(t *testing.T) {
	conf, opts := rig(t, vpntest.ServerIP)
	opts.Conf = conf
	m := newManager(t, opts)
	st := m.Up(context.Background(), nil)
	if !st.Enabled || !st.Connected || st.Error != "" || st.Exit == nil || st.Exit.IP != vpntest.ServerIP || st.Direct.IP != "203.0.113.9" {
		t.Fatalf("up: %+v", st)
	}
	// ServerIP exists only inside the tunnel, so reaching it proves the route.
	body, err := get(m)
	if err != nil || !strings.Contains(body, "Tunnelville") {
		t.Fatalf("through the tunnel: %q, %v", body, err)
	}
	if st := m.State(); st.LastHandshake == 0 || st.Unhealthy != "" {
		t.Fatalf("health %+v", st)
	}
}

// The kill switch: on but not connected means nothing leaves.
func TestOnButDownBlocks(t *testing.T) {
	conf, opts := rig(t, "203.0.113.9") // tunnel exits from the home IP: refused
	opts.Conf = conf
	m := newManager(t, opts)
	st := m.Up(context.Background(), nil)
	if !st.Enabled || st.Connected || !strings.Contains(st.Error, "not a VPN route") {
		t.Fatalf("up: %+v", st)
	}
	if _, err := m.RoundTripper(); err == nil {
		t.Fatal("on but down still routes")
	}
}

func TestNotConfigured(t *testing.T) {
	_, opts := rig(t, vpntest.ServerIP)
	m := newManager(t, opts)
	if st := m.State(); st.Configured {
		t.Fatalf("state %+v", st)
	}
	st := m.Up(context.Background(), nil)
	if st.Connected || !strings.Contains(st.Error, "no WireGuard config") {
		t.Fatalf("up: %+v", st)
	}
	if _, err := m.RoundTripper(); err == nil {
		t.Fatal("on without a config still routes")
	}
	if st := m.Down(); st.Enabled {
		t.Fatal("down left it on")
	}
	if _, err := m.RoundTripper(); err != nil {
		t.Fatalf("off: %v", err)
	}
}

func TestRejectsAnInvalidConfig(t *testing.T) {
	_, opts := rig(t, vpntest.ServerIP)
	opts.Conf = "[Interface]\nPrivateKey = nope\n"
	if _, err := New(opts); err == nil {
		t.Fatal("invalid config accepted")
	}
}

func TestDownPersistsAndRestartKeepsTheSwitch(t *testing.T) {
	conf, opts := rig(t, vpntest.ServerIP)
	opts.Conf = conf
	m := newManager(t, opts)
	if st := m.Up(context.Background(), nil); !st.Connected {
		t.Fatalf("up: %+v", st)
	}
	m.Close()

	// Restarted while on: blocked until it reconnects, never direct.
	again := newManager(t, opts)
	if st := again.State(); !st.Enabled || st.Connected {
		t.Fatalf("after restart %+v", st)
	}
	if _, err := again.RoundTripper(); err == nil {
		t.Fatal("restart while on routed before the tunnel was up")
	}
	again.Reconcile(context.Background())
	if body, err := get(again); err != nil || !strings.Contains(body, "Tunnelville") {
		t.Fatalf("after reconcile: %q, %v", body, err)
	}

	if st := again.Down(); st.Enabled || st.Connected {
		t.Fatalf("down: %+v", st)
	}
	again.Close()
	if st := newManager(t, opts).State(); st.Enabled {
		t.Fatal("off did not persist")
	}
}

func TestUpWithAnInvalidServerKeepsItBlocked(t *testing.T) {
	conf, opts := rig(t, vpntest.ServerIP)
	opts.Conf = conf
	m := newManager(t, opts)
	st := m.Up(context.Background(), &Location{Host: "not-an-ip", PublicKey: "x"})
	if st.Connected || st.Error == "" {
		t.Fatalf("up: %+v", st)
	}
	if _, err := m.RoundTripper(); err == nil {
		t.Fatal("failed switch still routes")
	}
}
