package main

import "testing"

func TestRequireLoopback(t *testing.T) {
	for addr, ok := range map[string]bool{
		"127.0.0.1:4320": true,
		"[::1]:4320":     true,
		"0.0.0.0:4320":   false,
		":4320":          false,
		"100.64.0.1:80":  false,
		"localhost:4320": false, // a name could resolve anywhere
		"nonsense":       false,
	} {
		if err := requireLoopback(addr); (err == nil) != ok {
			t.Errorf("%s: %v", addr, err)
		}
	}
}
