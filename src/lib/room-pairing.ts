/**
 * Connecting a door by pairing code. No I/O and no node-only imports: the admin
 * dialog uses the code helpers, the device route uses the rest.
 */

/** Keep what can be part of a code: up to 6 digits. */
export const cleanCode = (input: string) => input.replace(/\D/g, "").slice(0, 6);

/** "482913" -> "482 913", also while it is still being typed. */
export const formatCode = (code: string) =>
  code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

/** A key the device made for itself: long and URL-safe. */
export const validDeviceKey = (key: string | null): key is string =>
  !!key && /^[A-Za-z0-9_-]{32,128}$/.test(key);

export interface DeviceMqtt { host: string; port: number; user: string; pass: string }

/**
 * The broker details a connected door needs, so none are kept in the firmware.
 * MQTT_DEVICE_* lets doors use a narrower login than the server's. Returns null
 * when MQTT is not set up (or not TLS): the door then uses the status poll.
 */
export function deviceMqtt(env: Record<string, string | undefined>): DeviceMqtt | null {
  if (!env.MQTT_URL) return null;
  let url: URL;
  try { url = new URL(env.MQTT_URL); } catch { return null; }
  if (url.protocol !== "mqtts:" || !url.hostname) return null;
  const user = env.MQTT_DEVICE_USERNAME ?? env.MQTT_USERNAME;
  const pass = env.MQTT_DEVICE_PASSWORD ?? env.MQTT_PASSWORD;
  if (!user || !pass) return null;
  return { host: url.hostname, port: Number(url.port) || 8883, user, pass };
}
