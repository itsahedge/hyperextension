import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// The web app: the same screens and lib as the extension, built as a static
// site into .output/web and served by hx-web (native/cmd/hx-web) on the Mac
// mini behind `tailscale serve`. "@/platform" resolves to the web platform
// (localStorage + memory, no master key, API calls through the Mac mini's
// relay) instead of the extension's.
const src = fileURLToPath(new URL("./src", import.meta.url));

// Only bundled scripts run, and the page can only talk to its own origin:
// every API call goes through hx-web's relay (platform/relay.ts), so injected
// code has nowhere else to send a key. hx-web sends the same policy as a
// header (webhost.contentSecurityPolicy, plus frame-ancestors). Build only:
// the dev server injects an inline React refresh script.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "hyperextension-csp",
    apply: "build",
    transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" }],
  };
}

function devProxy() {
  const target = { target: "http://127.0.0.1:4320", ws: true, headers: { "Tailscale-User-Login": process.env.HX_DEV_LOGIN ?? "" } };
  return { "/relay": target, "/api": target };
}

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  resolve: {
    alias: [
      { find: /^@\/platform$/, replacement: `${src}/platform/web.ts` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  build: { outDir: "../../.output/web", emptyOutDir: true },
  // Loopback only. For local development, /relay and /api go to a running
  // hx-web (pnpm web:serve), with HX_DEV_LOGIN standing in for the identity
  // header tailscale serve would add.
  server: { host: "127.0.0.1", port: 4310, strictPort: true, proxy: devProxy() },
  preview: { host: "127.0.0.1", port: 4310, strictPort: true, proxy: devProxy() },
});
