package vpn

import (
	"errors"
	"strings"
	"testing"
)

const (
	keyA = "YNQzD8ZKP0Ev1dz2ri0V9b8bUsXN2C+4TBrqYGJz1Wk="
	keyB = "cQvUv7r4aqwAFrlEJW6Ff3YFwPq4L8xT1gDlR3hW4FU="
)

func conf(mut func(string) string) string {
	base := `[Interface]
PrivateKey = ` + keyA + `
Address = 172.21.0.5/32
DNS = 172.16.0.1

[Peer]
PublicKey = ` + keyB + `
Endpoint = us-fl2.wg.ivpn.net:2049
AllowedIPs = 0.0.0.0/0, ::/0
`
	if mut == nil {
		return base
	}
	return mut(base)
}

func TestParse(t *testing.T) {
	c, err := Parse(conf(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.PrivateKey != keyA || c.Peer.PublicKey != keyB || c.Peer.Endpoint != "us-fl2.wg.ivpn.net:2049" {
		t.Fatalf("parsed %+v", c)
	}
	if c.Addresses[0].String() != "172.21.0.5/32" || c.DNS[0].String() != "172.16.0.1" {
		t.Fatalf("addresses %v dns %v", c.Addresses, c.DNS)
	}
}

func TestParseRefusesUnsafeConfigs(t *testing.T) {
	tests := map[string]struct {
		mut  func(string) string
		want string
	}{
		"no DNS":       {func(s string) string { return strings.Replace(s, "DNS = 172.16.0.1\n", "", 1) }, "no DNS server"},
		"split tunnel": {func(s string) string { return strings.Replace(s, "0.0.0.0/0, ::/0", "10.0.0.0/8", 1) }, "0.0.0.0/0"},
		"two peers":    {func(s string) string { return s + "\n[Peer]\nPublicKey = " + keyB + "\n" }, "exactly one [Peer]"},
		"bad key":      {func(s string) string { return strings.Replace(s, keyA, "not-a-key", 1) }, "base64 WireGuard key"},
		"no address":   {func(s string) string { return strings.Replace(s, "Address = 172.21.0.5/32\n", "", 1) }, "no Address"},
		"bad MTU": {func(s string) string {
			return strings.Replace(s, "DNS = 172.16.0.1", "DNS = 172.16.0.1\nMTU = 99999", 1)
		}, "out of range"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := Parse(conf(tt.mut))
			if !errors.Is(err, ErrConfig) || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("err = %v, want ErrConfig containing %q", err, tt.want)
			}
			if err != nil && strings.Contains(err.Error(), keyA) {
				t.Fatal("error message leaks the private key")
			}
		})
	}
}

func TestWithServer(t *testing.T) {
	c, err := Parse(conf(nil))
	if err != nil {
		t.Fatal(err)
	}
	n, err := c.WithServer(Server{Host: "185.212.170.2", PublicKey: keyA})
	if err != nil {
		t.Fatal(err)
	}
	if n.Peer.Endpoint != "185.212.170.2:2049" || n.Peer.PublicKey != keyA || n.PrivateKey != keyA {
		t.Fatalf("got %+v", n.Peer)
	}
	if c.Peer.PublicKey != keyB {
		t.Fatal("WithServer mutated the original config")
	}
	if _, err := c.WithServer(Server{Host: "us-fl2.wg.ivpn.net", PublicKey: keyA}); !errors.Is(err, ErrConfig) {
		t.Fatalf("hostname accepted: %v", err)
	}
	if _, err := c.WithServer(Server{Host: "185.212.170.2", PublicKey: "short"}); !errors.Is(err, ErrConfig) {
		t.Fatalf("bad key accepted: %v", err)
	}
}
