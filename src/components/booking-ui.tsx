"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

/** Progress through the booking: shows where you are and what you already picked; past steps are clickable. */
export function BookingSteps({ current, steps, onGo }: {
  current: number;
  steps: { label: string; value?: string }[];
  onGo: (index: number) => void;
}) {
  return (
    <ol aria-label="Booking steps" className="flex items-center gap-1.5 text-xs">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const body = (
          <>
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
              active ? "bg-primary text-primary-foreground" : done ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span className={`truncate ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {done && s.value ? s.value : s.label}
            </span>
          </>
        );
        return (
          <li key={s.label} aria-current={active ? "step" : undefined}
            className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="h-px w-3 shrink-0 bg-border sm:w-6" aria-hidden />}
            {done ? (
              <button onClick={() => onGo(i)} aria-label={`Back to ${s.label}: ${s.value ?? ""}`}
                className="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-1 hover:text-foreground hover:underline">
                {body}
              </button>
            ) : (
              <span className="flex min-w-0 items-center gap-1.5 py-1 pr-1">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One-tap choices: every option is visible, so nothing has to be remembered or typed. */
export function ChoiceChips<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
          className={`h-9 rounded-lg border px-3 text-sm font-medium transition-colors ${
            value === o.value ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Hidden until asked for. The content mounts on first open, so closed sections load nothing. */
export function Disclosure({ title, hint, icon, children }: {
  title: string;
  hint?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border bg-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-3 text-left text-sm font-medium transition-colors hover:bg-muted/50">
        {icon}
        <span className="min-w-0 flex-1">{title}</span>
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="animate-field-in border-t p-3.5">{children}</div>}
    </div>
  );
}
