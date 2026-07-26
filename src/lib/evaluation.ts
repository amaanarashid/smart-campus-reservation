import { supabase } from "./supabase";

/**
 * Fire-and-forget evaluation logging for Phase 2 metrics. Failures are
 * swallowed so instrumentation never affects the user experience.
 *   rec_shown     - a set of recommendations was displayed (num = count)
 *   rec_accepted  - the user booked a suggested slot (num = its rank, 0-based)
 *   chat_feedback - the user rated a chatbot answer (bool = helpful)
 */
export async function logEvent(
  kind: "rec_shown" | "rec_accepted" | "chat_feedback",
  opts: { num?: number; bool?: boolean; note?: string } = {}
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
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
