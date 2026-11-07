import { createHash } from "node:crypto";

/**
 * Making firmware for one room: writing a device key and the room's setup into
 * an ESP32 app image (the firmware.bin the build makes), so the device starts
 * already connected, with the right parts, without compiling anything.
 *
 * The firmware keeps a 64-byte slot after the marker "CAMPUS-KEY-SLOT:" for
 * the key and a 1 KB one after "CAMPUS-CFG-SLOT:" for the room's setup
 * (firmware/door-wokwi/pair.cpp). The image ends with a checksum over every
 * segment's bytes and a SHA-256 of the whole image, and the ESP32 (and Wokwi)
 * refuse an image where either is wrong, so both are recomputed here.
 *
 * Image layout (as esptool writes it):
 *   24-byte header: [0] = 0xE9, [1] = segment count, ..., [23] = 1 if a hash follows
 *   per segment: load address (u32 LE), length (u32 LE), the bytes
 *   zero padding so the checksum byte sits at an offset of 15 mod 16
 *   checksum = 0xEF XOR every segment byte
 *   SHA-256 of everything before it (if [23] = 1)
 */

export const KEY_MARKER = "CAMPUS-KEY-SLOT:";
export const KEY_SLOT_LEN = 64;

interface Layout { segments: { start: number; end: number }[]; checksumAt: number; hashAt: number | null }

function layout(img: Uint8Array): Layout {
  if (img.length < 24 || img[0] !== 0xe9) throw new Error("Not an ESP32 app image.");
  const view = new DataView(img.buffer, img.byteOffset, img.byteLength);
  const count = img[1];
  let pos = 24;
  const segments: Layout["segments"] = [];
  for (let i = 0; i < count; i++) {
    if (pos + 8 > img.length) throw new Error("Image is cut short.");
    const len = view.getUint32(pos + 4, true);
    const start = pos + 8;
    if (start + len > img.length) throw new Error("Image is cut short.");
    segments.push({ start, end: start + len });
    pos = start + len;
  }
  const checksumAt = pos + (15 - (pos % 16));
  const hashAt = img[23] === 1 ? checksumAt + 1 : null;
  if (checksumAt >= img.length || (hashAt !== null && hashAt + 32 > img.length)) throw new Error("Image is cut short.");
  return { segments, checksumAt, hashAt };
}

function checksum(img: Uint8Array, l: Layout): number {
  let c = 0xef;
  for (const s of l.segments) for (let i = s.start; i < s.end; i++) c ^= img[i];
  return c;
}

/** True if the image's checksum (and hash, if any) match its contents. */
export function imageValid(img: Uint8Array): boolean {
  try {
    const l = layout(img);
    if (img[l.checksumAt] !== checksum(img, l)) return false;
    if (l.hashAt === null) return true;
    const h = createHash("sha256").update(img.subarray(0, l.hashAt)).digest();
    return Buffer.from(img.subarray(l.hashAt, l.hashAt + 32)).equals(h);
  } catch {
    return false;
  }
}

export const CONFIG_MARKER = "CAMPUS-CFG-SLOT:";
export const CONFIG_SLOT_LEN = 1024;

/** Where a slot's bytes start (just after its marker), or -1. */
export function findSlot(img: Uint8Array, marker: string): number {
  const at = Buffer.from(img.buffer, img.byteOffset, img.byteLength).indexOf(marker, 0, "latin1");
  return at < 0 ? -1 : at + marker.length;
}
export const findKeySlot = (img: Uint8Array) => findSlot(img, KEY_MARKER);

/** A copy of the image with `bytes` in a slot (rest zeroed) and the checksum and hash redone. */
export function writeSlot(image: Uint8Array, marker: string, slotLen: number, bytes: Uint8Array): Uint8Array {
  if (bytes.length > slotLen) throw new Error("Too much to fit in the firmware.");
  const img = new Uint8Array(image);              // never change the caller's copy
  const l = layout(img);
  const slot = findSlot(img, marker);
  if (slot < 0) throw new Error("This firmware has no slot for that. Rebuild it.");
  if (!l.segments.some((s) => slot >= s.start && slot + slotLen <= s.end))
    throw new Error("The slot is not inside the firmware's data.");
  img.fill(0, slot, slot + slotLen);
  img.set(bytes, slot);
  img[l.checksumAt] = checksum(img, l);
  if (l.hashAt !== null) img.set(createHash("sha256").update(img.subarray(0, l.hashAt)).digest(), l.hashAt);
  return img;
}

/** The device key, so the firmware starts already connected to its room. */
export function writeKey(image: Uint8Array, key: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(key)) throw new Error("Bad key.");
  return writeSlot(image, KEY_MARKER, KEY_SLOT_LEN, new TextEncoder().encode(key));
}

/** The room's setup (JSON), so the parts work from the first start. */
export function writeConfig(image: Uint8Array, config: object): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(config));
  if (json.length > CONFIG_SLOT_LEN) throw new Error("This setup is too large to put in the firmware.");
  return writeSlot(image, CONFIG_MARKER, CONFIG_SLOT_LEN, json);
}

/**
 * One flash image from parts at their offsets (as in an ESP Web Tools
 * manifest), gaps filled with 0xFF like erased flash. Wokwi runs this as is,
 * with the bootloader and partition table the firmware was built for.
 */
export function mergeFlash(parts: { offset: number; data: Uint8Array }[]): Uint8Array {
  const sorted = [...parts].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].offset < sorted[i - 1].offset + sorted[i - 1].data.length) throw new Error("Firmware parts overlap.");
  const last = sorted[sorted.length - 1];
  const out = new Uint8Array(last ? last.offset + last.data.length : 0).fill(0xff);
  for (const p of sorted) out.set(p.data, p.offset);
  return out;
}
