// Minimal stand-in for Supabase (PostgREST + Auth) with sample data.
// Used ONLY to render the app for the usability audit and report screenshots
// (no real people, no real database). Run: node scripts/eval/ui/mock-supabase.mjs
// The signed-in user is picked from the access token: it contains "admin",
// "manager" or anything else (= student). Writes are accepted and ignored.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 54321);
const MYT = 8 * 3600e3, DAY = 86400e3;
const todayKey = new Date(Date.now() + MYT).toISOString().slice(0, 10);
const keyPlus = (n) => new Date(Date.parse(todayKey) + n * DAY).toISOString().slice(0, 10);
const at = (key, hm) => new Date(`${key}T${hm}:00+08:00`).toISOString();
const TOM = keyPlus(1);
const NOW = Date.now();

const STUDENT = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";
const who = (tok) => (tok?.includes("admin") ? ADMIN : tok?.includes("manager") ? MANAGER : STUDENT);

const ALL = ["undergraduate", "postgraduate", "staff"];
const cats = [
  { id: "c-bad", name: "Badminton", slug: "badminton", venue: "Sports Complex", open: "08:00:00", close: "22:00:00", min: 60, max: 120, auto: false, cancel: 24, members: ALL },
  { id: "c-fut", name: "Futsal", slug: "futsal", venue: "Sports Complex", open: "08:00:00", close: "22:00:00", min: 60, max: 120, auto: false, cancel: 24, members: ALL },
  { id: "c-dis", name: "Discussion Room", slug: "discussion_room", venue: "Library", open: "08:00:00", close: "22:00:00", min: 30, max: 120, auto: true, cancel: 2, members: ALL },
  { id: "c-meet", name: "Meeting Room", slug: "meeting_room", venue: "Block B", open: "09:00:00", close: "18:00:00", min: 30, max: 180, auto: false, cancel: 24, members: ["postgraduate", "staff"] },
];
const fac = [];
const add = (c, name, cap) => fac.push({ id: `f-${c.slug}-${name.replace(/\W/g, "").toLowerCase()}`, name, category_id: c.id, category_name: c.name, type: c.slug, venue: c.venue, location: c.venue, capacity: cap, description: null, status: "active" });
for (let i = 1; i <= 4; i++) add(cats[0], `Court ${i}`, 4);
add(cats[1], "Court 1", 12);
for (const r of ["A", "B", "C"]) add(cats[2], `Room ${r}`, 6);
add(cats[3], "Meeting Room 1", 10);
const rules = fac.map((f) => {
  const c = cats.find((x) => x.id === f.category_id);
  return {
    facility_id: f.id, category_id: c.id, category_name: c.name, type: c.slug, venue: c.venue, open_time: c.open, close_time: c.close,
    slot_minutes: 30, min_duration_mins: c.min, max_duration_mins: c.max, max_advance_days: 14, cancellation_hours: c.cancel,
    auto_approve: c.auto, has_override: false, checkin_grace_mins: 15, allowed_members: c.members, max_upcoming: null, max_hours_week: null,
  };
});
const F = (slug, n) => fac.find((f) => f.type === slug && f.name === n).id;
const NAMES = { [STUDENT]: "Aina Rahman", [OTHER]: "Daniel Lim", [ADMIN]: "Demo admin", [MANAGER]: "Encik Faiz" };

let rid = 0;
const res = (fid, user, key, s, e, status = "approved", extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(++rid).padStart(12, "0")}`, facility_id: fid, user_id: user,
  start_time: at(key, s), end_time: at(key, e), participants: 2, purpose: null, status, checked_in_at: null, no_show: false,
  created_at: new Date(NOW - DAY).toISOString(), cancel_reason: null, extended_mins: 0, profiles: { full_name: NAMES[user] }, ...extra,
});
const busy = [
  res(F("badminton", "Court 1"), OTHER, TOM, "15:00", "16:00"), res(F("badminton", "Court 2"), OTHER, TOM, "14:00", "16:00"),
  res(F("badminton", "Court 3"), OTHER, TOM, "15:00", "17:00"), res(F("badminton", "Court 1"), OTHER, TOM, "18:00", "20:00"),
  res(F("badminton", "Court 4"), OTHER, TOM, "12:00", "13:30"),
  res(F("discussion_room", "Room A"), OTHER, todayKey, "18:00", "20:00"), res(F("discussion_room", "Room B"), OTHER, todayKey, "19:00", "21:00"),
  res(F("discussion_room", "Room C"), OTHER, todayKey, "17:30", "18:30"),
  // pending requests for the manager's approval queue
  res(F("badminton", "Court 2"), OTHER, keyPlus(2), "17:00", "18:00", "pending", { participants: 4, purpose: "Club practice" }),
  res(F("badminton", "Court 4"), STUDENT, keyPlus(3), "20:00", "21:00", "pending", { participants: 3, purpose: null }),
];
// history: popular times, analytics, attendance
for (let d = 1; d <= 20; d++) {
  for (const [s, e] of [["17:00", "18:00"], ["18:00", "19:00"], ["12:00", "13:00"]]) {
    const r = res(F("badminton", "Court 2"), OTHER, keyPlus(-d), s, e);
    if (d % 6 === 0 && s === "12:00") r.no_show = true; else r.checked_in_at = r.start_time;
    busy.push(r);
  }
  const r = res(F("discussion_room", "Room B"), d % 2 ? OTHER : STUDENT, keyPlus(-d), "14:00", "16:00");
  r.checked_in_at = r.start_time; busy.push(r);
}
const mine = [
  res(F("discussion_room", "Room A"), STUDENT, keyPlus(2), "10:00", "12:00", "approved", { purpose: "FYP group meeting", participants: 4 }),
  res(F("badminton", "Court 1"), STUDENT, keyPlus(-3), "18:00", "19:00", "approved", { checked_in_at: at(keyPlus(-3), "17:55") }),
  res(F("discussion_room", "Room C"), STUDENT, keyPlus(-5), "10:00", "11:00", "cancelled", { cancel_reason: "user" }),
];
// smart room (Library Room A)
const DEV = "d0000000-0000-4000-8000-000000000001";
const devices = [{ id: DEV, facility_id: F("discussion_room", "Room A"), label: "Room A door", active: true, last_seen_at: new Date(NOW - 3000).toISOString(), connection: "wokwi" }];
const nowRes = res(F("discussion_room", "Room A"), STUDENT, todayKey, "00:00", "00:00", "approved");
nowRes.start_time = new Date(NOW - 35 * 60e3).toISOString();
nowRes.end_time = new Date(NOW + 25 * 60e3).toISOString();
nowRes.checked_in_at = new Date(NOW - 33 * 60e3).toISOString();
const ev = (min, kind, detail = null) => ({ id: ++rid, device_id: DEV, facility_id: devices[0].facility_id, reservation_id: nowRes.id, at: new Date(NOW - min * 60e3).toISOString(), kind, detail });
const events = [ev(34, "unlock_ok"), ev(33.8, "door_open"), ev(33.5, "presence_on"), ev(33.4, "lights_on"), ev(33.3, "ac_on", { precool: false }), ev(33, "door_closed"), ev(1, "heartbeat")].reverse();
const commands = [{ id: "cmd1", device_id: DEV, facility_id: devices[0].facility_id, kind: "lights", args: { state: "on", mins: 30 }, issued_by: ADMIN, issued_at: new Date(NOW - 20 * 60e3).toISOString(), expires_at: new Date(NOW - 19 * 60e3).toISOString(), status: "done", via: "mqtt", result: { ok: true }, done_at: new Date(NOW - 20 * 60e3 + 900).toISOString() }];

const W = { time: 0.5, capacity: 0.3, offpeak: 0.2 };
const profiles = [
  { id: STUDENT, full_name: NAMES[STUDENT], email: "aina@mail.apu.edu.my", role: "student", member_type: "undergraduate", rec_weights: W, rec_bandit: null, created_at: "2026-09-01T00:00:00Z" },
  { id: OTHER, full_name: NAMES[OTHER], email: "daniel@mail.apu.edu.my", role: "student", member_type: "undergraduate", rec_weights: W, rec_bandit: null, created_at: "2026-09-02T00:00:00Z" },
  { id: MANAGER, full_name: NAMES[MANAGER], email: "faiz@apu.edu.my", role: "facility_manager", member_type: "staff", rec_weights: W, rec_bandit: null, created_at: "2026-08-20T00:00:00Z" },
  { id: ADMIN, full_name: NAMES[ADMIN], email: "admin@demo.campus", role: "admin", member_type: "staff", rec_weights: W, rec_bandit: null, created_at: "2026-08-01T00:00:00Z" },
];
const managed = [F("badminton", "Court 1"), F("badminton", "Court 2"), F("badminton", "Court 3"), F("badminton", "Court 4"), F("discussion_room", "Room A")];
const facility_managers = managed.map((facility_id) => ({ facility_id, manager_id: MANAGER, profiles: { full_name: NAMES[MANAGER] } }));
const catRows = cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, venue: c.venue, description: null, open_time: c.open, close_time: c.close, slot_minutes: 30, min_duration_mins: c.min, max_duration_mins: c.max, max_advance_days: 14, cancellation_hours: c.cancel, auto_approve: c.auto, checkin_grace_mins: 15, allowed_members: c.members, max_upcoming: null, max_hours_week: null }));
const pending = busy.filter((r) => r.status === "pending");
const booking_risk = [
  { reservation_id: pending[0].id, risk: 0.42, reasons: ["Missed 2 of last 4 bookings", "Booked 2 days ahead"], threshold: 0.35, model_version: 0, mode: "baseline" },
  { reservation_id: pending[1].id, risk: 0.08, reasons: [], threshold: 0.35, model_version: 0, mode: "baseline" },
];
const room_reports = [{ id: "rep1", facility_id: F("discussion_room", "Room B"), reservation_id: null, user_id: STUDENT, category: "aircon", urgency: "normal", description: "Air-con is very weak in the afternoon.", status: "open", manager_note: null, created_at: new Date(NOW - 2 * 3600e3).toISOString(), updated_at: new Date(NOW - 2 * 3600e3).toISOString(), profiles: { full_name: NAMES[STUDENT] }, facilities: { name: "Room B" } }];
const notifications = [
  { id: "n1", user_id: STUDENT, title: "Booking approved", body: "Your Room A booking is approved.", type: "booking_approved", entity_id: mine[0].id, read: false, created_at: new Date(NOW - 3600e3).toISOString() },
  { id: "n2", user_id: MANAGER, title: "New request", body: "Court 2 on " + keyPlus(2), type: "new_request", entity_id: pending[0].id, read: false, created_at: new Date(NOW - 1800e3).toISOString() },
];
const equipment = [{ id: "eq1", name: "Badminton racket", facility_type: "badminton", total_qty: 10, available_qty: 8 }, { id: "eq2", name: "HDMI cable", facility_type: "discussion_room", total_qty: 4, available_qty: 4 }];

const tables = (uid) => {
  const allRes = [...busy, ...mine, nowRes];
  const isAdmin = uid === ADMIN, isMgr = uid === MANAGER;
  return {
    facilities_full: fac, facilities: fac, effective_facility_rules: rules, facility_categories: catRows, facility_rules: [],
    profiles: isAdmin || isMgr ? profiles : profiles.filter((p) => p.id === uid),
    reservations: isAdmin ? allRes : isMgr ? allRes.filter((r) => managed.includes(r.facility_id)) : allRes.filter((r) => r.user_id === uid),
    reservation_busy: allRes.filter((r) => ["pending", "approved"].includes(r.status)).map(({ id, facility_id, start_time, end_time, status }) => ({ id, facility_id, start_time, end_time, status })),
    room_devices_visible: devices, room_devices: devices, door_facilities: devices.map((d) => ({ facility_id: d.facility_id })),
    room_events: events, room_commands: commands, facility_managers,
    equipment, reservation_equipment: [],
    notifications: notifications.filter((n) => n.user_id === uid),
    facility_open_issues: [{ facility_id: F("discussion_room", "Room B"), category: "aircon", urgency: "normal" }],
    room_reports: isAdmin || isMgr ? room_reports : room_reports.filter((r) => r.user_id === uid),
    activity_log: [], lost_and_found: [], evaluation_events: [],
    booking_risk: isAdmin || isMgr ? booking_risk : [],
    noshow_model: [],
  };
};

function filter(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    const m = v.match(/^(eq|neq|lt|lte|gt|gte|in|is)\.(.*)$/); if (!m) continue;
    const [, op, raw] = m;
    out = out.filter((r) => {
      const x = r[k]; if (x === undefined) return true;
      const s = x === null ? "null" : String(x);
      if (op === "eq") return s === raw; if (op === "neq") return s !== raw;
      if (op === "in") return raw.replace(/^\(|\)$/g, "").split(",").map((t) => t.replace(/^"|"$/g, "")).includes(s);
      if (op === "is") return raw === "null" ? x === null : String(x) === raw;
      const a = Date.parse(s), b = Date.parse(raw); const [p, q] = isNaN(a) || isNaN(b) ? [s, raw] : [a, b];
      return op === "lt" ? p < q : op === "lte" ? p <= q : op === "gt" ? p > q : p >= q;
    });
  }
  const order = params.get("order");
  if (order) { const [col, dir] = order.split(",")[0].split("."); out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === "desc" ? -1 : 1)); }
  const lim = params.get("limit"); if (lim) out = out.slice(0, Number(lim));
  return out;
}
const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "content-range", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  const u = new URL(req.url, "http://x");
  const tok = (req.headers.authorization || "").replace("Bearer ", "");
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (u.pathname.startsWith("/auth/v1/user")) {
      const id = who(tok); const p = profiles.find((x) => x.id === id);
      return send(res, 200, { id, aud: "authenticated", role: "authenticated", email: p.email, user_metadata: { full_name: p.full_name }, app_metadata: {}, created_at: "2026-09-01T00:00:00Z" });
    }
    if (u.pathname.startsWith("/auth/v1/")) return send(res, 200, {});
    if (u.pathname.startsWith("/realtime/")) return send(res, 404, {});
    if (u.pathname.startsWith("/rest/v1/rpc/")) return send(res, 200, null);
    if (!u.pathname.startsWith("/rest/v1/")) return send(res, 404, {});
    const t = u.pathname.replace("/rest/v1/", "");
    const rows = filter(tables(who(tok))[t] ?? [], u.searchParams);
    const range = { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` };
    if (req.method === "HEAD") return send(res, 200, undefined, range);
    if (req.method !== "GET") {
      let b = {}; try { b = JSON.parse(body || "{}"); } catch { /* ignore */ }
      const one = Array.isArray(b) ? b[0] : b;
      return send(res, 201, (req.headers.accept || "").includes("vnd.pgrst.object") ? { id: "new1", ...one } : [{ id: "new1", ...one }]);
    }
    if ((req.headers.accept || "").includes("vnd.pgrst.object")) return rows.length ? send(res, 200, rows[0]) : send(res, 406, { code: "PGRST116", message: "no rows" });
    return send(res, 200, rows, range);
  });
}).listen(PORT, () => console.log("mock supabase on", PORT));
