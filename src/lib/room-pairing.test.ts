import { describe, expect, it } from "vitest";
import { cleanCode, deviceMqtt, formatCode, validDeviceKey } from "./room-pairing";

describe("pairing code", () => {
  it("keeps only the first six digits", () => {
    expect(cleanCode("482 913")).toBe("482913");
    expect(cleanCode("48-29a13999")).toBe("482913");
    expect(cleanCode("abc")).toBe("");
  });
  it("groups digits for reading", () => {
    expect(formatCode("")).toBe("");
    expect(formatCode("482")).toBe("482");
    expect(formatCode("4829")).toBe("482 9");
    expect(formatCode("482913")).toBe("482 913");
  });
  it("round-trips through the input", () => {
    expect(cleanCode(formatCode("048213"))).toBe("048213");
  });
});

describe("device key", () => {
  it("accepts a key the firmware makes", () => {
    expect(validDeviceKey("a1".repeat(24))).toBe(true);
  });
  it("refuses missing, short or unsafe keys", () => {
    expect(validDeviceKey(null)).toBe(false);
    expect(validDeviceKey("")).toBe(false);
    expect(validDeviceKey("short")).toBe(false);
    expect(validDeviceKey(`${"a".repeat(32)} ;`)).toBe(false);
    expect(validDeviceKey("a".repeat(129))).toBe(false);
  });
});

describe("broker details for a door", () => {
  const base = { MQTT_URL: "mqtts://abc.emqxsl.com:8883", MQTT_USERNAME: "server", MQTT_PASSWORD: "pw" };

  it("reads host and port from the server's settings", () => {
    expect(deviceMqtt(base)).toEqual({ host: "abc.emqxsl.com", port: 8883, user: "server", pass: "pw" });
  });
  it("defaults to the TLS port", () => {
    expect(deviceMqtt({ ...base, MQTT_URL: "mqtts://abc.emqxsl.com" })?.port).toBe(8883);
  });
  it("prefers a door-only login", () => {
    expect(deviceMqtt({ ...base, MQTT_DEVICE_USERNAME: "", MQTT_DEVICE_PASSWORD: "" })).toMatchObject({ user: "server", pass: "pw" });
    const m = deviceMqtt({ ...base, MQTT_DEVICE_USERNAME: "door", MQTT_DEVICE_PASSWORD: "doorpw" });
    expect(m).toMatchObject({ user: "door", pass: "doorpw" });
  });
  it("gives nothing when MQTT is not usable, so the door falls back to polling", () => {
    expect(deviceMqtt({})).toBeNull();
    expect(deviceMqtt({ ...base, MQTT_URL: "not a url" })).toBeNull();
    expect(deviceMqtt({ ...base, MQTT_URL: "mqtt://abc.emqxsl.com:1883" })).toBeNull();
    expect(deviceMqtt({ MQTT_URL: base.MQTT_URL })).toBeNull();
  });
});
