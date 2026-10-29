package vpn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"time"
)

// Exit is where traffic leaves to the internet.
type Exit struct {
	IP      string `json:"ip"`
	City    string `json:"city,omitempty"`
	Region  string `json:"region,omitempty"`
	Country string `json:"country,omitempty"`
}

// Check compares the two routes: where tunneled traffic leaves, and where
// this machine's own connection leaves.
type Check struct {
	Tunnel Exit `json:"tunnel"`
	Direct Exit `json:"direct"`
}

// Verify proves the tunnel carries traffic and exits from a different IP
// than the direct connection, by asking an IP-info endpoint once through the
// tunnel and once directly (the same URL outside tests). Any doubt is an error, so the proxy never starts on a
// tunnel that could not be confirmed. The direct lookup carries nothing but
// itself.
func Verify(ctx context.Context, t *Tunnel, tunnelURL, directURL string) (*Check, error) {
	viaTunnel := &http.Client{Timeout: 20 * time.Second, Transport: t.Transport()}
	defer viaTunnel.CloseIdleConnections()
	tunneled, err := lookup(ctx, viaTunnel, tunnelURL)
	if err != nil {
		return nil, fmt.Errorf("nothing came back through the tunnel (check the WireGuard config, or the server may be down): %w", err)
	}
	direct := &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{Proxy: nil}}
	defer direct.CloseIdleConnections()
	real, err := lookup(ctx, direct, directURL)
	if err != nil {
		return nil, fmt.Errorf("could not read your direct IP to compare against: %w", err)
	}
	if real.IP == tunneled.IP {
		return nil, fmt.Errorf("the tunnel exits from your own IP %s; it is not a VPN route", real.IP)
	}
	return &Check{Tunnel: *tunneled, Direct: *real}, nil
}

func lookup(ctx context.Context, c *http.Client, url string) (*Exit, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var e Exit
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&e); err != nil {
		return nil, err
	}
	if _, err := netip.ParseAddr(e.IP); err != nil {
		return nil, errors.New("the IP lookup returned no IP address")
	}
	return &e, nil
}
