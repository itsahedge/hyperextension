#!/usr/bin/env bash
# Builds the hx-vpn helper and registers it with Chrome as a native messaging
# host for this extension only. Re-run after changing native/ code.
#
#   pnpm vpn:install                       # default Chrome profile directory
#   pnpm vpn:install "<chrome user-data-dir>"   # e.g. a test profile
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# Host name and extension ID must stay in sync with VPN_HOST in src/lib/vpn.ts,
# extensionOrigin in native/cmd/hx-vpn/main.go and the manifest key.
name="hyperextension.vpn"
extension_id="afafdoeghnoiaopgfhnipaldoekldgoo"

chrome_dir="${1:-$HOME/Library/Application Support/Google/Chrome}"
bin_dir="$HOME/Library/Application Support/Hyperextension"
hosts_dir="$chrome_dir/NativeMessagingHosts"
bin="$bin_dir/hx-vpn"

mkdir -p "$bin_dir" "$hosts_dir"
(cd "$root/native" && go build -trimpath -o "$bin" ./cmd/hx-vpn)

python3 - "$hosts_dir/$name.json" "$name" "$bin" "$extension_id" <<'EOF'
import json, sys
out, name, path, ext = sys.argv[1:]
manifest = {
    "name": name,
    "description": "Hyperextension WireGuard VPN helper",
    "path": path,
    "type": "stdio",
    "allowed_origins": [f"chrome-extension://{ext}/"],
}
with open(out, "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
EOF

echo "Installed $bin"
echo "Registered $hosts_dir/$name.json"
