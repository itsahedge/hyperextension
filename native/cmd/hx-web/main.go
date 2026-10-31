// Command hx-web serves the Hyperextension web app from the Mac mini: the
// static build, the VPN switch and the API relay (internal/webhost). It
// listens on loopback only; `tailscale serve` is the one way in.
//
//	scripts/hx-web.sh (launchd) reads the WireGuard config from KeePassXC
//	  | hx-web -wg-conf-stdin -static <dir> -allow-login <tailscale login>
//
// The config arrives on stdin and is only held in memory.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/itsahedge/hyperextension/native/internal/vpn"
	"github.com/itsahedge/hyperextension/native/internal/webhost"
	"github.com/itsahedge/hyperextension/native/internal/webvpn"
)

const (
	ivpnServersURL = "https://api.ivpn.net/v5/servers.json"
	ipInfoURL      = "https://ipinfo.io/json"
	// How often a VPN that should be on but is down or stale is reconnected.
	reconcileEvery = 30 * time.Second
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(log); err != nil {
		log.Error("hx-web failed", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	home, _ := os.UserHomeDir()
	listen := flag.String("listen", "127.0.0.1:4320", "loopback address to serve on")
	staticDir := flag.String("static", "", "the web build (.output/web)")
	statePath := flag.String("state", filepath.Join(home, "Library", "Application Support", "Hyperextension", "web-vpn.json"), "where the VPN switch is saved")
	logins := flag.String("allow-login", "", "comma-separated Tailscale logins allowed in")
	confStdin := flag.Bool("wg-conf-stdin", false, "read a wg-quick config from stdin")
	flag.Parse()

	if *staticDir == "" || *logins == "" {
		return errors.New("-static and -allow-login are required")
	}
	if err := requireLoopback(*listen); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(*staticDir, "index.html")); err != nil {
		return fmt.Errorf("no web build in %s (run pnpm build:web): %w", *staticDir, err)
	}
	var conf string
	if *confStdin {
		b, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<10))
		if err != nil {
			return fmt.Errorf("reading the WireGuard config: %w", err)
		}
		conf = strings.TrimSpace(string(b))
	}
	if conf == "" {
		log.Warn("no WireGuard config; the VPN cannot be turned on")
	}

	vpnManager, err := webvpn.New(webvpn.Options{Conf: conf, StatePath: *statePath, TunnelIPInfoURL: ipInfoURL, DirectIPInfoURL: ipInfoURL, Log: log})
	if err != nil {
		return fmt.Errorf("WireGuard config: %w", err)
	}
	defer vpnManager.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		vpnManager.Reconcile(ctx)
		t := time.NewTicker(reconcileEvery)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				vpnManager.Reconcile(ctx)
			}
		}
	}()

	direct := &http.Client{Timeout: 20 * time.Second, Transport: &http.Transport{Proxy: nil}}
	srv := &http.Server{
		Addr: *listen,
		Handler: webhost.New(webhost.Options{
			StaticDir:     *staticDir,
			AllowedLogins: strings.Split(*logins, ","),
			VPN:           vpnManager,
			Servers: func(ctx context.Context) ([]webvpn.Location, error) {
				return vpn.IVPNLocations(ctx, direct, ivpnServersURL)
			},
			Log: log,
		}),
		// No write timeout: websocket feeds stay open, and turning the VPN on
		// waits for the connect.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	log.Info("hx-web listening", "addr", *listen, "vpn", vpnManager.State().Enabled)
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(shutdown)
}

// requireLoopback refuses any address another machine could reach.
func requireLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("-listen %q: %w", addr, err)
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("-listen %q: must be a loopback IP; tailscale serve is the way in", addr)
	}
	return nil
}
