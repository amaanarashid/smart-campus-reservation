import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Grounded facility chatbot (availability + rules Q&A).
 *
 * Provider-agnostic: set AI_PROVIDER + AI_API_KEY in .env.local
 *   AI_PROVIDER=groq    AI_API_KEY=gsk_...   (free at console.groq.com)
 *   AI_PROVIDER=openai  AI_API_KEY=sk-...
 *   AI_PROVIDER=gemini  AI_API_KEY=AIza...   (free at aistudio.google.com)
 * With no key set, a deterministic mock mode answers from live data with
 * template phrasing - the demo always works.
 *
 * Design: the model never free-generates facts. It (1) extracts intent as
 * JSON, (2) the server queries Supabase under the caller's own RLS context,
 * (3) the model phrases an answer from the returned rows only.
 */

interface Msg { role: "user" | "assistant"; content: string }
interface Intent {
  intent: "availability" | "rules" | "list" | "other";
  facility: string | null;
  date: string | null; // YYYY-MM-DD
  part_of_day: "morning" | "afternoon" | "evening" | null;
}

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

// ---------- intent extraction ----------
function mockIntent(q: string): Intent {
  const lower = q.toLowerCase();
  const intent: Intent["intent"] =
    /free|available|availab|book|slot|when/.test(lower) ? "availability"
    : /rule|policy|how long|duration|cancel|hour|open|close/.test(lower) ? "rules"
    : /what facilities|list|which facilit/.test(lower) ? "list"
    : "other";

  const d = new Date();
  let date: string | null = null;
  if (lower.includes("today")) date = d.toISOString().slice(0, 10);
  else if (lower.includes("tomorrow")) {
    d.setDate(d.getDate() + 1);
    date = d.toISOString().slice(0, 10);
  } else {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const idx = days.findIndex((day) => lower.includes(day));
    if (idx >= 0) {
      const delta = (idx - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + delta);
      date = d.toISOString().slice(0, 10);
    }
  }
  const part = /morning/.test(lower) ? "morning" : /afternoon/.test(lower) ? "afternoon" : /evening|night/.test(lower) ? "evening" : null;

  const facilities = ["discussion room", "futsal", "basketball", "badminton", "meeting room", "event hall"];
  const facility = facilities.find((f) => lower.includes(f)) ?? null;
  return { intent, facility, date, part_of_day: part };
}

async function extractIntent(q: string): Promise<Intent> {
  const today = new Date().toISOString().slice(0, 10);
  const out = await llm(
    `Extract booking-query intent as strict JSON, no prose. Today is ${today}. Schema: {"intent":"availability"|"rules"|"list"|"other","facility":string|null,"date":"YYYY-MM-DD"|null,"part_of_day":"morning"|"afternoon"|"evening"|null}`,
    q
  );
  if (out) {
    try {
      const m = out.match(/\{[\s\S]*\}/);
      if (m) return { ...mockIntent(q), ...JSON.parse(m[0]) };
    } catch { /* fall through to mock */ }
  }
  return mockIntent(q);
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

// ---------- route ----------
export async function POST(req: NextRequest) {
  let body: { messages?: Msg[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ reply: "Invalid request." }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages.slice(-8) : [];
  const q = (messages.filter((m) => m.role === "user").pop()?.content ?? "").slice(0, 500);
  if (!q.trim()) return NextResponse.json({ reply: "Ask me about facility availability or rules." });

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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}
  );

  const it = await extractIntent(q);

  // gather grounded facts
  let facts = "";
  const { data: facs } = await supabase
    .from("facilities")
    .select("id,name,type,location,capacity,status")
    .eq("status", "active");
  const all = facs ?? [];
  const matched = it.facility
    ? all.filter(
        (f) =>
          f.name.toLowerCase().includes(it.facility!.toLowerCase()) ||
          f.type.replaceAll("_", " ").includes(it.facility!.toLowerCase())
      )
    : [];

  if (it.intent === "list" || (it.intent !== "other" && matched.length === 0 && !it.facility)) {
    facts = "Facilities: " + all.map((f) => `${f.name} (${f.location}, ${f.capacity} pax)`).join("; ");
  } else if (it.intent === "rules" && matched.length > 0) {
    const { data: rules } = await supabase
      .from("facility_rules").select("*")
      .in("facility_id", matched.map((f) => f.id));
    facts = matched
      .map((f) => {
        const r = rules?.find((x) => x.facility_id === f.id);
        return r
          ? `${f.name}: open ${r.open_time.slice(0, 5)}-${r.close_time.slice(0, 5)}, max ${r.max_duration_mins} min per booking, book up to ${r.max_advance_days} days ahead, cancel at least ${r.cancellation_hours}h before, ${r.auto_approve ? "auto-approved" : "requires manager approval"}.`
          : `${f.name}: no rules configured.`;
      })
      .join(" ");
  } else if (it.intent === "availability" && matched.length > 0) {
    const date = it.date ?? new Date().toISOString().slice(0, 10);
    const from = new Date(`${date}T00:00:00`).toISOString();
    const to = new Date(`${date}T23:59:59`).toISOString();
    const { data: res } = await supabase
      .from("reservations").select("facility_id,start_time,end_time")
      .in("facility_id", matched.map((f) => f.id))
      .in("status", ["pending", "approved"])
      .gte("start_time", from).lte("start_time", to);
    facts = matched
      .map((f) => {
        const busy = (res ?? [])
          .filter((r) => r.facility_id === f.id)
          .map((r) =>
            `${new Date(r.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}-${new Date(r.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          );
        return `${f.name} on ${date}: ${busy.length === 0 ? "no bookings yet, fully open during operating hours" : "booked at " + busy.join(", ") + "; other times are free"}.`;
      })
      .join(" ");
  } else if (matched.length === 0 && it.facility) {
    facts = `No facility matching "${it.facility}" was found. Facilities: ${all.map((f) => f.name).join(", ")}.`;
  }

  if (it.intent === "other" && !facts) {
    return NextResponse.json({
      reply:
        "I can help with facility availability and booking rules. For anything else (payments, lost property, complaints), please contact the campus service desk.",
    });
  }

  // phrase the answer (LLM if available, template otherwise)
  const phrased = await llm(
    "You are a campus facility booking assistant. Answer the user's question using ONLY the facts provided. Be brief and friendly. Do not invent any information. If the facts do not answer the question, say so.",
    `Question: ${q}\nFacts: ${facts}`
  );

  return NextResponse.json({ reply: phrased ?? facts ?? "I could not find that information." });
}
