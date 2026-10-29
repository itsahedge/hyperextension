// Package nmhost speaks Chrome's native messaging protocol and runs the VPN
// for the extension.
package nmhost

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Chrome's limits: messages from the extension are at most 64 MiB, messages
// to it at most 1 MB. Each is UTF-8 JSON preceded by a 32-bit length in
// native byte order (little-endian on every macOS Chrome target).
const (
	maxIncoming = 64 << 20
	maxOutgoing = 1 << 20
)

var errTooLarge = errors.New("native message too large")

// readMessage returns io.EOF when Chrome closes the port.
func readMessage(r io.Reader, v any) error {
	var n uint32
	if err := binary.Read(r, binary.LittleEndian, &n); err != nil {
		if errors.Is(err, io.ErrUnexpectedEOF) {
			return io.EOF
		}
		return err
	}
	if n > maxIncoming {
		return fmt.Errorf("%w: %d bytes", errTooLarge, n)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return fmt.Errorf("reading a %d-byte message: %w", n, err)
	}
	return json.Unmarshal(buf, v)
}

func writeMessage(w io.Writer, v any) error {
	buf, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if len(buf) > maxOutgoing {
		return fmt.Errorf("%w: %d bytes", errTooLarge, len(buf))
	}
	out := make([]byte, 4+len(buf))
	binary.LittleEndian.PutUint32(out, uint32(len(buf))) //nolint:gosec // bounded by maxOutgoing above
	copy(out[4:], buf)
	_, err = w.Write(out)
	return err
}
