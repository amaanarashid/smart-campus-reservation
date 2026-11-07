/**
 * Checks per-device broker logins against your real EMQX deployment, using
 * the settings in .env.local (no device, no deploy needed):
 *
 *   npx tsx scripts/eval/mqtt-accounts-check.ts
 *
 * Needs in .env.local: MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD, EMQX_API_URL,
 * EMQX_APP_ID, EMQX_APP_SECRET, ROOM_CODE_SECRET.
 *
 * Makes a throwaway device login (room-<test id>) through the EMQX API, then:
 *   1. the login can connect
 *   2. it can subscribe to its own topic
 *   3. it can NOT subscribe to another room's topic
 *   4. it can NOT publish
 *   5. the server's login can publish to campus/rooms/# and the device gets it
 *   6. after the login is deleted, it can no longer connect
 * and deletes the test login at the end, whatever happens.
 */
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import mqtt from "mqtt";
import { apiCheck, emqxApi, ensureDeviceAccount, ensureServerRule, removeDeviceAccount } from "../../src/lib/mqtt-accounts";

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(".env.local")) return out;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const e = { ...env(), ...process.env } as Record<string, string | undefined>;
const need = ["MQTT_URL", "MQTT_USERNAME", "MQTT_PASSWORD", "EMQX_API_URL", "EMQX_APP_ID", "EMQX_APP_SECRET", "ROOM_CODE_SECRET"];
const missing = need.filter((k) => !e[k]);
if (missing.length) {
  console.error(`Fill these in .env.local first: ${missing.join(", ")}`);
  process.exit(1);   // nothing has been opened yet, so exiting straight away is safe
}
const api = emqxApi(e)!;
const secret = e.ROOM_CODE_SECRET!;
const deviceId = `00000000-0000-4000-8000-${randomBytes(6).toString("hex")}`;
const ownTopic = `campus/rooms/${deviceId}/cmd`;
const otherTopic = "campus/rooms/some-other-room/cmd";

let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};
const msg = (x: unknown) => (x instanceof Error ? x.message : String(x));
const connect = (username: string, password: string) => mqtt.connectAsync(e.MQTT_URL!, {
  username, password, protocolVersion: 5, reconnectPeriod: 0, connectTimeout: 8000,
  clientId: `check-${randomBytes(4).toString("hex")}`,
});
/** SUBACK reason: under 0x80 = granted. Some brokers reject the promise instead. */
async function canSubscribe(c: mqtt.MqttClient, topic: string) {
  try {
    const g = await c.subscribeAsync(topic, { qos: 1 });
    const code = g[0]?.qos ?? 0;
    return { ok: code < 0x80, code };
  } catch (err) {
    return { ok: false, code: (err as { code?: number }).code ?? -1 };
  }
}

/** When the API refuses: try a few requests and show what each gets back, to find the cause. */
async function probe() {
  console.log("\nTrying a few requests to see what EMQX accepts:");
  console.log(`  App ID: ${api.id.length} characters, App Secret: ${api.secret.length} characters` +
    `${/\s|["']/.test(api.id + api.secret) ? " (contains spaces or quotes!)" : ""}`);
  const auth = `Basic ${Buffer.from(`${api.id}:${api.secret}`).toString("base64")}`;
  const tries: [string, string, Record<string, string>][] = [
    ["clients (no colon in the path)", "/clients?limit=1", { Authorization: auth }],
    ["logins, colon as is", "/authentication/password_based:built_in_database/users?limit=1", { Authorization: auth }],
    ["logins, colon encoded", "/authentication/password_based%3Abuilt_in_database/users?limit=1", { Authorization: auth }],
    ["rules", "/authorization/sources/built_in_database/rules/users?limit=1", { Authorization: auth }],
    ["clients, no key at all", "/clients?limit=1", {}],
  ];
  for (const [name, path, headers] of tries) {
    try {
      const r = await fetch(`${api.url}${path}`, { headers, signal: AbortSignal.timeout(8000) });
      const body = (await r.text()).replace(/\s+/g, " ").slice(0, 120);
      console.log(`  ${String(r.status).padEnd(4)} ${name}${body ? `  ${body}` : ""}`);
    } catch (err) {
      console.log(`  ERR  ${name}  ${msg(err)}`);
    }
  }
}

async function main() {
  console.log(`EMQX API: ${api.url}`);
  console.log(`Test device login: room-${deviceId}\n`);
  let device: mqtt.MqttClient | null = null;
  try {
    // 0. can the key read at all? (address and key check)
    const read = await apiCheck(api);
    check(read.ok, "EMQX API key can list logins", read.detail);
    if (!read.ok) {
      await probe();
      throw new Error("stop");
    }

    // 0. make the login
    let cred: { user: string; pass: string };
    try {
      cred = await ensureDeviceAccount(api, secret, deviceId, "0".repeat(64));
      check(true, "EMQX API created the device login and its rules");
    } catch (err) {
      check(false, "EMQX API created the device login and its rules", msg(err));
      throw new Error("stop");
    }
    await new Promise((r) => setTimeout(r, 1500));   // let the new login reach every broker node

    // 1. connect
    try {
      device = await connect(cred.user, cred.pass);
      check(true, "device login can connect");
    } catch (err) {
      check(false, "device login can connect", msg(err));
      throw new Error("stop");
    }

    // 2 + 3. subscribe: own topic yes, other rooms no
    const own = await canSubscribe(device, ownTopic);
    check(own.ok, "device can subscribe to its own topic", `reason ${own.code}`);
    const other = await canSubscribe(device!, otherTopic);
    check(!other.ok, "device can NOT subscribe to another room's topic", `reason ${other.code}`);

    // 4. publish: refused (or the broker drops the connection)
    try {
      await device.publishAsync(otherTopic, "{}", { qos: 1 });
      check(false, "device can NOT publish", "the broker accepted it");
    } catch (err) {
      check(true, "device can NOT publish", msg(err));
    }
    if (!device.connected) {
      device = await connect(cred.user, cred.pass);
      await device.subscribeAsync(ownTopic, { qos: 1 });
    }
    const listener = device;

    // 5. server -> device
    await ensureServerRule(api, e.MQTT_USERNAME!);
    const got = new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      listener.on("message", (topic) => { if (topic === ownTopic) { clearTimeout(t); resolve(true); } });
    });
    const server = await connect(e.MQTT_USERNAME!, e.MQTT_PASSWORD!);
    try {
      await server.publishAsync(ownTopic, '{"cmd":"x","sig":"y"}', { qos: 1 });
      check(true, "server login can publish to campus/rooms/#");
    } catch (err) {
      check(false, "server login can publish to campus/rooms/#", msg(err));
    }
    await server.endAsync();
    check(await got, "device received the server's message");
    await listener.endAsync();
    device = null;

    // 6. delete, then the login is gone
    await removeDeviceAccount(api, deviceId);
    try {
      const c = await connect(cred.user, cred.pass);
      await c.endAsync();
      check(false, "deleted login can no longer connect", "it still connected");
    } catch (err) {
      check(true, "deleted login can no longer connect", msg(err));
    }
  } catch (err) {
    if (msg(err) !== "stop") check(false, "unexpected error", msg(err));
  } finally {
    if (device) await device.endAsync().catch(() => {});
    await removeDeviceAccount(api, deviceId).catch(() => {});
  }
  console.log(`\n${failed === 0 ? "All checks passed." : `${failed} check(s) failed.`}`);
  // exitCode, not process.exit(): exiting while fetch is still closing its
  // sockets crashes Node on Windows ("Assertion failed ... UV_HANDLE_CLOSING")
  process.exitCode = failed ? 1 : 0;
}

main();
