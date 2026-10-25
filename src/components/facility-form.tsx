"use client";

import type { FacilityCategory, MemberType } from "@/lib/types";
import { MEMBER_LABEL, MEMBER_TYPES } from "@/lib/access";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Form pieces shared by the facility wizards and the facility detail page. */
export type RuleDraft = Pick<FacilityCategory,
  "open_time" | "close_time" | "min_duration_mins" | "max_duration_mins" |
  "max_advance_days" | "cancellation_hours" | "auto_approve"> & {
    checkin_grace_mins: number | null;
    /** upgrade-access-limits.sql; optional so older databases still save */
    allowed_members?: MemberType[];
    max_upcoming?: number | null;
    max_hours_week?: number | null;
  };

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
      <div className="sm:col-span-2">
      <Field label="Opening hours">
        <div className="flex items-center gap-2">
          <Input type="time" value={value.open_time} onChange={(e) => set({ open_time: e.target.value })} />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="time" value={value.close_time} onChange={(e) => set({ close_time: e.target.value })} />
        </div>
      </Field>
      </div>
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
      <div className="space-y-2 border-t pt-4 sm:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Who can book &amp; fair use</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
          <Field label="Who can book" hint="Member types are set per user in the Users tab.">
            <div className="flex flex-wrap gap-1.5">
              {MEMBER_TYPES.map((m) => {
                const list = value.allowed_members?.length ? value.allowed_members : MEMBER_TYPES;
                const on = list.includes(m);
                return (
                  <button key={m} type="button" aria-pressed={on}
                    onClick={() => {
                      const next = on ? list.filter((x) => x !== m) : [...list, m];
                      if (next.length) set({ allowed_members: MEMBER_TYPES.filter((x) => next.includes(x)) });
                    }}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                    {MEMBER_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </Field>
          </div>
          <Field label="Max upcoming" hint="Per person. Blank = no limit.">
            <Input type="number" min={1} placeholder="No limit" value={value.max_upcoming ?? ""}
              onChange={(e) => set({ max_upcoming: e.target.value === "" ? null : Math.max(1, Number(e.target.value)) })} />
          </Field>
          <Field label="Max hours / week" hint="Mon-Sun. Blank = no limit.">
            <Input type="number" min={0.5} step={0.5} placeholder="No limit" value={value.max_hours_week ?? ""}
              onChange={(e) => set({ max_hours_week: e.target.value === "" ? null : Math.max(0.5, Number(e.target.value)) })} />
          </Field>
        </div>
      </div>
    </div>
  );
}
