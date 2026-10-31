import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";
import { API_ORIGINS } from "./src/apiOrigins";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Hyperextension",
    description: "Personal Hyperliquid trading wallet",
    // Public key only; pins the extension ID (afafdoeghnoiaopgfhnipaldoekldgoo) so passkeys, whose RP ID is
    // the extension ID, keep working when the unpacked folder moves.
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1oCTABB7H8I7Fxwc7kHn/pn4TgDz7/jbMuJHkcKcY6ImD+gf+zHXhBei68RZyXvTAJUg7xGXTDnwQpZH4UZQ6QQneCYY1Z0/q+bR8MF+juyS2bgO/rZaEe1pdN+2q/eV/oFEem5YQIetm3JS5wQHgOm35YHAePBvuKZ0aPt8SkqZ1/QMjlHM8AUdvrZWqflJGIdJw2/Bb6g6Z7uuS4BXvSDbMk3Tpm4TVBBRxrgBjSDnX9eRMmNI78CbQcPaVc1luj/tIXWAsZTVllyeUlNU2kwm1sKqRQVPh4vsUH8DNCIA3FRn54qzRiOfRVC07WDFPRBKRA78WdxlR16zoEyQfQIDAQAB",
    // alarms + idle: background auto-lock on inactivity and on screen lock.
    // proxy + nativeMessaging: the WireGuard VPN helper (native/) and routing to it.
    permissions: ["storage", "alarms", "idle", "proxy", "nativeMessaging"],
    // The VPN routes exactly these hosts (lib/vpn.ts routedHosts).
    host_permissions: API_ORIGINS.map((origin) => `${origin}/*`),
  },
});
