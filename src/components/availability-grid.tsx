"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { busyQuery } from "@/lib/busy";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { gridColumns, gridStep, inRange, rowCells, type GridCell } from "@/lib/availability";
import type { FormRule } from "@/lib/booking-form";
import { addDays, fmtTime, myAt, myDateKey, myHour } from "@/lib/time";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

type Busy = { facility_id: string; start_time: string; end_time: string };

export interface GridRoom {
  id: string;
  name: string;
  /** Small second line, e.g. the facility type when a venue mixes types. */
  sub?: string;
  rule: FormRule | null | undefined;
  /** Booking length to check a start against (already fitted to this room). */
  duration: number;
}

/** Hours in view at once; the rest of the day scrolls sideways. */
const VISIBLE_HOURS = 6;
/** Width of the room-name column (px); it stays put while the hours scroll. */
const NAME_W = 112;

const hourText = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

/** Booked cells get diagonal stripes as well as red, so they read without colour vision. */
const STRIPES: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, oklch(1 0 0 / 22%) 0 2px, transparent 2px 6px)",
};

/**
 * Available / booked grid for one day: a row per room, a cell per slot,
 * green = available, red = booked. Six hours are in view; it opens at the
 * current time (earlier hours are a scroll back). Available cells a booking
 * can start in are buttons; hovering one previews the whole booking.
 * Reads only the reservation_busy view (when, not who).
 */
export default function AvailabilityGrid({
  rooms, date, openHour, closeHour, nowMs, selected, onPick, size = "sm", refreshKey, pickTaken = false, suggested,
}: {
  rooms: GridRoom[];
  date: string;
  openHour: number;
  closeHour: number;
  nowMs: number;
  selected?: { facilityId: string; time: string; duration: number } | null;
  onPick: (facilityId: string, time: string) => void;
  size?: "sm" | "lg";
  refreshKey?: unknown;
  /** Let booked slots be picked too (the time step: a booked time brings up suggestions). */
  pickTaken?: boolean;
  /** Starts of the recommender's suggested slots on this day; marked with a sparkle. */
  suggested?: { facilityId: string; time: string }[];
}) {
  const [busy, setBusy] = useState<Busy[]>([]);
  const [loaded, setLoaded] = useState(false);
  // which room set + day the shown cells belong to; while a new day loads the old one is dimmed
  const [shownKey, setShownKey] = useState("");
  const [hover, setHover] = useState<{ id: string; time: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const ids = rooms.map((r) => r.id).join(",");
  const key = `${ids}|${date}`;

  async function load() {
    const list = ids ? ids.split(",") : [];
    const from = myAt(date, "00:00").toISOString();
    const to = myAt(addDays(date, 1), "00:00").toISOString();
    const { data } = list.length
      ? await busyQuery((t) => supabase.from(t)
          .select("facility_id,start_time,end_time")
          .in("facility_id", list).in("status", ["pending", "approved"])
          .lt("start_time", to).gt("end_time", from))
      : { data: [] };
    setBusy((data as Busy[] | null) ?? []);
    setLoaded(true);
    setShownKey(key);
  }

  useEffect(() => {
    (async () => { await load(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, date, refreshKey]);
  useAutoRefresh(load, 30_000, loaded);

  const single = rooms.length === 1;
  const nameW = single ? 0 : NAME_W;
  const hours = Array.from({ length: Math.max(0, closeHour - openHour) }, (_, i) => openHour + i);

  // Open at the current time (today), else at the picked time or the start of
  // the day; only when the day or the rooms change, so the 30 s refresh never
  // yanks the view back.
  const isToday = nowMs > 0 && date === myDateKey(new Date(nowMs));
  const nowHour = nowMs > 0 ? Math.floor(myHour(new Date(nowMs))) : openHour;
  const scrolledFor = useRef("");
  const selectedHour = selected?.time ? Number(selected.time.slice(0, 2)) : null;
  useEffect(() => {
    const el = scroller.current;
    if (!el || shownKey !== key || scrolledFor.current === key) return;
    scrolledFor.current = key;
    const want = isToday ? nowHour : selectedHour ?? openHour;
    const fromHour = Math.min(Math.max(want, openHour), Math.max(openHour, closeHour - VISIBLE_HOURS));
    const col = el.querySelector<HTMLElement>(`[data-hour="${fromHour}"]`);
    const name = el.querySelector<HTMLElement>("thead th");
    // land the hour right next to the frozen room-name column
    // (the frozen room-name column sits at the very left edge)
    el.scrollTo({ left: col ? col.offsetLeft - (single || !name ? 2 : name.offsetWidth + 2) : 0, behavior: "instant" });
  }, [shownKey, key, isToday, nowHour, selectedHour, openHour, closeHour, single]);

  const step = gridStep(rooms.map((r) => r.rule));
  const columns = gridColumns(openHour, closeHour, step);
  const perHour = Math.max(1, Math.round(60 / step));
  const now = new Date(nowMs || 0);
  const cellH = size === "lg" ? "h-11" : "h-8";
  // six hours fill the visible width; a longer day is wider and scrolls
  const tableWidth = hours.length <= VISIBLE_HOURS
    ? "100%"
    : `calc((100% - ${nameW}px) * ${hours.length / VISIBLE_HOURS} + ${nameW}px)`;
  // the picked time runs into a booking: say what happens next
  const clash = !!selected?.time && busy.some((b) => {
    if (b.facility_id !== selected.facilityId) return false;
    const s = myAt(date, selected.time).getTime();
    return new Date(b.start_time).getTime() < s + selected.duration * 60_000 && new Date(b.end_time).getTime() > s;
  });

  if (!loaded) {
    return <div className={`skeleton w-full ${single ? "h-16" : "h-48"}`} aria-busy="true" aria-label="Loading free times" />;
  }

  function cellClass(room: GridRoom, c: GridCell): string {
    const picked = selected?.facilityId === room.id && inRange(c.time, selected.time, selected.duration);
    const preview = hover?.id === room.id && inRange(c.time, hover.time, room.duration);
    if (picked) return "bg-chart-2 ring-2 ring-chart-2 ring-offset-1 ring-offset-card";
    if (preview && c.state === "free") return "bg-chart-2/60";
    if (preview) return "bg-destructive ring-2 ring-chart-2";
    switch (c.state) {
      case "taken": return "bg-destructive/90";
      case "free": return c.canStart ? "bg-available hover:brightness-110" : "bg-available/40";
      case "past": return "bg-muted-foreground/15";
      default: return "bg-muted";
    }
  }

  const stateText = (c: GridCell) =>
    c.state === "taken" ? "booked" : c.state === "past" ? "passed" : c.state === "closed" ? "closed"
      : c.canStart ? "available" : "available, but too short";

  const scrollBy = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * (el.clientWidth - nameW) / 2, behavior: "smooth" });
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <div ref={scroller}
          className={`overflow-x-auto rounded-lg border bg-card py-2 transition-opacity ${shownKey === key ? "" : "opacity-50"}`}
          aria-busy={shownKey !== key}>
          <table className="table-fixed border-separate border-spacing-[2px] text-xs" style={{ width: tableWidth }}
            onMouseLeave={() => setHover(null)}>
            <caption className="sr-only">Available and booked times on {date}</caption>
            <colgroup>
              {!single && <col style={{ width: NAME_W }} />}
              {columns.map((t) => <col key={t} />)}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className={single ? "sr-only" : "sticky left-0 z-10 border-r bg-card px-2 text-left font-medium text-muted-foreground"}>
                  Room
                </th>
                {hours.map((h) => (
                  <th key={h} scope="col" colSpan={perHour} data-hour={h}
                    className={`whitespace-nowrap border-l px-0.5 pb-1 text-left text-[11px] font-semibold ${
                      isToday && h === nowHour ? "border-l-2 border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    {hourText(h)}{isToday && h === nowHour && <span className="sr-only"> (now)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => {
                const cells = rowCells(room.rule, date, columns, step, busy.filter((b) => b.facility_id === room.id), room.duration, now);
                return (
                  <tr key={room.id}>
                    <th scope="row"
                      className={single ? "sr-only" : "sticky left-0 z-10 truncate border-r bg-card px-2 text-left font-medium"}>
                      {room.name}
                      {room.sub && <span className="block truncate text-[10px] font-normal text-muted-foreground">{room.sub}</span>}
                    </th>
                    {cells.map((c) => {
                      const label = `${room.name}, ${fmtTime(myAt(date, c.time))}: ${stateText(c)}`;
                      const cls = `block w-full rounded-sm transition-colors ${cellH} ${cellClass(room, c)}`;
                      const pickable = c.canStart || (pickTaken && c.onGrid);
                      const isSuggested = c.canStart && !!suggested?.some((x) => x.facilityId === room.id && x.time === c.time);
                      return (
                        <td key={c.time} className="p-0">
                          {pickable ? (
                            <button type="button"
                              aria-label={c.canStart ? `${label}${isSuggested ? ", suggested for you" : ""} - start here` : `${label} - pick to see the closest free times`}
                              title={c.canStart ? `Start at ${fmtTime(myAt(date, c.time))}${isSuggested ? " - suggested for you" : ""}` : "Booked - pick it and we suggest the closest free times"}
                              style={c.state === "taken" ? STRIPES : undefined}
                              aria-pressed={selected?.facilityId === room.id && selected.time === c.time}
                              className={`${cls} cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring`}
                              onMouseEnter={() => setHover({ id: room.id, time: c.time })}
                              onFocus={() => setHover({ id: room.id, time: c.time })}
                              onBlur={() => setHover(null)}
                              onClick={() => onPick(room.id, c.time)}>
                              {isSuggested && <Sparkles className="pointer-events-none inline h-3.5 w-3.5 text-primary-foreground" aria-hidden />}
                            </button>
                          ) : (
                            <span className={cls} style={c.state === "taken" ? STRIPES : undefined} title={label}>
                              <span className="sr-only">{label}</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Colour key">
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-available" />Available</li>
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-destructive/90" style={STRIPES} />Booked</li>
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-available/40" />Too short</li>
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-chart-2" />Your time</li>
          <li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-muted" />Closed / passed</li>
          {!!suggested?.length && (
            <li className="flex items-center gap-1.5">
              <span className="flex h-3 w-3 items-center justify-center rounded-sm bg-available">
                <Sparkles className="h-2.5 w-2.5 text-primary-foreground" aria-hidden />
              </span>
              Suggested
            </li>
          )}
        </ul>
        {hours.length > VISIBLE_HOURS && (
          <div className="flex gap-1">
            <button type="button" onClick={() => scrollBy(-1)} aria-label="Earlier times"
              className="flex h-7 w-7 items-center justify-center rounded-md border bg-card hover:bg-muted">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => scrollBy(1)} aria-label="Later times"
              className="flex h-7 w-7 items-center justify-center rounded-md border bg-card hover:bg-muted">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {clash && (
        <p role="status" className="text-xs font-medium text-destructive">
          Part of that time is booked. Ask for it anyway and we&apos;ll suggest the closest free times.
        </p>
      )}
    </div>
  );
}
