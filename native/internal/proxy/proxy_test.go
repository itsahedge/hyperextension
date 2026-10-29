package proxy_test

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/itsahedge/hyperextension/native/internal/proxy"
	"github.com/itsahedge/hyperextension/native/internal/vpn"
	"github.com/itsahedge/hyperextension/native/internal/vpn/vpntest"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

// tunnel starts a real in-process WireGuard tunnel to a test peer whose HTTP
// server exists only inside the tunnel.
func tunnel(t *testing.T) *vpn.Tunnel {
	t.Helper()
	conf := vpntest.Server(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, "inside the tunnel")
	}))
	cfg, err := vpn.Parse(conf)
	if err != nil {
		t.Fatal(err)
	}
	tun, err := vpn.Up(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(tun.Close)
	return tun
}

func viaProxy(p *proxy.Proxy) *http.Client {
	u, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", p.Port()))
	return &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: http.ProxyURL(u)}}
}

// connect sends a raw CONNECT and returns the status line.
func connect(t *testing.T, p *proxy.Proxy, target string) (net.Conn, string) {
	t.Helper()
	c, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", p.Port()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	_ = c.SetDeadline(time.Now().Add(15 * time.Second))
	_, _ = fmt.Fprintf(c, "CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", target, target)
	line, err := bufio.NewReader(c).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	return c, strings.TrimSpace(line)
}

func TestConnectGoesThroughTheTunnel(t *testing.T) {
	target := net.JoinHostPort(vpntest.ServerIP, "80")
	p, err := proxy.Start(tunnel(t), []string{target}, quiet)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.Close() })

	c, status := connect(t, p, target)
	if status != "HTTP/1.1 200 Connection Established" {
		t.Fatalf("status %q", status)
	}
	_, _ = fmt.Fprintf(c, "GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n", vpntest.ServerIP)
	body, _ := io.ReadAll(c)
	if !strings.Contains(string(body), "inside the tunnel") {
		t.Fatalf("response %q", body)
	}
}

func TestRefusesTargetsOutsideTheAllowlist(t *testing.T) {
	p, err := proxy.Start(tunnel(t), []string{"api.hyperliquid.xyz:443"}, quiet)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.Close() })
	for _, target := range []string{net.JoinHostPort(vpntest.ServerIP, "80"), "api.hyperliquid.xyz:80", "evil.example:443"} {
		if _, status := connect(t, p, target); !strings.Contains(status, "403") {
			t.Errorf("%s: status %q, want 403", target, status)
		}
	}
}

func TestRefusesPlainHTTPForwarding(t *testing.T) {
	p, err := proxy.Start(tunnel(t), []string{net.JoinHostPort(vpntest.ServerIP, "80")}, quiet)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.Close() })
	res, err := viaProxy(p).Get("http://" + vpntest.ServerIP + "/")
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status %d, want 405", res.StatusCode)
	}
}

func TestUnreachableUpstreamIsBadGateway(t *testing.T) {
	// Allowed, but nothing listens there inside the tunnel.
	target := net.JoinHostPort(vpntest.ServerIP, "81")
	p, err := proxy.Start(tunnel(t), []string{target}, quiet)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = p.Close() })
	if _, status := connect(t, p, target); !strings.Contains(status, "502") {
		t.Fatalf("status %q, want 502", status)
	}
}

func TestCloseCutsOpenTunnels(t *testing.T) {
	target := net.JoinHostPort(vpntest.ServerIP, "80")
	p, err := proxy.Start(tunnel(t), []string{target}, quiet)
	if err != nil {
		t.Fatal(err)
	}
	c, status := connect(t, p, target)
	if !strings.Contains(status, "200") {
		t.Fatalf("status %q", status)
	}
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	_ = c.SetReadDeadline(time.Now().Add(5 * time.Second))
	buf := make([]byte, 64)
	for {
		if _, err := c.Read(buf); err != nil {
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				t.Fatal("connection still open after Close")
			}
			break
		}
	}
	if _, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", p.Port())); err == nil {
		t.Fatal("proxy still accepting after Close")
	}
}
