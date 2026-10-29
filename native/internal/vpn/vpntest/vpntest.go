// Package vpntest runs a WireGuard peer inside a test process, so tests can
// prove traffic goes through the tunnel: the peer's services exist only
// inside the tunnel, at ServerIP, and are unreachable any other way.
//
// Adapted from wagyuintents/internal/vpn/vpntest.
package vpntest

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"testing"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.zx2c4.com/wireguard/conn"
	"golang.zx2c4.com/wireguard/device"
	"golang.zx2c4.com/wireguard/tun/netstack"
)

// ServerIP is the peer's address inside the tunnel; ClientIP is the helper's.
const (
	ServerIP = "10.66.0.1"
	ClientIP = "10.66.0.2"
)

// KeyPair returns a base64 WireGuard private and public key.
func KeyPair(t testing.TB) (priv, pub string) {
	t.Helper()
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatal(err)
	}
	k[0] &= 248
	k[31] = (k[31] & 127) | 64
	p, err := curve25519.X25519(k, curve25519.Basepoint)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(k), base64.StdEncoding.EncodeToString(p)
}

// Peer is a running test server.
type Peer struct {
	PublicKey string
	Port      int
}

// Server starts a peer that serves handler at http://ServerIP inside its
// tunnel, and returns a client .conf that reaches it over loopback.
func Server(t testing.TB, handler http.Handler) (clientConf string) {
	t.Helper()
	clientPriv, clientPub := KeyPair(t)
	return ClientConf(clientPriv, ServerFor(t, handler, clientPub))
}

// ServerFor starts a peer that accepts the client key clientPub, so several
// servers can stand in for one provider's locations.
func ServerFor(t testing.TB, handler http.Handler, clientPub string) Peer {
	t.Helper()
	serverPriv, serverPub := KeyPair(t)
	pc, err := (&net.ListenConfig{}).ListenPacket(context.Background(), "udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := pc.LocalAddr().(*net.UDPAddr).Port
	_ = pc.Close()

	tun, tnet, err := netstack.CreateNetTUN([]netip.Addr{netip.MustParseAddr(ServerIP)}, nil, 1420)
	if err != nil {
		t.Fatal(err)
	}
	dev := device.NewDevice(tun, conn.NewDefaultBind(), device.NewLogger(device.LogLevelSilent, ""))
	t.Cleanup(dev.Close)
	if err := dev.IpcSet(fmt.Sprintf("private_key=%s\nlisten_port=%d\npublic_key=%s\nallowed_ip=%s/32\n",
		hexKey(serverPriv), port, hexKey(clientPub), ClientIP)); err != nil {
		t.Fatal(err)
	}
	if err := dev.Up(); err != nil {
		t.Fatal(err)
	}
	ln, err := tnet.ListenTCP(&net.TCPAddr{IP: net.ParseIP(ServerIP), Port: 80})
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{ReadHeaderTimeout: 5 * time.Second, Handler: handler}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })
	return Peer{PublicKey: serverPub, Port: port}
}

// ClientConf is the .conf that reaches p with the client key.
func ClientConf(clientPriv string, p Peer) string {
	return fmt.Sprintf(`[Interface]
PrivateKey = %s
Address = %s/32
DNS = %s

[Peer]
PublicKey = %s
Endpoint = 127.0.0.1:%d
AllowedIPs = 0.0.0.0/0
`, clientPriv, ClientIP, ServerIP, p.PublicKey, p.Port)
}

func hexKey(b64 string) string {
	b, _ := base64.StdEncoding.DecodeString(b64)
	return hex.EncodeToString(b)
}
