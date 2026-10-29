package vpn

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"slices"
)

// Location is one IVPN WireGuard server.
type Location struct {
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	City        string  `json:"city"`
	Hostname    string  `json:"hostname"` // e.g. us-fl2.wg.ivpn.net
	Host        string  `json:"host"`     // its IP
	PublicKey   string  `json:"publicKey"`
	Load        float64 `json:"load"` // percent
}

// IVPNLocations reads IVPN's public server list (url is
// https://api.ivpn.net/v5/servers.json outside tests), sorted by country,
// city, then hostname. Entries without a valid IP or key are dropped.
func IVPNLocations(ctx context.Context, c *http.Client, url string) ([]Location, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, fmt.Errorf("reading IVPN's server list: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("reading IVPN's server list: HTTP %d", resp.StatusCode)
	}
	var list struct {
		WireGuard []struct {
			Country     string `json:"country"`
			CountryCode string `json:"country_code"`
			City        string `json:"city"`
			Hosts       []struct {
				Hostname  string  `json:"hostname"`
				Host      string  `json:"host"`
				PublicKey string  `json:"public_key"`
				Load      float64 `json:"load"`
			} `json:"hosts"`
		} `json:"wireguard"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&list); err != nil {
		return nil, fmt.Errorf("decoding IVPN's server list: %w", err)
	}
	var out []Location
	for _, g := range list.WireGuard {
		for _, h := range g.Hosts {
			if net.ParseIP(h.Host) == nil {
				continue
			}
			if _, err := key32(h.PublicKey); err != nil {
				continue
			}
			out = append(out, Location{Country: g.Country, CountryCode: g.CountryCode, City: g.City,
				Hostname: h.Hostname, Host: h.Host, PublicKey: h.PublicKey, Load: h.Load})
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("IVPN's server list has no WireGuard servers")
	}
	slices.SortFunc(out, func(a, b Location) int {
		return cmp.Or(cmp.Compare(a.Country, b.Country), cmp.Compare(a.City, b.City), cmp.Compare(a.Hostname, b.Hostname))
	})
	return out, nil
}
