"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { busyQuery } from "@/lib/busy";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3 } from "lucide-react";
import { busyLabel, hourLabel, popularByHour, type PopularBooking } from "@/lib/popular-times";
import { myWeekday, myWholeHour } from "@/lib/time";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "Popular times" for a venue: how busy its rooms usually are, per hour of a
 * weekday, from booking history (Malaysia time). "All rooms" adds them up;
 * a room chip narrows it to one. Today's current hour is highlighted, with a
 * live busyness label - like Google Maps, but from real reservations.
 */
export default function PopularTimes({ rooms, openHour = 8, closeHour = 22 }: {
  rooms: { id: string; name: string }[];
  openHour?: number;
  closeHour?: number;
}) {
  const [rows, setRows] = useState<PopularBooking[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [room, setRoom] = useState<string>("all");
  const [day, setDay] = useState<number | null>(null);     // set after mount (Malaysia "today")
  const [nowMs, setNowMs] = useState(0);
  const ids = rooms.map((r) => r.id).join(",");

  useEffect(() => {
    const list = ids ? ids.split(",") : [];
    (async () => {
      const { data } = list.length
        ? await busyQuery((t) => supabase.from(t).select("facility_id,start_time,end_time,status")
            .in("facility_id", list).in("status", ["approved", "pending"]))
        : { data: [] };
      setRows((data as PopularBooking[]) ?? []);
      setLoaded(true);
      const now = Date.now();
      setNowMs(now);
      setDay((d) => d ?? myWeekday(new Date(now)));
    })();
  }, [ids]);

  const now = new Date(nowMs || 0);
  const shownDay = day ?? 0;
  const isToday = nowMs > 0 && shownDay === myWeekday(now);
  const bars = popularByHour(rows, shownDay, openHour, closeHour, room === "all" ? undefined : [room]);
  const max = Math.max(1, ...bars);
  const total = bars.reduce((a, c) => a + c, 0);
  const currentHour = myWholeHour(now);
  const liveRatio = isToday && currentHour >= openHour && currentHour < closeHour ? bars[currentHour - openHour] / max : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display flex items-center gap-2 text-lg font-semibold">
            <BarChart3 className="h-5 w-5 text-primary" /> Popular times
          </h3>
          <p className="text-xs text-muted-foreground">From past bookings - pick a quieter time</p>
        </div>
        <Select value={String(shownDay)} onValueChange={(v) => setDay(Number(v))}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}s</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {rooms.length > 1 && (
        <div className="flex flex-wrap gap-1.5 pt-3">
          {[{ id: "all", name: "All rooms" }, ...rooms].map((r) => (
            <button key={r.id} onClick={() => setRoom(r.id)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                room === r.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {r.name}
            </button>
          ))}
        </div>
      )}

      {liveRatio !== null && total > 0 && (
        <p className="pt-3 text-sm">
          <span className="mr-2 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-bold uppercase text-primary-foreground">Live</span>
          <span className="italic text-muted-foreground">{busyLabel(liveRatio)}</span>
        </p>
      )}

      {!loaded ? (
        <div className="skeleton mt-4 h-32" />
      ) : total === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No bookings on {DAYS[shownDay]}s yet{room !== "all" ? " for this room" : ""} - it is usually quiet.
        </p>
      ) : (
        <>
          <div className="mt-4 flex h-32 items-end gap-[3px]">
            {bars.map((c, i) => {
              const h = openHour + i;
              const isNow = isToday && h === currentHour;
              const pct = Math.round((c / max) * 100);
              return (
                <div key={i} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                  <div className={`w-full rounded-t transition-all duration-500 ${
                      isNow ? "bg-destructive" : c ? "bg-primary/70 group-hover:bg-primary" : "bg-muted"}`}
                    style={{ height: `${c ? Math.max(pct, 8) : 3}%` }}
                    title={`${hourLabel(h)} - ${c} booking${c === 1 ? "" : "s"}`} />
                  {(h % 3 === 0 || i === 0) && (
                    <span className="absolute -bottom-5 text-[10px] text-muted-foreground">{hourLabel(h)}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="h-5" />
        </>
      )}
    </div>
  );
}
