import { supabase } from "./supabase";

/**
 * Fire-and-forget evaluation logging for Phase 2 metrics. Failures are
 * swallowed so instrumentation never affects the user experience.
 *   rec_shown     - a set of recommendations was displayed (num = count)
 *   rec_accepted  - the user booked a suggested slot (num = its rank, 0-based)
 *   rec_offered         - suggestions were offered up front, before any time was
 *                         asked for (num = count); once per room and day
 *   rec_offer_accepted  - the user tapped an offered slot and booked exactly it
 *                         (num = its rank, 0-based)
 * The two "offer" kinds are kept apart from rec_shown / rec_accepted, which
 * only count the "that time is taken" case the acceptance metric is defined on.
 *   chat_feedback - the user rated a chatbot answer (bool = helpful)
 */
export async function logEvent(
  kind: "rec_shown" | "rec_accepted" | "rec_offered" | "rec_offer_accepted" | "chat_feedback",
  opts: { num?: number; bool?: boolean; note?: string } = {}
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    await supabase.from("evaluation_events").insert({
      user_id: user.id,
      kind,
      num_value: opts.num ?? null,
      bool_value: opts.bool ?? null,
      note: opts.note ?? null,
    });
  } catch {
    /* instrumentation must never break the app */
  }
}
