// Automated accessibility audit (axe-core, WCAG 2.1 A + AA) and screenshots of
// every role's pages, in light and dark theme, desktop and phone width.
// No participants: the app runs against scripts/eval/ui/mock-supabase.mjs.
//
//   1. node scripts/eval/ui/mock-supabase.mjs &
//   2. NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock npm run build && npm start &
//   3. CHROME=/path/to/chrome node scripts/eval/ui/audit.mjs [--only name,name] [--shots]
//
// Output: docs/evaluation/usability/axe.json (+ screenshots in shots/ with --shots).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER ?? "puppeteer-core");
const AXE = fs.readFileSync(require.resolve(process.env.AXE ?? "axe-core/axe.min.js"), "utf8");
const BASE = process.env.APP_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? "docs/evaluation/usability";
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const shots = args.includes("--shots");

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const IDS = { student: "11111111-1111-4111-8111-111111111111", manager: "44444444-4444-4444-8444-444444444444", admin: "22222222-2222-4222-8222-222222222222" };
function session(role) {
  const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
  const user = { id: IDS[role], aud: "authenticated", role: "authenticated", email: `${role}@demo.campus`, app_metadata: {}, user_metadata: {}, created_at: "2026-09-01T00:00:00Z" };
  // the mock picks the user from the word in the signature part
  const access_token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: IDS[role], role: "authenticated", exp })}.${role}-sig`;
  return { access_token, refresh_token: `${role}-refresh`, token_type: "bearer", expires_in: 7 * 86400, expires_at: exp, user };
}

/** Click the first button/link whose text starts with `text` (and contains every `also`). */
const clickText = (text, ...also) => async (page) => {
  const ok = await page.evaluate((t, more) => {
    const els = [...document.querySelectorAll("button, a, [role=button], [role=tab]")];
    const el = els.find((e) => {
      const s = e.textContent?.trim().replace(/\s+/g, " ") ?? "";
      return s.startsWith(t) && more.every((m) => s.includes(m));
    });
    if (el) { el.click(); return true; }
    return false;
  }, text, also);
  if (!ok) throw new Error(`no clickable "${text}"`);
  await new Promise((r) => setTimeout(r, 900));
};
const wait = (ms) => async () => new Promise((r) => setTimeout(r, ms));
/** Pick an option in a list opened by a real click (these lists ignore scripted clicks). */
const chooseOption = (label, text) => async (page) => {
  await page.click(`[role="combobox"][aria-label="${label}"]`);
  await new Promise((r) => setTimeout(r, 300));
  const handle = await page.evaluateHandle((t) => [...document.querySelectorAll("[role=option]")].find((o) => o.textContent?.trim() === t), text);
  if (!handle.asElement()) throw new Error(`no option "${text}" in "${label}"`);
  await handle.asElement().click();
  await new Promise((r) => setTimeout(r, 300));
};

// [name, role, path, steps]
const VIEWS = [
  ["login", null, "/login", []],
  ["student-home", "student", "/student", []],
  ["student-venue", "student", "/student", [clickText("Sports Complex")]],
  ["student-booking-form", "student", "/student", [clickText("Sports Complex"), clickText("Court 1", "up to 4 people")]],
  ["student-suggestions", "student", "/student", [clickText("Sports Complex"), clickText("Court 1", "up to 4 people"), clickText("Tomorrow"), chooseOption("Start time", "3:00 pm"), clickText("Request this time"), wait(1500)]],
  ["student-report-problem", "student", "/student", [clickText("Report a problem")]],
  ["student-chatbot", "student", "/student", [async (p) => { await p.evaluate(() => document.querySelector("[aria-label*='chat' i], [aria-label*='assistant' i]")?.click()); await wait(900)(); }]],
  ["manager-home", "manager", "/facility-manager", []],
  ["admin-overview", "admin", "/admin", []],
  ["admin-analytics", "admin", "/admin", [clickText("Analytics"), wait(1500)]],
  ["admin-smart-room", "admin", "/admin", [clickText("Smart room")]],
  ["admin-room-detail", "admin", "/admin", [clickText("Smart room"), clickText("Open Room A"), wait(2500)]],
  ["admin-connect-room", "admin", "/admin", [clickText("Smart room"), clickText("Connect a room")]],
  ["admin-users", "admin", "/admin", [clickText("Users")]],
  ["admin-facilities", "admin", "/admin", [clickText("Facilities")]],
  ["admin-facility-detail", "admin", "/admin", [clickText("Facilities"), clickText("View details")]],
  ["admin-new-facility", "admin", "/admin", [clickText("Facilities"), clickText("New facility")]],
  ["admin-approvals", "admin", "/admin", [clickText("Approvals")]],
  ["admin-feedback", "admin", "/admin", [clickText("Feedback")]],
  ["admin-equipment", "admin", "/admin", [clickText("Equipment")]],
  ["admin-records", "admin", "/admin", [clickText("Records")]],
];
const VARIANTS = [
  ["desktop-light", { width: 1366, height: 900 }, "light"],
  ["desktop-dark", { width: 1366, height: 900 }, "dark"],
  ["phone-light", { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, "light"],
];

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME,
  args: (process.env.CHROME_ARGS ?? "--no-sandbox --disable-dev-shm-usage --disable-gpu").split(" "),
  headless: true,
});
const results = [];
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
for (const [name, role, url, steps] of VIEWS) {
  if (only && !only.includes(name)) continue;
  for (const [variant, viewport, theme] of VARIANTS) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.evaluateOnNewDocument((s, theme) => {
      localStorage.setItem("campus-theme", theme);
      if (s) { sessionStorage.setItem("campus-tab-id", "audit"); sessionStorage.setItem("campus-auth-audit", s); }
    }, role ? JSON.stringify(session(role)) : null, theme);
    const t0 = Date.now();
    let error = null;
    try {
      await page.goto(BASE + url, { waitUntil: "networkidle0", timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1200));
      for (const s of steps) await s(page);
    } catch (e) { error = e.message; }
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => t.startsWith("wcag")), nodes: v.nodes.length, examples: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") })) }));
    });
    if (shots) await page.screenshot({ path: path.join(OUT, "shots", `${name}--${variant}.png`), fullPage: variant !== "phone-light" });
    results.push({ view: name, variant, url, error, ms: Date.now() - t0, violations: axe });
    console.log(`${name.padEnd(22)} ${variant.padEnd(14)} ${error ? "ERR " + error : ""} ${axe.length} rule(s): ${axe.map((v) => `${v.id}×${v.nodes}`).join(", ")}`);
    await page.close();
  }
}
await browser.close();
const file = path.join(OUT, only ? `axe-partial.json` : "axe.json");
const prev = only && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).results : [];
const merged = [...prev.filter((r) => !results.some((x) => x.view === r.view && x.variant === r.variant)), ...results];
fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), standard: "WCAG 2.1 A + AA (axe-core)", results: merged }, null, 2));
console.log("wrote", file);
