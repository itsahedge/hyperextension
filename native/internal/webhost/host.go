// Package webhost is the Mac mini side of the web app: it serves the static
// build, the VPN switch (/api/vpn/*) and the API relay (/relay/<host>/...),
// behind `tailscale serve` on loopback.
//
// Every request must carry the Tailscale-User-Login of an allowed user (set
// by tailscale serve for tailnet traffic) and, when a browser says where it
// came from, be same-origin: Tailscale adds the identity header to any
// tailnet request, including one a malicious site makes from the user's
// browser. Anything else on this machine can reach the loopback port and set
// the header itself; the host does not defend against local processes.
package webhost

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/itsahedge/hyperextension/native/internal/relay"
	"github.com/itsahedge/hyperextension/native/internal/webvpn"
)

// RelayHosts are the hostnames of src/apiOrigins.ts (a test keeps them equal).
var RelayHosts = []string{
	"api.hyperliquid.xyz",
	"api.hyperliquid-testnet.xyz",
	"arb1.arbitrum.io",
	"sepolia-rollup.arbitrum.io",
	"iris-api.circle.com",
	"iris-api-sandbox.circle.com",
	"api.hyperunit.xyz",
	"api.hyperunit-testnet.xyz",
}

// The page may only talk to this host; the relay reaches the APIs.
const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
	"img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

type VPN interface {
	relay.Router
	State() webvpn.State
	Up(ctx context.Context, loc *webvpn.Location) webvpn.State
	Down() webvpn.State
}

type Options struct {
	StaticDir     string
	AllowedLogins []string
	VPN           VPN
	// IVPN's server list, fetched directly (it is the VPN provider's own list).
	Servers func(context.Context) ([]webvpn.Location, error)
	Log     *slog.Logger
}

func New(opts Options) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/relay/", relay.New("/relay/", RelayHosts, opts.VPN, opts.Log))
	mux.HandleFunc("GET /api/vpn/state", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, opts.VPN.State()) })
	mux.HandleFunc("GET /api/vpn/servers", func(w http.ResponseWriter, r *http.Request) {
		list, err := opts.Servers(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		writeJSON(w, list)
	})
	mux.HandleFunc("POST /api/vpn/up", jsonOnly(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Location *webvpn.Location `json:"location"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil {
			http.Error(w, "bad request body", http.StatusBadRequest)
			return
		}
		writeJSON(w, opts.VPN.Up(r.Context(), body.Location))
	}))
	mux.HandleFunc("POST /api/vpn/down", jsonOnly(func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, opts.VPN.Down()) }))
	mux.Handle("/api/", http.NotFoundHandler())
	mux.Handle("/", static(opts.StaticDir))

	allowed := map[string]bool{}
	for _, l := range opts.AllowedLogins {
		allowed[strings.ToLower(l)] = true
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowed[strings.ToLower(r.Header.Get("Tailscale-User-Login"))] {
			opts.Log.Warn("refused a request without an allowed Tailscale login", "path", logPath(r.URL.Path))
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		switch r.Header.Get("Sec-Fetch-Site") {
		case "", "same-origin", "none": // not a browser, this app, or typed in the address bar
		default:
			http.Error(w, "cross-site request refused", http.StatusForbidden)
			return
		}
		h := w.Header()
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		mux.ServeHTTP(w, r)
	})
}

// jsonOnly refuses anything a plain HTML form could send: a cross-origin
// JSON POST needs a CORS preflight, which this host never approves.
func jsonOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			http.Error(w, "Content-Type must be application/json", http.StatusUnsupportedMediaType)
			return
		}
		next(w, r)
	}
}

// logPath keeps relay paths to "/relay/<host>": the rest can carry account
// addresses (Unit's /gen/.../<address>).
func logPath(p string) string {
	if rest, ok := strings.CutPrefix(p, "/relay/"); ok {
		host, _, _ := strings.Cut(rest, "/")
		return "/relay/" + host
	}
	return p
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}

// static serves files from dir: index.html at "/" (revalidated every load,
// so a rebuild takes effect at once), hashed assets cached for good, no
// directory listings.
func static(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := path.Clean("/" + r.URL.Path)
		if p == "/" || p == "/index.html" {
			w.Header().Set("Cache-Control", "no-cache")
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(p)))
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		if strings.HasPrefix(p, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		files.ServeHTTP(w, r)
	})
}
