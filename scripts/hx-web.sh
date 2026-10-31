#!/usr/bin/env bash
# launchd runs this (scripts/install-web.sh writes the plist): reads the
# WireGuard config from KeePassXC and pipes it to hx-web, which keeps it in
# memory only. Without a readable entry hx-web still starts, VPN unavailable.
#
# Environment (set in the plist):
#   HX_ALLOW_LOGIN       Tailscale login(s) allowed in, comma-separated
#   HX_KEEPASS_DB        KeePassXC database path
#   HX_KEEPASS_ENTRY     entry whose Notes hold the wg-quick .conf
#   HX_KEYCHAIN_ACCOUNT  login-keychain item holding the database password
#   HX_KEYCHAIN_SERVICE
set -euo pipefail

dir="$HOME/Library/Application Support/Hyperextension"
cli=/Applications/KeePassXC.app/Contents/MacOS/keepassxc-cli

conf=""
if [[ -x "$cli" && -f "${HX_KEEPASS_DB:-}" ]]; then
  conf=$(security find-generic-password -a "$HX_KEYCHAIN_ACCOUNT" -s "$HX_KEYCHAIN_SERVICE" -w |
    "$cli" show -s -a Notes "$HX_KEEPASS_DB" "$HX_KEEPASS_ENTRY" 2>/dev/null) || conf=""
fi
[[ -n "$conf" ]] || echo "hx-web.sh: no WireGuard config from KeePassXC; the VPN cannot be turned on" >&2

printf '%s' "$conf" | exec "$dir/hx-web" -wg-conf-stdin -static "$dir/web" -allow-login "$HX_ALLOW_LOGIN"
