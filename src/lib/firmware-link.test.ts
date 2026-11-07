import { describe, expect, it } from "vitest";
import { linkKey, makeLink, readLink } from "./firmware-link";

const S = "a-long-test-secret-for-links";
const L = { facility: "11111111-1111-1111-1111-111111111111", board: "esp32-cam" as const, nonce: "abc123", exp: 2_000_000_000 };

describe("install links", () => {
  it("round-trips while fresh", () => {
    const t = makeLink(S, L);
    expect(readLink(S, t, 1_999_999_999)).toEqual({ ok: true, link: L });
  });
  it("refuses expired, forged and garbled links", () => {
    const t = makeLink(S, L);
    expect(readLink(S, t, 2_000_000_001)).toEqual({ ok: false, reason: "expired" });
    expect(readLink("another-secret-entirely", t, 0)).toEqual({ ok: false, reason: "bad" });
    const [p, sig] = t.split(".");
    const other = Buffer.from(JSON.stringify({ f: L.facility, b: "esp32-devkit", n: L.nonce, e: L.exp })).toString("base64url");
    expect(readLink(S, `${other}.${sig}`, 0).ok).toBe(false);
    expect(readLink(S, p, 0).ok).toBe(false);
    expect(readLink(S, "x.y", 0).ok).toBe(false);
  });
  it("gives each link its own key, the size of the key slot", () => {
    const k = linkKey(S, L);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(linkKey(S, { ...L, nonce: "other" })).not.toBe(k);
    expect(linkKey(S, L)).toBe(k);
  });
});
