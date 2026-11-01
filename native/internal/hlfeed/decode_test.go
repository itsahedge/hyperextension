package hlfeed

import (
	"testing"
)

func TestDecodeDocsExample(t *testing.T) {
	// The example payload from Hyperliquid's websocket docs (fastAssetCtxs).
	got, err := Decode(`"q1ZyCnFWsqpWyk0syg6oULJSsjQ3NTDQM1Wq1VFyDfFAkTI2MzXQMwJLVVRWWfmFuTiiyBuamOoZKdXWAgA="`)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]Quote{
		"BTC":      {Mark: 97500.5, HasMark: true},
		"ETH":      {Mark: 3650.25, HasMark: true},
		"xyz:NVDA": {Mark: 145.2, HasMark: true},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d coins, want %d: %+v", len(got), len(want), got)
	}
	for coin, q := range want {
		if got[coin] != q {
			t.Errorf("%s: got %+v, want %+v", coin, got[coin], q)
		}
	}
}

func TestDecodeNullAndMissingMid(t *testing.T) {
	data := encodeForTest(t, `{"@1":{"markPx":"0.005","midPx":null},"BTC":{"midPx":"77847.5"}}`)
	got, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if q := got["@1"]; q != (Quote{Mark: 0.005, HasMark: true}) {
		t.Errorf("@1: %+v", q)
	}
	if q := got["BTC"]; q != (Quote{Mid: 77847.5, HasMid: true}) {
		t.Errorf("BTC: %+v", q)
	}
}

func TestDecodeRejectsBadPrices(t *testing.T) {
	for _, body := range []string{
		`{"BTC":{"markPx":"abc"}}`,
		`{"BTC":{"markPx":"-1"}}`,
		`{"BTC":{"markPx":"NaN"}}`,
	} {
		if _, err := Decode(encodeForTest(t, body)); err == nil {
			t.Errorf("%s: want an error", body)
		}
	}
}

func TestDecodeRejectsGarbage(t *testing.T) {
	for _, data := range []string{`42`, `"not base64!"`, `"aGVsbG8="`} {
		if _, err := Decode(data); err == nil {
			t.Errorf("%s: want an error", data)
		}
	}
}
