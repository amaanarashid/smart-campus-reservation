import { describe, expect, it } from "vitest";
import {
  deviceRules, devicePassword, deviceUsername, emqxApi, ensureDeviceAccount, ensureServerRule, removeDeviceAccount,
} from "./mqtt-accounts";

const API = { url: "https://x.emqxsl.com:8443/api/v5", id: "app", secret: "s3cret" };
const DEV = "a89c0d60-f00d-4b59-95bc-22d6b77c6930";

/** A fake EMQX: records calls, answers from a script of statuses. */
function fake(statuses: Record<string, number[]>) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace(API.url, "");
    const key = `${init.method} ${path.split("/").slice(0, 4).join("/")}`;
    calls.push({ method: init.method!, path, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get("authorization") });
    const status = (statuses[key] ?? [200]).shift() ?? 200;
    return new Response(null, { status: status === 204 ? 204 : status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("per-device broker logins", () => {
  it("reads the API settings, trailing slash or not", () => {
    expect(emqxApi({ EMQX_API_URL: "https://x/api/v5/", EMQX_APP_ID: "a", EMQX_APP_SECRET: "b" })).toEqual({ url: "https://x/api/v5", id: "a", secret: "b" });
    expect(emqxApi({ EMQX_API_URL: "https://x" })).toBeNull();
  });

  it("a new key gives a new password; nothing random", () => {
    const a = devicePassword("secret-1", DEV, "a".repeat(64));
    expect(a).toHaveLength(32);
    expect(devicePassword("secret-1", DEV, "a".repeat(64))).toBe(a);
    expect(devicePassword("secret-1", DEV, "b".repeat(64))).not.toBe(a);
    expect(devicePassword("secret-2", DEV, "a".repeat(64))).not.toBe(a);
  });

  it("a device may only subscribe to its own topic", () => {
    expect(deviceRules(DEV)).toEqual([
      { topic: `campus/rooms/${DEV}/cmd`, permission: "allow", action: "subscribe" },
      { topic: "#", permission: "deny", action: "all" },
    ]);
  });

  it("creates the login and its rules", async () => {
    const { f, calls } = fake({ "PUT /authorization/sources/built_in_database": [404] });
    const cred = await ensureDeviceAccount(API, "secret-1", DEV, "a".repeat(64), f);
    expect(cred.user).toBe(deviceUsername(DEV));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /authentication/password_based:built_in_database/users",
      `PUT /authorization/sources/built_in_database/rules/users/room-${DEV}`,
      "POST /authorization/sources/built_in_database/rules/users",
    ]);
    expect(calls[0].body).toEqual({ user_id: `room-${DEV}`, password: cred.pass, is_superuser: false });
    expect(calls[2].body).toEqual([{ username: `room-${DEV}`, rules: deviceRules(DEV) }]);
    expect(calls[0].auth).toBe(`Basic ${Buffer.from("app:s3cret").toString("base64")}`);
  });

  it("updates the password when the login already exists (Replace device)", async () => {
    const { f, calls } = fake({ "POST /authentication/password_based:built_in_database/users": [409] });
    await ensureDeviceAccount(API, "secret-1", DEV, "b".repeat(64), f);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "PUT"]);
    expect(calls[1].path).toBe(`/authentication/password_based:built_in_database/users/room-${DEV}`);
  });

  it("reports a broken API instead of handing out a login that won't work", async () => {
    const { f } = fake({ "POST /authentication/password_based:built_in_database/users": [401] });
    await expect(ensureDeviceAccount(API, "s", DEV, "a".repeat(64), f)).rejects.toThrow(/HTTP 401/);
    // EMQX's own reason is passed on
    const withBody = (async () => new Response('{"code":"FORBIDDEN","message":"no write access"}', { status: 403 })) as unknown as typeof fetch;
    await expect(ensureDeviceAccount(API, "s", DEV, "a".repeat(64), withBody)).rejects.toThrow(/HTTP 403: .*no write access/);
  });

  it("gives the server publish rights, and removes device logins", async () => {
    const s = fake({});
    await ensureServerRule(API, "server-user", s.f);
    expect(s.calls[0]).toMatchObject({ method: "PUT", body: { username: "server-user", rules: [{ topic: "campus/rooms/#", permission: "allow", action: "publish" }] } });
    const r = fake({ "DELETE /authorization/sources/built_in_database": [404] });
    await removeDeviceAccount(API, DEV, r.f);
    expect(r.calls.map((c) => c.method)).toEqual(["DELETE", "DELETE"]);
  });
});
