package vpn

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

const (
	// defaultMTU is IPv6's minimum, which every path carries. WireGuard's
	// usual 1420 broke TLS on a real network (wagyuintents, 2026-10-15):
	// small packets went through, the certificate exchange's large ones were
	// dropped, so every HTTPS request stalled. A config's own MTU still wins.
	defaultMTU       = 1280
	defaultKeepalive = 25 // seconds: keeps the handshake fresh, so liveness is visible
	// StaleAfter is how old the last handshake may get before the tunnel
	// counts as down. WireGuard re-handshakes every 2 minutes on an active
	// tunnel, and keepalive keeps it active.
	StaleAfter = 3 * time.Minute
)

// Tunnel is a running in-process WireGuard tunnel. Connections made with
// DialContext or Transport leave only through it.
type Tunnel struct {
	dev      *device.Device
	net      *netstack.Net
	endpoint string
}

// Up resolves the server, then starts the tunnel. Resolving the server's own
// hostname is the only lookup made outside the tunnel; every later one uses
// the config's DNS servers through the tunnel.
func Up(ctx context.Context, cfg *Config) (*Tunnel, error) {
	endpoint, err := resolveEndpoint(ctx, cfg.Peer.Endpoint)
	if err != nil {
		return nil, err
	}
	addrs := make([]netip.Addr, len(cfg.Addresses))
	for i, p := range cfg.Addresses {
		addrs[i] = p.Addr()
	}
	mtu := cfg.MTU
	if mtu == 0 {
		mtu = defaultMTU
	}
	tun, tnet, err := netstack.CreateNetTUN(addrs, cfg.DNS, mtu)
	if err != nil {
		return nil, fmt.Errorf("creating the tunnel's network stack: %w", err)
	}
	dev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))
	keepalive := cfg.Peer.Keepalive
	if keepalive == 0 {
		keepalive = defaultKeepalive
	}
	var uapi strings.Builder
	fmt.Fprintf(&uapi, "private_key=%s\nreplace_peers=true\npublic_key=%s\n", hexKey(cfg.PrivateKey), hexKey(cfg.Peer.PublicKey))
	if cfg.Peer.PresharedKey != "" {
		fmt.Fprintf(&uapi, "preshared_key=%s\n", hexKey(cfg.Peer.PresharedKey))
	}
	fmt.Fprintf(&uapi, "endpoint=%s\npersistent_keepalive_interval=%d\nreplace_allowed_ips=true\n", endpoint, keepalive)
	for _, p := range cfg.Peer.AllowedIPs {
		fmt.Fprintf(&uapi, "allowed_ip=%s\n", p)
	}
	if err := dev.IpcSet(uapi.String()); err != nil {
		dev.Close()
		return nil, fmt.Errorf("configuring WireGuard: %w", err)
	}
	if err := dev.Up(); err != nil {
		dev.Close()
		return nil, fmt.Errorf("starting WireGuard: %w", err)
	}
	return &Tunnel{dev: dev, net: tnet, endpoint: endpoint.String()}, nil
}

// resolveEndpoint turns host:port into ip:port, preferring IPv4.
func resolveEndpoint(ctx context.Context, hostport string) (netip.AddrPort, error) {
	host, port, err := net.SplitHostPort(hostport)
	if err != nil {
		return netip.AddrPort{}, fmt.Errorf("%w: endpoint %q: %w", ErrConfig, hostport, err)
	}
	p, err := strconv.ParseUint(port, 10, 16)
	if err != nil {
		return netip.AddrPort{}, fmt.Errorf("%w: endpoint port %q", ErrConfig, port)
	}
	if a, err := netip.ParseAddr(host); err == nil {
		return netip.AddrPortFrom(a, uint16(p)), nil
	}
	ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(ips) == 0 {
		return netip.AddrPort{}, fmt.Errorf("resolving the VPN server %s: %w", host, err)
	}
	best := ips[0]
	for _, a := range ips {
		if a.Unmap().Is4() {
			best = a.Unmap()
			break
		}
	}
	return netip.AddrPortFrom(best, uint16(p)), nil
}

// DialContext connects through the tunnel only. Hostnames are resolved by
// the config's DNS servers, inside the tunnel.
func (t *Tunnel) DialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	return t.net.DialContext(ctx, network, addr)
}

// Transport is an HTTP transport whose every connection goes through the
// tunnel. It ignores HTTP_PROXY and friends: a proxy outside the tunnel
// would be a way around it.
func (t *Tunnel) Transport() *http.Transport {
	return &http.Transport{
		Proxy:                 nil,
		DialContext:           t.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
}

// Endpoint is the resolved server ip:port.
func (t *Tunnel) Endpoint() string { return t.endpoint }

// LastHandshake is when the tunnel last completed a WireGuard handshake;
// zero if it never has.
func (t *Tunnel) LastHandshake() time.Time {
	state, err := t.dev.IpcGet()
	if err != nil {
		return time.Time{}
	}
	var sec, nsec int64
	sc := bufio.NewScanner(strings.NewReader(state))
	for sc.Scan() {
		k, v, _ := strings.Cut(sc.Text(), "=")
		switch k {
		case "last_handshake_time_sec":
			sec, _ = strconv.ParseInt(v, 10, 64)
		case "last_handshake_time_nsec":
			nsec, _ = strconv.ParseInt(v, 10, 64)
		}
	}
	if sec == 0 && nsec == 0 {
		return time.Time{}
	}
	return time.Unix(sec, nsec)
}

// Healthy reports whether the tunnel has handshaken recently.
func (t *Tunnel) Healthy(now time.Time) error {
	hs := t.LastHandshake()
	switch {
	case hs.IsZero():
		return errors.New("no WireGuard handshake yet")
	case now.Sub(hs) > StaleAfter:
		return fmt.Errorf("no WireGuard handshake for %s; traffic is blocked, not leaked", now.Sub(hs).Round(time.Second))
	}
	return nil
}

// Close stops the tunnel. Connections through it fail afterwards.
func (t *Tunnel) Close() {
	t.dev.Close()
}
