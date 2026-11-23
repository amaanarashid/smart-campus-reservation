"use client";

import { useState, type CSSProperties } from "react";
import type { ScoredSlot } from "@/lib/recommend";
import type { BanditState } from "@/lib/bandit";
import { explainSlot, hourLabel, learningSummary } from "@/lib/suggest";
import { fmtRelativeDay, fmtTime } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, Clock, Sparkles } from "lucide-react";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
const slotKey = (s: ScoredSlot) => `${s.facilityId}-${s.start.getTime()}`;

/**
 * The recommender's shortlist as cards.
 *
 *   offer - shown as soon as the time step opens, before the student has
 *           asked for anything. Tapping a card fills the form with that slot.
 *   clash - the time they asked for is taken. Tapping a card books it.
 *
 * "Why?" opens the five factors behind a card and how much the student's own
 * model weighs each. No percentage is shown anywhere: the ranking score is a
 * confidence bound, not a chance of anything.
 */
export default function SlotSuggestions({
  mode, slots, loading = false, requestedFacilityId, requestedDate, bandit, preferredHour,
  selectedKey, bookingKey, onPick,
}: {
  mode: "offer" | "clash";
  slots: ScoredSlot[];
  /** Offer mode only: the list for the current choices is still being worked out. */
  loading?: boolean;
  requestedFacilityId: string;
  requestedDate: string;
  bandit: BanditState | null;
  /** Hour the ranking aimed for: the usual hour (offer) or the hour asked for (clash). */
  preferredHour: number | null;
  /** Key of the slot now in the form, to mark its card. */
  selectedKey?: string | null;
  /** Key of the slot being booked right now; locks every card. */
  bookingKey: string | null;
  onPick: (slot: ScoredSlot, rank: number) => void;
}) {
  const [whyKey, setWhyKey] = useState<string | null>(null);
  const learning = learningSummary(bandit);
  const clash = mode === "clash";
  const why = slots.find((s) => slotKey(s) === whyKey) ?? null;

  if (!loading && slots.length === 0) return null;

  return (
    <section aria-label={clash ? "Closest free times" : "Suggested times"}
      className={`animate-field-in space-y-3 rounded-xl border p-3.5 ${clash ? "border-primary/40 bg-accent/50" : "bg-accent/25"}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <h3 className="font-display flex items-center gap-2 text-base font-semibold leading-tight">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            {clash ? "That time is taken - here are the closest fits" : "Suggested for you"}
          </h3>
          <p className="pt-0.5 text-xs text-muted-foreground">
            {clash
              ? "Ranked for you. Tap one to book it straight away."
              : preferredHour !== null
                ? `Free times near your usual ${hourLabel(preferredHour)} start, quieter hours first. Tap one to use it.`
                : "Free times in quieter hours that fit your group. Tap one to use it."}
          </p>
        </div>
        <Badge variant={learning.personalised ? "default" : "outline"} className="mt-0.5" title={learning.text}>
          {learning.personalised ? "Personalised" : "Learning your preferences"}
        </Badge>
      </div>

      {loading && slots.length === 0 ? (
        <div className="grid gap-2 sm:grid-cols-3" aria-busy="true" aria-label="Finding good times">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-[104px] rounded-lg" />)}
        </div>
      ) : (
        <ol className={`grid gap-2 transition-opacity ${loading ? "opacity-60" : ""} ${
          slots.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {slots.map((s, i) => {
            const key = slotKey(s);
            const isBooking = bookingKey === key;
            const selected = !clash && selectedKey === key;
            const otherRoom = s.facilityId !== requestedFacilityId;
            const otherDay = s.dateKey !== requestedDate;
            const open = whyKey === key;
            return (
              <li key={key} style={stagger(i)}
                className={`animate-reveal stagger flex flex-col rounded-lg border bg-card transition-all
                  ${selected || isBooking ? "border-primary ring-2 ring-primary/25" : i === 0 ? "border-primary/50" : ""}
                  ${bookingKey !== null && !isBooking ? "opacity-60" : "hover:-translate-y-0.5 hover:border-primary hover:shadow-md"}`}>
                <button type="button" onClick={() => onPick(s, i)} disabled={bookingKey !== null}
                  aria-pressed={clash ? undefined : selected}
                  className="flex-1 rounded-t-lg p-3 pb-2 text-left disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                  <span className="flex min-h-5 items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide">
                    <span className={`flex items-center gap-1 ${i === 0 ? "text-primary" : "text-muted-foreground"}`}>
                      {i === 0 && <Sparkles className="h-3 w-3" aria-hidden />}
                      {i === 0 ? "Top pick" : `Option ${i + 1}`}
                    </span>
                    {isBooking ? (
                      <span className="flex items-center gap-1.5 normal-case tracking-normal text-primary">
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                        Booking
                      </span>
                    ) : selected && (
                      <Badge className="gap-1 normal-case tracking-normal"><Check className="h-3 w-3" /> Selected</Badge>
                    )}
                  </span>
                  <span className="font-display block pt-1 text-[15px] font-semibold leading-tight">
                    <span className="sr-only">{clash ? "Book " : "Use "}</span>
                    {fmtTime(s.start)} - {fmtTime(s.end)}
                  </span>
                  <span className={`block pt-1 text-xs ${otherRoom || otherDay ? "font-medium text-primary" : "text-muted-foreground"}`}>
                    {s.facilityName} - {fmtRelativeDay(s.dateKey)}
                  </span>
                  {s.reasons.length > 0 && (
                    <span className="block pt-1 text-xs leading-snug text-muted-foreground">
                      {s.reasons.slice(0, 2).join(" - ")}
                    </span>
                  )}
                </button>
                <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5">
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3" /> {clash ? "Tap to book" : "Tap to use"}
                  </span>
                  <button type="button" aria-expanded={open} onClick={() => setWhyKey(open ? null : key)}
                    className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                    Why this?
                    <ChevronDown className={`h-3 w-3 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {why && (
        <div className="animate-field-in space-y-3 rounded-lg border bg-card p-3" role="region"
          aria-label={`Why ${fmtTime(why.start)} in ${why.facilityName} is suggested`}>
          <p className="text-sm font-medium">
            Why {fmtTime(why.start)} in {why.facilityName}?
          </p>
          <ul className="space-y-2">
            {explainSlot(why, bandit, { hasPreferredHour: preferredHour !== null }).map((f, i) => (
              <li key={f.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[5.5rem_7rem_minmax(0,1fr)]">
                <span className="font-medium">{f.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${Math.round(f.value * 100)}%` }} />
                </span>
                <span className="col-span-2 text-muted-foreground sm:col-span-1">
                  {f.detail}
                  {i === 0 && f.contribution > 0 && (
                    <span className="font-medium text-foreground"> - counts most here</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t pt-2 text-xs text-muted-foreground">
            {learning.text} A longer bar means the time does better on that point; it is not a score out of 100.
          </p>
        </div>
      )}
    </section>
  );
}
