import mqtt from "mqtt";

/**
 * Publish one message to the MQTT broker and disconnect. Serverless-friendly:
 * a Vercel function cannot hold a connection open, so each command opens a
 * short TLS session (about half a second).
 *
 * Needs on Vercel (never NEXT_PUBLIC_):
 *   MQTT_URL        mqtts://<broker host>:8883
 *   MQTT_USERNAME   a login the broker lets publish to campus/rooms/#
 *   MQTT_PASSWORD
 * Without them, publishing is skipped and the device picks the command up
 * over HTTP on its next status poll instead (a few seconds later).
 *
 * MQTT 5, so the broker says when it did not deliver. With MQTT 3.1.1 a
 * broker that refuses a publish (no permission on the topic) still
 * acknowledges it and drops it silently, and the server would wrongly report
 * "sent". Falls back to 3.1.1 for a broker without MQTT 5.
 */
/** "Not authorized" in an MQTT 5 PUBACK. */
export const NOT_AUTHORIZED = 135;

export function mqttConfigured(): boolean {
  return !!process.env.MQTT_URL;
}

/** PUBACK reason codes worth explaining (MQTT 5). */
const REASON: Record<number, string> = {
  16: "no device is listening on this topic (it is offline, or connected to another broker)",
  135: "the broker refused it: MQTT_USERNAME is not allowed to publish to campus/rooms/# (check the broker's authorization rules)",
  144: "the broker refused the topic name",
  151: "the broker's message quota was exceeded",
  153: "the broker refused the message format",
};

export async function publish(topic: string, payload: string, timeoutMs = 6000):
  Promise<{ ok: true } | { ok: false; error: string; code?: number }> {
  const url = process.env.MQTT_URL;
  if (!url) return { ok: false, error: "MQTT not configured" };
  let client: mqtt.MqttClient | null = null;
  const connect = (protocolVersion: 4 | 5) => mqtt.connectAsync(url, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clientId: `campus-api-${Math.random().toString(16).slice(2, 10)}`,
    connectTimeout: timeoutMs,
    reconnectPeriod: 0,          // one shot: no background reconnect loop
    clean: true,
    protocolVersion,
  });
  try {
    try {
      client = await connect(5);
    } catch (e) {
      // an MQTT 3.1.1-only broker refuses the MQTT 5 handshake
      if (!/protocol|unsupported|version/i.test(e instanceof Error ? e.message : String(e))) throw e;
      client = await connect(4);
    }
    let reason: number | undefined;
    client.on("packetreceive", (p) => {
      if (p.cmd === "puback") reason = (p as { reasonCode?: number }).reasonCode;
    });
    await client.publishAsync(topic, payload, { qos: 1, retain: false });
    if (reason === 16) return { ok: false, error: `Not delivered: ${REASON[16]}.`, code: 16 };
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (typeof code === "number" && REASON[code]) return { ok: false, error: `Not delivered: ${REASON[code]}.`, code };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (client) await client.endAsync().catch(() => {});
  }
}
