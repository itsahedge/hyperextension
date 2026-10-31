package webhost

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/itsahedge/hyperextension/native/internal/webvpn"
)

const login = "don@example.com"

type fakeVPN struct {
	st     webvpn.State
	upLoc  *webvpn.Location
	downs  int
	route  http.RoundTripper
	routeE error
}

func (f *fakeVPN) State() webvpn.State { return f.st }
func (f *fakeVPN) Up(_ context.Context, loc *webvpn.Location) webvpn.State {
	f.upLoc = loc
	f.st.Enabled = true
	return f.st
}
func (f *fakeVPN) Down() webvpn.State {
	f.downs++
	f.st.Enabled = false
	return f.st
}
func (f *fakeVPN) RoundTripper() (http.RoundTripper, error) { return f.route, f.routeE }

func newHost(t *testing.T, v *fakeVPN) http.Handler {
	t.Helper()
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, "index.html"), []byte("<!doctype html><title>app</title>"), 0o600))
	must(t, os.MkdirAll(filepath.Join(dir, "assets"), 0o700))
	must(t, os.WriteFile(filepath.Join(dir, "assets", "app-abc.js"), []byte("console.log(1)"), 0o600))
	return New(Options{
		StaticDir:     dir,
		AllowedLogins: []string{login},
		VPN:           v,
		Servers:       func(context.Context) ([]webvpn.Location, error) { return []webvpn.Location{{City: "Zurich"}}, nil },
		Log:           slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func do(h http.Handler, method, path string, headers map[string]string, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var me = map[string]string{"Tailscale-User-Login": login}

func TestOnlyTheAllowedTailscaleLoginGetsIn(t *testing.T) {
	h := newHost(t, &fakeVPN{})
	for _, path := range []string{"/", "/api/vpn/state", "/relay/api.hyperliquid.xyz/info"} {
		if rec := do(h, http.MethodGet, path, nil, ""); rec.Code != http.StatusForbidden {
			t.Errorf("%s without a login: %d", path, rec.Code)
		}
		if rec := do(h, http.MethodGet, path, map[string]string{"Tailscale-User-Login": "eve@example.com"}, ""); rec.Code != http.StatusForbidden {
			t.Errorf("%s as another user: %d", path, rec.Code)
		}
	}
	if rec := do(h, http.MethodGet, "/", me, ""); rec.Code != http.StatusOK {
		t.Fatalf("index as the allowed user: %d", rec.Code)
	}
}

// Tailscale adds the identity header to any tailnet request, including one a
// malicious site makes from the user's browser; the browser's Sec-Fetch-Site
// header tells them apart.
func TestRefusesCrossSiteRequests(t *testing.T) {
	v := &fakeVPN{}
	h := newHost(t, v)
	cross := map[string]string{"Tailscale-User-Login": login, "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json"}
	for _, path := range []string{"/api/vpn/down", "/relay/api.hyperliquid.xyz/exchange"} {
		if rec := do(h, http.MethodPost, path, cross, "{}"); rec.Code != http.StatusForbidden {
			t.Errorf("cross-site %s: %d", path, rec.Code)
		}
	}
	if v.downs != 0 {
		t.Fatal("a cross-site request turned the VPN off")
	}
	same := map[string]string{"Tailscale-User-Login": login, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json"}
	if rec := do(h, http.MethodPost, "/api/vpn/down", same, "{}"); rec.Code != http.StatusOK || v.downs != 1 {
		t.Fatalf("same-origin down: %d, downs %d", rec.Code, v.downs)
	}
}

func TestVPNAPI(t *testing.T) {
	v := &fakeVPN{st: webvpn.State{Configured: true}}
	h := newHost(t, v)
	json := map[string]string{"Tailscale-User-Login": login, "Content-Type": "application/json"}

	rec := do(h, http.MethodGet, "/api/vpn/state", me, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"configured":true`) {
		t.Fatalf("state: %d %s", rec.Code, rec.Body.String())
	}
	// A form post (no preflight) cannot drive the switch.
	if rec := do(h, http.MethodPost, "/api/vpn/up", map[string]string{"Tailscale-User-Login": login, "Content-Type": "text/plain"}, "{}"); rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("text/plain up: %d", rec.Code)
	}
	if rec := do(h, http.MethodGet, "/api/vpn/up", me, ""); rec.Code == http.StatusOK || v.st.Enabled {
		t.Fatalf("GET up: %d, enabled %v", rec.Code, v.st.Enabled)
	}
	rec = do(h, http.MethodPost, "/api/vpn/up", json, `{"location":{"city":"Zurich","host":"185.212.170.2","publicKey":"k"}}`)
	if rec.Code != http.StatusOK || v.upLoc == nil || v.upLoc.Host != "185.212.170.2" || !strings.Contains(rec.Body.String(), `"enabled":true`) {
		t.Fatalf("up: %d %s %+v", rec.Code, rec.Body.String(), v.upLoc)
	}
	if rec := do(h, http.MethodPost, "/api/vpn/up", json, `{}`); rec.Code != http.StatusOK || v.upLoc != nil {
		t.Fatalf("up without a location: %d %+v", rec.Code, v.upLoc)
	}
	rec = do(h, http.MethodGet, "/api/vpn/servers", me, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "Zurich") {
		t.Fatalf("servers: %d %s", rec.Code, rec.Body.String())
	}
}

func TestStaticFilesAndHeaders(t *testing.T) {
	h := newHost(t, &fakeVPN{})
	rec := do(h, http.MethodGet, "/", me, "")
	if !strings.Contains(rec.Body.String(), "<title>app</title>") {
		t.Fatalf("index: %q", rec.Body.String())
	}
	csp := rec.Header().Get("Content-Security-Policy")
	for _, want := range []string{"connect-src 'self'", "script-src 'self'", "frame-ancestors 'none'"} {
		if !strings.Contains(csp, want) {
			t.Errorf("CSP %q lacks %q", csp, want)
		}
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("index headers %v", rec.Header())
	}
	rec = do(h, http.MethodGet, "/assets/app-abc.js", me, "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("asset: %d %v", rec.Code, rec.Header())
	}
	// "/../index.html" is cleaned by the mux into a redirect to "/index.html".
	for _, path := range []string{"/assets/", "/missing.js", "/../index.html", "/api/vpn/nope"} {
		if rec := do(h, http.MethodGet, path, me, ""); rec.Code != http.StatusNotFound && rec.Code != http.StatusTemporaryRedirect {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
}

// The relay may reach exactly the origins the app is built to talk to.
func TestRelayHostsMatchApiOrigins(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "src", "apiOrigins.ts"))
	must(t, err)
	var want []string
	for _, m := range regexp.MustCompile(`"https://([a-z0-9.-]+)"`).FindAllStringSubmatch(string(src), -1) {
		want = append(want, m[1])
	}
	got := slices.Clone(RelayHosts)
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("RelayHosts %v, src/apiOrigins.ts %v", got, want)
	}
}

func TestStateJSONMatchesTheClient(t *testing.T) {
	b, err := json.Marshal(webvpn.State{Enabled: true, Connected: true, Exit: nil})
	must(t, err)
	if !strings.Contains(string(b), `"enabled":true`) || !strings.Contains(string(b), `"connected":true`) || !strings.Contains(string(b), `"connecting":false`) {
		t.Fatal(string(b))
	}
}

func TestLogPathDropsRelayDetails(t *testing.T) {
	for in, want := range map[string]string{
		"/relay/api.hyperunit.xyz/gen/bitcoin/hyperliquid/btc/0xabc": "/relay/api.hyperunit.xyz",
		"/relay/api.hyperliquid.xyz":                                 "/relay/api.hyperliquid.xyz",
		"/api/vpn/state":                                             "/api/vpn/state",
	} {
		if got := logPath(in); got != want {
			t.Errorf("logPath(%q) = %q, want %q", in, got, want)
		}
	}
}
