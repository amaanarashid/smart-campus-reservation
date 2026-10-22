import mqtt from "mqtt";

/**
 * Publish one message to the MQTT broker and disconnect. Serverless-friendly:
 * a Vercel function cannot hold a connection open, so each command opens a
 * short TLS session (about half a second to HiveMQ Cloud).
 *
 * Needs on Vercel (never NEXT_PUBLIC_):
 *   MQTT_URL        mqtts://<cluster>.s1.eu.hivemq.cloud:8883
 *   MQTT_USERNAME   from HiveMQ Cloud -> Access Management
 *   MQTT_PASSWORD
 * Without them, publishing is skipped and the device picks the command up
 * over HTTP on its next status poll instead (a few seconds later).
 */
export function mqttConfigured(): boolean {
  return !!process.env.MQTT_URL;
}

export async function publish(topic: string, payload: string, timeoutMs = 6000):
  Promise<{ ok: true } | { ok: false; error: string }> {
  const url = process.env.MQTT_URL;
  if (!url) return { ok: false, error: "MQTT not configured" };
  let client: mqtt.MqttClient | null = null;
  try {
    client = await mqtt.connectAsync(url, {
      username: process.env.MQTT_USERNAME,
      password: process.env.MQTT_PASSWORD,
      clientId: `campus-api-${Math.random().toString(16).slice(2, 10)}`,
      connectTimeout: timeoutMs,
      reconnectPeriod: 0,          // one shot: no background reconnect loop
      clean: true,
    });
    await client.publishAsync(topic, payload, { qos: 1, retain: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (client) await client.endAsync().catch(() => {});
  }
}
