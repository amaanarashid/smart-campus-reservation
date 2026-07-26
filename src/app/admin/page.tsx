"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Facility, FacilityRule, Profile, Equipment, Reservation, ActivityLog, typeLabel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast, Toaster } from "sonner";
import AppShell from "@/components/app-shell";
import { ensureProfile } from "@/lib/profile";
import {
  Users, CalendarRange, Clock, Building2, ClipboardCheck, Package,
  Plus, ChevronDown, ScrollText, LayoutDashboard, BarChart3,
} from "lucide-react";
import AdminAnalytics from "@/components/admin-analytics";

interface FmRow { id: string; facility_id: string; manager_id: string }
interface PendingRow extends Reservation { profiles: { full_name: string } | null }

const NEW_FACILITY_DEFAULTS = {
  name: "", type: "", venue: "", location: "", capacity: 10,
  open: "08:00", close: "22:00", minDur: 30, maxDur: 120,
  advance: 14, cancel: 24, autoApprove: false,
};

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [rules, setRules] = useState<Record<string, FacilityRule>>({});
  const [managers, setManagers] = useState<Profile[]>([]);
  const [fmRows, setFmRows] = useState<FmRow[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [unassignedPending, setUnassignedPending] = useState<PendingRow[]>([]);
  const [stats, setStats] = useState({ users: 0, bookings: 0, pending: 0 });
  const [nf, setNf] = useState({ ...NEW_FACILITY_DEFAULTS });
  const [newEquip, setNewEquip] = useState({ type: "", name: "", qty: 1 });
  const [showAdd, setShowAdd] = useState(false);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [logFilter, setLogFilter] = useState<string>("all");
  const [logSearch, setLogSearch] = useState("");
  const [tab, setTab] = useState<"overview" | "analytics" | "facilities" | "approvals" | "equipment" | "records">("overview");

  const load = useCallback(async () => {
    const [{ data: f }, { data: r }, { data: m }, { data: fm }, { data: eq }] = await Promise.all([
      supabase.from("facilities").select("*").order("venue").order("name"),
      supabase.from("facility_rules").select("*"),
      supabase.from("profiles").select("*").eq("role", "facility_manager").order("full_name"),
      supabase.from("facility_managers").select("*"),
      supabase.from("equipment").select("*").order("facility_type").order("name"),
    ]);
    const facs = (f as Facility[]) ?? [];
    setFacilities(facs);
    const map: Record<string, FacilityRule> = {};
    (r as FacilityRule[] | null)?.forEach((x) => { map[x.facility_id] = x; });
    setRules(map);
    setManagers((m as Profile[]) ?? []);
    const fms = (fm as FmRow[]) ?? [];
    setFmRows(fms);
    setEquipment((eq as Equipment[]) ?? []);

    // pending bookings for facilities without any assigned manager
    const assigned = new Set(fms.map((x) => x.facility_id));
    const unassignedIds = facs.filter((x) => !assigned.has(x.id)).map((x) => x.id);
    if (unassignedIds.length > 0) {
      const { data: up } = await supabase
        .from("reservations").select("*, profiles(full_name)")
        .eq("status", "pending").in("facility_id", unassignedIds).order("start_time");
      setUnassignedPending((up as PendingRow[]) ?? []);
    } else setUnassignedPending([]);

    const [{ count: users }, { count: bookings }, { count: pending }] = await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("reservations").select("*", { count: "exact", head: true }),
      supabase.from("reservations").select("*", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    setStats({ users: users ?? 0, bookings: bookings ?? 0, pending: pending ?? 0 });

    const { data: log } = await supabase
      .from("activity_log").select("*")
      .order("at", { ascending: false }).limit(300);
    setActivity((log as ActivityLog[]) ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const prof = await ensureProfile();
      if (!prof || prof.role !== "admin") { router.push("/login"); return; }
      setProfile(prof);
      await load();
      setLoading(false);
    })();
  }, [router, load]);

  // ---------- facilities ----------
  async function createFacility() {
    if (!nf.name || !nf.type || !nf.venue) {
      toast.error("Name, category and venue are required"); return;
    }
    const type = nf.type.trim().toLowerCase().replace(/\s+/g, "_");
    const { data: created, error } = await supabase.from("facilities").insert({
      name: nf.name, type, venue: nf.venue, location: nf.location || nf.venue,
      capacity: nf.capacity, status: "active",
    }).select().single();
    if (error || !created) { toast.error(error?.message ?? "Failed"); return; }
    const { error: rErr } = await supabase.from("facility_rules").insert({
      facility_id: created.id,
      open_time: nf.open, close_time: nf.close,
      min_duration_mins: nf.minDur, max_duration_mins: nf.maxDur,
      max_advance_days: nf.advance, cancellation_hours: nf.cancel,
      auto_approve: nf.autoApprove,
      slot_minutes: Math.min(nf.minDur, 60),
    });
    if (rErr) { toast.error("Facility created but rules failed: " + rErr.message); return; }
    toast.success(`${nf.name} created`);
    setNf({ ...NEW_FACILITY_DEFAULTS });
    setShowAdd(false);
    await load();
  }

  async function toggleStatus(f: Facility) {
    const status = f.status === "active" ? "inactive" : "active";
    await supabase.from("facilities").update({ status }).eq("id", f.id);
    toast.success(`${f.name} is now ${status}`);
    await load();
  }

  // ---------- managers ----------
  async function addManager(facilityId: string, managerId: string) {
    const { error } = await supabase.from("facility_managers")
      .insert({ facility_id: facilityId, manager_id: managerId });
    if (error) { toast.error(error.message.includes("duplicate") ? "Already assigned" : error.message); return; }
    await load();
  }

  async function removeManager(rowId: string) {
    await supabase.from("facility_managers").delete().eq("id", rowId);
    await load();
  }

  // ---------- rules ----------
  async function saveRule(facilityId: string, patch: Partial<FacilityRule>) {
    const { error } = await supabase.from("facility_rules").update(patch).eq("facility_id", facilityId);
    if (error) { toast.error(error.message); return; }
    toast.success("Rule updated");
    await load();
  }

  // ---------- unassigned approvals ----------
  async function decide(r: Reservation, status: "approved" | "rejected") {
    const { error } = await supabase.from("reservations").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Request ${status}`);
    await load();
  }

  // ---------- equipment (admin fallback) ----------
  async function saveQty(e: Equipment, qty: number) {
    await supabase.from("equipment").update({ total_qty: qty }).eq("id", e.id);
    toast.success(`${e.name}: ${qty} in inventory`);
    await load();
  }

  async function addEquipment() {
    if (!newEquip.type || !newEquip.name) { toast.error("Category and item name required"); return; }
    const type = newEquip.type.trim().toLowerCase().replace(/\s+/g, "_");
    const { error } = await supabase.from("equipment")
      .insert({ facility_type: type, name: newEquip.name, total_qty: newEquip.qty });
    if (error) { toast.error(error.message); return; }
    setNewEquip({ type: "", name: "", qty: 1 });
    await load();
  }

  const types = Array.from(new Set(facilities.map((f) => f.type)));
  const venues = Array.from(new Set(facilities.map((f) => f.venue)));
  const fname = (id: string) => facilities.find((f) => f.id === id)?.name ?? "-";

  const LOG_TABS: { key: string; label: string; entities: string[] }[] = [
    { key: "all", label: "All", entities: [] },
    { key: "reservation", label: "Bookings", entities: ["reservation"] },
    { key: "facility", label: "Facilities", entities: ["facility", "facility_rule"] },
    { key: "lost_and_found", label: "Lost & found", entities: ["lost_and_found"] },
    { key: "facility_manager", label: "Managers", entities: ["facility_manager"] },
    { key: "equipment", label: "Equipment", entities: ["equipment"] },
    { key: "profile", label: "Users", entities: ["profile"] },
  ];
  const activeTab = LOG_TABS.find((t) => t.key === logFilter) ?? LOG_TABS[0];
  const filteredLog = activity.filter((a) => {
    const inTab = activeTab.entities.length === 0 || activeTab.entities.includes(a.entity);
    const q = logSearch.trim().toLowerCase();
    const inSearch = !q || a.summary.toLowerCase().includes(q) || (a.actor_name ?? "").toLowerCase().includes(q);
    return inTab && inSearch;
  });
  const ACTION_COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    approved: "default", created: "secondary", assigned: "secondary", claimed: "default",
    returned: "outline", updated: "outline", rejected: "destructive", cancelled: "destructive",
    deleted: "destructive", disposed: "destructive", unassigned: "destructive",
  };

  return (
    <AppShell
      title="Administration"
      subtitle="Facilities, managers, booking policy and inventory"
      role="admin"
      userName={profile?.full_name}
    >
      <Toaster richColors />
      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">Loading...</div>
      ) : (
        <>
          {/* section nav */}
          <nav className="sticky top-16 z-30 -mx-4 mb-2 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur">
            {([
              ["overview", "Overview", LayoutDashboard, 0],
              ["analytics", "Analytics", BarChart3, 0],
              ["facilities", "Facilities", Building2, facilities.length],
              ["approvals", "Approvals", ClipboardCheck, unassignedPending.length],
              ["equipment", "Equipment", Package, 0],
              ["records", "Records", ScrollText, 0],
            ] as const).map(([key, label, Icon, count]) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted"
                }`}>
                <Icon className="h-4 w-4" />
                {label}
                {count > 0 && (
                  <span className={`rounded-full px-1.5 text-xs ${
                    tab === key ? "bg-primary-foreground/20" : "bg-muted-foreground/15"
                  }`}>{count}</span>
                )}
              </button>
            ))}
          </nav>

          {tab === "overview" && (
          <div key="ov" className="grid gap-4 md:grid-cols-3">
            {([
              ["Registered users", stats.users, Users],
              ["Total bookings", stats.bookings, CalendarRange],
              ["Pending approval", stats.pending, Clock],
            ] as const).map(([label, n, Icon], i) => (
              <Card key={label}
                className="animate-reveal overflow-hidden transition-shadow hover:shadow-md"
                style={{ animationDelay: `${i * 70}ms` }}>
                <CardContent className="flex items-center gap-4 py-5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className="font-display animate-count text-3xl font-semibold leading-tight"
                      style={{ animationDelay: `${i * 70 + 150}ms` }}>{n}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          )}

          {tab === "analytics" && (
            <div key="an" className="animate-reveal"><AdminAnalytics /></div>
          )}

          {tab === "facilities" && (<div key="fac" className="space-y-6">
          {/* add facility (collapsible) */}
          <Card className="animate-reveal overflow-hidden" style={{ animationDelay: "210ms" }}>
            <button className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-muted/40"
              onClick={() => setShowAdd((s) => !s)}>
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Plus className="h-5 w-5" />
                </span>
                <span>
                  <span className="font-display block font-semibold">Add a facility</span>
                  <span className="block text-xs text-muted-foreground">
                    Create a category (e.g. basketball), then Court 1, Court 2... each with its own rules
                  </span>
                </span>
              </span>
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform duration-300 ${showAdd ? "rotate-180" : ""}`} />
            </button>
            {showAdd && (
            <CardContent className="animate-field-in space-y-3 border-t pt-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Facility name</label>
                  <Input placeholder="e.g. Basketball Court 2" value={nf.name}
                    onChange={(e) => setNf({ ...nf, name: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Category (new or existing)</label>
                  <Input placeholder="e.g. basketball" value={nf.type} list="type-list"
                    onChange={(e) => setNf({ ...nf, type: e.target.value })} />
                  <datalist id="type-list">
                    {types.map((t) => <option key={t} value={t} />)}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Venue</label>
                  <Input placeholder="e.g. Sports Complex" value={nf.venue} list="venue-list"
                    onChange={(e) => setNf({ ...nf, venue: e.target.value })} />
                  <datalist id="venue-list">
                    {venues.map((v) => <option key={v} value={v} />)}
                  </datalist>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Location detail</label>
                  <Input placeholder="e.g. Level 2, east wing" value={nf.location}
                    onChange={(e) => setNf({ ...nf, location: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Capacity (people at a time)</label>
                  <Input type="number" min={1} value={nf.capacity}
                    onChange={(e) => setNf({ ...nf, capacity: Number(e.target.value) })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Opens</label>
                    <Input type="time" value={nf.open} onChange={(e) => setNf({ ...nf, open: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Closes</label>
                    <Input type="time" value={nf.close} onChange={(e) => setNf({ ...nf, close: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Min booking (min)</label>
                    <Input type="number" min={15} step={15} value={nf.minDur}
                      onChange={(e) => setNf({ ...nf, minDur: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Max booking (min)</label>
                    <Input type="number" min={15} step={15} value={nf.maxDur}
                      onChange={(e) => setNf({ ...nf, maxDur: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Advance (days)</label>
                    <Input type="number" min={1} value={nf.advance}
                      onChange={(e) => setNf({ ...nf, advance: Number(e.target.value) })} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Cancel notice (h)</label>
                    <Input type="number" min={0} value={nf.cancel}
                      onChange={(e) => setNf({ ...nf, cancel: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button variant={nf.autoApprove ? "default" : "outline"}
                    onClick={() => setNf({ ...nf, autoApprove: !nf.autoApprove })}>
                    Auto-approve: {nf.autoApprove ? "On" : "Off"}
                  </Button>
                  <Button onClick={createFacility}>Create facility</Button>
                </div>
              </div>
            </CardContent>
            )}
          </Card>

          {/* facilities, rules, managers */}
          <Card className="animate-reveal" style={{ animationDelay: "280ms" }}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                Facilities, rules &amp; managers
              </CardTitle>
              <CardDescription>
                Edit a number and press Enter to save. Managers only see and approve bookings for
                facilities assigned to them.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facility</TableHead><TableHead>Hours</TableHead>
                    <TableHead>Min/Max (min)</TableHead><TableHead>Capacity</TableHead>
                    <TableHead>Auto</TableHead><TableHead>Managers</TableHead><TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facilities.map((f) => {
                    const r = rules[f.id];
                    const assigned = fmRows.filter((x) => x.facility_id === f.id);
                    const unassignedManagers = managers.filter(
                      (m) => !assigned.some((a) => a.manager_id === m.id)
                    );
                    return (
                      <TableRow key={f.id}>
                        <TableCell>
                          <span className="font-medium">{f.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {f.venue} - {typeLabel(f.type)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r && (
                            <div className="flex gap-1">
                              <Input type="time" defaultValue={r.open_time.slice(0, 5)} className="w-24"
                                onBlur={(e) => e.target.value !== r.open_time.slice(0, 5) &&
                                  saveRule(f.id, { open_time: e.target.value })} />
                              <Input type="time" defaultValue={r.close_time.slice(0, 5)} className="w-24"
                                onBlur={(e) => e.target.value !== r.close_time.slice(0, 5) &&
                                  saveRule(f.id, { close_time: e.target.value })} />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {r && (
                            <div className="flex gap-1">
                              <Input type="number" defaultValue={r.min_duration_mins} className="w-16"
                                onKeyDown={(e) => e.key === "Enter" &&
                                  saveRule(f.id, { min_duration_mins: Number((e.target as HTMLInputElement).value) })} />
                              <Input type="number" defaultValue={r.max_duration_mins} className="w-16"
                                onKeyDown={(e) => e.key === "Enter" &&
                                  saveRule(f.id, { max_duration_mins: Number((e.target as HTMLInputElement).value) })} />
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input type="number" defaultValue={f.capacity} className="w-16"
                            onKeyDown={async (e) => {
                              if (e.key === "Enter") {
                                await supabase.from("facilities")
                                  .update({ capacity: Number((e.target as HTMLInputElement).value) }).eq("id", f.id);
                                toast.success("Capacity updated"); await load();
                              }
                            }} />
                        </TableCell>
                        <TableCell>
                          {r && (
                            <Button size="sm" variant={r.auto_approve ? "default" : "outline"}
                              onClick={() => saveRule(f.id, { auto_approve: !r.auto_approve })}>
                              {r.auto_approve ? "On" : "Off"}
                            </Button>
                          )}
                        </TableCell>
                        <TableCell className="min-w-[180px]">
                          <div className="flex flex-wrap gap-1">
                            {assigned.map((a) => {
                              const m = managers.find((x) => x.id === a.manager_id);
                              return (
                                <Badge key={a.id} variant="secondary" className="gap-1">
                                  {m?.full_name ?? "?"}
                                  <button className="ml-1 text-muted-foreground hover:text-destructive"
                                    onClick={() => removeManager(a.id)}>x</button>
                                </Badge>
                              );
                            })}
                            {assigned.length === 0 && (
                              <span className="text-xs text-muted-foreground">admin-managed</span>
                            )}
                          </div>
                          {unassignedManagers.length > 0 && (
                            <Select value="" onValueChange={(v) => addManager(f.id, v)}>
                              <SelectTrigger className="mt-1 h-7 w-36 text-xs">
                                <SelectValue placeholder="+ assign manager" />
                              </SelectTrigger>
                              <SelectContent>
                                {unassignedManagers.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant={f.status === "active" ? "outline" : "destructive"}
                            onClick={() => toggleStatus(f)}>
                            {f.status}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          </div>)}

          {tab === "approvals" && (
          <Card key="appr" className="animate-reveal" style={{ animationDelay: "50ms" }}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-primary" />
                Approvals - facilities without a manager
                {unassignedPending.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{unassignedPending.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>{unassignedPending.length} request(s) waiting on you</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facility</TableHead><TableHead>Requested by</TableHead>
                    <TableHead>When</TableHead><TableHead>Pax</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unassignedPending.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{fname(r.facility_id)}</TableCell>
                      <TableCell>{r.profiles?.full_name ?? "-"}</TableCell>
                      <TableCell>
                        {new Date(r.start_time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>{r.participants}</TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap">
                        <Button size="sm" onClick={() => decide(r, "approved")}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => decide(r, "rejected")}>Reject</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {unassignedPending.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nothing waiting</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          )}

          {tab === "equipment" && (
          <Card key="equip" className="animate-reveal" style={{ animationDelay: "50ms" }}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                Equipment inventory
              </CardTitle>
              <CardDescription>
                Managers maintain inventory for their own facility categories; this is the admin override
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Quantity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {equipment.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell>{typeLabel(e.facility_type)}</TableCell>
                      <TableCell>
                        <Input type="number" min={0} defaultValue={e.total_qty} className="w-20"
                          onKeyDown={(ev) => ev.key === "Enter" &&
                            saveQty(e, Number((ev.target as HTMLInputElement).value))} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid gap-2 sm:grid-cols-4">
                <Input placeholder="Category (e.g. basketball)" value={newEquip.type} list="type-list"
                  onChange={(e) => setNewEquip({ ...newEquip, type: e.target.value })} />
                <Input placeholder="Item name" value={newEquip.name}
                  onChange={(e) => setNewEquip({ ...newEquip, name: e.target.value })} />
                <Input type="number" min={1} value={newEquip.qty}
                  onChange={(e) => setNewEquip({ ...newEquip, qty: Number(e.target.value) })} />
                <Button onClick={addEquipment}>Add item</Button>
              </div>
            </CardContent>
          </Card>
          )}

          {tab === "records" && (
          <Card key="rec" className="animate-reveal" style={{ animationDelay: "50ms" }}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <ScrollText className="h-5 w-5 text-primary" />
                Records - activity log
              </CardTitle>
              <CardDescription>
                Every booking, approval, facility change, and lost-and-found action, newest first
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {LOG_TABS.map((t) => (
                  <button key={t.key}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      logFilter === t.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                    }`}
                    onClick={() => setLogFilter(t.key)}>
                    {t.label}
                  </button>
                ))}
                <Input placeholder="Search records..." value={logSearch}
                  onChange={(e) => setLogSearch(e.target.value)}
                  className="ml-auto h-8 w-48" />
              </div>
              <div className="max-h-[420px] overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="w-36">When</TableHead>
                      <TableHead className="w-24">Action</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLog.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(a.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ACTION_COLOR[a.action] ?? "secondary"} className="capitalize">{a.action}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{a.summary}</TableCell>
                      </TableRow>
                    ))}
                    {filteredLog.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-muted-foreground">
                        No records{logSearch ? " match your search" : " yet"}
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                Showing the {activity.length} most recent events. Records are written by database
                triggers, so every action is captured automatically.
              </p>
            </CardContent>
          </Card>
          )}
        </>
      )}
    </AppShell>
  );
}
