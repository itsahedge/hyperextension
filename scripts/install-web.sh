#!/usr/bin/env bash
# Builds the web app and hx-web, installs them under
# ~/Library/Application Support/Hyperextension and (re)starts the launchd
# agent. hx-web listens on 127.0.0.1:4320 only; this does not expose it.
# Exposing it to the tailnet is a separate, manual step:
#
#   tailscale serve --bg --https=8443 http://127.0.0.1:4320
#
# Required environment, written into the plist:
#   HX_ALLOW_LOGIN, HX_KEEPASS_DB, HX_KEEPASS_ENTRY, HX_KEYCHAIN_ACCOUNT, HX_KEYCHAIN_SERVICE
#   (see scripts/hx-web.sh)
set -euo pipefail

for v in HX_ALLOW_LOGIN HX_KEEPASS_DB HX_KEEPASS_ENTRY HX_KEYCHAIN_ACCOUNT HX_KEYCHAIN_SERVICE; do
  [[ -n "${!v:-}" ]] || { echo "set $v" >&2; exit 1; }
done

root=$(cd "$(dirname "$0")/.." && pwd)
dir="$HOME/Library/Application Support/Hyperextension"
label="com.hyperextension.web"
plist="$HOME/Library/LaunchAgents/$label.plist"

(cd "$root" && pnpm build:web)
mkdir -p "$dir"
(cd "$root/native" && go build -trimpath -o "$dir/hx-web" ./cmd/hx-web)
rm -rf "$dir/web.new" && cp -R "$root/.output/web" "$dir/web.new"
rm -rf "$dir/web" && mv "$dir/web.new" "$dir/web"
install -m 0755 "$root/scripts/hx-web.sh" "$dir/hx-web.sh"

python3 - "$plist" "$label" "$dir" <<'EOF'
import os, plistlib, sys
out, label, d = sys.argv[1:]
env = {k: os.environ[k] for k in ("HX_ALLOW_LOGIN", "HX_KEEPASS_DB", "HX_KEEPASS_ENTRY", "HX_KEYCHAIN_ACCOUNT", "HX_KEYCHAIN_SERVICE")}
env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin"
with open(out, "wb") as f:
    plistlib.dump({
        "Label": label,
        "ProgramArguments": ["/bin/bash", os.path.join(d, "hx-web.sh")],
        "EnvironmentVariables": env,
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "StandardErrorPath": os.path.join(d, "hx-web.log"),
        "StandardOutPath": os.path.join(d, "hx-web.log"),
    }, f)
os.chmod(out, 0o600)
EOF

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "hx-web running on 127.0.0.1:4320 (log: $dir/hx-web.log)"
