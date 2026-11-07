import { describe, expect, it } from "vitest";
import { crc32, makeZip, readZip } from "./zip";

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it("round-trips files", () => {
    const bin = new Uint8Array([0, 255, 1, 254]);
    const z = makeZip([{ name: "wokwi.toml", data: "[wokwi]\nversion = 1\n" }, { name: "firmware.bin", data: bin }]);
    const files = readZip(z);
    expect(files.map((f) => f.name)).toEqual(["wokwi.toml", "firmware.bin"]);
    expect(files.every((f) => f.crcOk)).toBe(true);
    expect([...files[1].data]).toEqual([...bin]);
    // end-of-central-directory record says two entries
    const v = new DataView(z.buffer);
    expect(v.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(v.getUint16(z.length - 12, true)).toBe(2);
  });
});
