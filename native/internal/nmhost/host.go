package nmhost

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"regexp"
	"time"

	"github.com/itsahedge/hyperextension/native/internal/proxy"
	"github.com/itsahedge/hyperextension/native/internal/vpn"
)

// Request is one message from the extension.
//
//	servers  -> IVPN's WireGuard server list
//	up       -> tunnel up, exit verified, proxy started; replies with its port
//	status   -> whether the tunnel is up and handshaking
//	down     -> tunnel and proxy stopped
type Request struct {
	ID     int         `json:"id"`
	Type   string      `json:"type"`
	Conf   string      `json:"conf,omitempty"`   // wg-quick .conf; a credential
	Server *vpn.Server `json:"server,omitempty"` // optional location override
	Hosts  []string    `json:"hosts,omitempty"`  // hostnames the proxy may reach on :443
}

type Response struct {
	ID    int    `json:"id"`
	Type  string `json:"type"`
	Error string `json:"error,omitempty"`

	Servers []vpn.Location `json:"servers,omitempty"`

	Up            bool       `json:"up,omitempty"`
	Port          int        `json:"port,omitempty"`
	Endpoint      string     `json:"endpoint,omitempty"`
	Check         *vpn.Check `json:"check,omitempty"`
	LastHandshake int64      `json:"lastHandshake,omitempty"` // unix ms
	Unhealthy     string     `json:"unhealthy,omitempty"`
}

type Options struct {
	IVPNServersURL string
	// IP-info endpoint queried through the tunnel and directly; the same URL
	// outside tests.
	TunnelIPInfoURL string
	DirectIPInfoURL string
	Log             *slog.Logger
}

type Host struct {
	opts   Options
	tunnel *vpn.Tunnel
	proxy  *proxy.Proxy
	check  *vpn.Check
}

func New(opts Options) *Host { return &Host{opts: opts} }

// Serve handles requests one at a time until Chrome closes the port or ctx
// ends, then stops the tunnel.
func (h *Host) Serve(ctx context.Context, in io.Reader, out io.Writer) error {
	defer h.down()
	msgs := make(chan Request)
	errc := make(chan error, 1)
	go func() {
		for {
			var req Request
			if err := readMessage(in, &req); err != nil {
				errc <- err
				return
			}
			select {
			case msgs <- req:
			case <-ctx.Done():
				return
			}
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return nil
		case err := <-errc:
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		case req := <-msgs:
			res := h.handle(ctx, req)
			res.ID, res.Type = req.ID, req.Type
			if err := writeMessage(out, res); err != nil {
				return fmt.Errorf("replying to %s: %w", req.Type, err)
			}
		}
	}
}

func (h *Host) handle(ctx context.Context, req Request) Response {
	var res Response
	var err error
	switch req.Type {
	case "servers":
		ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		res.Servers, err = vpn.IVPNLocations(ctx, &http.Client{}, h.opts.IVPNServersURL)
	case "up":
		res, err = h.up(ctx, req)
	case "status":
		res = h.status()
	case "down":
		h.down()
	default:
		err = fmt.Errorf("unknown request %q", req.Type)
	}
	if err != nil {
		h.opts.Log.Warn("request failed", "type", req.Type, "err", err)
		return Response{Error: err.Error()}
	}
	return res
}

// A hostname, not a pattern or host:port; the extension sends its own
// manifest host_permissions.
var hostname = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)

func (h *Host) up(ctx context.Context, req Request) (Response, error) {
	h.down()
	if len(req.Hosts) == 0 {
		return Response{}, errors.New("no hosts to route")
	}
	allowed := make([]string, len(req.Hosts))
	for i, host := range req.Hosts {
		if !hostname.MatchString(host) {
			return Response{}, fmt.Errorf("invalid host %q", host)
		}
		allowed[i] = net.JoinHostPort(host, "443")
	}
	cfg, err := vpn.Parse(req.Conf)
	if err != nil {
		return Response{}, err
	}
	if req.Server != nil {
		if cfg, err = cfg.WithServer(*req.Server); err != nil {
			return Response{}, err
		}
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	t, err := vpn.Up(ctx, cfg)
	if err != nil {
		return Response{}, err
	}
	check, err := vpn.Verify(ctx, t, h.opts.TunnelIPInfoURL, h.opts.DirectIPInfoURL)
	if err != nil {
		t.Close()
		return Response{}, err
	}
	p, err := proxy.Start(t, allowed, h.opts.Log)
	if err != nil {
		t.Close()
		return Response{}, fmt.Errorf("starting the local proxy: %w", err)
	}
	h.tunnel, h.proxy, h.check = t, p, check
	h.opts.Log.Info("vpn up", "endpoint", t.Endpoint(), "exit", check.Tunnel.IP, "port", p.Port())
	return Response{Up: true, Port: p.Port(), Endpoint: t.Endpoint(), Check: check}, nil
}

func (h *Host) status() Response {
	if h.tunnel == nil {
		return Response{}
	}
	res := Response{Up: true, Port: h.proxy.Port(), Endpoint: h.tunnel.Endpoint(), Check: h.check}
	if hs := h.tunnel.LastHandshake(); !hs.IsZero() {
		res.LastHandshake = hs.UnixMilli()
	}
	if err := h.tunnel.Healthy(time.Now()); err != nil {
		res.Unhealthy = err.Error()
	}
	return res
}

func (h *Host) down() {
	if h.proxy != nil {
		_ = h.proxy.Close()
	}
	if h.tunnel != nil {
		h.tunnel.Close()
		h.opts.Log.Info("vpn down")
	}
	h.tunnel, h.proxy, h.check = nil, nil, nil
}
