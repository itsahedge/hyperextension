import { describe, expect, it } from "vitest";
import { relayUrl } from "./relay";

const page = { protocol: "https:", host: "mini.example.ts.net:8443" };

describe("relayUrl", () => {
  it("sends HTTPS API calls through the Mac mini's relay", () => {
    expect(relayUrl("https://api.hyperliquid.xyz", page)).toBe("https://mini.example.ts.net:8443/relay/api.hyperliquid.xyz/");
    expect(relayUrl("https://arb1.arbitrum.io/rpc", page)).toBe("https://mini.example.ts.net:8443/relay/arb1.arbitrum.io/rpc");
  });

  it("keeps the path and query", () => {
    expect(relayUrl("https://iris-api.circle.com/v2/burn/USDC/fees/3/19?forward=true", page)).toBe(
      "https://mini.example.ts.net:8443/relay/iris-api.circle.com/v2/burn/USDC/fees/3/19?forward=true",
    );
  });

  it("turns websocket URLs into websocket URLs on the page's host", () => {
    expect(relayUrl("wss://api.hyperliquid.xyz/ws", page)).toBe("wss://mini.example.ts.net:8443/relay/api.hyperliquid.xyz/ws");
    expect(relayUrl("wss://api.hyperliquid.xyz/ws", { protocol: "http:", host: "127.0.0.1:4310" })).toBe(
      "ws://127.0.0.1:4310/relay/api.hyperliquid.xyz/ws",
    );
  });

  it("refuses anything but https and wss on the default port", () => {
    expect(() => relayUrl("http://api.hyperliquid.xyz/info", page)).toThrow(/https or wss/);
    expect(() => relayUrl("https://api.hyperliquid.xyz:8443/info", page)).toThrow(/port/);
    expect(() => relayUrl("https://user@api.hyperliquid.xyz/info", page)).toThrow(/credentials/);
  });
});
