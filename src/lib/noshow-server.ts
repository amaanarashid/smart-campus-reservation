import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BookingRow, EvalResult, buildDataset, fromSuggestion, shouldStore, trainAndEvaluate, DEFAULT_THRESHOLD,
} from "./noshow";

/**
 * Server-only I/O for the no-show model: load the labelled bookings with the
 * service role, train + evaluate (pure, in noshow.ts), and store a new model
 * row when it earns it. Shared by scripts/eval/noshow-train.ts and the admin
 * "Retrain" route.
 */

/** Every row of a query, 1000 at a time (PostgREST caps a single response). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** Labelled bookings (no-show or checked in), joined with what the features need. */
export async function loadBookingRows(db: SupabaseClient): Promise<BookingRow[]> {
  type R = { id: string; user_id: string; facility_id: string; start_time: string; end_time: string; created_at: string;
    participants: number; status: string; no_show: boolean; checked_in_at: string | null };
  const [res, facs, rules, evs] = await Promise.all([
    all<R>((a, b) => db.from("reservations")
      .select("id,user_id,facility_id,start_time,end_time,created_at,participants,status,no_show,checked_in_at")
      .or("no_show.eq.true,checked_in_at.not.is.null").order("id").range(a, b)),
    all<{ id: string; category_id: string; capacity: number }>((a, b) =>
      db.from("facilities").select("id,category_id,capacity").order("id").range(a, b)),
    all<{ facility_id: string; auto_approve: boolean }>((a, b) =>
      db.from("effective_facility_rules").select("facility_id,auto_approve").order("facility_id").range(a, b)),
    all<{ user_id: string | null; at: string }>((a, b) =>
      db.from("evaluation_events").select("user_id,at").eq("kind", "rec_accepted").order("at").range(a, b)),
  ]);
  const fac = new Map(facs.map((f) => [f.id, f]));
  const auto = new Map(rules.map((r) => [r.facility_id, r.auto_approve]));
  return res.flatMap((r) => {
    const f = fac.get(r.facility_id);
    if (!f) return [];
    return [{
      id: r.id, user_id: r.user_id, category_id: f.category_id,
      start_time: r.start_time, end_time: r.end_time, created_at: r.created_at,
      participants: r.participants, capacity: f.capacity, auto_approve: auto.get(r.facility_id) ?? false,
      from_suggestion: fromSuggestion(r.user_id, r.created_at, evs),
      status: r.status, no_show: r.no_show, checked_in_at: r.checked_in_at,
    }];
  });
}

export interface RetrainOutcome {
  result: EvalResult;
  stored: boolean;
  version: number | null;
  /** Why nothing was stored, in plain English. */
  note: string;
}

/** Train on the live data and insert a new noshow_model row if it beats the user-rate baseline. */
export async function retrain(db: SupabaseClient, nowMs: number, opts: { dryRun?: boolean; lambda?: number } = {}): Promise<RetrainOutcome> {
  const rows = await loadBookingRows(db);
  const { data: cur, error: curErr } = await db.from("noshow_model")
    .select("version, mode, threshold").order("version", { ascending: false }).limit(1).maybeSingle();
  if (curErr && !opts.dryRun) throw new Error(/noshow_model/.test(curErr.message) ? "Run supabase/upgrade-noshow.sql first." : curErr.message);
  const result = trainAndEvaluate(buildDataset(rows, nowMs), { lambda: opts.lambda, threshold: cur?.threshold ?? DEFAULT_THRESHOLD });

  const store = shouldStore(result, cur ?? null);
  const note = store ? (result.mode === "logreg" ? "New model beats the user-rate baseline." : "Not enough data yet - baseline mode.")
    : result.mode === "logreg" ? "Model did not beat the user-rate baseline on test AUC; the current model stays."
    : "Not enough data for the model yet; the current model stays.";
  if (!store || opts.dryRun) return { result, stored: false, version: null, note: opts.dryRun ? `Dry run, nothing stored. ${note}` : note };

  const version = (cur?.version ?? 0) + 1;
  const { model } = result;
  const { error } = await db.from("noshow_model").insert({
    version, mode: model.mode, weights: model.weights, means: model.means, stds: model.stds,
    threshold: model.threshold, n_train: result.n_labelled,
    metrics: {
      n_labelled: result.n_labelled, n_noshow: result.n_noshow, n_train: result.n_train, n_test: result.n_test,
      split_at: result.split_at, lambda: result.lambda, test: result.test, beats_user_rate: result.beats_user_rate,
    },
  });
  if (error) throw new Error(error.message);
  return { result, stored: true, version, note };
}
