import { NextRequest, NextResponse } from "next/server";
import { busyQuery } from "@/lib/busy";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { BusySlot, Facility, FacilityRule, Reservation, RecWeights } from "@/lib/types";
import {
  fitsIn, freeWindows, Intent, matchFacilities, parseIntent,
  PART_CENTRE, sanitiseIntent, withContext,
} from "@/lib/chat-logic";
import { recommendAcross, learnPeakHours, DEFAULT_WEIGHTS } from "@/lib/recommend";
import { initBandit, isBanditState, rankWithBandit } from "@/lib/bandit";
import { addDays, fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";
import {
  FIXED, PART_MS, REASON_MS, fmtRelativeDayMs, fmtTimeMs, hasOtherScript, replyLanguage, type Lang,
} from "@/lib/chat-lang";

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
 * Languages: English and Bahasa Melayu. The answer is in the language the
 * student writes in (lib/chat-lang.ts); Malay dates, times and facility words
 * are understood by the same parser (lib/chat-logic.ts). Other scripts
 * (Arabic, Chinese, Tamil ...) are understood and answered by the AI when a
 * key is set; the facts underneath are the same.
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
    `Extract a campus facility booking question as strict JSON, no prose. The question may be in any language (often English or Bahasa Melayu). Facilities cost nothing to book, so "free" or "available" means not booked (intent availability). Today is ${myDateKey(now)} (Malaysia).
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

// ---------- wording, per language ----------
/** Everything the answer needs to say, in English or Bahasa Melayu. */
function words(lang: Lang, now: Date) {
  const ms = lang === "ms";
  const time = (d: Date) => (ms ? fmtTimeMs(d) : fmtTime(d));
  const day = (k: string) => (ms ? fmtRelativeDayMs(k, now) : fmtRelativeDay(k, now));
  const range = (a: Date, b: Date) => `${time(a)} ${ms ? "hingga" : "to"} ${time(b)}`;
  return {
    time, day, range,
    windows: (ws: { start: Date; end: Date }[]) => ws.map((w) => range(w.start, w.end)).join(", "),
    part: (p: "morning" | "afternoon" | "evening") => (ms ? ` pada waktu ${PART_MS[p]}` : ` in the ${p}`),
    reason: (r: string) => (ms ? REASON_MS[r] ?? r : r),
    listIntro: ms ? "Kemudahan yang boleh anda tempah:" : "Facilities you can book:",
    listGroup: (cat: string, venue: string, items: string) => ms ? `${cat} di ${venue}: ${items}.` : `${cat} at ${venue}: ${items}.`,
    upTo: (name: string, n: number) => ms ? `${name} (sehingga ${n} orang)` : `${name} (up to ${n})`,
    notFound: (term: string, names: string) => ms
      ? `Tiada kemudahan yang sepadan dengan "${term}". Kemudahan: ${names}.`
      : `No facility matching "${term}" was found. Facilities: ${names}.`,
    noRules: (name: string) => ms ? `${name}: tiada peraturan ditetapkan.` : `${name}: no rules configured.`,
    rules: (name: string, cat: string, r: FacilityRule, cap: number) => ms
      ? `${name} (${cat}): dibuka ${r.open_time.slice(0, 5)} hingga ${r.close_time.slice(0, 5)}, tempahan ${r.min_duration_mins} hingga ${r.max_duration_mins} minit, ` +
        `sehingga ${cap} orang, boleh ditempah sehingga ${r.max_advance_days} hari lebih awal, batal sekurang-kurangnya ${r.cancellation_hours} jam sebelum, ` +
        `${r.auto_approve ? "diluluskan secara automatik" : "perlu kelulusan pengurus"}` +
        (r.checkin_grace_mins ? `, dan anda mesti daftar masuk dalam ${r.checkin_grace_mins} minit selepas mula atau tempahan akan dilepaskan.` : ".")
      : `${name} (${cat}): open ${r.open_time.slice(0, 5)} to ${r.close_time.slice(0, 5)}, bookings of ${r.min_duration_mins} to ${r.max_duration_mins} minutes, ` +
        `up to ${cap} people, bookable up to ${r.max_advance_days} days ahead, cancel at least ${r.cancellation_hours} hours before, ` +
        `${r.auto_approve ? "approved automatically" : "needs manager approval"}` +
        (r.checkin_grace_mins ? `, and you must check in within ${r.checkin_grace_mins} minutes of the start or the booking is released.` : "."),
    bookingLine: (fac: string, d: string, a: Date, b: Date, approved: boolean) => ms
      ? `${fac} ${d}, ${range(a, b)}, ${approved ? "diluluskan" : "menunggu kelulusan"}`
      : `${fac} ${d}, ${range(a, b)}, ${approved ? "approved" : "waiting for approval"}`,
    aFacility: ms ? "sebuah kemudahan" : "a facility",
    next: (line: string, more: number) => ms
      ? `Tempahan anda yang seterusnya ialah ${line}.${more ? ` Anda ada ${more} lagi selepas itu.` : ""}`
      : `Your next booking is ${line}.${more ? ` You have ${more} more after that.` : ""}`,
    upcoming: (lines: string) => ms ? `Tempahan anda yang akan datang: ${lines}.` : `Your upcoming bookings: ${lines}.`,
    freeAt: (label: string, d: string, at: Date, mins: number) => ms
      ? `${label} kosong ${d} pada ${time(at)} selama ${mins} minit.` : `${label} is free ${d} at ${time(at)} for ${mins} minutes.`,
    notFreeAt: (label: string, d: string, at: Date, mins: number) => ms
      ? `${label} tidak kosong ${d} pada ${time(at)} selama ${mins} minit.` : `${label} is not free ${d} at ${time(at)} for ${mins} minutes.`,
    noTime: (label: string, d: string, part: string) => ms ? `${label} tiada masa kosong ${d}${part}.` : `${label} has no free time ${d}${part}.`,
    freeList: (label: string, d: string, part: string, ws: string) => ms ? `${label} kosong ${d}${part}: ${ws}.` : `${label} is free ${d}${part}: ${ws}.`,
    more: (n: number) => ms ? `(${n} lagi kemudahan jenis ini tidak disenaraikan.)` : `(${n} more facilities of this type not listed.)`,
    noAlt: (why: string) => ms ? `Tiada pilihan lain ditemui: ${why}` : `No alternatives found: ${why}`,
    altFull: (d: string, cat: string) => ms
      ? `${d} penuh untuk setiap ${cat}, jadi ini hari-hari berikutnya yang masih ada ruang.`
      : `${d} is full for every ${cat}, so here are the next days with space.`,
    altLead: ms ? "Pilihan terbaik:" : "Best alternatives:",
  };
}
type Words = ReturnType<typeof words>;

// ---------- fact builders ----------
function listFacts(all: Facility[], w: Words): string {
  const groups = new Map<string, Facility[]>();
  for (const f of all) groups.set(f.category_name, [...(groups.get(f.category_name) ?? []), f]);
  return [...groups.entries()]
    .map(([cat, fs]) => w.listGroup(cat, fs[0].venue, fs.map((f) => w.upTo(f.name, f.capacity)).join(", ")))
    .join(" ");
}

function rulesFacts(matched: Facility[], rules: Record<string, FacilityRule>, w: Words): string {
  return matched.slice(0, 4).map((f) => {
    const r = rules[f.id];
    return r ? w.rules(f.name, f.category_name, r, f.capacity) : w.noRules(f.name);
  }).join(" ");
}

async function mineFacts(db: SupabaseClient, uid: string, all: Facility[], now: Date, wantsNext: boolean, w: Words, lang: Lang): Promise<string> {
  const { data } = await db
    .from("reservations")
    .select("facility_id,start_time,end_time,status")
    .eq("user_id", uid)
    .in("status", ["pending", "approved"])
    .gte("end_time", now.toISOString())
    .order("start_time", { ascending: true })
    .limit(5);

  const rows = (data ?? []) as Pick<Reservation, "facility_id" | "start_time" | "end_time" | "status">[];
  if (rows.length === 0) return FIXED[lang].none;

  const line = (r: (typeof rows)[number]) => {
    const f = all.find((x) => x.id === r.facility_id);
    const s = new Date(r.start_time);
    return w.bookingLine(f ? `${f.name} (${f.category_name})` : w.aFacility, w.day(myDateKey(s)), s, new Date(r.end_time), r.status === "approved");
  };
  if (wantsNext) return w.next(line(rows[0]), rows.length - 1);
  return w.upcoming(rows.map(line).join("; "));
}

async function availabilityFacts(
  db: SupabaseClient, it: Intent, matched: Facility[], all: Facility[],
  rules: Record<string, FacilityRule>, uid: string, now: Date, w: Words
): Promise<string> {
  const date = it.date ?? myDateKey(now);
  const when = w.day(date);
  const shown = matched.slice(0, 4);
  const ids = shown.map((f) => f.id);

  // free/busy only: the chatbot learns when a room is taken, never by whom
  const { data: res } = await busyQuery((t) => db
    .from(t)
    .select("id,facility_id,start_time,end_time,status")
    .in("facility_id", ids)
    .in("status", ["pending", "approved"])
    .lt("start_time", myAt(addDays(date, 1), "00:00").toISOString())
    .gt("end_time", myAt(date, "00:00").toISOString()));
  const dayRes = (res ?? []) as BusySlot[];

  const lines: string[] = [];
  let anyFree = false;
  let askedTimeTaken = false;

  for (const f of shown) {
    const rule = rules[f.id];
    if (!rule) { lines.push(w.noRules(f.name)); continue; }
    const wins = freeWindows(rule, dayRes.filter((r) => r.facility_id === f.id), date, now, it.part_of_day);
    const label = `${f.name} (${f.category_name})`;
    const partLabel = it.part_of_day ? w.part(it.part_of_day) : "";

    if (it.hour !== null) {
      const dur = Math.min(rule.max_duration_mins, Math.max(rule.min_duration_mins, it.duration ?? 60));
      const start = myAt(date, `${it.hour}:00`);
      if (fitsIn(wins, start, dur)) {
        anyFree = true;
        lines.push(w.freeAt(label, when, start, dur));
        continue;
      }
      askedTimeTaken = true;
      lines.push(w.notFreeAt(label, when, start, dur));
    }
    if (wins.length === 0) {
      lines.push(w.noTime(label, when, partLabel));
    } else {
      anyFree = true;
      if (it.hour === null) lines.push(w.freeList(label, when, partLabel, w.windows(wins)));
    }
  }
  if (matched.length > shown.length) lines.push(w.more(matched.length - shown.length));

  // Busy at the time asked, or nothing free at all: ask the recommender.
  if (askedTimeTaken || !anyFree) {
    const requested = shown.find((f) => rules[f.id]);
    if (requested) {
      const alt = await alternatives(db, it, requested, all, rules, uid, date, now, w);
      if (alt) lines.push(alt);
    }
  }
  return lines.join(" ");
}

async function alternatives(
  db: SupabaseClient, it: Intent, requested: Facility, all: Facility[],
  rules: Record<string, FacilityRule>, uid: string, date: string, now: Date, w: Words
): Promise<string | null> {
  const LOOK_AHEAD = 2;
  const rule = rules[requested.id];
  const ids = all.filter((f) => f.category_id === requested.category_id).map((f) => f.id);
  const since = myAt(addDays(myDateKey(now), -60), "00:00").toISOString();

  const [{ data: res }, { data: hist }, { data: prof }] = await Promise.all([
    busyQuery((t) => db.from(t).select("id,facility_id,start_time,end_time,status")
      .in("facility_id", ids).in("status", ["pending", "approved"])
      .lt("start_time", myAt(addDays(date, LOOK_AHEAD + 1), "00:00").toISOString())
      .gt("end_time", myAt(date, "00:00").toISOString())),
    busyQuery((t) => db.from(t).select("start_time,end_time,status")
      .in("facility_id", ids).in("status", ["pending", "approved"]).gte("start_time", since)),
    db.from("profiles").select("*").eq("id", uid).maybeSingle(),
  ]);

  const weights = (prof?.rec_weights as RecWeights | undefined) ?? DEFAULT_WEIGHTS;
  const stored: unknown = prof?.rec_bandit;
  const bandit = isBanditState(stored) ? stored : initBandit();
  const preferredHour = it.hour ?? (it.part_of_day ? PART_CENTRE[it.part_of_day] : null);
  const duration = Math.min(rule.max_duration_mins, Math.max(rule.min_duration_mins, it.duration ?? 60));

  const out = recommendAcross({
    requested, facilities: all, rules,
    reservations: (res ?? []) as BusySlot[],
    date, durationMins: duration, participants: 1, preferredHour,
    weights, peaks: learnPeakHours(hist ?? []), now, lookAheadDays: LOOK_AHEAD,
  });
  const top = rankWithBandit(out.slots, bandit).slice(0, 3);
  if (top.length === 0) return out.rejectedReason ? w.noAlt(out.rejectedReason) : null;

  const lead = out.usedLookAhead ? w.altFull(w.day(date), requested.category_name) : w.altLead;
  const items = top.map((s) =>
    `${s.facilityName} ${w.day(s.dateKey)} ${w.range(s.start, s.end)}` +
    (s.reasons.length ? ` (${s.reasons.slice(0, 2).map(w.reason).join(", ")})` : "")
  );
  return `${lead} ${items.join("; ")}.`;
}

// ---------- route ----------
export async function POST(req: NextRequest) {
  let body: { messages?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: FIXED.en.invalid }, { status: 400 });
  }
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 500) }));
  const lastUser = [...messages].reverse().findIndex((m) => m.role === "user");
  if (lastUser < 0) return NextResponse.json({ reply: FIXED.en.ask });
  const qIndex = messages.length - 1 - lastUser;
  const q = messages[qIndex].content;
  const history = messages.slice(0, qIndex);
  // answer in the language the student is writing in
  const earlier = history.filter((m) => m.role === "user").map((m) => m.content);
  const lang = replyLanguage(q, earlier);
  // another script (Arabic, Chinese ...): English facts, AI answers in that language
  const otherScript = hasOtherScript(q);
  const fixed = FIXED[lang];
  if (!q.trim()) return NextResponse.json({ reply: fixed.ask });

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ reply: fixed.signIn }, { status: 401 });
  }
  const clientId = token.slice(-24);
  if (rateLimited(clientId)) {
    return NextResponse.json({ reply: fixed.slow }, { status: 429 });
  }

  // every query below runs under the caller's own RLS context
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );
  const { data: userData } = await db.auth.getUser(token);
  const uid = userData?.user?.id;
  if (!uid) return NextResponse.json({ reply: fixed.expired }, { status: 401 });

  const now = new Date();
  const w = words(lang, now);
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
    facts = await mineFacts(db, uid, all, now, /\bnext\b|\bseterusnya\b|\bberikutnya\b/i.test(q), w, lang);
  } else if (it.intent === "list" || (it.intent !== "other" && matched.length === 0 && !it.facility)) {
    facts = all.length ? `${w.listIntro} ${listFacts(all, w)}` : fixed.noFacilities;
  } else if (it.facility && matched.length === 0) {
    facts = w.notFound(it.facility, all.map((f) => f.name).join(", "));
  } else if (it.intent === "rules") {
    facts = rulesFacts(matched, rules, w);
  } else if (it.intent === "availability") {
    facts = await availabilityFacts(db, it, matched, all, rules, uid, now, w);
  }

  if (!facts) return NextResponse.json({ reply: fixed.offTopic, lang });

  // phrase the answer (LLM if available, the facts themselves otherwise)
  const phrased = await llm(
    "You are a campus facility booking assistant in Malaysia. Answer the user's question using ONLY the facts provided. " +
      "Be brief and friendly. Keep every time, date and facility name exactly as given. Do not invent any information. " +
      "Booking campus facilities costs nothing, so \"free\" or \"available\" means not booked at that time. " +
      "If the facts do not answer the question, say so. " +
      (otherScript
        ? "Reply in the same language as the question; keep facility names as given."
        : lang === "ms" ? "Reply in Bahasa Melayu (Malaysia), in a natural, friendly tone." : "Reply in English."),
    `Question: ${q}\nFacts: ${facts}`
  );

  return NextResponse.json({ reply: phrased ?? facts, lang });
}
