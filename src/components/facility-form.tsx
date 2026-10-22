"use client";

import type { FacilityCategory } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Form pieces shared by the facility wizards and the facility detail page. */
export type RuleDraft = Pick<FacilityCategory,
  "open_time" | "close_time" | "min_duration_mins" | "max_duration_mins" |
  "max_advance_days" | "cancellation_hours" | "auto_approve"> & { checkin_grace_mins: number | null };

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The booking-rule inputs, shared by "New facility type" and the detail page. */
export function RuleFields({ value, onChange }: { value: RuleDraft; onChange: (v: RuleDraft) => void }) {
  const set = (patch: Partial<RuleDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Opening hours">
        <div className="flex items-center gap-2">
          <Input type="time" value={value.open_time} onChange={(e) => set({ open_time: e.target.value })} />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="time" value={value.close_time} onChange={(e) => set({ close_time: e.target.value })} />
        </div>
      </Field>
      <Field label="Booking length (minutes)">
        <div className="flex items-center gap-2">
          <Input type="number" min={15} step={15} value={value.min_duration_mins}
            onChange={(e) => set({ min_duration_mins: Number(e.target.value) })} />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="number" min={15} step={15} value={value.max_duration_mins}
            onChange={(e) => set({ max_duration_mins: Number(e.target.value) })} />
        </div>
      </Field>
      <Field label="Bookable up to (days ahead)">
        <Input type="number" min={1} value={value.max_advance_days}
          onChange={(e) => set({ max_advance_days: Number(e.target.value) })} />
      </Field>
      <Field label="Cancellation notice (hours)">
        <Input type="number" min={0} value={value.cancellation_hours}
          onChange={(e) => set({ cancellation_hours: Number(e.target.value) })} />
      </Field>
      <Field label="Check-in grace (minutes)" hint="Release the booking if nobody checks in. Blank = off.">
        <Input type="number" min={1} max={120} placeholder="Off" value={value.checkin_grace_mins ?? ""}
          onChange={(e) => set({ checkin_grace_mins: e.target.value === "" ? null : Number(e.target.value) })} />
      </Field>
      <Field label="Approval">
        <Select value={value.auto_approve ? "auto" : "manual"} onValueChange={(v) => set({ auto_approve: v === "auto" })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Manager approves</SelectItem>
            <SelectItem value="auto">Automatic</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
