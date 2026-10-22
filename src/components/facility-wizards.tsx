"use client";

import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Facility, FacilityCategory } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, ArrowRight, Check, Clock, Loader2, MapPin, Minus, Plus, TriangleAlert } from "lucide-react";
import FacilityIso from "@/components/facility-iso";
import VenueArt from "@/components/venue-art";
import { Field, RuleFields } from "@/components/facility-form";
import {
  DEFAULT_RULES, PRESETS, findPreset, nextRoomNames, roomPrefix, ruleProblems, typicalCapacity, uniqueSlug,
  type RuleDefaults,
} from "@/lib/facility-setup";

/**
 * Admin wizards, following the venue-first layout of the Facilities page:
 *   New facility: location -> facility (presets) -> rules + first rooms
 *   Add room:     location -> facility        -> how many, names, capacity
 * Both can start part-way (from a venue card, a facility row or the detail
 * page). Naming, slugs and defaults come from lib/facility-setup.ts.
 */

const hhmm = (t: string) => t.slice(0, 5);

function Steps({ labels, step }: { labels: string[]; step: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
            i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary text-primary-foreground ring-4 ring-primary/20" : "bg-muted text-muted-foreground"}`}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={i === step ? "font-medium" : "text-muted-foreground"}>{l}</span>
          {i < labels.length - 1 && <span className="h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function Stepper({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="icon" variant="outline" className="h-9 w-9" aria-label="Fewer" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="h-4 w-4" />
      </Button>
      <span className="font-display w-10 text-center text-lg font-semibold">{value}</span>
      <Button type="button" size="icon" variant="outline" className="h-9 w-9" aria-label="More" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Location tiles: existing venues + optional "New location". */
function VenuePicker({ venues, categories, value, onPick, allowNew, newName, onNewName }: {
  venues: string[]; categories: FacilityCategory[]; value: string | null; onPick: (v: string | null) => void;
  allowNew: boolean; newName?: string; onNewName?: (s: string) => void;
}) {
  const isNew = allowNew && value === null;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {venues.map((v) => {
        const types = categories.filter((c) => c.venue === v);
        const on = value === v;
        return (
          <button key={v} type="button" onClick={() => onPick(v)}
            className={`overflow-hidden rounded-xl border text-left transition-all ${on ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"}`}>
            <div className="aspect-[12/7] bg-muted/30"><VenueArt name={v} types={types.map((c) => c.slug)} /></div>
            <div className="p-2.5">
              <p className="flex items-center gap-1 text-sm font-semibold"><MapPin className="h-3.5 w-3.5 text-primary" />{v}</p>
              <p className="truncate text-[11px] text-muted-foreground">{types.map((c) => c.name).join(", ") || "No facilities yet"}</p>
            </div>
          </button>
        );
      })}
      {allowNew && (
        <div className={`overflow-hidden rounded-xl border transition-all ${isNew ? "border-primary ring-2 ring-primary/30" : "border-dashed"}`}>
          <button type="button" onClick={() => onPick(null)} className="block w-full text-left">
            <div className="aspect-[12/7] bg-muted/30">
              {isNew && newName?.trim()
                ? <VenueArt name={newName} />
                : <div className="flex h-full items-center justify-center"><Plus className="h-8 w-8 text-muted-foreground/60" /></div>}
            </div>
          </button>
          <div className="p-2.5">
            {isNew ? (
              <Input autoFocus value={newName} onChange={(e) => onNewName?.(e.target.value)} placeholder="e.g. Block C"
                className="h-8 text-sm" aria-label="New location name" />
            ) : (
              <button type="button" onClick={() => onPick(null)} className="w-full text-left">
                <p className="text-sm font-semibold">New location</p>
                <p className="text-[11px] text-muted-foreground">A building or area not listed yet</p>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NamesPreview({ names }: { names: string[] }) {
  if (!names.length) return <p className="text-xs text-muted-foreground">No rooms yet - you can add them later.</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {names.slice(0, 12).map((n) => <Badge key={n} variant="secondary">{n}</Badge>)}
      {names.length > 12 && <Badge variant="outline">+{names.length - 12} more</Badge>}
    </div>
  );
}

// ======================================================= New facility ====
export function NewFacilityWizard({ open, startVenue, categories, facilities, onClose, onCreated }: {
  open: boolean; startVenue?: string | null;
  categories: FacilityCategory[]; facilities: Facility[];
  onClose: () => void; onCreated: (categoryId: string) => void | Promise<void>;
}) {
  const venues = Array.from(new Set(categories.map((c) => c.venue))).sort((a, b) => a.localeCompare(b));
  const [step, setStep] = useState(startVenue ? 1 : 0);
  const [venue, setVenue] = useState<string | null>(startVenue ?? (venues[0] ?? null));
  const [newVenue, setNewVenue] = useState("");
  const [name, setName] = useState("");
  const [rules, setRules] = useState<RuleDefaults>({ ...DEFAULT_RULES });
  const [rooms, setRooms] = useState(1);
  const [prefix, setPrefix] = useState("Room");
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [capacity, setCapacity] = useState(6);
  const [saving, setSaving] = useState(false);

  const where = (venue ?? newVenue).trim();
  const duplicate = categories.some((c) => c.venue.toLowerCase() === where.toLowerCase() && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const problems = ruleProblems(rules);
  const names = nextRoomNames([], prefix || "Room", rooms);

  function pickName(n: string) {
    setName(n);
    const p = findPreset(n);
    if (p) { setRules({ ...p.rules }); setCapacity(p.capacity); }
    if (!prefixTouched) setPrefix(roomPrefix(n));
  }

  async function create() {
    if (!where || !name.trim() || duplicate || problems.length) return;
    setSaving(true);
    const slug = uniqueSlug(name, where, categories.map((c) => c.slug));
    const { checkin_grace_mins, ...base } = rules;
    const { data, error } = await supabase.from("facility_categories")
      .insert({ ...base, slot_minutes: 30, name: name.trim(), venue: where, slug, ...(checkin_grace_mins ? { checkin_grace_mins } : {}) })
      .select("id").single();
    if (error || !data) { setSaving(false); toast.error(error?.message ?? "Could not create the facility"); return; }
    if (rooms > 0) {
      const { error: e2 } = await supabase.from("facilities")
        .insert(names.map((n) => ({ category_id: data.id, name: n, capacity, status: "active" })));
      if (e2) toast.warning(`Facility created, but adding rooms failed: ${e2.message}`);
    }
    setSaving(false);
    toast.success(`${name.trim()} added at ${where}${rooms ? ` with ${rooms} room${rooms > 1 ? "s" : ""}` : ""}`);
    await onCreated(data.id as string);
  }

  const canNext = step === 0 ? !!where : step === 1 ? !!name.trim() && !duplicate : false;
  void facilities;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="font-display">New facility</DialogTitle>
          <DialogDescription>Choose where it is, what it is, then its rules. Rooms can be added now or later.</DialogDescription>
        </DialogHeader>
        <Steps labels={["Location", "Facility", "Rules & rooms"]} step={step} />

        {step === 0 && (
          <VenuePicker venues={venues} categories={categories} value={venue} onPick={setVenue}
            allowNew newName={newVenue} onNewName={setNewVenue} />
        )}

        {step === 1 && (
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <div className="space-y-4">
              <Field label="Facility name" hint="Pick a common one to start with good rules, or type your own.">
                <Input autoFocus value={name} onChange={(e) => pickName(e.target.value)} placeholder="e.g. Badminton" />
              </Field>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PRESETS.map((p) => (
                  <button key={p.name} type="button" onClick={() => pickName(p.name)}
                    className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center text-xs transition-colors ${
                      name.trim().toLowerCase() === p.name.toLowerCase() ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50"}`}>
                    <span className="h-10 w-14"><FacilityIso type={p.name} busy={false} /></span>
                    {p.name}
                  </button>
                ))}
              </div>
              {duplicate && (
                <p className="flex items-center gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="h-3.5 w-3.5" /> {where} already has a facility called {name.trim()}. Add rooms to it instead.
                </p>
              )}
            </div>
            <div className="overflow-hidden rounded-xl border">
              <div className="aspect-[12/7] bg-muted/30"><VenueArt name={where} types={[name]} /></div>
              <div className="flex items-center gap-2 border-t p-3">
                <span className="h-10 w-14 shrink-0"><FacilityIso type={name || "room"} busy={false} /></span>
                <div className="min-w-0">
                  <p className="font-display truncate font-semibold">{name.trim() || "New facility"}</p>
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><MapPin className="h-3 w-3" />{where}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <p className="pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Booking rules for {name.trim()}</p>
              <RuleFields value={rules} onChange={(v) => setRules({ ...rules, ...v })} />
              {problems.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-destructive">{problems.map((p) => <li key={p}>• {p}</li>)}</ul>
              )}
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rooms to create now</p>
              <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_7rem]">
                <Field label="How many"><Stepper value={rooms} onChange={setRooms} min={0} max={20} /></Field>
                <Field label="Name them">
                  <Input value={prefix} onChange={(e) => { setPrefix(e.target.value); setPrefixTouched(true); }} placeholder="Court" />
                </Field>
                <Field label="Capacity each">
                  <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))} />
                </Field>
              </div>
              <div className="pt-3"><NamesPreview names={names} /></div>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))} className="gap-1.5">
            {step === 0 ? "Cancel" : <><ArrowLeft className="h-4 w-4" /> Back</>}
          </Button>
          {step < 2 ? (
            <Button disabled={!canNext} onClick={() => setStep(step + 1)} className="gap-1.5">Next <ArrowRight className="h-4 w-4" /></Button>
          ) : (
            <Button disabled={saving || problems.length > 0} onClick={create} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Create facility{rooms ? ` + ${rooms} room${rooms > 1 ? "s" : ""}` : ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================== Add room ====
export function AddRoomWizard({ open, startVenue, startCategoryId, categories, facilities, onClose, onCreated, onNewFacility }: {
  open: boolean; startVenue?: string | null; startCategoryId?: string | null;
  categories: FacilityCategory[]; facilities: Facility[];
  onClose: () => void; onCreated: () => void | Promise<void>;
  /** "Not listed?" - switch to the New facility wizard at this venue. */
  onNewFacility?: (venue: string) => void;
}) {
  const venues = Array.from(new Set(categories.map((c) => c.venue))).sort((a, b) => a.localeCompare(b));
  const startCat = categories.find((c) => c.id === startCategoryId) ?? null;
  const [step, setStep] = useState(startCat ? 2 : startVenue ? 1 : 0);
  const [venue, setVenue] = useState<string | null>(startCat?.venue ?? startVenue ?? venues[0] ?? null);
  const [catId, setCatId] = useState<string | null>(startCat?.id ?? null);
  const [count, setCount] = useState(1);
  const [prefix, setPrefix] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const cat = categories.find((c) => c.id === catId) ?? null;
  const siblings = cat ? facilities.filter((f) => f.category_id === cat.id) : [];
  const usePrefix = prefix ?? (cat ? roomPrefix(cat.name, siblings.map((f) => f.name)) : "Room");
  const useCapacity = capacity ?? typicalCapacity(siblings.map((f) => f.capacity), findPreset(cat?.name ?? "")?.capacity ?? 6);
  const names = cat ? nextRoomNames(siblings.map((f) => f.name), usePrefix, count) : [];
  const typesHere = categories.filter((c) => c.venue === venue);

  function pickCategory(id: string) { setCatId(id); setPrefix(null); setCapacity(null); setStep(2); }

  async function create() {
    if (!cat || !names.length) return;
    setSaving(true);
    const { error } = await supabase.from("facilities")
      .insert(names.map((n) => ({ category_id: cat.id, name: n, capacity: useCapacity, status: "active" })));
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${names.length === 1 ? names[0] : `${names.length} rooms`} added to ${cat.name}, ${cat.venue}`);
    await onCreated();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="font-display">Add rooms</DialogTitle>
          <DialogDescription>New rooms follow their facility&apos;s booking rules straight away.</DialogDescription>
        </DialogHeader>
        <Steps labels={["Location", "Facility", "Rooms"]} step={step} />

        {step === 0 && (
          <VenuePicker venues={venues} categories={categories} value={venue} onPick={(v) => { if (v) { setVenue(v); setCatId(null); setStep(1); } }} allowNew={false} />
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-medium"><MapPin className="h-4 w-4 text-primary" /> {venue}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {typesHere.map((c) => {
                const n = facilities.filter((f) => f.category_id === c.id).length;
                return (
                  <button key={c.id} type="button" onClick={() => pickCategory(c.id)}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${catId === c.id ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"}`}>
                    <span className="h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-muted/40"><FacilityIso type={c.slug} busy={false} /></span>
                    <span className="min-w-0">
                      <span className="font-display block truncate font-semibold">{c.name}</span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        {n} room{n === 1 ? "" : "s"} <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{hhmm(c.open_time)}-{hhmm(c.close_time)}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
              {onNewFacility && venue && (
                <button type="button" onClick={() => onNewFacility(venue)}
                  className="flex items-center gap-3 rounded-xl border border-dashed p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30">
                  <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-muted/40"><Plus className="h-5 w-5 text-muted-foreground" /></span>
                  <span>
                    <span className="block text-sm font-semibold">New facility here</span>
                    <span className="text-xs text-muted-foreground">Not listed? Create it at {venue}, with its rooms</span>
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {step === 2 && cat && (
          <div className="grid gap-5 sm:grid-cols-[14rem_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-xl border">
              <div className="aspect-[12/7] bg-muted/30"><VenueArt name={cat.venue} types={[cat.slug]} /></div>
              <div className="space-y-1 border-t p-3">
                <p className="font-display font-semibold">{cat.name}</p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><MapPin className="h-3 w-3" />{cat.venue}</p>
                <p className="text-[11px] text-muted-foreground">Has: {siblings.map((f) => f.name).join(", ") || "no rooms yet"}</p>
                <button type="button" onClick={() => setStep(1)} className="pt-1 text-xs text-primary hover:underline">Change facility</button>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)_7rem]">
                <Field label="How many"><Stepper value={count} onChange={setCount} min={1} max={20} /></Field>
                <Field label="Name them">
                  <Input value={usePrefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Court" />
                </Field>
                <Field label="Capacity each">
                  <Input type="number" min={1} value={useCapacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))} />
                </Field>
              </div>
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="pb-2 text-xs font-medium text-muted-foreground">Will be added</p>
                <NamesPreview names={names} />
              </div>
              <p className="text-xs text-muted-foreground">
                Rules: {hhmm(cat.open_time)}-{hhmm(cat.close_time)}, {cat.min_duration_mins}-{cat.max_duration_mins} min,
                {cat.auto_approve ? " instant booking" : " manager approval"}. Give one room different rules later from its menu.
              </p>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => (step === 0 || (startCat && step === 2) ? onClose() : setStep(step - 1))} className="gap-1.5">
            {step === 0 || (startCat && step === 2) ? "Cancel" : <><ArrowLeft className="h-4 w-4" /> Back</>}
          </Button>
          {step === 2 ? (
            <Button disabled={saving || !names.length} onClick={create} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add {names.length === 1 ? names[0] : `${names.length} rooms`}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">{step === 0 ? "Pick a location" : "Pick a facility"}</span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
