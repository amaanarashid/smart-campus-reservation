import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Facility, FacilityRule, Reservation, RecWeights } from "@/lib/types";
import {
  describeWindows, fitsIn, freeWindows, Intent, matchFacilities, parseIntent,
  PART_CENTRE, sanitiseIntent, withContext,
} from "@/lib/chat-logic";
import { recommendAcross, learnPeakHours, DEFAULT_WEIGHTS } from "@/lib/recommend";
import { initBandit, isBanditState, rankWithBandit } from "@/lib/bandit";
import { addDays, fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";

/**
 * Grounded facility chatbot.
 *
 * Provider-agnostic: set AI_PROVIDER + AI_API_KEY in .env.local
 *   AI_PROVIDER=groq    AI_API_KEY=gsk_...   (free at console.groq.com)
 *   AI_PROVIDER=openai  AI_API_KEY=sk-...
 *   AI_PROVIDER=gemini  AI_API_KEY=AIza...   (free at aistudio.google.com)
 * With no key set, a deterministic parser and template phrasing answer from
 * live data, so the demo works offline.
 *
 * Design: the model never free-generates facts. It (1) helps extract the
 * question as JSON, (2) the server queries Supabase under the caller's own RLS
 * context, (3) the model phrases an answer from the returned facts only.
 *
 * Question families: availability (with real free windows, a specific time,
 * and ranked alternatives from the recommender when busy), rules, the list of
 * facilities, and the student's own bookings. Follow-ups inherit the facility
 * and day from earlier turns. All times are Malaysia time.
 */

interface Msg { role: "user" | "assistant"; content: string }

// ---------- LLM adapter ----------
async function llm(system: string, user: string): Promise<string | null> {
  const provider = process.env.AI_PROVIDER;
  const key = process.env.AI_API_KEY;
  if (!provider || !key) return null;

  try {
    if (provider === "gemini") {
      const model = process.env.AI_MODEL || "gemini-2.5-flash";
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
          }),
        }
      );
      const j = await r.json();
      if (!r.ok || !j?.candidates?.[0]?.content?.parts?.[0]?.text) {
        console.error("[chat] Gemini call failed:", r.status, JSON.stringify(j).slice(0, 400));
        return null;
      }
      return j.candidates[0].content.parts[0].text;
    }
    // openai + groq share the chat-completions shape
    const base = provider === "groq" ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1";
    const model = provider === "groq" ? "llama-3.3-70b-versatile" : "gpt-4o-mini";
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.2,
      }),
    });
    const j = await r.json();
    if (!r.ok || !j?.choices?.[0]?.message?.content) {
      console.error("[chat] LLM call failed:", r.status, JSON.stringify(j).slice(0, 400));
      return null;
    }
    return j.choices[0].message.content;
  } catch (e) {
    console.error("[chat] LLM request threw:", e);
    return null;
  }
}

// ---------- understanding the question ----------
async function understand(q: string, history: Msg[], facilities: Facility[], now: Date): Promise<Intent> {
  const local = parseIntent(q, facilities, now);
  const past = history
    .filter((m) => m.role === "user")
    .map((m) => parseIntent(m.content, facilities, now));

  const names = facilities.map((f) => `${f.name} (${f.category_name})`).join("; ");
  const convo = history.slice(-4).map((m) => `${m.role}: ${m.content}`).join("\n");
  const out = await llm(
    `Extract a campus facility booking question as strict JSON, no prose. Today is ${myDateKey(now)} (Malaysia).
Known facilities: ${names}.
Schema: {"intent":"availability"|"rules"|"list"|"mine"|"other","facility":string|null,"date":"YYYY-MM-DD"|null,"part_of_day":"morning"|"afternoon"|"evening"|null,"hour":0-23|null,"duration":minutes|null}
"mine" means the user asks about their own bookings. Use earlier turns to resolve follow-ups like "what about tomorrow?". Use facility and category names exactly as listed.`,
    `${convo ? `Earlier:\n${convo}\n\n` : ""}Question: ${q}`
  );

  let merged: Intent = local;
  if (out) {
    try {
      const m = out.match(/\{[\s\S]*\}/);
      if (m) {
        const fromLlm = sanitiseIntent(JSON.parse(m[0]));
        // the local parser only reports facility words that really exist, so
        // it wins on facility; the model wins on everything it understood
        merged = { ...local, ...fromLlm, facility: local.facility ?? fromLlm.facility ?? null };
      }
    } catch { /* keep the local parse */ }
  }
  return withContext(merged, past);
}

// ---------- rate limiting (per client, in-memory) ----------
const hits = new Map<string, { n: number; t: number }>();
function rateLimited(id: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(id);
  if (!h || now - h.t > windowMs) {
    hits.set(id, { n: 1, t: now });
    return false;
  }
  h.n += 1;
  return h.n > limit;
}

// ---------- fact builders ----------
function listFacts(all: Facility[]): string {
  const groups = new Map<string, Facility[]>();
  for (const f of all) groups.set(f.category_name, [...(groups.get(f.category_name) ?? []), f]);
  return [...groups.entries()]
    .map(([cat, fs]) => `${cat} at ${fs[0].venue}: ${fs.map((f) => `${f.name} (up to ${f.capacity})`).join(", ")}.`)
    .join(" ");
}

function rulesFacts(matched: Facility[], rules: Record<string, FacilityRule>): string {
  return matched.slice(0, 4).map((f) => {
    const r = rules[f.id];
    if (!r) return `${f.name}: no rules configured.`;
    return `${f.name} (${f.category_name}): open ${r.open_time.slice(0, 5)} to ${r.close_time.slice(0, 5)}, ` +
      `bookings of ${r.min_duration_mins} to ${r.max_duration_mins} minutes, up to ${f.capacity} people, ` +
      `bookable up to ${r.max_advance_days} days ahead, cancel at least ${r.cancellation_hours} hours before, ` +
      `${r.auto_approve ? "approved automatically" : "needs manager approval"}.`;
  }).join(" ");
}

async function mineFacts(db: SupabaseClient, uid: string, all: Facility[], now: Date, wantsNext: boolean): Promise<string> {
  const { data } = await db
    .from("reservations")
    .select("facility_id,start_time,end_time,status")
    .eq("user_id", uid)
    .in("status", ["pending", "approved"])
    .gte("end_time", now.toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  const rows = (data ?? []) as Pick<Reservation, "facility_id" | "start_time" | "end_time" | "status">[];
  if (rows.length === 0) return "You have no upcoming bookings.";

  const line = (r: (typeof rows)[number]) => {
    const f = all.find((x) => x.id === r.facility_id);
    const s = new Date(r.start_time);
    return `${f ? `${f.name} (${f.category_name})` : "a facility"} ${fmtRelativeDay(myDateKey(s), now)}, ` +
      `${fmtTime(s)} to ${fmtTime(new Date(r.end_time))}, ${r.status === "approved" ? "approved" : "waiting for approval"}`;
  };

  if (wantsNext) {
    const more = rows.length > 1 ? ` You have ${rows.length - 1} more after that.` : "";
    return `Your next booking is ${line(rows[0])}.${more}`;
  }
  return `Your upcoming bookings: ${rows.map(line).join("; ")}.`;
}

async function availabilityFacts(
  db: SupabaseClient, it: Intent, matched: Facility[], all: Facility[],
  rules: Record<string, FacilityRule>, uid: string, now: Date
): Promise<string> {
  const date = it.date ?? myDateKey(now);
  const when = fmtRelativeDay(date, now);
  const shown = matched.slice(0, 4);
  const ids = shown.map((f) => f.id);

  const { data: res } = await db
    .from("reservations")
    .select("facility_id,start_time,end_time,status")
    .in("facility_id", ids)
    .in("status", ["pending", "approved"])
    .lt("start_time", myAt(addDays(date, 1), "00:00").toISOString())
    .gt("end_time", myAt(date, "00:00").toISOString());
  const dayRes = (res ?? []) as Reservation[];

  const lines: string[] = [];
  let anyFree = false;
  let askedTimeTaken = false;

  for (const f of shown) {
    const rule = rules[f.id];
    if (!rule) { lines.push(`${f.name}: no booking rules configured.`); continue; }
    const wins = freeWindows(rule, dayRes.filter((r) => r.facility_id === f.id), date, now, it.part_of_day);
    const label = `${f.name} (${f.category_name})`;
    const partLabel = it.part_of_day ? ` in the ${it.part_of_day}` : "";

    if (it.hour !== null) {
      const dur = Math.min(rule.max_duration_mins, Math.max(rule.min_duration_mins, it.duration ?? 60));
      const start = myAt(date, `${it.hour}:00`);
      if (fitsIn(wins, start, dur)) {
        anyFree = true;
        lines.push(`${label} is free ${when} at ${fmtTime(start)} for ${dur} minutes.`);
        continue;
      }
      askedTimeTaken = true;
      lines.push(`${label} is not free ${when} at ${fmtTime(start)} for ${dur} minutes.`);
    }
    if (wins.length === 0) {
      lines.push(`${label} has no free time ${when}${partLabel}.`);
    } else {
      anyFree = true;
      if (it.hour === null) lines.push(`${label} is free ${when}${partLabel}: ${describeWindows(wins)}.`);
    }
  }
  if (matched.length > shown.length) lines.push(`(${matched.length - shown.length} more facilities of this type not listed.)`);

  // Busy at the time asked, or nothing free at all: ask the recommender.
  if (askedTimeTaken || !anyFree) {
    const requested = shown.find((f) => rules[f.id]);
    if (requested) {
      const alt = await alternatives(db, it, requested, all, rules, uid, date, now);
      if (alt) lines.push(alt);
    }
  }
  return lines.join(" ");
}

async function alternatives(
  db: SupabaseClient, it: Intent, requested: Facility, all: Facility[],
  rules: Record<string, FacilityRule>, uid: string, date: string, now: Date
): Promise<string | null> {
  const LOOK_AHEAD = 2;
  const rule = rules[requested.id];
  const ids = all.filter((f) => f.category_id === requested.category_id).map((f) => f.id);
  const since = myAt(addDays(myDateKey(now), -60), "00:00").toISOString();

  const [{ data: res }, { data: hist }, { data: prof }] = await Promise.all([
    db.from("reservations").select("*")
      .in("facility_id", ids).in("status", ["pending", "approved"])
      .lt("start_time", myAt(addDays(date, LOOK_AHEAD + 1), "00:00").toISOString())
      .gt("end_time", myAt(date, "00:00").toISOString()),
    db.from("reservations").select("start_time,end_time,status")
      .in("facility_id", ids).in("status", ["pending", "approved"]).gte("start_time", since),
    db.from("profiles").select("*").eq("id", uid).maybeSingle(),
  ]);

  const weights = (prof?.rec_weights as RecWeights | undefined) ?? DEFAULT_WEIGHTS;
  const stored: unknown = prof?.rec_bandit;
  const bandit = isBanditState(stored) ? stored : initBandit();
  const preferredHour = it.hour ?? (it.part_of_day ? PART_CENTRE[it.part_of_day] : null);
  const duration = Math.min(rule.max_duration_mins, Math.max(rule.min_duration_mins, it.duration ?? 60));

  const out = recommendAcross({
    requested, facilities: all, rules,
    reservations: (res ?? []) as Reservation[],
    date, durationMins: duration, participants: 1, preferredHour,
    weights, peaks: learnPeakHours(hist ?? []), now, lookAheadDays: LOOK_AHEAD,
  });
  const top = rankWithBandit(out.slots, bandit).slice(0, 3);
  if (top.length === 0) return out.rejectedReason ? `No alternatives found: ${out.rejectedReason}` : null;

  const lead = out.usedLookAhead
    ? `${fmtRelativeDay(date, now)} is full for every ${requested.category_name}, so here are the next days with space.`
    : "Best alternatives:";
  const items = top.map((s) =>
    `${s.facilityName} ${fmtRelativeDay(s.dateKey, now)} ${fmtTime(s.start)} to ${fmtTime(s.end)}` +
    (s.reasons.length ? ` (${s.reasons.slice(0, 2).join(", ")})` : "")
  );
  return `${lead} ${items.join("; ")}.`;
}

// ---------- route ----------
export async function POST(req: NextRequest) {
  let body: { messages?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Invalid request." }, { status: 400 });
  }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));
  const lastUser = [...messages].reverse().findIndex((m) => m.role === "user");
  if (lastUser < 0) return NextResponse.json({ reply: "Ask me about facility availability, rules, or your bookings." });
  const qIndex = messages.length - 1 - lastUser;
  const q = messages[qIndex].content;
  const history = messages.slice(0, qIndex);
  if (!q.trim()) return NextResponse.json({ reply: "Ask me about facility availability, rules, or your bookings." });

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ reply: "Please sign in to use the assistant." }, { status: 401 });
  }
  const clientId = token.slice(-24);
  if (rateLimited(clientId)) {
    return NextResponse.json(
      { reply: "You're sending messages quickly - give me a few seconds and try again." },
      { status: 429 }
    );
  }

  // every query below runs under the caller's own RLS context
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );
  const { data: userData } = await db.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return NextResponse.json({ reply: "Your session has expired - please sign in again." }, { status: 401 });

  const now = new Date();
  const [{ data: facs }, { data: ruleRows }] = await Promise.all([
    db.from("facilities_full").select("*").eq("status", "active").order("name"),
    db.from("effective_facility_rules").select("*"),
  ]);
  const all = (facs ?? []) as Facility[];
  const rules: Record<string, FacilityRule> = {};
  for (const r of (ruleRows ?? []) as FacilityRule[]) rules[r.facility_id] = r;

  const it = await understand(q, history, all, now);
  const matched = matchFacilities(it.facility, all);

  let facts = "";
  if (it.intent === "mine") {
    facts = await mineFacts(db, uid, all, now, /\bnext\b/i.test(q));
  } else if (it.intent === "list" || (it.intent !== "other" && matched.length === 0 && !it.facility)) {
    facts = all.length ? `Facilities you can book: ${listFacts(all)}` : "No facilities are open for booking right now.";
  } else if (it.facility && matched.length === 0) {
    facts = `No facility matching "${it.facility}" was found. Facilities: ${all.map((f) => f.name).join(", ")}.`;
  } else if (it.intent === "rules") {
    facts = rulesFacts(matched, rules);
  } else if (it.intent === "availability") {
    facts = await availabilityFacts(db, it, matched, all, rules, uid, now);
  }

  if (!facts) {
    return NextResponse.json({
      reply:
        "I can help with facility availability, booking rules, and your own bookings. For anything else (payments, lost property, complaints), please contact the campus service desk.",
    });
  }

  // phrase the answer (LLM if available, the facts themselves otherwise)
  const phrased = await llm(
    "You are a campus facility booking assistant in Malaysia. Answer the user's question using ONLY the facts provided. " +
      "Be brief and friendly. Keep every time, date and facility name exactly as given. Do not invent any information. " +
      "If the facts do not answer the question, say so.",
    `Question: ${q}\nFacts: ${facts}`
  );

  return NextResponse.json({ reply: phrased ?? facts });
}
