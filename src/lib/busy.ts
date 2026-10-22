/**
 * Free/busy reads. Students, the recommender, popular times and the chatbot
 * only need to know WHEN a room is taken, so they read the reservation_busy
 * view (id, facility_id, start_time, end_time, status - no user, purpose or
 * party size). The reservations table itself is private to the booker,
 * admins and that room's managers (supabase/upgrade-private-bookings.sql).
 *
 * Until that migration has run the view does not exist; the query then
 * falls back to the table once and remembers it, so the app keeps working.
 */
export const BUSY_VIEW = "reservation_busy";

type Result<T> = { data: T | null; error: { code?: string; message: string } | null };

let viewMissing = false;

/** True for "relation does not exist" from Postgres or PostgREST. */
export function isMissingRelation(err: { code?: string; message: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message);
}

/** Run a read against the busy view, or the table if the view is not there yet. */
export async function busyQuery<T>(run: (table: string) => PromiseLike<Result<T>>): Promise<Result<T>> {
  if (!viewMissing) {
    const res = await run(BUSY_VIEW);
    if (!isMissingRelation(res.error)) return res;
    viewMissing = true;
  }
  return run("reservations");
}

/** For tests. */
export function resetBusyFallback() { viewMissing = false; }
