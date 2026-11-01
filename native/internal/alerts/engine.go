// Package alerts holds price-alert rules and decides when they fire. It does
// no I/O: the feed calls Observe with prices, and the caller stores the
// rules and delivers the fires.
//
// An alert fires whenever its price is at or past the level, not only on a
// crossing. After a restart or a dropped feed there is no previous price to
// cross from, and an alert (and later a stop) must not be silently skipped;
// such a fire is marked AlreadyBeyond so the message can say so.
package alerts

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"sync"
	"time"
)

type Source string

const (
	Mark Source = "mark" // Hyperliquid's mark price, which also triggers its TP/SL orders
	Mid  Source = "mid"  // book mid
)

type Direction string

const (
	Above Direction = "above"
	Below Direction = "below"
)

type Status string

const (
	Active  Status = "active"
	Paused  Status = "paused"
	Fired   Status = "fired" // a one-shot rule that fired; repeating rules stay active
	Expired Status = "expired"
)

const (
	MaxNote        = 200
	MaxHoldSeconds = 86_400
	MaxRearmPct    = 50
)

// Coin names as Hyperliquid writes them: "BTC", "kPEPE", "@107" (spot),
// "xyz:NVDA" (HIP-3), "PURR/USDC". Case matters.
var coinRE = regexp.MustCompile(`^[A-Za-z0-9@:/._-]{1,40}$`)

type Rule struct {
	ID        string    `json:"id"`
	Coin      string    `json:"coin"`
	Source    Source    `json:"source"`
	Direction Direction `json:"direction"`
	Level     float64   `json:"level"`
	// Repeat rules fire again once the price has gone back past the level
	// by RearmPct percent; one-shot rules (the default) fire once.
	Repeat   bool    `json:"repeat,omitempty"`
	RearmPct float64 `json:"rearmPct,omitempty"`
	// The price must stay past the level this long before firing. Checked on
	// each price update, so it fires on the first update after the hold.
	HoldSeconds int        `json:"holdSeconds,omitempty"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
	Note        string     `json:"note,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`

	Status Status `json:"status"`
	// False while a repeating rule waits to rearm.
	Armed       bool       `json:"armed"`
	FireCount   int        `json:"fireCount"`
	LastFiredAt *time.Time `json:"lastFiredAt,omitempty"`

	// Runtime only: a restart counts as a gap.
	seenInside  bool
	beyondSince *time.Time
}

// Fire is one triggering of a rule. ID is "<rule id>:<n>" for the rule's
// n-th fire, so a delivery retried after a crash can be recognized.
type Fire struct {
	ID        string    `json:"id"`
	RuleID    string    `json:"ruleId"`
	Coin      string    `json:"coin"`
	Source    Source    `json:"source"`
	Direction Direction `json:"direction"`
	Level     float64   `json:"level"`
	Px        float64   `json:"px"`
	At        time.Time `json:"at"`
	// The first price seen since the rule was created or resumed, the
	// service started, or the feed recovered was already past the level.
	AlreadyBeyond bool   `json:"alreadyBeyond,omitempty"`
	Note          string `json:"note,omitempty"`
}

// Beyond reports whether px is at or past level in direction d.
func Beyond(d Direction, level, px float64) bool {
	if d == Above {
		return px >= level
	}
	return px <= level
}

type Engine struct {
	mu    sync.Mutex
	rules map[string]*Rule
	now   func() time.Time
}

// NewEngine restores saved rules. now is the clock used for new rules and
// expiry checks.
func NewEngine(saved []Rule, now func() time.Time) *Engine {
	e := &Engine{rules: map[string]*Rule{}, now: now}
	for _, r := range saved {
		r.seenInside, r.beyondSince = false, nil
		e.rules[r.ID] = &r
	}
	return e
}

// Validate checks the fields a user sets.
func Validate(r Rule, now time.Time) error {
	switch {
	case !coinRE.MatchString(r.Coin):
		return fmt.Errorf("coin %q: use Hyperliquid's name, e.g. BTC, @107 or xyz:NVDA", r.Coin)
	case r.Source != Mark && r.Source != Mid:
		return fmt.Errorf("price %q: use mark or mid", r.Source)
	case r.Direction != Above && r.Direction != Below:
		return fmt.Errorf("direction %q: use above or below", r.Direction)
	case !(r.Level > 0) || math.IsInf(r.Level, 0):
		return errors.New("level must be a positive price")
	case r.Repeat && !(r.RearmPct > 0 && r.RearmPct <= MaxRearmPct):
		return fmt.Errorf("a repeating alert needs a rearm gap above 0%% and at most %d%%", MaxRearmPct)
	case !r.Repeat && r.RearmPct != 0:
		return errors.New("a rearm gap only applies to repeating alerts")
	case r.HoldSeconds < 0 || r.HoldSeconds > MaxHoldSeconds:
		return fmt.Errorf("hold must be 0 to %d seconds", MaxHoldSeconds)
	case r.ExpiresAt != nil && !r.ExpiresAt.After(now):
		return errors.New("expiry must be in the future")
	case len([]rune(r.Note)) > MaxNote:
		return fmt.Errorf("note over %d characters", MaxNote)
	}
	return nil
}

// Add validates a new rule and returns it as stored, with its ID and state.
func (e *Engine) Add(r Rule) (Rule, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	now := e.now()
	if err := Validate(r, now); err != nil {
		return Rule{}, err
	}
	r.ID = newID()
	r.CreatedAt = now
	r.Status, r.Armed, r.FireCount, r.LastFiredAt = Active, true, 0, nil
	r.seenInside, r.beyondSince = false, nil
	e.rules[r.ID] = &r
	return r, nil
}

func (e *Engine) Remove(id string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	_, ok := e.rules[id]
	delete(e.rules, id)
	return ok
}

// SetPaused pauses or resumes an active rule. Fired and expired rules stay
// as they are.
func (e *Engine) SetPaused(id string, paused bool) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	r, ok := e.rules[id]
	switch {
	case !ok:
		return errors.New("no such alert")
	case r.Status != Active && r.Status != Paused:
		return fmt.Errorf("the alert is %s", r.Status)
	}
	if paused {
		r.Status = Paused
	} else {
		r.Status = Active
	}
	// Prices seen while paused were not checked, so treat resuming as a gap.
	r.seenInside, r.beyondSince = false, nil
	return nil
}

// Rules returns copies, oldest first.
func (e *Engine) Rules() []Rule {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make([]Rule, 0, len(e.rules))
	for _, r := range e.rules {
		out = append(out, *r)
	}
	slices.SortFunc(out, func(a, b Rule) int {
		if c := a.CreatedAt.Compare(b.CreatedAt); c != 0 {
			return c
		}
		if a.ID < b.ID {
			return -1
		}
		return 1
	})
	return out
}

// Gap records that prices may have been missed (feed down or stale): no
// rule may assume it saw the price stay on one side.
func (e *Engine) Gap() {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, r := range e.rules {
		r.seenInside, r.beyondSince = false, nil
	}
}

// Expire marks rules past their expiry, for coins with no recent price.
// It reports whether any rule changed.
func (e *Engine) Expire(now time.Time) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	changed := false
	for _, r := range e.rules {
		if expire(r, now) {
			changed = true
		}
	}
	return changed
}

func expire(r *Rule, now time.Time) bool {
	if (r.Status == Active || r.Status == Paused) && r.ExpiresAt != nil && !now.Before(*r.ExpiresAt) {
		r.Status = Expired
		return true
	}
	return false
}

// Observe checks one price against the rules for that coin and price
// source. changed reports a stored-state change (a fire, a rearm or an
// expiry) that the caller should save.
func (e *Engine) Observe(coin string, src Source, px float64, at time.Time) (fires []Fire, changed bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, r := range e.rules {
		if r.Coin != coin || r.Source != src || r.Status != Active {
			continue
		}
		if expire(r, at) {
			changed = true
			continue
		}
		if !r.Armed {
			if rearmed(r, px) {
				r.Armed, r.seenInside = true, true
				changed = true
			}
			continue
		}
		if !Beyond(r.Direction, r.Level, px) {
			r.seenInside, r.beyondSince = true, nil
			continue
		}
		if r.HoldSeconds > 0 {
			if r.beyondSince == nil {
				start := at
				r.beyondSince = &start
				continue
			}
			if at.Sub(*r.beyondSince) < time.Duration(r.HoldSeconds)*time.Second {
				continue
			}
		}
		fires = append(fires, fire(r, px, at))
		changed = true
	}
	slices.SortFunc(fires, func(a, b Fire) int {
		if a.ID < b.ID {
			return -1
		}
		return 1
	})
	return fires, changed
}

func rearmed(r *Rule, px float64) bool {
	gap := r.RearmPct / 100
	if r.Direction == Above {
		return px <= r.Level*(1-gap)
	}
	return px >= r.Level*(1+gap)
}

func fire(r *Rule, px float64, at time.Time) Fire {
	r.FireCount++
	t := at
	r.LastFiredAt = &t
	f := Fire{
		ID:            r.ID + ":" + strconv.Itoa(r.FireCount),
		RuleID:        r.ID,
		Coin:          r.Coin,
		Source:        r.Source,
		Direction:     r.Direction,
		Level:         r.Level,
		Px:            px,
		At:            at,
		AlreadyBeyond: !r.seenInside,
		Note:          r.Note,
	}
	r.beyondSince = nil
	if r.Repeat {
		r.Armed = false
	} else {
		r.Status = Fired
	}
	return f
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read never fails on supported platforms
	return hex.EncodeToString(b)
}
