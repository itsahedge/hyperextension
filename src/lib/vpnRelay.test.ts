import { describe, expect, it, vi } from "vitest";
import { relayVpnRequest } from "./vpnRelay";

function fakeFetch(reply: { status?: number; body: unknown }) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const status = reply.status ?? 200;
    const text = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(text, { status });
  });
}

const location = { country: "Switzerland", countryCode: "CH", city: "Zurich", hostname: "ch01.wg.ivpn.net", host: "185.212.170.2", publicKey: "k", load: 10 };

describe("relayVpnRequest", () => {
  it("reads state and servers with GET", async () => {
    const f = fakeFetch({ body: { enabled: false, connected: false, connecting: false } });
    expect(await relayVpnRequest({ vpn: "state" }, f)).toEqual({ enabled: false, connected: false, connecting: false });
    expect(f).toHaveBeenCalledWith("/api/vpn/state", expect.objectContaining({ method: "GET" }));
    await relayVpnRequest({ vpn: "servers" }, f);
    expect(f).toHaveBeenLastCalledWith("/api/vpn/servers", expect.objectContaining({ method: "GET" }));
  });

  it("turns on with only the server choice: the config stays on the Mac mini", async () => {
    const f = fakeFetch({ body: { enabled: true } });
    await relayVpnRequest({ vpn: "up", conf: "[Interface]\nPrivateKey = secret", location }, f);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("/api/vpn/up");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ location });
    expect(String(init?.body)).not.toContain("secret");
  });

  it("turns off with a JSON POST", async () => {
    const f = fakeFetch({ body: { enabled: false } });
    await relayVpnRequest({ vpn: "down" }, f);
    expect(f).toHaveBeenCalledWith("/api/vpn/down", expect.objectContaining({ method: "POST", body: "{}" }));
  });

  it("throws the server's message on an error", async () => {
    const f = fakeFetch({ status: 403, body: "forbidden\n" });
    await expect(relayVpnRequest({ vpn: "state" }, f)).rejects.toThrow("Mac mini: forbidden");
  });
});
