// Package relay forwards the web app's API requests from the Mac mini to an
// allowlisted set of HTTPS hosts. The browser calls
//
//	https://<mini>.ts.net:8443/relay/api.hyperliquid.xyz/info
//
// and the relay sends it to https://api.hyperliquid.xyz/info over whatever
// Router picks: the WireGuard tunnel while the VPN is on, the Mac mini's own
// connection while it is off, or nothing (the kill switch) while it is on but
// down. Websocket upgrades pass through, so Hyperliquid's feeds work too.
//
// Requests leave stripped of anything that identifies the browser or the
// tailnet: cookies, Origin, Referer, forwarding and Tailscale identity headers.
// Bodies are never logged.
package relay

import (
	"errors"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// MaxBody caps a relayed request body. A 200-order batch is well under it.
const MaxBody = 1 << 20

// Router picks how a relayed request leaves. An error means it must not leave
// at all; its text is shown to the user.
type Router interface {
	RoundTripper() (http.RoundTripper, error)
}

type Relay struct {
	prefix string
	hosts  map[string]bool
	router Router
	log    *slog.Logger
}

// New serves paths "<prefix><host>/<path>" for the given hostnames.
func New(prefix string, hosts []string, router Router, log *slog.Logger) *Relay {
	r := &Relay{prefix: prefix, hosts: map[string]bool{}, router: router, log: log}
	for _, h := range hosts {
		r.hosts[strings.ToLower(h)] = true
	}
	return r
}

// Headers that would tell the upstream who is asking, or from where.
var stripped = []string{
	"Cookie", "Origin", "Referer", "Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto",
	"X-Real-Ip", "Via", "Tailscale-User-Login", "Tailscale-User-Name", "Tailscale-User-Profile-Pic", "Tailscale-Headers-Info",
}

func (rl *Relay) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	rest, ok := strings.CutPrefix(r.URL.EscapedPath(), rl.prefix)
	if !ok {
		http.NotFound(w, r)
		return
	}
	host, path, _ := strings.Cut(rest, "/")
	if !rl.hosts[host] {
		rl.log.Warn("relay refused a host outside the allowlist", "host", host)
		http.Error(w, "host not allowed", http.StatusForbidden)
		return
	}
	target, err := url.Parse("https://" + host + "/" + path)
	if err != nil {
		http.Error(w, "bad path", http.StatusBadRequest)
		return
	}
	target.RawQuery = r.URL.RawQuery

	rt, err := rl.router.RoundTripper()
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	if r.ContentLength > MaxBody {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxBody)

	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL = target
			pr.Out.Host = host
			for _, h := range stripped {
				pr.Out.Header.Del(h)
			}
		},
		Transport: rt,
		ModifyResponse: func(res *http.Response) error {
			res.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
				return
			}
			rl.log.Warn("relay upstream failed", "host", host, "err", err)
			http.Error(w, "upstream unreachable", http.StatusBadGateway)
		},
	}
	proxy.ServeHTTP(w, r)
}
