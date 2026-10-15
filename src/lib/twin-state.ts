import type { TwinState, TwinStatus } from "./twin-scene";

/**
 * What the 3D twin should show, from what the room reported (room_events,
 * newest first) and what is booked. Pure, so it is unit-tested.
 *
 * With a Wokwi device, every output comes from its last on/off event.
 * Without one there is nothing to measure, so the twin shows what the
 * booking implies (a checked-in booking = people, lights and air-con) and
 * says so - the "source" field lets the UI label it honestly.
 */
export interface TwinEvent { at: string; kind: string }
export interface TwinBooking { start_time: string; end_time: string; status: string; checked_in_at: string | null }

export interface TwinReading extends TwinState {
  source: "device" | "bookings";
  online: boolean;
  running: TwinBooking | null;
}

/** A door unlocked this recently (and not shut since) still shows as unlocked. */
export const UNLOCK_SHOW_MS = 10_000;
/** A device not heard from for this long is shown as offline. */
export const OFFLINE_AFTER_MS = 2 * 60_000;

function last(events: TwinEvent[], on: string, off: string): boolean {
  const e = events.find((x) => x.kind === on || x.kind === off);
  return e ? e.kind === on : false;
}

export function twinReading(opts: {
  events: TwinEvent[];            // newest first
  bookings: TwinBooking[];
  facilityActive: boolean;
  hasDevice: boolean;
  lastSeenAt: string | null;
  now: Date;
}): TwinReading {
  const t = opts.now.getTime();
  const running = opts.bookings.find((b) => b.status === "approved" &&
    new Date(b.start_time).getTime() <= t && t < new Date(b.end_time).getTime()) ?? null;
  const online = opts.hasDevice && !!opts.lastSeenAt && t - new Date(opts.lastSeenAt).getTime() < OFFLINE_AFTER_MS;

  let status: TwinStatus = !running ? "free" : running.checked_in_at ? "in_use" : "booked";
  if (!opts.facilityActive) status = "inactive";

  if (!opts.hasDevice) {
    const inUse = status === "in_use";
    return { source: "bookings", online: false, running, status,
      lights: inUse, ac: inUse, people: inUse, doorOpen: false, unlocked: false };
  }

  const evs = opts.events;
  const unlock = evs.find((e) => e.kind === "unlock_ok");
  const closedAfter = unlock && evs.some((e) =>
    e.kind === "door_closed" && new Date(e.at).getTime() > new Date(unlock.at).getTime());
  const unlocked = !!unlock && !closedAfter && t - new Date(unlock.at).getTime() < UNLOCK_SHOW_MS;

  return {
    source: "device", online, running, status,
    lights: last(evs, "lights_on", "lights_off"),
    ac: last(evs, "ac_on", "ac_off"),
    people: last(evs, "presence_on", "presence_off"),
    doorOpen: last(evs, "door_open", "door_closed"),
    unlocked,
  };
}
