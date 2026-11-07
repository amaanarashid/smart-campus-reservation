import { createHmac } from "node:crypto";

/**
 * One broker login per room device, made through the EMQX API.
 *
 * Without this, every device shares one MQTT login (MQTT_DEVICE_* or the
 * server's), so a leaked login can listen to any room's topic. With it, each
 * device gets its own username and password, allowed to SUBSCRIBE to its own
 * topic only (campus/rooms/<device id>/cmd) and denied everything else. The
 * server's login gets one rule: publish to campus/rooms/#.
 *
 *   username  room-<device id>
 *   password  HMAC(ROOM_CODE_SECRET, device id + key hash): never stored. A new
 *             key (Replace device) gives a new password, so the old device's
 *             broker login stops working with its HTTP access.
 *
 * Needs, on Vercel (never NEXT_PUBLIC_), from the EMQX deployment's overview
 * page -> Deployment API Key:
 *   EMQX_API_URL     the API endpoint shown there, e.g. https://<id>.ala.<region>.emqxsl.com:8443/api/v5
 *   EMQX_APP_ID      App ID
 *   EMQX_APP_SECRET  App Secret
 * Without them (or if a call fails) devices get the shared login as before.
 */

export interface EmqxApi { url: string; id: string; secret: string }

export function emqxApi(env: Record<string, string | undefined> = process.env): EmqxApi | null {
  const url = env.EMQX_API_URL?.replace(/\/+$/, "");
  if (!url || !env.EMQX_APP_ID || !env.EMQX_APP_SECRET) return null;
  return { url, id: env.EMQX_APP_ID, secret: env.EMQX_APP_SECRET };
}

export const deviceUsername = (deviceId: string) => `room-${deviceId}`;

export const devicePassword = (secret: string, deviceId: string, keyHash: string) =>
  createHmac("sha256", secret).update(`mqtt-pass:${deviceId}:${keyHash}`).digest("base64url").slice(0, 32);

/** The device may only listen to its own command topic. */
export const deviceRules = (deviceId: string) => [
  { topic: `campus/rooms/${deviceId}/cmd`, permission: "allow", action: "subscribe" },
  { topic: "#", permission: "deny", action: "all" },
];
/** The server only publishes commands. */
export const serverRules = () => [{ topic: "campus/rooms/#", permission: "allow", action: "publish" }];

type Fetch = typeof fetch;

async function call(api: EmqxApi, method: string, path: string, body: unknown, f: Fetch) {
  const r = await f(`${api.url}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${api.id}:${api.secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(6000),
  });
  return r;
}

/** "HTTP 403: <EMQX's code and message>", for error messages. */
async function why(r: Response) {
  let text = "";
  try { text = (await r.text()).replace(/\s+/g, " ").trim().slice(0, 200); } catch { /* no body */ }
  return `HTTP ${r.status}${text ? `: ${text}` : ""}`;
}

/** List one login: a harmless read, to check the API key and address. */
export async function apiCheck(api: EmqxApi, f: Fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  const r = await call(api, "GET", `${USERS}?limit=1`, undefined, f);
  return { ok: r.ok, detail: await why(r) };
}

const USERS = "/authentication/password_based:built_in_database/users";
const RULES = "/authorization/sources/built_in_database/rules/users";

/** Create the login, or set its password if it already exists. */
async function upsertUser(api: EmqxApi, username: string, password: string, f: Fetch) {
  const created = await call(api, "POST", USERS, { user_id: username, password, is_superuser: false }, f);
  if (created.ok) return;
  if (created.status !== 409) throw new Error(`EMQX: could not create ${username} (${await why(created)})`);
  const updated = await call(api, "PUT", `${USERS}/${encodeURIComponent(username)}`, { password, is_superuser: false }, f);
  if (!updated.ok) throw new Error(`EMQX: could not update ${username} (${await why(updated)})`);
}

/** Replace a username's rules (create them if it has none yet). */
async function setRules(api: EmqxApi, username: string, rules: unknown[], f: Fetch) {
  const put = await call(api, "PUT", `${RULES}/${encodeURIComponent(username)}`, { username, rules }, f);
  if (put.ok) return;
  if (put.status !== 404) throw new Error(`EMQX: could not set rules for ${username} (${await why(put)})`);
  const post = await call(api, "POST", RULES, [{ username, rules }], f);
  if (!post.ok) throw new Error(`EMQX: could not add rules for ${username} (${await why(post)})`);
}

/** Make (or refresh) a device's own login. Returns the credentials to hand to the device. */
export async function ensureDeviceAccount(api: EmqxApi, secret: string, deviceId: string, keyHash: string, f: Fetch = fetch) {
  const user = deviceUsername(deviceId);
  const pass = devicePassword(secret, deviceId, keyHash);
  await upsertUser(api, user, pass, f);
  await setRules(api, user, deviceRules(deviceId), f);
  return { user, pass };
}

/** Let the server's login publish commands (fixes a broker that refuses them). */
export async function ensureServerRule(api: EmqxApi, serverUsername: string, f: Fetch = fetch) {
  await setRules(api, serverUsername, serverRules(), f);
}

/** Remove a device's login and rules (Disconnect). Missing ones are fine. */
export async function removeDeviceAccount(api: EmqxApi, deviceId: string, f: Fetch = fetch) {
  const user = encodeURIComponent(deviceUsername(deviceId));
  const a = await call(api, "DELETE", `${USERS}/${user}`, undefined, f);
  const b = await call(api, "DELETE", `${RULES}/${user}`, undefined, f);
  for (const r of [a, b]) if (!r.ok && r.status !== 404) throw new Error(`EMQX: could not remove the device login (${await why(r)})`);
}
