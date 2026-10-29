import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { BLOCKED_PROXY, pacScript, routedHosts, summarizeConf } from "./vpn";

const HOSTS = ["api.hyperliquid.xyz", "api.hyperunit.xyz"];

// Runs the PAC script the way Chrome does: a bare FindProxyForURL in a fresh
// global scope.
function findProxy(script: string, host: string): string {
  return runInNewContext(`${script}\nFindProxyForURL("https://${host}/info", ${JSON.stringify(host)})`) as string;
}

describe("routedHosts", () => {
  it("takes the hostnames from https host permissions", () => {
    expect(routedHosts(["https://api.hyperunit.xyz/*", "https://api.hyperliquid.xyz/*", "https://API.hyperliquid.xyz/*"])).toEqual(HOSTS);
  });

  it("refuses patterns it cannot route exactly", () => {
    for (const p of ["https://*.hyperliquid.xyz/*", "<all_urls>", "http://api.hyperliquid.xyz/*", "https://api.hyperliquid.xyz/info"]) {
      expect(() => routedHosts([p])).toThrow(/Unsupported/);
    }
  });
});

describe("pacScript", () => {
  it("sends routed hosts to the local proxy and everything else direct", () => {
    const pac = pacScript(HOSTS, 51234);
    expect(findProxy(pac, "api.hyperliquid.xyz")).toBe("PROXY 127.0.0.1:51234");
    expect(findProxy(pac, "API.HYPERUNIT.XYZ")).toBe("PROXY 127.0.0.1:51234");
    expect(findProxy(pac, "app.hyperliquid.xyz")).toBe("DIRECT");
    expect(findProxy(pac, "google.com")).toBe("DIRECT");
  });

  it("blocks routed hosts with no DIRECT fallback when not connected", () => {
    const pac = pacScript(HOSTS, null);
    expect(findProxy(pac, "api.hyperliquid.xyz")).toBe(`PROXY ${BLOCKED_PROXY}`);
    expect(findProxy(pac, "api.hyperliquid.xyz")).not.toContain("DIRECT");
    expect(findProxy(pac, "example.com")).toBe("DIRECT");
  });

  it("is not fooled by Object prototype names", () => {
    const pac = pacScript(HOSTS, 51234);
    expect(findProxy(pac, "constructor")).toBe("DIRECT");
    expect(findProxy(pac, "__proto__")).toBe("DIRECT");
  });

  it("rejects invalid ports", () => {
    for (const port of [0, 65536, 1.5, -1]) expect(() => pacScript(HOSTS, port)).toThrow(/Invalid proxy port/);
  });
});

describe("summarizeConf", () => {
  const conf = `[Interface]
PrivateKey = YNQzD8ZKP0Ev1dz2ri0V9b8bUsXN2C+4TBrqYGJz1Wk=
Address = 172.21.0.5/32
DNS = 172.16.0.1

[Peer]
PublicKey = cQvUv7r4aqwAFrlEJW6Ff3YFwPq4L8xT1gDlR3hW4FU=
Endpoint = us-fl2.wg.ivpn.net:2049 # Miami
AllowedIPs = 0.0.0.0/0`;

  it("reads the address and endpoint without exposing the key", () => {
    const s = summarizeConf(conf);
    expect(s).toEqual({ address: "172.21.0.5/32", endpoint: "us-fl2.wg.ivpn.net:2049" });
    expect(JSON.stringify(s)).not.toContain("YNQz");
  });

  it("rejects things that are not a usable single-peer config", () => {
    expect(() => summarizeConf("hello")).toThrow(/PrivateKey/);
    expect(() => summarizeConf(conf.replace(/PrivateKey.*\n/, ""))).toThrow(/PrivateKey/);
    expect(() => summarizeConf(`${conf}\n[Peer]\nPublicKey = x`)).toThrow(/exactly one/);
    expect(() => summarizeConf(conf.replace(/Endpoint.*\n/, ""))).toThrow(/Endpoint/);
  });
});
