package alerts

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// State is everything saved: the rules, and fires not yet delivered. A fire
// enters the outbox in the same write that records it on its rule, so a
// crash between firing and delivering neither loses nor repeats it.
type State struct {
	Rules  []Rule `json:"rules"`
	Outbox []Fire `json:"outbox"`
}

// Load reads the saved state. A missing file is an empty state; a damaged
// one is an error, never silently an empty rule set.
func Load(path string) (State, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return State{}, nil
	}
	if err != nil {
		return State{}, err
	}
	var st State
	if err := json.Unmarshal(b, &st); err != nil {
		return State{}, fmt.Errorf("%s: %w", path, err)
	}
	for _, r := range st.Rules {
		if err := validateStored(r); err != nil {
			return State{}, fmt.Errorf("%s: alert %q: %w", path, r.ID, err)
		}
	}
	return st, nil
}

func validateStored(r Rule) error {
	if r.ID == "" {
		return errors.New("no id")
	}
	switch r.Status {
	case Active, Paused, Fired, Expired:
	default:
		return fmt.Errorf("status %q", r.Status)
	}
	// A stored expiry may be in the past; Validate only rejects that for new rules.
	return Validate(r, r.CreatedAt.Add(-1))
}

// Save writes the state to a temporary file and renames it over path, so a
// crash leaves the old or the new state, never a partial one.
func Save(path string, st State) error {
	if st.Rules == nil {
		st.Rules = []Rule{}
	}
	if st.Outbox == nil {
		st.Outbox = []Fire{}
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	err = writeSynced(f, b)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		_ = os.Remove(tmp)
	}
	return err
}

func writeSynced(f *os.File, b []byte) error {
	if err := f.Chmod(0o600); err != nil {
		return err
	}
	if _, err := f.Write(b); err != nil {
		return err
	}
	return f.Sync()
}

// AppendHistory adds delivered fires to a JSON-lines log.
func AppendHistory(path string, fires []Fire) error {
	if len(fires) == 0 {
		return nil
	}
	var buf []byte
	for _, fr := range fires {
		line, err := json.Marshal(fr)
		if err != nil {
			return err
		}
		buf = append(append(buf, line...), '\n')
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(buf)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	return err
}
