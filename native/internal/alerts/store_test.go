package alerts

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingFileIsEmpty(t *testing.T) {
	st, err := Load(filepath.Join(t.TempDir(), "alerts.json"))
	if err != nil || len(st.Rules) != 0 || len(st.Outbox) != 0 {
		t.Fatalf("got %+v, %v", st, err)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "alerts.json")
	e, _ := newEngine(t, btcAbove(100), Rule{Coin: "ETH", Source: Mid, Direction: Below, Level: 2, Repeat: true, RearmPct: 1, Note: "dip"})
	fires, _ := e.Observe("BTC", Mark, 101, at(1))
	want := State{Rules: e.Rules(), Outbox: fires}
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(want)
	b, _ := json.Marshal(got)
	if string(a) != string(b) {
		t.Fatalf("round trip:\n%s\n%s", a, b)
	}
}

func TestSaveIsPrivateAndLeavesNoTempFiles(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "alerts.json")
	for range 2 {
		if err := Save(path, State{}); err != nil {
			t.Fatal(err)
		}
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Errorf("mode %v, want 0600", fi.Mode().Perm())
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("leftover files: %v", entries)
	}
}

func TestLoadRejectsACorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "alerts.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("want an error, not an empty rule set that would drop every alert")
	}
}

func TestLoadRejectsAnInvalidRule(t *testing.T) {
	path := filepath.Join(t.TempDir(), "alerts.json")
	if err := os.WriteFile(path, []byte(`{"rules":[{"id":"x","coin":"BTC","source":"mark","direction":"up","level":1,"status":"active"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("loaded a rule with an invalid direction")
	}
}

func TestAppendHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.jsonl")
	e, _ := newEngine(t, btcAbove(100), Rule{Coin: "BTC", Source: Mark, Direction: Above, Level: 99})
	fires, _ := e.Observe("BTC", Mark, 101, at(1))
	if err := AppendHistory(path, fires[:1]); err != nil {
		t.Fatal(err)
	}
	if err := AppendHistory(path, fires[1:]); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	var got []Fire
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var fr Fire
		if err := json.Unmarshal(sc.Bytes(), &fr); err != nil {
			t.Fatal(err)
		}
		got = append(got, fr)
	}
	if len(got) != 2 || got[0].ID != fires[0].ID || got[1].ID != fires[1].ID {
		t.Fatalf("history %+v", got)
	}
	if fi, _ := os.Stat(path); fi.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", fi.Mode().Perm())
	}
}
