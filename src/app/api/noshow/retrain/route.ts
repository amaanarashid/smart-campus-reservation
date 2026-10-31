import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { config } from "@/lib/room-server";
import { retrain } from "@/lib/noshow-server";

/**
 * Admin only: retrain the no-show model on the live data.
 *
 *   POST /api/noshow/retrain
 *   Authorization: Bearer <the admin's Supabase access token>
 *
 * Same code as scripts/eval/noshow-train.ts: time-based split, three
 * baselines, and a new noshow_model row only if the model beats the
 * student-rate baseline on test AUC (or baseline mode while data is small).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return json({ ok: false, error: `Server not configured: ${cfg.missing}` }, 500);
  const { db } = cfg;

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "Please sign in." }, 401);
  const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } });
  const { data: u } = await userDb.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json({ ok: false, error: "Session expired - sign in again." }, 401);
  const { data: prof } = await db.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (prof?.role !== "admin") return json({ ok: false, error: "Only admins can retrain the model." }, 403);

  try {
    const { result, stored, version, note } = await retrain(db, Date.now());
    return json({
      ok: true, stored, version, note, mode: result.mode,
      labelled: result.n_labelled, no_shows: result.n_noshow,
      test_auc: { model: result.test.logreg?.auc ?? null, user_rate: result.test.user_rate.auc },
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
}
