// Package vpn runs a WireGuard tunnel inside the helper process (userspace
// wireguard-go on a gVisor network stack): no system VPN, no Docker, no root.
// Every connection made through it, DNS lookups included, goes through the
// tunnel or fails; nothing falls back to the normal network.
//
// Adapted from wagyuintents/internal/vpn.
package vpn

import (
	"bufio"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
)

// Config is a WireGuard client config with exactly one peer: the usual
// wg-quick .conf a VPN provider such as IVPN generates.
type Config struct {
	PrivateKey string // base64; a credential, never logged
	Addresses  []netip.Prefix
	DNS        []netip.Addr
	MTU        int
	Peer       Peer
}

type Peer struct {
	PublicKey    string // base64
	PresharedKey string // base64, optional; a credential
	Endpoint     string // host:port
	AllowedIPs   []netip.Prefix
	Keepalive    int // seconds; 0 means the default
}

// ErrConfig means the .conf cannot be used. Messages never include keys.
var ErrConfig = errors.New("WireGuard config")

// Parse reads a wg-quick .conf. It refuses configs that cannot be used
// safely: no DNS server (lookups would have nowhere private to go), more than
// one peer, or a peer that does not take all traffic.
func Parse(text string) (*Config, error) {
	c := &Config{}
	section, peers := "", 0
	sc := bufio.NewScanner(strings.NewReader(text))
	for n := 1; sc.Scan(); n++ {
		line := strings.TrimSpace(sc.Text())
		if i := strings.IndexAny(line, "#;"); i >= 0 {
			line = strings.TrimSpace(line[:i])
		}
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.ToLower(strings.TrimSpace(line[1 : len(line)-1]))
			if section == "peer" {
				peers++
			}
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("%w: line %d: expected key = value", ErrConfig, n)
		}
		key, val = strings.ToLower(strings.TrimSpace(key)), strings.TrimSpace(val)
		var err error
		switch section + "." + key {
		case "interface.privatekey":
			c.PrivateKey, err = key32(val)
		case "interface.address":
			c.Addresses, err = prefixes(val, true)
		case "interface.dns":
			c.DNS, err = dnsAddrs(val)
		case "interface.mtu":
			c.MTU, err = strconv.Atoi(val)
		case "peer.publickey":
			c.Peer.PublicKey, err = key32(val)
		case "peer.presharedkey":
			c.Peer.PresharedKey, err = key32(val)
		case "peer.endpoint":
			c.Peer.Endpoint = val
			_, _, err = net.SplitHostPort(val)
		case "peer.allowedips":
			c.Peer.AllowedIPs, err = prefixes(val, false)
		case "peer.persistentkeepalive":
			c.Peer.Keepalive, err = strconv.Atoi(val)
		default:
			// wg-quick-only keys (PostUp, Table, SaveConfig, ...) do not
			// apply to an in-process tunnel.
			if section != "interface" && section != "peer" {
				return nil, fmt.Errorf("%w: line %d: %q is outside [Interface] or [Peer]", ErrConfig, n, key)
			}
		}
		if err != nil {
			return nil, fmt.Errorf("%w: line %d (%s): %w", ErrConfig, n, key, err)
		}
	}
	switch {
	case peers != 1:
		return nil, fmt.Errorf("%w: needs exactly one [Peer], found %d", ErrConfig, peers)
	case c.PrivateKey == "":
		return nil, fmt.Errorf("%w: [Interface] has no PrivateKey", ErrConfig)
	case len(c.Addresses) == 0:
		return nil, fmt.Errorf("%w: [Interface] has no Address", ErrConfig)
	case len(c.DNS) == 0:
		return nil, fmt.Errorf("%w: [Interface] has no DNS server; lookups must go through the tunnel", ErrConfig)
	case c.Peer.PublicKey == "":
		return nil, fmt.Errorf("%w: [Peer] has no PublicKey", ErrConfig)
	case c.Peer.Endpoint == "":
		return nil, fmt.Errorf("%w: [Peer] has no Endpoint", ErrConfig)
	case !fullTunnel(c.Peer.AllowedIPs):
		return nil, fmt.Errorf("%w: [Peer] AllowedIPs must include 0.0.0.0/0 so all traffic is tunneled", ErrConfig)
	case c.MTU < 0 || c.MTU > 9000:
		return nil, fmt.Errorf("%w: MTU %d is out of range", ErrConfig, c.MTU)
	}
	return c, nil
}

// Server is another server of the same provider. On IVPN the [Interface]
// (key, tunnel address, DNS) is the account's on every server, so switching
// location only replaces the peer's key and address.
type Server struct {
	Host      string `json:"host"`      // IP
	PublicKey string `json:"publicKey"` // base64
}

// WithServer is c pointed at s, keeping the configured port.
func (c *Config) WithServer(s Server) (*Config, error) {
	ip, err := netip.ParseAddr(s.Host)
	if err != nil {
		return nil, fmt.Errorf("%w: server host %q is not an IP address", ErrConfig, s.Host)
	}
	if _, err := key32(s.PublicKey); err != nil {
		return nil, fmt.Errorf("%w: server key: %w", ErrConfig, err)
	}
	port := "2049"
	if _, p, err := net.SplitHostPort(c.Peer.Endpoint); err == nil {
		port = p
	}
	n := *c
	n.Peer.PublicKey = s.PublicKey
	n.Peer.Endpoint = net.JoinHostPort(ip.String(), port)
	return &n, nil
}

func key32(v string) (string, error) {
	b, err := base64.StdEncoding.DecodeString(v)
	if err != nil || len(b) != 32 {
		return "", errors.New("not a base64 WireGuard key")
	}
	return v, nil
}

// prefixes parses a comma-separated list; host addresses (no "/n") get a
// full-length prefix when hostOK.
func prefixes(v string, hostOK bool) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for s := range strings.SplitSeq(v, ",") {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		p, err := netip.ParsePrefix(s)
		if err != nil && hostOK {
			var a netip.Addr
			if a, err = netip.ParseAddr(s); err == nil {
				p = netip.PrefixFrom(a, a.BitLen())
			}
		}
		if err != nil {
			return nil, fmt.Errorf("%q is not an address or prefix", s)
		}
		out = append(out, p)
	}
	return out, nil
}

// dnsAddrs keeps the IP entries of a DNS line; search domains are skipped.
func dnsAddrs(v string) ([]netip.Addr, error) {
	var out []netip.Addr
	for s := range strings.SplitSeq(v, ",") {
		if a, err := netip.ParseAddr(strings.TrimSpace(s)); err == nil {
			out = append(out, a)
		}
	}
	if len(out) == 0 {
		return nil, errors.New("no IP address")
	}
	return out, nil
}

func fullTunnel(allowed []netip.Prefix) bool {
	for _, p := range allowed {
		if p.Addr().Is4() && p.Bits() == 0 {
			return true
		}
	}
	return false
}

// hexKey converts a base64 key to the hex form the WireGuard UAPI takes.
func hexKey(b64 string) string {
	b, _ := base64.StdEncoding.DecodeString(b64) // validated by Parse
	return hex.EncodeToString(b)
}
