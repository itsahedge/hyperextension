package nmhost

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/itsahedge/hyperextension/native/internal/vpn/vpntest"
)

func TestFramingRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	if err := writeMessage(&buf, map[string]any{"type": "status", "id": 7}); err != nil {
		t.Fatal(err)
	}
	if n := binary.LittleEndian.Uint32(buf.Bytes()[:4]); int(n) != buf.Len()-4 {
		t.Fatalf("length prefix %d for %d bytes", n, buf.Len()-4)
	}
	var req Request
	if err := readMessage(&buf, &req); err != nil {
		t.Fatal(err)
	}
	if req.ID != 7 || req.Type != "status" {
		t.Fatalf("got %+v", req)
	}
	if err := readMessage(&buf, &req); err != io.EOF {
		t.Fatalf("empty stream: %v, want io.EOF", err)
	}
}

func TestFramingLimits(t *testing.T) {
	if err := writeMessage(io.Discard, strings.Repeat("x", maxOutgoing)); err == nil {
		t.Fatal("oversized outgoing message accepted")
	}
	var hdr bytes.Buffer
	_ = binary.Write(&hdr, binary.LittleEndian, uint32(maxIncoming+1))
	var req Request
	if err := readMessage(&hdr, &req); err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("oversized incoming header: %v", err)
	}
}

// session runs a Host over in-memory pipes and returns a request function.
func session(t *testing.T, opts Options) func(Request) Response {
	t.Helper()
	opts.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- New(opts).Serve(context.Background(), inR, outW) }()
	t.Cleanup(func() {
		_ = inW.Close()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("Serve: %v", err)
			}
		case <-time.After(10 * time.Second):
			t.Error("Serve did not return after stdin closed")
		}
	})
	id := 0
	return func(req Request) Response {
		id++
		req.ID = id
		if err := writeMessage(inW, req); err != nil {
			t.Fatal(err)
		}
		var res Response
		if err := readMessage(outR, &res); err != nil {
			t.Fatal(err)
		}
		if res.ID != id || res.Type != req.Type {
			t.Fatalf("reply %d/%s to request %d/%s", res.ID, res.Type, id, req.Type)
		}
		return res
	}
}

func TestUpStatusDown(t *testing.T) {
	conf := vpntest.Server(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"ip":"`+vpntest.ServerIP+`","city":"Tunnelville","country":"ZZ"}`)
	}))
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"ip":"203.0.113.9","city":"Home","country":"US"}`)
	}))
	t.Cleanup(direct.Close)
	call := session(t, Options{TunnelIPInfoURL: "http://" + vpntest.ServerIP + "/json", DirectIPInfoURL: direct.URL})

	if res := call(Request{Type: "status"}); res.Up {
		t.Fatal("up before any request")
	}
	res := call(Request{Type: "up", Conf: conf, Hosts: []string{"api.hyperliquid.xyz", "api.hyperunit.xyz"}})
	if res.Error != "" || !res.Up || res.Port == 0 {
		t.Fatalf("up: %+v", res)
	}
	if res.Check.Tunnel.IP != vpntest.ServerIP || res.Check.Direct.IP != "203.0.113.9" {
		t.Fatalf("check %+v", res.Check)
	}
	st := call(Request{Type: "status"})
	if !st.Up || st.Port != res.Port || st.LastHandshake == 0 || st.Unhealthy != "" {
		t.Fatalf("status %+v", st)
	}
	if res := call(Request{Type: "down"}); res.Error != "" {
		t.Fatal(res.Error)
	}
	if st := call(Request{Type: "status"}); st.Up {
		t.Fatal("still up after down")
	}
}

func TestUpRefusesWhenTheTunnelExitsFromTheDirectIP(t *testing.T) {
	conf := vpntest.Server(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"ip":"203.0.113.9"}`)
	}))
	direct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"ip":"203.0.113.9"}`)
	}))
	t.Cleanup(direct.Close)
	call := session(t, Options{TunnelIPInfoURL: "http://" + vpntest.ServerIP + "/json", DirectIPInfoURL: direct.URL})
	res := call(Request{Type: "up", Conf: conf, Hosts: []string{"api.hyperliquid.xyz"}})
	if !strings.Contains(res.Error, "not a VPN route") || res.Up {
		t.Fatalf("up: %+v", res)
	}
	if st := call(Request{Type: "status"}); st.Up {
		t.Fatal("up after a failed verification")
	}
}

func TestUpValidatesInput(t *testing.T) {
	call := session(t, Options{})
	for _, tt := range []struct {
		req  Request
		want string
	}{
		{Request{Type: "up", Conf: "x", Hosts: nil}, "no hosts"},
		{Request{Type: "up", Conf: "x", Hosts: []string{"*.hyperliquid.xyz"}}, "invalid host"},
		{Request{Type: "up", Conf: "x", Hosts: []string{"api.hyperliquid.xyz:443"}}, "invalid host"},
		{Request{Type: "up", Conf: "x", Hosts: []string{"localhost"}}, "invalid host"},
		{Request{Type: "up", Conf: "[Interface]", Hosts: []string{"api.hyperliquid.xyz"}}, "WireGuard config"},
		{Request{Type: "bogus"}, "unknown request"},
	} {
		if res := call(tt.req); !strings.Contains(res.Error, tt.want) {
			t.Errorf("%+v: error %q, want %q", tt.req.Hosts, res.Error, tt.want)
		}
	}
}

func TestServers(t *testing.T) {
	list := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"wireguard":[
		  {"country":"Switzerland","country_code":"CH","city":"Zurich","hosts":[
		    {"hostname":"ch01.wg.ivpn.net","host":"185.212.170.2","public_key":"YNQzD8ZKP0Ev1dz2ri0V9b8bUsXN2C+4TBrqYGJz1Wk=","load":12.5},
		    {"hostname":"bad.wg.ivpn.net","host":"not-an-ip","public_key":"YNQzD8ZKP0Ev1dz2ri0V9b8bUsXN2C+4TBrqYGJz1Wk=","load":1}]},
		  {"country":"Austria","country_code":"AT","city":"Vienna","hosts":[
		    {"hostname":"at1.wg.ivpn.net","host":"185.244.212.69","public_key":"cQvUv7r4aqwAFrlEJW6Ff3YFwPq4L8xT1gDlR3hW4FU=","load":3}]}]}`)
	}))
	t.Cleanup(list.Close)
	res := session(t, Options{IVPNServersURL: list.URL})(Request{Type: "servers"})
	if res.Error != "" || len(res.Servers) != 2 {
		t.Fatalf("servers %+v", res)
	}
	if res.Servers[0].Country != "Austria" || res.Servers[1].Hostname != "ch01.wg.ivpn.net" || res.Servers[1].Load != 12.5 {
		t.Fatalf("order or fields: %+v", res.Servers)
	}
}
