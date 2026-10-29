import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: "Hyperextension",
    description: "Personal Hyperliquid trading wallet",
    permissions: ["storage"],
    host_permissions: [
      "https://api.hyperliquid.xyz/*",
      "https://api.hyperliquid-testnet.xyz/*",
    ],
  },
});
