// Package webvpn runs the web app's VPN on the Mac mini: one WireGuard tunnel
// (internal/vpn), an on/off switch persisted across restarts, and the route
// every relayed request takes.
//
//	off                      -> the Mac mini's own connection
//	on, tunnel verified      -> the tunnel only
//	on, connecting or failed -> nothing (kill switch); never direct
//
// The wg-quick config is handed in at start (from KeePassXC, never from the
// browser) and only ever held in memory.
package webvpn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/itsahedge/hyperextension/native/internal/vpn"
)

type Location = vpn.Location

// connectTimeout bounds one connect: tunnel up plus both IP lookups.
const connectTimeout = 45 * time.Second

type Options struct {
	// wg-quick .conf; empty means the VPN is not configured on this machine.
	Conf string
	// Where the switch and server choice are saved (JSON, mode 0600).
	StatePath string
	// IP-info endpoint asked through the tunnel and directly (the same URL
	// outside tests), as the extension's helper does.
	TunnelIPInfoURL string
	DirectIPInfoURL string
	Log             *slog.Logger
}

// Settings is what survives a restart.
type Settings struct {
	Enabled  bool      `json:"enabled"`
	Location *Location `json:"location,omitempty"`
}

type ConfSummary struct {
	Address  string `json:"address"`
	Endpoint string `json:"endpoint"`
}

// State mirrors VpnState in src/lib/vpn.ts, plus whether a config exists.
type State struct {
	Enabled       bool         `json:"enabled"`
	Connected     bool         `json:"connected"`
	Connecting    bool         `json:"connecting"`
	Location      *Location    `json:"location,omitempty"`
	Endpoint      string       `json:"endpoint,omitempty"`
	Exit          *vpn.Exit    `json:"exit,omitempty"`
	Direct        *vpn.Exit    `json:"direct,omitempty"`
	LastHandshake int64        `json:"lastHandshake,omitempty"` // unix ms
	Unhealthy     string       `json:"unhealthy,omitempty"`
	Error         string       `json:"error,omitempty"`
	Configured    bool         `json:"configured"`
	Config        *ConfSummary `json:"config,omitempty"`
}

type Manager struct {
	opts   Options
	conf   *vpn.Config // nil: not configured
	direct *http.Transport

	mu         sync.Mutex
	settings   Settings
	tunnel     *vpn.Tunnel
	via        *http.Transport // through tunnel
	check      *vpn.Check
	err        string
	connecting chan struct{} // closed when the connect in flight ends
}

func New(opts Options) (*Manager, error) {
	m := &Manager{opts: opts, direct: &http.Transport{Proxy: nil, ForceAttemptHTTP2: true, IdleConnTimeout: 90 * time.Second, TLSHandshakeTimeout: 15 * time.Second}}
	if opts.Conf != "" {
		cfg, err := vpn.Parse(opts.Conf)
		if err != nil {
			return nil, err
		}
		m.conf = cfg
	}
	if err := m.load(); err != nil {
		return nil, err
	}
	return m, nil
}

var errBlocked = errors.New("VPN is on but not connected, so this request was blocked rather than sent from the Mac mini's own IP")

// RoundTripper is the route for a relayed request right now.
func (m *Manager) RoundTripper() (http.RoundTripper, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.settings.Enabled {
		return m.direct, nil
	}
	if m.via == nil {
		return nil, errBlocked
	}
	return m.via, nil
}

func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	st := State{
		Enabled:    m.settings.Enabled,
		Connected:  m.tunnel != nil,
		Connecting: m.connecting != nil,
		Location:   m.settings.Location,
		Error:      m.err,
		Configured: m.conf != nil,
	}
	if m.conf != nil {
		st.Config = &ConfSummary{Endpoint: m.conf.Peer.Endpoint}
		if len(m.conf.Addresses) > 0 {
			st.Config.Address = m.conf.Addresses[0].String()
		}
	}
	if m.tunnel != nil {
		st.Endpoint = m.tunnel.Endpoint()
		st.Exit, st.Direct = &m.check.Tunnel, &m.check.Direct
		if hs := m.tunnel.LastHandshake(); !hs.IsZero() {
			st.LastHandshake = hs.UnixMilli()
		}
		if err := m.tunnel.Healthy(time.Now()); err != nil {
			st.Unhealthy = err.Error()
		}
	}
	return st
}

// Up turns the VPN on (loc nil: the config's own server) and connects. A
// failure is reported in the state's Error; the switch stays on, so requests
// stay blocked until a reconnect or Down.
func (m *Manager) Up(ctx context.Context, loc *Location) State {
	m.mu.Lock()
	m.settings = Settings{Enabled: true, Location: loc}
	err := m.save()
	m.mu.Unlock()
	if err != nil {
		m.setErr(err)
		return m.State()
	}
	m.connect(ctx, true)
	return m.State()
}

func (m *Manager) Down() State {
	m.mu.Lock()
	m.settings.Enabled = false
	err := m.save()
	m.closeTunnel()
	m.err = ""
	m.mu.Unlock()
	if err != nil {
		m.setErr(err)
	}
	return m.State()
}

// Reconcile reconnects when the VPN should be on but has no healthy tunnel:
// at start, and periodically after (the Mac mini may sleep or lose the
// network). It never routes direct in the meantime.
func (m *Manager) Reconcile(ctx context.Context) {
	m.mu.Lock()
	need := m.settings.Enabled && m.conf != nil && m.connecting == nil &&
		(m.tunnel == nil || m.tunnel.Healthy(time.Now()) != nil)
	m.mu.Unlock()
	if need {
		m.connect(ctx, false)
	}
}

// connect replaces any tunnel with a fresh, verified one. One runs at a time;
// a second caller waits for the one in flight. replace: drop the current
// tunnel first, as after a server change (requests block meanwhile).
func (m *Manager) connect(ctx context.Context, replace bool) {
	m.mu.Lock()
	if wait := m.connecting; wait != nil {
		m.mu.Unlock()
		select {
		case <-wait:
		case <-ctx.Done():
		}
		return
	}
	done := make(chan struct{})
	m.connecting = done
	if replace || m.tunnel != nil {
		m.closeTunnel()
	}
	m.err = ""
	loc := m.settings.Location
	m.mu.Unlock()

	t, check, err := m.dial(ctx, loc)

	m.mu.Lock()
	defer m.mu.Unlock()
	m.connecting = nil
	close(done)
	if err == nil && !m.settings.Enabled { // turned off while connecting
		t.Close()
		return
	}
	if err != nil {
		m.err = err.Error()
		m.opts.Log.Warn("vpn connect failed", "err", err)
		return
	}
	m.tunnel, m.check, m.via = t, check, t.Transport()
	m.opts.Log.Info("vpn up", "endpoint", t.Endpoint(), "exit", check.Tunnel.IP)
}

func (m *Manager) dial(ctx context.Context, loc *Location) (*vpn.Tunnel, *vpn.Check, error) {
	if m.conf == nil {
		return nil, nil, errors.New("no WireGuard config on the Mac mini; add it to KeePassXC (see the README) and restart the service")
	}
	cfg := m.conf
	if loc != nil {
		var err error
		if cfg, err = cfg.WithServer(vpn.Server{Host: loc.Host, PublicKey: loc.PublicKey}); err != nil {
			return nil, nil, err
		}
	}
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	t, err := vpn.Up(ctx, cfg)
	if err != nil {
		return nil, nil, err
	}
	check, err := vpn.Verify(ctx, t, m.opts.TunnelIPInfoURL, m.opts.DirectIPInfoURL)
	if err != nil {
		t.Close()
		return nil, nil, err
	}
	return t, check, nil
}

// closeTunnel needs m.mu held.
func (m *Manager) closeTunnel() {
	if m.via != nil {
		m.via.CloseIdleConnections()
	}
	if m.tunnel != nil {
		m.tunnel.Close()
		m.opts.Log.Info("vpn down")
	}
	m.tunnel, m.via, m.check = nil, nil, nil
}

func (m *Manager) setErr(err error) {
	m.mu.Lock()
	m.err = err.Error()
	m.mu.Unlock()
}

// Close stops the tunnel without changing the saved switch.
func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closeTunnel()
	m.direct.CloseIdleConnections()
}

func (m *Manager) load() error {
	b, err := os.ReadFile(m.opts.StatePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, &m.settings); err != nil {
		return fmt.Errorf("reading %s: %w", m.opts.StatePath, err)
	}
	return nil
}

// save needs m.mu held. Written to a temp file and renamed, so a crash never
// leaves a half-written switch.
func (m *Manager) save() error {
	b, err := json.Marshal(m.settings)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(m.opts.StatePath), 0o700); err != nil {
		return err
	}
	tmp := m.opts.StatePath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, m.opts.StatePath)
}
