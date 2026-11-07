import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { CONFIG_MARKER, KEY_MARKER, findKeySlot, findSlot, imageValid, mergeFlash, writeConfig, writeKey } from "./esp-image";

/** A tiny but well-formed ESP32 app image with the key slot in its first segment. */
function fakeImage(withHash = true): Uint8Array {
  const seg1 = new TextEncoder().encode(`xx${KEY_MARKER}${".".repeat(64)}yy${CONFIG_MARKER}${".".repeat(1024)}zz`);
  const seg2 = new Uint8Array([1, 2, 3, 4, 5]);
  const parts: number[] = [0xe9, 2, 2, 0x20, 0, 0, 0, 0, ...new Array(15).fill(0), withHash ? 1 : 0];
  for (const s of [seg1, seg2]) {
    const h = new DataView(new ArrayBuffer(8));
    h.setUint32(0, 0x3f400020, true);
    h.setUint32(4, s.length, true);
    parts.push(...new Uint8Array(h.buffer), ...s);
  }
  while (parts.length % 16 !== 15) parts.push(0);
  let c = 0xef;
  for (const b of [...seg1, ...seg2]) c ^= b;
  parts.push(c);
  const img = new Uint8Array(parts);
  if (!withHash) return img;
  const out = new Uint8Array(img.length + 32);
  out.set(img);
  out.set(createHash("sha256").update(img).digest(), img.length);
  return out;
}

describe("writing a key into firmware", () => {
  it("writes the key and keeps the image valid", () => {
    for (const withHash of [true, false]) {
      const img = fakeImage(withHash);
      expect(imageValid(img)).toBe(true);
      const key = "k".repeat(31) + "Q".repeat(17);
      const out = writeKey(img, key);
      expect(imageValid(out)).toBe(true);
      const at = findKeySlot(out);
      expect(new TextDecoder().decode(out.subarray(at, at + 48))).toBe(key);
      expect(out.subarray(at + 48, at + 64).every((b) => b === 0)).toBe(true);
      expect(imageValid(img) && img[findKeySlot(img)]).toBe(46);   // the original is untouched
    }
  });
  it("writes the room's setup next to the key", () => {
    const cfg = { lights: { pin: 12 }, presence: { pir: 13 } };
    const out = writeConfig(writeKey(fakeImage(), "a".repeat(48)), cfg);
    expect(imageValid(out)).toBe(true);
    const at = findSlot(out, CONFIG_MARKER);
    const json = new TextDecoder().decode(out.subarray(at, at + 1024)).replace(/\0+$/, "");
    expect(JSON.parse(json)).toEqual(cfg);
    expect(new TextDecoder().decode(out.subarray(findKeySlot(out), findKeySlot(out) + 48))).toBe("a".repeat(48));
    expect(() => writeConfig(fakeImage(), { x: "y".repeat(1100) })).toThrow(/too large/);
  });
  it("notices a broken image", () => {
    const img = fakeImage();
    img[30] ^= 1;
    expect(imageValid(img)).toBe(false);
    expect(() => writeKey(new Uint8Array(40), "a".repeat(48))).toThrow(/Not an ESP32/);
    expect(() => writeKey(fakeImage(), "bad key!")).toThrow(/Bad key/);
  });
  it("works on the published Wokwi build", () => {
    const path = "public/firmware/wokwi/firmware.bin";
    if (!existsSync(path)) return;                // built by pio run -e wokwi-web
    const img = new Uint8Array(readFileSync(path));
    expect(imageValid(img)).toBe(true);
    expect(findKeySlot(img)).toBeGreaterThan(0);
    expect(imageValid(writeKey(img, "0123456789abcdef".repeat(3)))).toBe(true);
    expect(findSlot(img, CONFIG_MARKER)).toBeGreaterThan(0);
    expect(imageValid(writeConfig(img, { lights: { pin: 17 } }))).toBe(true);
  });
});

describe("one flash image from parts", () => {
  it("places parts at their offsets over erased flash", () => {
    const f = mergeFlash([{ offset: 4, data: new Uint8Array([9, 9]) }, { offset: 0, data: new Uint8Array([1]) }]);
    expect([...f]).toEqual([1, 0xff, 0xff, 0xff, 9, 9]);
    expect(() => mergeFlash([{ offset: 0, data: new Uint8Array(4) }, { offset: 2, data: new Uint8Array(1) }])).toThrow(/overlap/);
  });
});
