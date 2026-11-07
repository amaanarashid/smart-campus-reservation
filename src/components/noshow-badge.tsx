"use client";

import { riskLevel } from "@/lib/noshow";

export interface BookingRisk {
  reservation_id: string;
  risk: number;
  reasons: string[];
  threshold: number;
}

const STYLE = {
  low: "border-border bg-muted text-muted-foreground",
  medium: "border-chart-3/40 bg-chart-3/15 text-foreground",
  high: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;
const LABEL = { low: "Low", medium: "Medium", high: "High" } as const;

/**
 * "Low / Medium / High no-show risk" with the reasons on hover or focus.
 * Information only: the score never blocks, cancels or penalises anyone.
 */
export default function NoShowBadge({ risk }: { risk: BookingRisk | undefined }) {
  if (!risk) return null;
  const level = riskLevel(risk.risk, risk.threshold);
  const pct = Math.round(risk.risk * 100);
  const reasons = risk.reasons.length ? risk.reasons : ["Nothing stands out"];
  return (
    <span tabIndex={0} aria-label={`${LABEL[level]} no-show risk, ${pct}%. ${reasons.join(". ")}.`}
      className="group/risk relative inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className={`inline-flex h-5 items-center rounded-full border px-2 text-[0.625rem] font-medium whitespace-nowrap ${STYLE[level]}`}>
        {LABEL[level]} no-show risk
      </span>
      <span role="tooltip"
        className="pointer-events-none invisible absolute left-0 top-full z-30 mt-1.5 w-60 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/risk:visible group-hover/risk:opacity-100 group-focus-visible/risk:visible group-focus-visible/risk:opacity-100">
        <span className="block font-medium">About {pct}% chance of a no-show</span>
        <span className="mt-1 block space-y-0.5">
          {reasons.map((r) => <span key={r} className="block text-muted-foreground">· {r}</span>)}
        </span>
        <span className="mt-1.5 block text-[0.625rem] text-muted-foreground">
          For information only - it never blocks or cancels a booking.
          {level === "high" && " The student gets one \"Still coming?\" reminder an hour before."}
        </span>
      </span>
    </span>
  );
}
