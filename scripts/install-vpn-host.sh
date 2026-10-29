#!/usr/bin/env bash
# Builds the hx-vpn helper and registers it with Chrome as a native messaging
# host for this extension only. Re-run after changing native/ code.
#
#   pnpm vpn:install                            # every installed Chrome / Brave
#   pnpm vpn:install "<browser user-data-dir>"  # one directory, e.g. a test profile
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
# Host name and extension ID must stay in sync with VPN_HOST in src/lib/vpn.ts,
# extensionOrigin in native/cmd/hx-vpn/main.go and the manifest key.
name="hyperextension.vpn"
extension_id="afafdoeghnoiaopgfhnipaldoekldgoo"

bin_dir="$HOME/Library/Application Support/Hyperextension"
bin="$bin_dir/hx-vpn"

# Each Chromium browser reads native messaging hosts from
# <user-data-dir>/NativeMessagingHosts.
browser_dirs=()
if [[ $# -gt 0 ]]; then
  browser_dirs=("$1")
else
  for d in "$HOME/Library/Application Support/Google/Chrome" "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"; do
    [[ -d "$d" ]] && browser_dirs+=("$d")
  done
fi
if [[ ${#browser_dirs[@]} -eq 0 ]]; then
  echo "No Chrome or Brave profile directory found; pass the browser's user-data-dir." >&2
  exit 1
fi

mkdir -p "$bin_dir"
(cd "$root/native" && go build -trimpath -o "$bin" ./cmd/hx-vpn)
echo "Installed $bin"

for browser_dir in "${browser_dirs[@]}"; do
  hosts_dir="$browser_dir/NativeMessagingHosts"
  mkdir -p "$hosts_dir"
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
  echo "Registered $hosts_dir/$name.json"
done
