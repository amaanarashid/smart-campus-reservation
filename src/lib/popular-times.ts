import { myHour, myWeekday } from "./time";

/**
 * "Popular times": for one weekday, how many bookings cover each hour,
 * from booking history (approved + pending), in Malaysia time. Pure, so the
 * chart and the tests agree.
 */
export interface PopularBooking { facility_id: string; start_time: string; end_time: string; status: string }

export function popularByHour(
  bookings: PopularBooking[], weekday: number, openHour: number, closeHour: number, facilityIds?: string[],
): number[] {
  const ids = facilityIds ? new Set(facilityIds) : null;
  const counts = Array.from({ length: Math.max(0, closeHour - openHour) }, () => 0);
  for (const b of bookings) {
    if (b.status !== "approved" && b.status !== "pending") continue;
    if (ids && !ids.has(b.facility_id)) continue;
    const s = new Date(b.start_time), e = new Date(b.end_time);
    if (myWeekday(s) !== weekday) continue;
    const from = myHour(s);
    const to = from + Math.max(0, e.getTime() - s.getTime()) / 3_600_000;
    for (let h = openHour; h < closeHour; h++) {
      if (from < h + 1 && to > h) counts[h - openHour]++;   // the booking overlaps hour h
    }
  }
  return counts;
}

export const busyLabel = (ratio: number) =>
  ratio === 0 ? "Usually not busy" : ratio < 0.34 ? "Not too busy" : ratio < 0.67 ? "A little busy" : "As busy as it gets";

export const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
