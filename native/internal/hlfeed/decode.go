package hlfeed

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"strconv"
)

// Quote is one market's update from fastAssetCtxs. Hyperliquid sends only
// the fields that changed, so a missing field means "unchanged", not zero.
type Quote struct {
	Mark    float64
	HasMark bool
	Mid     float64
	HasMid  bool
}

// A fastAssetCtxs payload decompresses to at most a few hundred KB (about
// 90 KB for all ~2,000 markets); anything far larger is not a price update.
const maxInflated = 8 << 20

// Decode reads a fastAssetCtxs `data` field: a JSON string holding base64 of
// a raw DEFLATE stream (no zlib or gzip wrapper) of
// {"<coin>": {"markPx": "...", "midPx": "..." | null}}. Coins are keyed as
// Hyperliquid names them: "BTC", "@107" (spot), "xyz:NVDA" (HIP-3).
func Decode(data string) (map[string]Quote, error) {
	var b64 string
	if err := json.Unmarshal([]byte(data), &b64); err != nil {
		return nil, fmt.Errorf("fastAssetCtxs data is not a string: %w", err)
	}
	compressed, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("fastAssetCtxs base64: %w", err)
	}
	raw, err := io.ReadAll(io.LimitReader(flate.NewReader(bytes.NewReader(compressed)), maxInflated+1))
	if err != nil {
		return nil, fmt.Errorf("fastAssetCtxs inflate: %w", err)
	}
	if len(raw) > maxInflated {
		return nil, fmt.Errorf("fastAssetCtxs payload over %d bytes", maxInflated)
	}
	var ctxs map[string]struct {
		MarkPx json.RawMessage `json:"markPx"`
		MidPx  json.RawMessage `json:"midPx"`
	}
	if err := json.Unmarshal(raw, &ctxs); err != nil {
		return nil, fmt.Errorf("fastAssetCtxs json: %w", err)
	}
	out := make(map[string]Quote, len(ctxs))
	for coin, c := range ctxs {
		var q Quote
		if q.Mark, q.HasMark, err = price(c.MarkPx); err != nil {
			return nil, fmt.Errorf("%s markPx: %w", coin, err)
		}
		if q.Mid, q.HasMid, err = price(c.MidPx); err != nil {
			return nil, fmt.Errorf("%s midPx: %w", coin, err)
		}
		out[coin] = q
	}
	return out, nil
}

// price reads a price sent as a decimal string (what the API sends) or a
// number (what its type docs say). Absent or null means no value.
func price(raw json.RawMessage) (float64, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, false, nil
	}
	s := string(raw)
	var str string
	if json.Unmarshal(raw, &str) == nil {
		s = str
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, false, fmt.Errorf("not a number: %q", s)
	}
	if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return 0, false, fmt.Errorf("not a positive price: %q", s)
	}
	return v, true, nil
}
