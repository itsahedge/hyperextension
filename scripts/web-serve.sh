#!/usr/bin/env bash
# Local development: build the web app and run hx-web in the foreground on
# 127.0.0.1:4320 without a WireGuard config. Pair with pnpm dev:web or
# preview:web (port 4310), which proxy /relay and /api here and send
# HX_DEV_LOGIN as the Tailscale identity.
set -euo pipefail
: "${HX_DEV_LOGIN:?set HX_DEV_LOGIN to any login, e.g. dev@localhost}"
root=$(cd "$(dirname "$0")/.." && pwd)
(cd "$root" && pnpm build:web)
cd "$root/native"
exec go run ./cmd/hx-web -static "$root/.output/web" -allow-login "$HX_DEV_LOGIN" -state "$root/.output/web-vpn-dev.json"
