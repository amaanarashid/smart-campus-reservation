"use client";

import { useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { Facility, FacilityRule, MemberType } from "@/lib/types";
import { addDays, fmtTime, myAt, myDateKey } from "@/lib/time";
import { clampDuration, durationOptions, fmtDuration } from "@/lib/booking-form";
import { MEMBER_LABEL, accessMessage, canBook } from "@/lib/access";
import {
  BLOCK_REASONS, UPGRADE_HINT, blockTimes, ilikeExact, needsStaffUpgrade, validReason, walkInTimes,
} from "@/lib/staff-booking";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Ban, Loader2, Search, UserCheck, UserRoundPlus } from "lucide-react";

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`;

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Asks staff for a written reason before cancelling or rejecting, because the
 * student is shown it. Mount it only while it is needed (with a `key`), so
 * each use starts empty.
 */
export function ReasonDialog({
  title, description, presets, action, busy, onSubmit, onClose,
}: {
  title: string;
  description: ReactNode;
  presets: string[];
  action: string;
  busy: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const ok = validReason(text);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ok && !busy) onSubmit(text.trim()); }}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common reasons">
            {presets.map((p) => (
              <button key={p} type="button" aria-pressed={text === p} className={chip(text === p)} onClick={() => setText(p)}>
                {p}
              </button>
            ))}
          </div>
          <Field label="Reason (the student will see this)">
            <Textarea autoFocus value={text} maxLength={200} rows={2}
              placeholder="e.g. The air-con is being repaired this afternoon"
              onChange={(e) => setText(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-9 px-4 text-sm" disabled={busy} onClick={onClose}>Keep it</Button>
            <Button type="submit" variant="destructive" disabled={!ok || busy} className="h-9 gap-1 px-4 text-sm">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface Person { id: string; full_name: string; email: string; role: string; member_type?: MemberType | null }

/**
 * Staff make a booking themselves: for a student at the desk (found by
 * email, the booking sits under that student), or a block that takes the
 * room out of use. The database function staff_create_booking() checks
 * everything again. Mount only while open, with a `key`.
 */
export function StaffBookingDialog({
  facilities, rules, facilityId, now, onClose, onDone,
}: {
  /** Rooms this manager looks after. */
  facilities: Facility[];
  rules: Record<string, FacilityRule>;
  /** Room to start on (the open room), if any. */
  facilityId?: string | null;
  /** The page's ticking clock (ms); never Date.now() during render. */
  now: number;
  onClose: () => void;
  onDone: (kind: "walk_in" | "block") => void;
}) {
  const today = myDateKey(new Date(now || 0));
  const [kind, setKind] = useState<"walk_in" | "block">("walk_in");
  const [roomId, setRoomId] = useState(facilityId ?? facilities[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);

  // walk-in
  const [email, setEmail] = useState("");
  const [person, setPerson] = useState<Person | null>(null);
  const [lookup, setLookup] = useState<"idle" | "searching" | "none">("idle");
  const [wantDur, setWantDur] = useState(60);
  const [wantTime, setWantTime] = useState("");
  const [people, setPeople] = useState(1);

  // block
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  const room = facilities.find((f) => f.id === roomId);
  const rule = rules[roomId];
  const durations = durationOptions(rule);
  const dur = clampDuration(wantDur, rule);
  const times = walkInTimes(rule, date, dur, new Date(now || 0));
  const time = times.includes(wantTime) ? wantTime : times[0] ?? "";
  const lastDay = addDays(today, rule?.max_advance_days ?? 14);

  const marks = blockTimes(rule);
  const fromT = marks.slice(0, -1).includes(from) ? from : marks[0];
  const toOptions = marks.filter((t) => t > fromT);
  const toT = toOptions.includes(to) ? to : marks[marks.length - 1];

  const allowed = person ? canBook(rule, person.member_type) : true;
  const ready = !!room && !busy && (kind === "walk_in"
    ? !!person && allowed && !!time && people >= 1 && people <= (room?.capacity ?? 1)
    : validReason(reason) && myAt(date, toT).getTime() > now);

  async function findPerson() {
    const q = email.trim();
    if (!q || lookup === "searching") return;
    setLookup("searching");
    setPerson(null);
    const { data, error } = await supabase.from("profiles")
      .select("id, full_name, email, role, member_type").ilike("email", ilikeExact(q)).limit(2);
    if (error) { toast.error(error.message); setLookup("idle"); return; }
    const found = (data as Person[] | null) ?? [];
    if (found.length === 1) { setPerson(found[0]); setLookup("idle"); }
    else setLookup("none");
  }

  async function save() {
    if (!ready || !room) return;
    setBusy(true);
    const start = kind === "walk_in" ? myAt(date, time) : myAt(date, fromT);
    const end = kind === "walk_in" ? new Date(start.getTime() + dur * 60_000) : myAt(date, toT);
    const { error } = await supabase.rpc("staff_create_booking", {
      p_facility: room.id,
      p_start: start.toISOString(),
      p_end: end.toISOString(),
      p_kind: kind,
      p_user: kind === "walk_in" ? person!.id : null,
      p_participants: kind === "walk_in" ? people : 1,
      p_note: kind === "block" ? reason.trim() : null,
    });
    setBusy(false);
    if (error) {
      toast.error(needsStaffUpgrade(error) ? UPGRADE_HINT : error.message);
      return;
    }
    toast.success(kind === "walk_in"
      ? `Booked ${room.name} for ${person!.full_name}, ${fmtTime(start)} - ${fmtTime(end)}`
      : `${room.name} blocked, ${fmtTime(start)} - ${fmtTime(end)}`);
    onDone(kind);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Book or block a room</DialogTitle>
          <DialogDescription>
            {kind === "walk_in"
              ? "For someone at the desk. The booking goes under their account and they are notified."
              : "Takes the room out of use for a while. Students see the time as taken."}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="What to do">
            {([["walk_in", "Walk-in booking", UserRoundPlus], ["block", "Block the room", Ban]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                  kind === k ? "border-primary bg-accent text-primary" : "hover:bg-muted"}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>

          <Field label="Room">
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger aria-label="Room" className="w-full"><SelectValue placeholder="Choose a room" /></SelectTrigger>
              <SelectContent>
                {facilities.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} - {f.venue}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          {kind === "walk_in" && (
            <>
              <div className="space-y-2">
                <Field label="Student's email">
                  <span className="flex gap-2">
                    <Input type="email" inputMode="email" autoComplete="off" placeholder="name@mail.apu.edu.my" value={email}
                      onChange={(e) => { setEmail(e.target.value); setPerson(null); setLookup("idle"); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); findPerson(); } }} />
                    <Button type="button" variant="outline" className="h-9 shrink-0 gap-1.5 px-3 text-sm" disabled={!email.trim() || lookup === "searching"} onClick={findPerson}>
                      {lookup === "searching" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find
                    </Button>
                  </span>
                </Field>
                {person && (
                  <div className={`animate-pop-in flex items-start gap-2.5 rounded-lg border p-3 text-sm ${allowed ? "border-primary/40 bg-accent/50" : "border-destructive/40 bg-destructive/10"}`}>
                    <UserCheck className={`mt-0.5 h-4 w-4 shrink-0 ${allowed ? "text-primary" : "text-destructive"}`} />
                    <div className="min-w-0">
                      <p className="font-medium">{person.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {person.email} · {MEMBER_LABEL[person.member_type ?? "undergraduate"]}
                        {person.role !== "student" ? ` · ${person.role.replace("_", " ")}` : ""}
                      </p>
                      <p className={`pt-1 text-xs ${allowed ? "text-muted-foreground" : "font-medium text-destructive"}`}>
                        {allowed ? "Check this is the person in front of you." : accessMessage(rule?.category_name ?? "This room", rule)}
                      </p>
                    </div>
                  </div>
                )}
                {lookup === "none" && (
                  <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    No account uses that email. Check the spelling, or ask them to sign up first.
                  </p>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Day">
                  <Input type="date" value={date} min={today} max={lastDay} onChange={(e) => setDate(e.target.value || today)} />
                </Field>
                <Field label="How long">
                  <Select value={String(dur)} onValueChange={(v) => setWantDur(Number(v))}>
                    <SelectTrigger aria-label="How long" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {durations.map((d) => <SelectItem key={d} value={String(d)}>{fmtDuration(d)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Start" hint={times.length === 0 ? "Nothing fits on this day." : undefined}>
                  <Select value={time} onValueChange={setWantTime} disabled={times.length === 0}>
                    <SelectTrigger aria-label="Start time" className="w-full"><SelectValue placeholder="No times" /></SelectTrigger>
                    <SelectContent>
                      {times.map((t) => {
                        const s = myAt(date, t);
                        return <SelectItem key={t} value={t}>{fmtTime(s)}{s.getTime() <= now ? " (now)" : ""}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="People" hint={room ? `Room holds ${room.capacity}` : undefined}>
                  <Input type="number" min={1} max={room?.capacity} value={people}
                    onChange={(e) => setPeople(Number(e.target.value))} />
                </Field>
              </div>
            </>
          )}

          {kind === "block" && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Day">
                  <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value || today)} />
                </Field>
                <Field label="From">
                  <Select value={fromT} onValueChange={setFrom}>
                    <SelectTrigger aria-label="From" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {marks.slice(0, -1).map((t) => <SelectItem key={t} value={t}>{fmtTime(myAt(date, t))}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="To">
                  <Select value={toT} onValueChange={setTo}>
                    <SelectTrigger aria-label="To" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {toOptions.map((t) => <SelectItem key={t} value={t}>{fmtTime(myAt(date, t))}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common reasons">
                  {BLOCK_REASONS.map((p) => (
                    <button key={p} type="button" aria-pressed={reason === p} className={chip(reason === p)} onClick={() => setReason(p)}>{p}</button>
                  ))}
                </div>
                <Field label="Why is it blocked?" hint="Existing bookings in that time are not cancelled for you: cancel them first, with a reason.">
                  <Input value={reason} maxLength={120} placeholder="e.g. Projector being replaced" onChange={(e) => setReason(e.target.value)} />
                </Field>
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" className="h-9 px-4 text-sm" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!ready} className="h-9 gap-1 px-4 text-sm">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {kind === "walk_in" ? "Book for this student" : "Block the room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
