package alerts

import (
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)

func at(sec int) time.Time { return t0.Add(time.Duration(sec) * time.Second) }

func newEngine(t *testing.T, rules ...Rule) (*Engine, []Rule) {
	t.Helper()
	e := NewEngine(nil, func() time.Time { return t0 })
	var added []Rule
	for _, r := range rules {
		got, err := e.Add(r)
		if err != nil {
			t.Fatalf("Add(%+v): %v", r, err)
		}
		added = append(added, got)
	}
	return e, added
}

func btcAbove(level float64) Rule {
	return Rule{Coin: "BTC", Source: Mark, Direction: Above, Level: level}
}

func TestAddFillsInIdentityAndState(t *testing.T) {
	_, rules := newEngine(t, btcAbove(80_000))
	r := rules[0]
	if r.ID == "" || r.Status != Active || !r.Armed || !r.CreatedAt.Equal(t0) {
		t.Fatalf("got %+v", r)
	}
}

func TestFiresOnceWhenPriceCrosses(t *testing.T) {
	e, rules := newEngine(t, btcAbove(80_000))
	if fires, _ := e.Observe("BTC", Mark, 79_000, at(1)); len(fires) != 0 {
		t.Fatalf("fired below the level: %+v", fires)
	}
	fires, changed := e.Observe("BTC", Mark, 80_000, at(2))
	if len(fires) != 1 || !changed {
		t.Fatalf("want one fire at the level, got %+v changed=%v", fires, changed)
	}
	f := fires[0]
	if f.RuleID != rules[0].ID || f.Px != 80_000 || !f.At.Equal(at(2)) || f.AlreadyBeyond {
		t.Errorf("fire %+v", f)
	}
	if f.ID != rules[0].ID+":1" {
		t.Errorf("fire id %q", f.ID)
	}
	if fires, _ := e.Observe("BTC", Mark, 81_000, at(3)); len(fires) != 0 {
		t.Errorf("a one-shot alert fired again: %+v", fires)
	}
	if got := e.Rules()[0]; got.Status != Fired || got.FireCount != 1 || !got.LastFiredAt.Equal(at(2)) {
		t.Errorf("rule after firing: %+v", got)
	}
}

func TestBelow(t *testing.T) {
	e, _ := newEngine(t, Rule{Coin: "ETH", Source: Mark, Direction: Below, Level: 2_000})
	if fires, _ := e.Observe("ETH", Mark, 2_000.01, at(1)); len(fires) != 0 {
		t.Fatal("fired above a below-level")
	}
	if fires, _ := e.Observe("ETH", Mark, 1_999, at(2)); len(fires) != 1 {
		t.Fatal("did not fire below the level")
	}
}

// A price already past the level fires, even with no crossing seen: after a
// restart or a dropped feed there is no "previous" price to cross from, and
// an alert (later, a stop) must not be silently skipped.
func TestFiresWhenFirstPriceIsAlreadyBeyond(t *testing.T) {
	e, _ := newEngine(t, btcAbove(80_000))
	fires, _ := e.Observe("BTC", Mark, 82_000, at(1))
	if len(fires) != 1 || !fires[0].AlreadyBeyond {
		t.Fatalf("want one fire marked AlreadyBeyond, got %+v", fires)
	}
}

func TestGapMarksTheNextFireAlreadyBeyond(t *testing.T) {
	e, _ := newEngine(t, btcAbove(80_000))
	e.Observe("BTC", Mark, 79_000, at(1))
	e.Gap()
	fires, _ := e.Observe("BTC", Mark, 81_000, at(60))
	if len(fires) != 1 || !fires[0].AlreadyBeyond {
		t.Fatalf("want AlreadyBeyond after a gap, got %+v", fires)
	}
}

func TestOnlyMatchingCoinAndSource(t *testing.T) {
	e, _ := newEngine(t, btcAbove(80_000))
	if fires, _ := e.Observe("ETH", Mark, 90_000, at(1)); len(fires) != 0 {
		t.Error("fired on another coin")
	}
	if fires, _ := e.Observe("BTC", Mid, 90_000, at(1)); len(fires) != 0 {
		t.Error("fired on another price source")
	}
}

func TestCoinNamesAreExact(t *testing.T) {
	// kPEPE and xyz:NVDA are real Hyperliquid names; case matters.
	e, _ := newEngine(t, Rule{Coin: "kPEPE", Source: Mark, Direction: Above, Level: 1})
	if fires, _ := e.Observe("KPEPE", Mark, 2, at(1)); len(fires) != 0 {
		t.Error("matched a differently cased coin")
	}
	if fires, _ := e.Observe("kPEPE", Mark, 2, at(1)); len(fires) != 1 {
		t.Error("did not match the exact coin")
	}
}

func TestRepeatRearmsOnlyAfterTheGap(t *testing.T) {
	e, _ := newEngine(t, Rule{Coin: "BTC", Source: Mark, Direction: Above, Level: 100, Repeat: true, RearmPct: 1})
	steps := []struct {
		px   float64
		fire bool
	}{
		{99, false},
		{100, true},    // fires
		{100.5, false}, // still beyond: disarmed
		{99.5, false},  // back under, but less than 1% under: still disarmed
		{100.2, false}, // so this is not a new crossing
		{99, false},    // 1% under: rearms
		{100.1, true},  // fires again
	}
	for i, s := range steps {
		fires, _ := e.Observe("BTC", Mark, s.px, at(i))
		if (len(fires) == 1) != s.fire {
			t.Fatalf("step %d px %v: fires %+v, want fire=%v", i, s.px, fires, s.fire)
		}
	}
	if got := e.Rules()[0]; got.Status != Active || got.FireCount != 2 {
		t.Errorf("repeating rule %+v", got)
	}
}

func TestRepeatBelowRearmsAbove(t *testing.T) {
	e, _ := newEngine(t, Rule{Coin: "BTC", Source: Mark, Direction: Below, Level: 100, Repeat: true, RearmPct: 2})
	for i, s := range []struct {
		px   float64
		fire bool
	}{{99, true}, {101, false}, {99, false}, {102, false}, {99.9, true}} {
		if fires, _ := e.Observe("BTC", Mark, s.px, at(i)); (len(fires) == 1) != s.fire {
			t.Fatalf("step %d px %v: fires %+v", i, s.px, fires)
		}
	}
}

func TestHoldRequiresContinuousTimeBeyond(t *testing.T) {
	e, _ := newEngine(t, Rule{Coin: "BTC", Source: Mark, Direction: Above, Level: 100, HoldSeconds: 10})
	e.Observe("BTC", Mark, 99, at(0))
	if fires, _ := e.Observe("BTC", Mark, 101, at(1)); len(fires) != 0 {
		t.Fatal("fired before the hold")
	}
	if fires, _ := e.Observe("BTC", Mark, 99, at(5)); len(fires) != 0 {
		t.Fatal("fired after dropping back")
	}
	e.Observe("BTC", Mark, 101, at(6)) // the clock restarts here
	if fires, _ := e.Observe("BTC", Mark, 102, at(15)); len(fires) != 0 {
		t.Fatal("fired 9s into a new hold")
	}
	if fires, _ := e.Observe("BTC", Mark, 102, at(16)); len(fires) != 1 {
		t.Fatal("did not fire after 10s beyond")
	}
}

func TestGapRestartsTheHold(t *testing.T) {
	e, _ := newEngine(t, Rule{Coin: "BTC", Source: Mark, Direction: Above, Level: 100, HoldSeconds: 10})
	e.Observe("BTC", Mark, 101, at(0))
	e.Gap() // the price may have dipped back while the feed was down
	if fires, _ := e.Observe("BTC", Mark, 101, at(11)); len(fires) != 0 {
		t.Fatal("counted time across a gap toward the hold")
	}
	if fires, _ := e.Observe("BTC", Mark, 101, at(21)); len(fires) != 1 {
		t.Fatal("did not fire 10s after the gap")
	}
}

func TestPausedRulesDoNotFire(t *testing.T) {
	e, rules := newEngine(t, btcAbove(100))
	if err := e.SetPaused(rules[0].ID, true); err != nil {
		t.Fatal(err)
	}
	if fires, _ := e.Observe("BTC", Mark, 101, at(1)); len(fires) != 0 {
		t.Fatal("a paused rule fired")
	}
	if err := e.SetPaused(rules[0].ID, false); err != nil {
		t.Fatal(err)
	}
	fires, _ := e.Observe("BTC", Mark, 101, at(2))
	if len(fires) != 1 || !fires[0].AlreadyBeyond {
		t.Fatalf("resumed rule: %+v", fires)
	}
}

func TestCannotResumeAFiredRule(t *testing.T) {
	e, rules := newEngine(t, btcAbove(100))
	e.Observe("BTC", Mark, 101, at(1))
	if err := e.SetPaused(rules[0].ID, false); err == nil {
		t.Fatal("resumed a fired one-shot rule")
	}
}

func TestExpiry(t *testing.T) {
	exp := at(10)
	e, _ := newEngine(t, Rule{Coin: "BTC", Source: Mark, Direction: Above, Level: 100, ExpiresAt: &exp})
	if fires, changed := e.Observe("BTC", Mark, 101, at(10)); len(fires) != 0 || !changed {
		t.Fatalf("at expiry: fires %+v changed=%v", fires, changed)
	}
	if got := e.Rules()[0]; got.Status != Expired {
		t.Fatalf("status %s", got.Status)
	}
}

func TestExpireSweepsQuietRules(t *testing.T) {
	exp := at(10)
	e, _ := newEngine(t, Rule{Coin: "QUIET", Source: Mark, Direction: Above, Level: 100, ExpiresAt: &exp})
	if e.Expire(at(9)) {
		t.Fatal("expired early")
	}
	if !e.Expire(at(10)) || e.Rules()[0].Status != Expired {
		t.Fatal("did not expire")
	}
}

func TestRemove(t *testing.T) {
	e, rules := newEngine(t, btcAbove(100))
	if !e.Remove(rules[0].ID) || e.Remove(rules[0].ID) {
		t.Fatal("Remove should succeed once")
	}
	if fires, _ := e.Observe("BTC", Mark, 101, at(1)); len(fires) != 0 {
		t.Fatal("a removed rule fired")
	}
}

func TestRestoredRulesKeepTheirState(t *testing.T) {
	e, _ := newEngine(t, Rule{Coin: "BTC", Source: Mark, Direction: Above, Level: 100, Repeat: true, RearmPct: 1})
	e.Observe("BTC", Mark, 101, at(1)) // fires and disarms
	restored := NewEngine(e.Rules(), func() time.Time { return at(2) })
	if fires, _ := restored.Observe("BTC", Mark, 101, at(3)); len(fires) != 0 {
		t.Fatal("a disarmed rule fired again after a restart")
	}
	restored.Observe("BTC", Mark, 98, at(4))
	fires, _ := restored.Observe("BTC", Mark, 101, at(5))
	if len(fires) != 1 || fires[0].ID != e.Rules()[0].ID+":2" {
		t.Fatalf("second fire after restart: %+v", fires)
	}
}

func TestValidate(t *testing.T) {
	past := at(-1)
	bad := map[string]Rule{
		"no coin":            {Source: Mark, Direction: Above, Level: 1},
		"bad coin":           {Coin: "BTC USD", Source: Mark, Direction: Above, Level: 1},
		"long coin":          {Coin: strings.Repeat("A", 41), Source: Mark, Direction: Above, Level: 1},
		"bad source":         {Coin: "BTC", Source: "last", Direction: Above, Level: 1},
		"bad direction":      {Coin: "BTC", Source: Mark, Direction: "sideways", Level: 1},
		"zero level":         {Coin: "BTC", Source: Mark, Direction: Above},
		"repeat no gap":      {Coin: "BTC", Source: Mark, Direction: Above, Level: 1, Repeat: true},
		"gap without repeat": {Coin: "BTC", Source: Mark, Direction: Above, Level: 1, RearmPct: 1},
		"gap too big":        {Coin: "BTC", Source: Mark, Direction: Above, Level: 1, Repeat: true, RearmPct: 60},
		"negative hold":      {Coin: "BTC", Source: Mark, Direction: Above, Level: 1, HoldSeconds: -1},
		"hold over a day":    {Coin: "BTC", Source: Mark, Direction: Above, Level: 1, HoldSeconds: 86_401},
		"expired":            {Coin: "BTC", Source: Mark, Direction: Above, Level: 1, ExpiresAt: &past},
		"long note":          {Coin: "BTC", Source: Mark, Direction: Above, Level: 1, Note: strings.Repeat("x", 201)},
	}
	e, _ := newEngine(t)
	for name, r := range bad {
		if _, err := e.Add(r); err == nil {
			t.Errorf("%s: accepted %+v", name, r)
		}
	}
	for _, coin := range []string{"BTC", "kPEPE", "@107", "xyz:NVDA", "PURR/USDC"} {
		if _, err := e.Add(Rule{Coin: coin, Source: Mark, Direction: Above, Level: 1}); err != nil {
			t.Errorf("rejected coin %q: %v", coin, err)
		}
	}
}

func TestBeyond(t *testing.T) {
	if !Beyond(Above, 100, 100) || Beyond(Above, 100, 99.99) || !Beyond(Below, 100, 100) || Beyond(Below, 100, 100.01) {
		t.Fatal("Beyond is wrong at the boundaries")
	}
}

func TestRulesAreSortedByCreation(t *testing.T) {
	now := t0
	e := NewEngine(nil, func() time.Time { now = now.Add(time.Second); return now })
	for _, coin := range []string{"C", "A", "B"} {
		if _, err := e.Add(Rule{Coin: coin, Source: Mark, Direction: Above, Level: 1}); err != nil {
			t.Fatal(err)
		}
	}
	var got []string
	for _, r := range e.Rules() {
		got = append(got, r.Coin)
	}
	if strings.Join(got, "") != "CAB" {
		t.Fatalf("order %v", got)
	}
}
