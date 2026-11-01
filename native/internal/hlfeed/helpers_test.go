package hlfeed

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/json"
	"testing"
)

// encodeForTest builds a fastAssetCtxs data field the way Hyperliquid does:
// raw DEFLATE, base64, as a JSON string.
func encodeForTest(t *testing.T, payload string) string {
	t.Helper()
	var buf bytes.Buffer
	w, err := flate.NewWriter(&buf, flate.BestSpeed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte(payload)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	s, _ := json.Marshal(base64.StdEncoding.EncodeToString(buf.Bytes()))
	return string(s)
}
