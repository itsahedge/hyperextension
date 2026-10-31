import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { API_ORIGINS, WEBSOCKET_ORIGINS } from "./src/apiOrigins";

// The web app: the same screens and lib as the extension, built as a static
// site into .output/web and served from the Mac mini over Tailscale
// (`tailscale serve`, tailnet only). "@/platform" resolves to the web platform
// (localStorage + memory, no master key, no VPN) instead of the extension's.
const src = fileURLToPath(new URL("./src", import.meta.url));

// Like the extension's CSP: only bundled scripts run, and requests can only go
// to the APIs the app uses, so injected code has nowhere to send a key.
// Build only: the dev server injects an inline React refresh script.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${[...API_ORIGINS, ...WEBSOCKET_ORIGINS].join(" ")}`,
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
  // Loopback only; Tailscale Serve is the one way in from other devices.
  server: { host: "127.0.0.1", port: 4310, strictPort: true },
  preview: { host: "127.0.0.1", port: 4310, strictPort: true },
});
