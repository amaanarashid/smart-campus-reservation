"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Reservation } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOUR_LABEL = (h: number) =>
  h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;

const BUSY_LABEL = (r: number) =>
  r === 0 ? "Usually not busy" : r < 0.34 ? "Not too busy" : r < 0.67 ? "A little busy" : "As busy as it gets";

/**
 * "Popular times" for a facility, derived from its own booking history
 * (approved + pending reservations), bucketed by weekday and hour.
 * When the selected day is today, the current hour is highlighted and a
 * live busyness label is shown - the same idea as Google Maps, but from
 * real reservation data rather than location pings.
 */
export default function PopularTimes({
  facilityId,
  openHour = 8,
  closeHour = 22,
}: {
  facilityId: string;
  openHour?: number;
  closeHour?: number;
}) {
  const [res, setRes] = useState<Reservation[]>([]);
  const now = new Date();
  const [day, setDay] = useState<number>(now.getDay());
  const isToday = day === now.getDay();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("reservations")
        .select("start_time,end_time,status")
        .eq("facility_id", facilityId)
        .in("status", ["approved", "pending"]);
      setRes((data as Reservation[]) ?? []);
    })();
  }, [facilityId]);

  // count, per hour of the selected weekday, how many reservations cover it
  const { bars, max } = useMemo(() => {
    const counts: number[] = [];
    for (let h = openHour; h < closeHour; h++) {
      let c = 0;
      for (const r of res) {
        const s = new Date(r.start_time);
        const e = new Date(r.end_time);
        if (s.getDay() !== day) continue;
        if (s.getHours() <= h && h < Math.max(e.getHours(), s.getHours() + 1)) c++;
      }
      counts.push(c);
    }
    return { bars: counts, max: Math.max(1, ...counts) };
  }, [res, day, openHour, closeHour]);

  const currentHour = now.getHours();
  const liveRatio = isToday && currentHour >= openHour && currentHour < closeHour
    ? bars[currentHour - openHour] / max
    : null;

  const hasData = res.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Popular times</h3>
        <Select value={String(day)} onValueChange={(v) => setDay(Number(v))}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DAYS.map((d, i) => <SelectItem key={i} value={String(i)}>{d}s</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {liveRatio !== null && (
        <p className="pt-2 text-sm">
          <span className="mr-2 rounded bg-destructive px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
            Live
          </span>
          <span className="italic text-muted-foreground">{BUSY_LABEL(liveRatio)}</span>
        </p>
      )}

      {!hasData ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No booking history yet - popular times appear as this facility gets used.
        </p>
      ) : (
        <div className="mt-4 flex h-32 items-end gap-[3px]">
          {bars.map((c, i) => {
            const h = openHour + i;
            const isNow = isToday && h === currentHour;
            const pct = Math.round((c / max) * 100);
            return (
              <div key={i} className="group relative flex flex-1 flex-col items-center justify-end">
                <div
                  className={`w-full rounded-t transition-colors ${isNow ? "bg-destructive" : "bg-primary/70"}`}
                  style={{ height: `${Math.max(pct, 4)}%` }}
                  title={`${HOUR_LABEL(h)} - ${c} booking${c === 1 ? "" : "s"}`}
                />
                {h % 3 === 0 && (
                  <span className="absolute -bottom-5 text-[10px] text-muted-foreground">{HOUR_LABEL(h)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {hasData && <div className="h-5" />}
    </div>
  );
}
