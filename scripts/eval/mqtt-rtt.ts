/**
 * Objective 5: remote-control round trip, measured in the lab (no internet).
 *
 *   cd scripts/eval && npm install && cd ../.. && npx tsx scripts/eval/mqtt-rtt.ts
 *
 * Uses the app's REAL code: signCommand() / verifyCommand() (lib/room-commands)
 * and publish() (lib/mqtt-publish, one short TLS session per command, as on
 * Vercel). A local MQTT broker (aedes) runs over TLS with a throwaway
 * self-signed certificate. A simulated ESP32 keeps one connection open (like
 * the firmware), verifies each command and confirms it over HTTP, like
 * POST /api/room/ack. Measured per command, from the button press:
 *   publish   - server connects (TLS), publishes, disconnects
 *   delivered - device has the command and the signature checks out
 *   confirmed - the server has received the device's confirmation
 * Also checks that tampered, replayed and expired commands are rejected, and
 * models the HTTP fallback (device polls every 5 s). Excludes internet time to
 * EMQX Cloud and Vercel; the live run (scripts/eval/live-metrics.sql, block 4)
 * gives that. Writes docs/evaluation/mqtt-rtt.json.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttp } from "node:http";
import { createServer as createTls } from "node:tls";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import Aedes from "aedes";
import mqtt from "mqtt";
import { signCommand, verifyCommand } from "../../src/lib/room-commands";
import { commandTopic, type CommandArgs } from "../../src/lib/room-commands-shared";
import { publish } from "../../src/lib/mqtt-publish";

const N = Number(process.argv.find((a) => a.startsWith("--n="))?.split("=")[1] ?? 100);
const MQTT_PORT = 8884, HTTP_PORT = 8085, POLL_S = 5;
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---- throwaway TLS certificate for the local broker. Node only trusts extra
// CAs given at start-up, so the script makes the certificate, then re-runs
// itself with NODE_EXTRA_CA_CERTS: TLS verification stays fully on.
if (!process.env.MQTT_RTT_CERT_DIR) {
  const d = mkdtempSync(join(tmpdir(), "mqtt-rtt-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost",
    "-addext", "subjectAltName=DNS:localhost", "-keyout", join(d, "key.pem"), "-out", join(d, "cert.pem")], { stdio: "ignore" });
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit", env: { ...process.env, MQTT_RTT_CERT_DIR: d, NODE_EXTRA_CA_CERTS: join(d, "cert.pem") },
  });
  process.exit(r.status ?? 1);
}
const dir = process.env.MQTT_RTT_CERT_DIR;
process.env.MQTT_URL = `mqtts://localhost:${MQTT_PORT}`;
process.env.MQTT_USERNAME = "campus-api"; process.env.MQTT_PASSWORD = "lab";

// ---- broker
const aedes = new Aedes();
const broker = createTls({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }, aedes.handle);
await new Promise<void>((ok) => broker.listen(MQTT_PORT, ok));

// ---- "API" that receives the device's confirmation (stands in for /api/room/ack)
const confirmed = new Map<string, number>();
const http = createHttp((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => { try { confirmed.set(JSON.parse(body).id, performance.now()); } catch { /* ignore */ } res.end("{\"ok\":true}"); });
});
await new Promise<void>((ok) => http.listen(HTTP_PORT, ok));

// ---- simulated ESP32: one persistent connection, verify, act, confirm
const deviceId = randomUUID();
const deviceKey = "lab-device-key-0123456789";
const keyHash = createHash("sha256").update(deviceKey).digest("hex");   // what the server signs with
const seen = new Set<string>();
const delivered = new Map<string, number>();
const rejected: Record<string, number> = {};
const device = await mqtt.connectAsync(process.env.MQTT_URL, { clientId: `esp32-${deviceId.slice(0, 8)}`, keepalive: 30, reconnectPeriod: 0 });
await device.subscribeAsync(commandTopic(deviceId), { qos: 1 });
device.on("message", async (_t, payload) => {
  const v = verifyCommand(JSON.parse(payload.toString()), keyHash, Math.floor(Date.now() / 1000), seen);
  if (!v.ok) { rejected[v.reason] = (rejected[v.reason] ?? 0) + 1; return; }
  delivered.set(v.id, performance.now());
  await fetch(`http://localhost:${HTTP_PORT}/ack`, { method: "POST", body: JSON.stringify({ id: v.id, ok: true }) });
});

const KINDS: CommandArgs[] = [
  { kind: "unlock", args: {} }, { kind: "lights", args: { state: "on", mins: 30 } },
  { kind: "ac", args: { state: "off", mins: 30 } }, { kind: "message", args: { text: "Room closes at 10 pm", secs: 300 } },
] as CommandArgs[];

// ---- the measurement
const rows: { publish: number; delivered: number; confirmed: number }[] = [];
for (let i = 0; i < 10 + N; i++) {                     // first 10 = warm-up
  const id = randomUUID();
  const signed = signCommand(id, KINDS[i % KINDS.length], keyHash, Math.floor(Date.now() / 1000));
  const t0 = performance.now();
  const p = await publish(commandTopic(deviceId), JSON.stringify({ cmd: signed.cmd, sig: signed.sig }));
  const t1 = performance.now();
  if (!p.ok) throw new Error(p.error);
  const end = Date.now() + 3000;
  while (!confirmed.has(id) && Date.now() < end) await new Promise((r) => setTimeout(r, 1));
  if (i >= 10 && confirmed.has(id)) rows.push({ publish: t1 - t0, delivered: delivered.get(id)! - t0, confirmed: confirmed.get(id)! - t0 });
}

// ---- security checks through the same path
const pubRaw = (o: unknown) => publish(commandTopic(deviceId), JSON.stringify(o));
const good = signCommand(randomUUID(), KINDS[0], keyHash, Math.floor(Date.now() / 1000));
await pubRaw({ cmd: good.cmd.replace("unlock", "lockdown"), sig: good.sig });            // tampered
await pubRaw({ cmd: good.cmd, sig: good.sig }); await pubRaw({ cmd: good.cmd, sig: good.sig }); // second one = replay
const old = signCommand(randomUUID(), KINDS[0], keyHash, Math.floor(Date.now() / 1000) - 120);   // expired a minute ago
await pubRaw({ cmd: old.cmd, sig: old.sig });
const wrongKey = signCommand(randomUUID(), KINDS[0], createHash("sha256").update("not-the-key").digest("hex"), Math.floor(Date.now() / 1000));
await pubRaw({ cmd: wrongKey.cmd, sig: wrongKey.sig });                                  // signed with another device's key
await new Promise((r) => setTimeout(r, 500));

// ---- HTTP fallback model: command waits for the next 5 s poll, then one request
const httpReq: number[] = [];
for (let i = 0; i < 50; i++) { const s = performance.now(); await fetch(`http://localhost:${HTTP_PORT}/ack`, { method: "POST", body: "{}" }); httpReq.push(performance.now() - s); }
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const fallback = Array.from({ length: 10000 }, () => rnd() * POLL_S * 1000 + q(httpReq, 0.5) * 2);

const stat = (k: "publish" | "delivered" | "confirmed") => {
  const a = rows.map((r) => r[k]); return { median: r2(q(a, 0.5)), p95: r2(q(a, 0.95)), max: r2(Math.max(...a)) };
};
const out = {
  generated_by: "scripts/eval/mqtt-rtt.ts", commands: rows.length, transport: "MQTT 3.1.1 over TLS (local broker), QoS 1",
  ms_from_button_press: { publish: stat("publish"), delivered: stat("delivered"), confirmed: stat("confirmed") },
  security: { tampered_bad_signature: rejected.bad_signature ?? 0, replayed: rejected.replayed ?? 0, expired: rejected.expired ?? 0,
    note: "sent: 1 tampered, 1 replay, 1 expired, 1 signed with another device's key (counts as bad_signature); none may be acted on" },
  http_fallback_model_ms: { poll_every_s: POLL_S, median: r2(q(fallback, 0.5)), p95: r2(q(fallback, 0.95)),
    note: "wait for the next status poll (uniform 0-5 s) + request; used when MQTT is unavailable" },
  excludes: "internet latency to EMQX Cloud (Singapore) and Vercel; see live-metrics.sql block 4 for the live figure",
};
const accepted = rows.length;
const pass = accepted === N && (rejected.bad_signature ?? 0) === 2 && (rejected.replayed ?? 0) === 1 && (rejected.expired ?? 0) === 1;
mkdirSync("docs/evaluation", { recursive: true });
writeFileSync("docs/evaluation/mqtt-rtt.json", JSON.stringify({ ...out, pass }, null, 2));
console.log(JSON.stringify({ ...out, pass }, null, 2));

await device.endAsync(); aedes.close(); broker.close(); http.close();
process.exit(pass ? 0 : 1);
