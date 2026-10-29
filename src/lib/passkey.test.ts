import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "./passkey";

describe("base64url", () => {
  it("round-trips arbitrary bytes without padding or +/", () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x01, 0xfe, 0xfa]);
    const encoded = toBase64Url(bytes);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(fromBase64Url(encoded)).toEqual(bytes);
  });

  it("handles every padding length", () => {
    for (let n = 0; n < 6; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
  });
});
