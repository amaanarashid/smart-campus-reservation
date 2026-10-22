"use client";

import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Facility, FacilityCategory, FacilityRule, Profile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft, ArrowRight, Building2, Clock, Loader2, MapPin, MoreHorizontal, Plus, Search, Settings2,
  Trash2, Users2, X,
} from "lucide-react";
import FacilityIso from "@/components/facility-iso";
import VenueArt from "@/components/venue-art";
import { Field, RuleFields, type RuleDraft } from "@/components/facility-form";
import { AddRoomWizard, NewFacilityWizard } from "@/components/facility-wizards";

/**
 * Admin -> Facilities. Overview grouped by location (venue card with a 2D
 * drawing, its facilities as rows with "+ rooms" and "View details"), and a
 * detail page per facility: booking rules form with Save, rooms table with a
 * row menu. New facilities and rooms are added through the step-by-step
 * wizards in facility-wizards.tsx (location -> facility -> rules/rooms).
 */
interface FmRow { id: string; facility_id: string; manager_id: string }

const hhmm = (t: string) => t.slice(0, 5);
const draftOf = (c: FacilityCategory): RuleDraft => ({
  open_time: hhmm(c.open_time), close_time: hhmm(c.close_time),
  min_duration_mins: c.min_duration_mins, max_duration_mins: c.max_duration_mins,
  max_advance_days: c.max_advance_days, cancellation_hours: c.cancellation_hours,
  auto_approve: c.auto_approve, checkin_grace_mins: c.checkin_grace_mins ?? null,
});

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="font-display text-lg font-semibold leading-none">{value}</p>
      <p className="pt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

export default function AdminFacilities({ categories, facilities, rules, fmRows, managers, inUse, reload }: {
  categories: FacilityCategory[];
  facilities: Facility[];
  rules: Record<string, FacilityRule>;
  fmRows: FmRow[];
  managers: Profile[];
  inUse: Set<string>;
  reload: () => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [saving, setSaving] = useState(false);
  // dialogs
  // wizards (components/facility-wizards.tsx); mounted only while open so each run starts fresh
  const [wizard, setWizard] = useState<
    | { kind: "facility"; venue?: string | null }
    | { kind: "room"; venue?: string | null; categoryId?: string | null }
    | null>(null);
  const [override, setOverride] = useState<{ f: Facility; v: Pick<RuleDraft, "open_time" | "close_time" | "min_duration_mins" | "max_duration_mins"> } | null>(null);

  const roomsOf = (id: string) => facilities.filter((f) => f.category_id === id);
  const open = categories.find((c) => c.id === openId) ?? null;

  function openType(c: FacilityCategory) {
    setOpenId(c.id);
    setDraft(draftOf(c));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- writes ----------
  async function saveRules() {
    if (!open || !draft) return;
    if (draft.min_duration_mins > draft.max_duration_mins) { toast.error("Shortest booking is longer than the longest"); return; }
    if (draft.open_time >= draft.close_time) { toast.error("Closing time must be after opening time"); return; }
    setSaving(true);
    const { error } = await supabase.from("facility_categories").update(draft).eq("id", open.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Rules saved - apply to every room in ${open.name}`);
    await reload();
  }

  async function deleteType(c: FacilityCategory) {
    const n = roomsOf(c.id).length;
    if (!window.confirm(`Delete "${c.name}"${n ? ` and its ${n} room(s)` : ""}? Their bookings are removed too.`)) return;
    const { error } = await supabase.from("facility_categories").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${c.name} deleted`);
    setOpenId(null);
    await reload();
  }

  async function deleteRoom(f: Facility) {
    if (!window.confirm(`Delete "${f.name}"? Its bookings are removed too.`)) return;
    const { error } = await supabase.from("facilities").delete().eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${f.name} deleted`);
    await reload();
  }

  async function toggleStatus(f: Facility) {
    const status = f.status === "active" ? "inactive" : "active";
    const { error } = await supabase.from("facilities").update({ status }).eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "active" ? `${f.name} is bookable again` : `${f.name} taken offline`);
    await reload();
  }

  async function saveCapacity(f: Facility, value: string) {
    const n = Number(value);
    if (!n || n === f.capacity) return;
    const { error } = await supabase.from("facilities").update({ capacity: n }).eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${f.name}: capacity ${n}`);
    await reload();
  }

  async function addManager(facilityId: string, managerId: string) {
    const { error } = await supabase.from("facility_managers").insert({ facility_id: facilityId, manager_id: managerId });
    if (error) { toast.error(error.message.includes("duplicate") ? "Already assigned" : error.message); return; }
    await reload();
  }

  async function removeManager(rowId: string) {
    await supabase.from("facility_managers").delete().eq("id", rowId);
    await reload();
  }

  async function saveOverride() {
    if (!override || !open) return;
    const base = draftOf(open);
    // store only what differs from the type (NULL = inherit)
    const patch = Object.fromEntries(
      (Object.keys(override.v) as (keyof typeof override.v)[])
        .map((k) => [k, override.v[k] === base[k] ? null : override.v[k]]),
    );
    setSaving(true);
    const { error } = await supabase.from("facility_rules")
      .upsert({ facility_id: override.f.id, ...patch }, { onConflict: "facility_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Custom rules saved for ${override.f.name}`);
    setOverride(null);
    await reload();
  }

  async function clearOverride(f: Facility) {
    const { error } = await supabase.from("facility_rules").delete().eq("facility_id", f.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${f.name} now follows the ${open?.name ?? "type"} rules`);
    await reload();
  }

  // ---------- dialogs (shared by both views) ----------
  const dialogs = (
    <>
      {wizard?.kind === "facility" && (
        <NewFacilityWizard open startVenue={wizard.venue} categories={categories} facilities={facilities}
          onClose={() => setWizard(null)}
          onCreated={async () => { setWizard(null); await reload(); }} />
      )}
      {wizard?.kind === "room" && (
        <AddRoomWizard open startVenue={wizard.venue} startCategoryId={wizard.categoryId} categories={categories} facilities={facilities}
          onClose={() => setWizard(null)} onCreated={async () => { setWizard(null); await reload(); }}
          onNewFacility={(venue) => setWizard({ kind: "facility", venue })} />
      )}
      <Dialog open={!!override} onOpenChange={(v) => !v && setOverride(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display">Custom rules - {override?.f.name}</DialogTitle>
            <DialogDescription>
              Only this room changes. Anything left the same as {open?.name} keeps following the type.
            </DialogDescription>
          </DialogHeader>
          {override && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Opening hours">
                <div className="flex items-center gap-2">
                  <Input type="time" value={override.v.open_time}
                    onChange={(e) => setOverride({ ...override, v: { ...override.v, open_time: e.target.value } })} />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input type="time" value={override.v.close_time}
                    onChange={(e) => setOverride({ ...override, v: { ...override.v, close_time: e.target.value } })} />
                </div>
              </Field>
              <Field label="Booking length (minutes)">
                <div className="flex items-center gap-2">
                  <Input type="number" min={15} step={15} value={override.v.min_duration_mins}
                    onChange={(e) => setOverride({ ...override, v: { ...override.v, min_duration_mins: Number(e.target.value) } })} />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input type="number" min={15} step={15} value={override.v.max_duration_mins}
                    onChange={(e) => setOverride({ ...override, v: { ...override.v, max_duration_mins: Number(e.target.value) } })} />
                </div>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverride(null)}>Cancel</Button>
            <Button onClick={saveOverride} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  // ---------- detail page ----------
  if (open && draft) {
    const rooms = roomsOf(open.id);
    const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(open));
    const offline = rooms.filter((f) => f.status !== "active").length;
    return (
      <div key={open.id} className="animate-step-in w-full space-y-5">
        {dialogs}
        <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground" onClick={() => setOpenId(null)}>
          <ArrowLeft className="h-4 w-4" /> All facilities
        </Button>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-5 p-5">
            <span className="h-20 w-28 shrink-0 overflow-hidden rounded-lg border bg-muted/40">
              <FacilityIso type={open.slug} busy={false} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-2xl font-semibold">{open.name}</h2>
              <p className="flex items-center gap-1.5 pt-1 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> {open.venue}
              </p>
            </div>
            <div className="flex gap-8 pr-2">
              <Stat label="Rooms" value={rooms.length} />
              <Stat label="In use" value={rooms.filter((f) => inUse.has(f.id)).length} />
              <Stat label="Offline" value={offline} />
            </div>
            <div className="flex gap-2">
              <Button className="gap-2" onClick={() => setWizard({ kind: "room", categoryId: open.id })}>
                <Plus className="h-4 w-4" /> Add room
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteType(open)}>
                    <Trash2 className="h-4 w-4" /> Delete facility type
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          {/* rules */}
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary" /> Booking rules
              </CardTitle>
              <CardDescription>Apply to every room below unless a room has custom rules.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <RuleFields value={draft} onChange={setDraft} />
              <div className="flex justify-end gap-2 border-t pt-4">
                <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(draftOf(open))}>Discard</Button>
                <Button disabled={!dirty || saving} onClick={saveRules} className="gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save rules
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* rooms */}
          <Card className="h-fit overflow-hidden">
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-primary" /> Rooms and courts
              </CardTitle>
              <CardDescription>Capacity saves when you leave the box. Use the menu for more.</CardDescription>
            </CardHeader>
            {rooms.length === 0 ? (
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Building2 className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">No rooms yet</p>
                <Button size="sm" variant="outline" className="mt-1 gap-2"
                  onClick={() => setWizard({ kind: "room", categoryId: open.id })}>
                  <Plus className="h-4 w-4" /> Add the first room
                </Button>
              </CardContent>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Room</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Managers</TableHead>
                    <TableHead className="w-12 pr-6" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rooms.map((f) => {
                    const r = rules[f.id];
                    const off = f.status !== "active";
                    const busy = inUse.has(f.id);
                    const assigned = fmRows.filter((x) => x.facility_id === f.id);
                    const free = managers.filter((m) => !assigned.some((a) => a.manager_id === m.id));
                    return (
                      <TableRow key={f.id} className={off ? "opacity-70" : ""}>
                        <TableCell className="pl-6">
                          <div className="flex items-center gap-3">
                            <span className={`h-10 w-14 shrink-0 overflow-hidden rounded-md border bg-muted/40 ${off ? "grayscale" : ""}`}>
                              <FacilityIso type={f.type} busy={busy} />
                            </span>
                            <div>
                              <p className="font-medium">{f.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {r?.has_override
                                  ? `Custom: ${hhmm(r.open_time)}-${hhmm(r.close_time)}, ${r.min_duration_mins}-${r.max_duration_mins} min`
                                  : "Follows type rules"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-sm">
                            <span className={`h-2 w-2 rounded-full ${off ? "bg-muted-foreground/50" : busy ? "bg-primary" : "bg-green-500"}`} />
                            {off ? "Offline" : busy ? "In use" : "Free now"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Input key={`${f.id}-${f.capacity}`} type="number" min={1} defaultValue={f.capacity}
                              className="h-8 w-16" aria-label={`Capacity of ${f.name}`}
                              onBlur={(e) => saveCapacity(f, e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                            <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {assigned.map((a) => (
                              <Badge key={a.id} variant="secondary" className="gap-1 pr-1">
                                {managers.find((m) => m.id === a.manager_id)?.full_name ?? "Unknown"}
                                <button className="rounded-full p-0.5 hover:bg-destructive/15 hover:text-destructive"
                                  aria-label="Remove manager" onClick={() => removeManager(a.id)}>
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                            {assigned.length === 0 && <span className="text-xs text-muted-foreground">Admin</span>}
                            {free.length > 0 && (
                              <Select value="" onValueChange={(v) => addManager(f.id, v)}>
                                <SelectTrigger className="h-6 w-auto gap-1 border-dashed px-2 text-xs text-muted-foreground [&>svg:last-child]:hidden" aria-label="Add manager">
                                  <Plus className="h-3 w-3" /> Add
                                </SelectTrigger>
                                <SelectContent>
                                  {free.map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${f.name}`}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setOverride({
                                f, v: {
                                  open_time: hhmm(r?.open_time ?? open.open_time), close_time: hhmm(r?.close_time ?? open.close_time),
                                  min_duration_mins: r?.min_duration_mins ?? open.min_duration_mins,
                                  max_duration_mins: r?.max_duration_mins ?? open.max_duration_mins,
                                },
                              })}>
                                <Settings2 className="h-4 w-4" /> Custom rules
                              </DropdownMenuItem>
                              {r?.has_override && (
                                <DropdownMenuItem onClick={() => clearOverride(f)}>
                                  <Clock className="h-4 w-4" /> Use type rules again
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => toggleStatus(f)}>
                                <Building2 className="h-4 w-4" /> {off ? "Bring back online" : "Take offline"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteRoom(f)}>
                                <Trash2 className="h-4 w-4" /> Delete room
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    );
  }

  // ---------- overview ----------
  const q = search.trim().toLowerCase();
  const shown = categories.filter((c) => !q || c.name.toLowerCase().includes(q) || c.venue.toLowerCase().includes(q));
  // one panel per location (venue), types inside
  const byVenue = Array.from(new Set(shown.map((c) => c.venue))).sort((a, b) => a.localeCompare(b))
    .map((venue) => ({ venue, types: shown.filter((c) => c.venue === venue) }));
  const offlineTotal = facilities.filter((f) => f.status !== "active").length;

  return (
    <div className="animate-reveal w-full space-y-5">
      {dialogs}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold">Facilities</h2>
          <p className="text-sm text-muted-foreground">
            {new Set(categories.map((c) => c.venue)).size} locations · {categories.length} facilities · {facilities.length} rooms{offlineTotal ? ` · ${offlineTotal} offline` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search facilities or locations"
              className="h-9 w-56 pl-8" />
          </div>
          <Button variant="outline" className="gap-2" disabled={categories.length === 0}
            onClick={() => setWizard({ kind: "room" })}>
            <Plus className="h-4 w-4" /> Add room
          </Button>
          <Button className="gap-2" onClick={() => setWizard({ kind: "facility" })}>
            <Plus className="h-4 w-4" /> New facility
          </Button>
        </div>
      </div>

      {categories.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-display text-lg font-semibold">No facilities yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create a facility type such as Badminton or Discussion Room, then add its rooms and courts.
            </p>
            <Button className="mt-2 gap-2" onClick={() => setWizard({ kind: "facility" })}>
              <Plus className="h-4 w-4" /> New facility
            </Button>
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Nothing matches &quot;{search}&quot;.</p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {byVenue.map(({ venue, types }, vi) => {
            const vRooms = types.flatMap((c) => roomsOf(c.id));
            const vBusy = vRooms.filter((f) => inUse.has(f.id)).length;
            const vOff = vRooms.filter((f) => f.status !== "active").length;
            return (
              <Card key={venue} style={{ "--i": vi } as React.CSSProperties}
                className="stagger animate-reveal gap-0 overflow-hidden py-0">
                <div className="flex h-full flex-col sm:flex-row">
                  {/* the location */}
                  <div className="flex shrink-0 flex-col border-b bg-muted/30 sm:w-60 sm:border-b-0 sm:border-r">
                    <div className="aspect-[12/7] w-full">
                      <VenueArt name={venue} types={types.map((c) => c.slug)} busy={vBusy > 0} />
                    </div>
                    <div className="mt-auto grid grid-cols-3 gap-2 p-3">
                      <Stat label="Rooms" value={vRooms.length} />
                      <Stat label="In use" value={vBusy} />
                      <Stat label="Offline" value={vOff} />
                    </div>
                  </div>

                  {/* facility types at this location */}
                  <div className="min-w-0 flex-1 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-display flex items-center gap-1.5 text-lg font-semibold leading-tight">
                          <MapPin className="h-4 w-4 shrink-0 text-primary" /> {venue}
                        </h3>
                        <p className="pt-0.5 text-xs text-muted-foreground">
                          {types.length} facilit{types.length === 1 ? "y" : "ies"} · {vRooms.length} room{vRooms.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1.5 text-primary hover:text-primary"
                        onClick={() => setWizard({ kind: "facility", venue })}>
                        <Plus className="h-3.5 w-3.5" /> Add facility
                      </Button>
                    </div>
                    <ul className="mt-3 divide-y rounded-lg border">
                      {types.map((c) => {
                        const rooms = roomsOf(c.id);
                        const active = rooms.filter((f) => f.status === "active").length;
                        const busy = rooms.filter((f) => inUse.has(f.id)).length;
                        return (
                          <li key={c.id} className="flex items-center gap-3 p-2.5 transition-colors hover:bg-muted/40">
                            <span className="h-10 w-14 shrink-0 overflow-hidden rounded-md bg-muted/40">
                              <FacilityIso type={c.slug} busy={busy > 0} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="font-display truncate font-semibold">{c.name}</span>
                                <Badge variant={c.auto_approve ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">
                                  {c.auto_approve ? "Instant" : "Approval"}
                                </Badge>
                              </p>
                              <p className="flex flex-wrap items-center gap-x-2 pt-0.5 text-xs text-muted-foreground">
                                <span>{active}/{rooms.length} active{busy ? ` · ${busy} in use` : ""}</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{hhmm(c.open_time)}-{hhmm(c.close_time)}</span>
                                <span>{c.min_duration_mins}-{c.max_duration_mins} min</span>
                              </p>
                            </div>
                            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" title={`Add rooms to ${c.name}`}
                              aria-label={`Add rooms to ${c.name}`} onClick={() => setWizard({ kind: "room", categoryId: c.id })}>
                              <Plus className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5" onClick={() => openType(c)}>
                              View details <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
