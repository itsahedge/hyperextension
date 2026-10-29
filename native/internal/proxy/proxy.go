// Package proxy is a loopback HTTP CONNECT proxy whose upstream connections
// are made by a Dialer (the WireGuard tunnel). Chrome sends every proxied
// HTTPS and WSS request as CONNECT, so plain-HTTP forwarding is refused.
// Only the allowlisted host:port targets are reachable, so another local
// process cannot use it as a general-purpose tunnel.
package proxy

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const dialTimeout = 20 * time.Second

type Dialer interface {
	DialContext(ctx context.Context, network, addr string) (net.Conn, error)
}

type Proxy struct {
	ln      net.Listener
	srv     *http.Server
	dial    Dialer
	allowed map[string]bool // lowercase host:port
	log     *slog.Logger

	mu     sync.Mutex
	conns  map[net.Conn]struct{} // hijacked client and upstream conns, closed on Close
	closed bool
}

// Start listens on 127.0.0.1 at a random port.
func Start(dial Dialer, allowed []string, log *slog.Logger) (*Proxy, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &Proxy{ln: ln, dial: dial, allowed: map[string]bool{}, log: log, conns: map[net.Conn]struct{}{}}
	for _, a := range allowed {
		p.allowed[strings.ToLower(a)] = true
	}
	p.srv = &http.Server{Handler: p, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := p.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("proxy stopped", "err", err)
		}
	}()
	return p, nil
}

func (p *Proxy) Port() int { return p.ln.Addr().(*net.TCPAddr).Port }

// Close stops accepting and cuts every open tunnel.
func (p *Proxy) Close() error {
	err := p.srv.Close()
	p.mu.Lock()
	p.closed = true
	for c := range p.conns {
		_ = c.Close()
	}
	p.conns = map[net.Conn]struct{}{}
	p.mu.Unlock()
	return err
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodConnect {
		http.Error(w, "only CONNECT is supported", http.StatusMethodNotAllowed)
		return
	}
	target := strings.ToLower(r.Host)
	if !p.allowed[target] {
		p.log.Warn("refused CONNECT to a host outside the allowlist", "target", target)
		http.Error(w, "target not allowed", http.StatusForbidden)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), dialTimeout)
	upstream, err := p.dial.DialContext(ctx, "tcp", target)
	cancel()
	if err != nil {
		p.log.Warn("tunnel dial failed", "target", target, "err", err)
		http.Error(w, "upstream unreachable through the tunnel", http.StatusBadGateway)
		return
	}
	hj, ok := w.(http.Hijacker)
	if !ok {
		_ = upstream.Close()
		http.Error(w, "hijacking unsupported", http.StatusInternalServerError)
		return
	}
	client, rw, err := hj.Hijack()
	if err != nil {
		_ = upstream.Close()
		return
	}
	if !p.track(client, upstream) {
		return
	}
	defer p.untrack(client, upstream)
	if _, err := io.WriteString(client, "HTTP/1.1 200 Connection Established\r\n\r\n"); err != nil {
		return
	}
	// The client may already have sent bytes (e.g. a TLS ClientHello) that the
	// server's reader buffered.
	if n := rw.Reader.Buffered(); n > 0 {
		buf, _ := rw.Peek(n)
		if _, err := upstream.Write(buf); err != nil {
			return
		}
	}
	pipe(client, upstream)
}

func (p *Proxy) track(conns ...net.Conn) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		for _, c := range conns {
			_ = c.Close()
		}
		return false
	}
	for _, c := range conns {
		p.conns[c] = struct{}{}
	}
	return true
}

func (p *Proxy) untrack(conns ...net.Conn) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range conns {
		_ = c.Close()
		delete(p.conns, c)
	}
}

// pipe copies both ways until either side ends, then closes both.
func pipe(a, b net.Conn) {
	done := make(chan struct{}, 2)
	cp := func(dst, src net.Conn) {
		_, _ = io.Copy(dst, src)
		done <- struct{}{}
	}
	go cp(a, b)
	go cp(b, a)
	<-done
	_ = a.Close()
	_ = b.Close()
	<-done
}
