// Command hx-vpn is Hyperextension's native messaging host. Chrome starts it
// when the extension calls runtime.connectNative and stops it (stdin closes)
// when the port is disconnected. It runs a WireGuard tunnel in-process and a
// loopback CONNECT proxy that the extension points chrome.proxy at.
//
// Stdout carries only native messages; logs go to stderr, which Chrome
// forwards to its own log.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/itsahedge/hyperextension/native/internal/nmhost"
)

// Must stay in sync with the manifest `key` in wxt.config.ts and with
// allowed_origins written by scripts/install-vpn-host.sh.
const extensionOrigin = "chrome-extension://afafdoeghnoiaopgfhnipaldoekldgoo/"

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	// Chrome passes the caller's origin as the first argument. allowed_origins
	// already restricts callers; this refuses a manual or foreign launch.
	if len(os.Args) < 2 || os.Args[1] != extensionOrigin {
		fmt.Fprintln(os.Stderr, "hx-vpn is started by the Hyperextension Chrome extension, not by hand")
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	host := nmhost.New(nmhost.Options{
		IVPNServersURL:  "https://api.ivpn.net/v5/servers.json",
		TunnelIPInfoURL: "https://ipinfo.io/json",
		DirectIPInfoURL: "https://ipinfo.io/json",
		Log:             log,
	})
	if err := host.Serve(ctx, os.Stdin, os.Stdout); err != nil {
		log.Error("native messaging failed", "err", err)
		os.Exit(1)
	}
}
