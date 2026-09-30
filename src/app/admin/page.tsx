"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Facility, FacilityCategory, FacilityRule, Profile, Equipment, Reservation, ActivityLog, typeLabel } from "@/lib/types";
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
  Trash2, MapPin, Users2,
} from "lucide-react";
import AdminAnalytics from "@/components/admin-analytics";
import FacilityIso from "@/components/facility-iso";

interface FmRow { id: string; facility_id: string; manager_id: string }
interface PendingRow extends Reservation { profiles: { full_name: string } | null }

// step 1: a category owns the venue and the rules
const NEW_CATEGORY_DEFAULTS = {
  name: "", venue: "",
  open_time: "08:00", close_time: "22:00", slot_minutes: 60,
  min_duration_mins: 30, max_duration_mins: 120,
  max_advance_days: 14, cancellation_hours: 24, auto_approve: false,
};
// step 2: a court/room under a category
const NEW_COURT_DEFAULTS = { category_id: "", name: "", capacity: 10, description: "" };

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
  const [categories, setCategories] = useState<FacilityCategory[]>([]);
  const [nc, setNc] = useState({ ...NEW_CATEGORY_DEFAULTS });
  const [ncourt, setNcourt] = useState({ ...NEW_COURT_DEFAULTS });
  const [newEquip, setNewEquip] = useState({ type: "", name: "", qty: 1 });
  const [showAddCat, setShowAddCat] = useState(false);
  const [showAddCourt, setShowAddCourt] = useState(false);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [logFilter, setLogFilter] = useState<string>("all");
  const [logSearch, setLogSearch] = useState("");
  const [tab, setTab] = useState<"overview" | "analytics" | "facilities" | "users" | "approvals" | "equipment" | "records">("overview");
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [userSearch, setUserSearch] = useState("");

  const load = useCallback(async () => {
    const [{ data: f }, { data: r }, { data: m }, { data: fm }, { data: eq }, { data: cats }] = await Promise.all([
      supabase.from("facilities_full").select("*").order("venue").order("name"),
      supabase.from("effective_facility_rules").select("*"),
      supabase.from("profiles").select("*").eq("role", "facility_manager").order("full_name"),
      supabase.from("facility_managers").select("*"),
      supabase.from("equipment").select("*").order("facility_type").order("name"),
      supabase.from("facility_categories").select("*").order("name"),
    ]);
    setCategories((cats as FacilityCategory[]) ?? []);
    const facs = (f as Facility[]) ?? [];
    setFacilities(facs);
    const map: Record<string, FacilityRule> = {};
    (r as FacilityRule[] | null)?.forEach((x) => { map[x.facility_id] = x; });
    setRules(map);
    setManagers((m as Profile[]) ?? []);
    const { data: us } = await supabase.from("profiles").select("*").order("full_name");
    setAllUsers((us as Profile[]) ?? []);
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

  // ---------- step 1: categories (own the rules) ----------
  async function createCategory() {
    if (!nc.name || !nc.venue) { toast.error("Category name and venue are required"); return; }
    const slug = nc.name.trim().toLowerCase().replace(/\s+/g, "_");
    const { error } = await supabase.from("facility_categories").insert({ ...nc, slug });
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That category already exists" : error.message);
      return;
    }
    toast.success(`Category "${nc.name}" created - now add its rooms/courts`);
    setNc({ ...NEW_CATEGORY_DEFAULTS });
    setShowAddCat(false);
    setShowAddCourt(true);
    await load();
  }

  async function saveCategoryRule(categoryId: string, patch: Partial<FacilityCategory>) {
    const { error } = await supabase.from("facility_categories").update(patch).eq("id", categoryId);
    if (error) { toast.error(error.message); return; }
    toast.success("Category rules updated - applies to all its rooms/courts");
    await load();
  }

  async function deleteCategory(c: FacilityCategory) {
    const count = facilities.filter((f) => f.category_id === c.id).length;
    if (!window.confirm(
      `Delete "${c.name}"${count ? ` and its ${count} room(s)/court(s)` : ""}? Bookings will be removed too.`
    )) return;
    const { error } = await supabase.from("facility_categories").delete().eq("id", c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${c.name} deleted`);
    await load();
  }

  // ---------- step 2: rooms / courts ----------
  async function createCourt() {
    if (!ncourt.category_id || !ncourt.name) {
      toast.error("Pick a category and give the room/court a name"); return;
    }
    const { error } = await supabase.from("facilities").insert({
      category_id: ncourt.category_id, name: ncourt.name,
      capacity: ncourt.capacity, description: ncourt.description || null, status: "active",
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`${ncourt.name} added`);
    setNcourt({ ...NEW_COURT_DEFAULTS, category_id: ncourt.category_id });
    await load();
  }

  async function deleteCourt(f: Facility) {
    if (!window.confirm(`Delete "${f.name}"? Its bookings will be removed too.`)) return;
    const { error } = await supabase.from("facilities").delete().eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${f.name} deleted`);
    await load();
  }

  async function changeRole(u: Profile, role: string) {
    if (u.id === profile?.id && role !== "admin") {
      toast.error("You can't remove your own admin access"); return;
    }
    const { error } = await supabase.from("profiles").update({ role }).eq("id", u.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${u.full_name} is now ${role.replace("_", " ")}`);
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

  // ---------- per-court overrides (NULL columns = inherit from category) ----------
  async function saveOverride(facilityId: string, patch: Record<string, unknown>) {
    const { error } = await supabase
      .from("facility_rules")
      .upsert({ facility_id: facilityId, ...patch }, { onConflict: "facility_id" });
    if (error) { toast.error(error.message); return; }
    toast.success("Override saved for this room/court");
    await load();
  }

  async function clearOverride(facilityId: string) {
    const { error } = await supabase.from("facility_rules").delete().eq("facility_id", facilityId);
    if (error) { toast.error(error.message); return; }
    toast.success("Override removed - now inherits its category");
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

  const venues = Array.from(new Set(categories.map((c) => c.venue)));
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
              ["users", "Users", Users, allUsers.length],
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

          {tab === "users" && (
          <Card key="usr" className="animate-reveal">
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                User management
              </CardTitle>
              <CardDescription>
                Everyone signs up as a student. Promote trusted staff to facility manager
                or administrator here.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Search by name or email..." value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)} className="max-w-xs" />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allUsers
                    .filter((u) => {
                      const q = userSearch.trim().toLowerCase();
                      return !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                    })
                    .map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          {u.full_name}{u.id === profile?.id && <span className="text-xs text-muted-foreground"> (you)</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          <Select value={u.role} onValueChange={(v) => changeRole(u, v)}>
                            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="student">Student</SelectItem>
                              <SelectItem value="facility_manager">Facility Manager</SelectItem>
                              <SelectItem value="admin">Administrator</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  {allUsers.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground">No users yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          )}

          {tab === "facilities" && (<div key="fac" className="space-y-6">

          {/* ---------- stepper header ---------- */}
          <div className="animate-reveal grid gap-4 md:grid-cols-2">
            {/* STEP 1 */}
            <Card className="overflow-hidden border-l-4 border-l-primary">
              <button className="flex w-full items-start gap-3 p-5 text-left transition-colors hover:bg-muted/40"
                onClick={() => setShowAddCat((s) => !s)}>
                <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  1
                </span>
                <span className="flex-1">
                  <span className="font-display block font-semibold">Create a facility type</span>
                  <span className="block pt-0.5 text-xs leading-relaxed text-muted-foreground">
                    e.g. Badminton or Football. Set the venue and booking rules once - every
                    room or court you add inherits them.
                  </span>
                </span>
                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${showAddCat ? "rotate-180" : ""}`} />
              </button>
              {showAddCat && (
                <CardContent className="animate-field-in space-y-4 border-t pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Facility type</label>
                      <Input placeholder="e.g. Badminton" value={nc.name}
                        onChange={(e) => setNc({ ...nc, name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Venue</label>
                      <Input placeholder="e.g. Sports Hall" value={nc.venue} list="venue-list"
                        onChange={(e) => setNc({ ...nc, venue: e.target.value })} />
                      <datalist id="venue-list">
                        {venues.map((v) => <option key={v} value={v} />)}
                      </datalist>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" /> Booking rules
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Opening hours</label>
                        <div className="flex items-center gap-1.5">
                          <Input type="time" value={nc.open_time}
                            onChange={(e) => setNc({ ...nc, open_time: e.target.value })} />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input type="time" value={nc.close_time}
                            onChange={(e) => setNc({ ...nc, close_time: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Booking length (min)</label>
                        <div className="flex items-center gap-1.5">
                          <Input type="number" min={15} step={15} value={nc.min_duration_mins}
                            onChange={(e) => setNc({ ...nc, min_duration_mins: Number(e.target.value) })} />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input type="number" min={15} step={15} value={nc.max_duration_mins}
                            onChange={(e) => setNc({ ...nc, max_duration_mins: Number(e.target.value) })} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Book up to (days ahead)</label>
                        <Input type="number" min={1} value={nc.max_advance_days}
                          onChange={(e) => setNc({ ...nc, max_advance_days: Number(e.target.value) })} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Cancellation notice (hours)</label>
                        <Input type="number" min={0} value={nc.cancellation_hours}
                          onChange={(e) => setNc({ ...nc, cancellation_hours: Number(e.target.value) })} />
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center justify-between rounded-lg bg-card px-3 py-2">
                      <span>
                        <span className="block text-sm font-medium">Auto-approve bookings</span>
                        <span className="block text-xs text-muted-foreground">
                          Skip the manager queue for this type
                        </span>
                      </span>
                      <Button size="sm" variant={nc.auto_approve ? "default" : "outline"}
                        onClick={() => setNc({ ...nc, auto_approve: !nc.auto_approve })}>
                        {nc.auto_approve ? "On" : "Off"}
                      </Button>
                    </label>
                  </div>

                  <Button className="w-full gap-2" onClick={createCategory}>
                    <Plus className="h-4 w-4" /> Create facility type
                  </Button>
                </CardContent>
              )}
            </Card>

            {/* STEP 2 */}
            <Card className={`overflow-hidden border-l-4 ${categories.length ? "border-l-primary" : "border-l-muted"}`}>
              <button className="flex w-full items-start gap-3 p-5 text-left transition-colors hover:bg-muted/40"
                onClick={() => setShowAddCourt((s) => !s)}>
                <span className={`font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  categories.length ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  2
                </span>
                <span className="flex-1">
                  <span className="font-display block font-semibold">Add rooms &amp; courts</span>
                  <span className="block pt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {categories.length === 0
                      ? "Create a facility type first, then add its rooms here."
                      : "e.g. Court 1, Court 2 under Badminton. Only a name and capacity needed."}
                  </span>
                </span>
                <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${showAddCourt ? "rotate-180" : ""}`} />
              </button>
              {showAddCourt && (
                <CardContent className="animate-field-in space-y-3 border-t pt-4">
                  {categories.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No facility types yet - complete step 1 first.
                    </p>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Facility type</label>
                        <Select value={ncourt.category_id} onValueChange={(v) => setNcourt({ ...ncourt, category_id: v })}>
                          <SelectTrigger><SelectValue placeholder="Choose type" /></SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name} - {c.venue}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Room / court name</label>
                          <Input placeholder="e.g. Court 1" value={ncourt.name}
                            onChange={(e) => setNcourt({ ...ncourt, name: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium">Capacity (people)</label>
                          <Input type="number" min={1} value={ncourt.capacity}
                            onChange={(e) => setNcourt({ ...ncourt, capacity: Number(e.target.value) })} />
                        </div>
                      </div>
                      <Button className="w-full gap-2" onClick={createCourt}>
                        <Plus className="h-4 w-4" /> Add room / court
                      </Button>
                    </>
                  )}
                </CardContent>
              )}
            </Card>
          </div>

          {/* ---------- existing types ---------- */}
          {categories.map((c, ci) => {
            const courts = facilities.filter((f) => f.category_id === c.id);
            const activeCount = courts.filter((f) => f.status === "active").length;
            return (
              <Card key={c.id} className="animate-reveal overflow-hidden"
                style={{ animationDelay: `${80 + ci * 50}ms` }}>
                <CardHeader className="border-b bg-muted/30">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <span className="h-14 w-16 shrink-0 overflow-hidden rounded-lg border bg-card">
                        <FacilityIso type={c.slug} busy={false} />
                      </span>
                      <div>
                        <CardTitle className="font-display text-lg">{c.name}</CardTitle>
                        <CardDescription className="flex flex-wrap items-center gap-1.5 pt-1">
                          <Badge variant="secondary" className="gap-1">
                            <MapPin className="h-3 w-3" />{c.venue}
                          </Badge>
                          <Badge variant="outline">{courts.length} room(s)</Badge>
                          {courts.length > 0 && (
                            <Badge variant="outline">{activeCount} active</Badge>
                          )}
                          {c.auto_approve && <Badge>auto-approve</Badge>}
                        </CardDescription>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:bg-destructive/10"
                      onClick={() => deleteCategory(c)}>
                      <Trash2 className="h-4 w-4" /> Delete type
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 pt-5">
                  {/* shared rules */}
                  <div className="rounded-xl border bg-muted/30 p-4">
                    <p className="flex items-center gap-1.5 pb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Booking rules - apply to every room in {c.name}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Opening hours</label>
                        <div className="flex items-center gap-1.5">
                          <Input type="time" defaultValue={c.open_time.slice(0, 5)}
                            onBlur={(e) => e.target.value !== c.open_time.slice(0, 5) &&
                              saveCategoryRule(c.id, { open_time: e.target.value })} />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input type="time" defaultValue={c.close_time.slice(0, 5)}
                            onBlur={(e) => e.target.value !== c.close_time.slice(0, 5) &&
                              saveCategoryRule(c.id, { close_time: e.target.value })} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Booking length (min)</label>
                        <div className="flex items-center gap-1.5">
                          <Input type="number" defaultValue={c.min_duration_mins}
                            onKeyDown={(e) => e.key === "Enter" &&
                              saveCategoryRule(c.id, { min_duration_mins: Number((e.target as HTMLInputElement).value) })} />
                          <span className="text-xs text-muted-foreground">to</span>
                          <Input type="number" defaultValue={c.max_duration_mins}
                            onKeyDown={(e) => e.key === "Enter" &&
                              saveCategoryRule(c.id, { max_duration_mins: Number((e.target as HTMLInputElement).value) })} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Advance / cancel notice</label>
                        <div className="flex items-center gap-1.5">
                          <Input type="number" defaultValue={c.max_advance_days} title="days ahead"
                            onKeyDown={(e) => e.key === "Enter" &&
                              saveCategoryRule(c.id, { max_advance_days: Number((e.target as HTMLInputElement).value) })} />
                          <span className="whitespace-nowrap text-xs text-muted-foreground">d /</span>
                          <Input type="number" defaultValue={c.cancellation_hours} title="hours notice"
                            onKeyDown={(e) => e.key === "Enter" &&
                              saveCategoryRule(c.id, { cancellation_hours: Number((e.target as HTMLInputElement).value) })} />
                          <span className="text-xs text-muted-foreground">h</span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Auto-approve</label>
                        <Button size="sm" className="w-full" variant={c.auto_approve ? "default" : "outline"}
                          onClick={() => saveCategoryRule(c.id, { auto_approve: !c.auto_approve })}>
                          {c.auto_approve ? "On - instant booking" : "Off - needs approval"}
                        </Button>
                      </div>
                    </div>
                    <p className="pt-2 text-[11px] text-muted-foreground">
                      Edit a value and press Enter (or click away for times) to save.
                    </p>
                  </div>

                  {/* rooms */}
                  {courts.length === 0 ? (
                    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-8 text-center">
                      <Building2 className="h-6 w-6 text-muted-foreground/50" />
                      <p className="text-sm font-medium">No rooms or courts yet</p>
                      <p className="text-xs text-muted-foreground">Add one using step 2 above.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {courts.map((f) => {
                        const r = rules[f.id];
                        const assigned = fmRows.filter((x) => x.facility_id === f.id);
                        const unassignedManagers = managers.filter(
                          (m) => !assigned.some((a) => a.manager_id === m.id)
                        );
                        return (
                          <div key={f.id}
                            className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/30">
                            {/* name + capacity */}
                            <div className="min-w-[8rem] flex-1">
                              <p className="font-medium">{f.name}</p>
                              <div className="flex items-center gap-1.5 pt-0.5">
                                <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
                                <Input type="number" defaultValue={f.capacity} className="h-7 w-16 text-xs"
                                  onKeyDown={async (e) => {
                                    if (e.key === "Enter") {
                                      await supabase.from("facilities")
                                        .update({ capacity: Number((e.target as HTMLInputElement).value) }).eq("id", f.id);
                                      toast.success("Capacity updated"); await load();
                                    }
                                  }} />
                                <span className="text-xs text-muted-foreground">people</span>
                              </div>
                            </div>

                            {/* rules badge */}
                            <div className="min-w-[7rem]">
                              {r?.has_override ? (
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="secondary">custom rules</Badge>
                                  <button className="text-xs text-muted-foreground underline hover:text-foreground"
                                    onClick={() => clearOverride(f.id)}>reset</button>
                                </div>
                              ) : (
                                <button className="text-xs text-muted-foreground underline hover:text-foreground"
                                  onClick={() => {
                                    const v = window.prompt(
                                      `Override max booking minutes for ${f.name} (leave blank to cancel):`,
                                      String(r?.max_duration_mins ?? c.max_duration_mins)
                                    );
                                    if (v) saveOverride(f.id, { max_duration_mins: Number(v) });
                                  }}>
                                  inherits type rules
                                </button>
                              )}
                            </div>

                            {/* managers */}
                            <div className="min-w-[10rem] flex-1">
                              <div className="flex flex-wrap items-center gap-1">
                                {assigned.map((a) => {
                                  const m = managers.find((x) => x.id === a.manager_id);
                                  return (
                                    <Badge key={a.id} variant="secondary" className="gap-1">
                                      {m?.full_name ?? "?"}
                                      <button className="ml-0.5 text-muted-foreground hover:text-destructive"
                                        onClick={() => removeManager(a.id)}>x</button>
                                    </Badge>
                                  );
                                })}
                                {assigned.length === 0 && (
                                  <span className="text-xs text-muted-foreground">admin-managed</span>
                                )}
                                {unassignedManagers.length > 0 && (
                                  <Select value="" onValueChange={(v) => addManager(f.id, v)}>
                                    <SelectTrigger className="h-6 w-auto gap-1 border-dashed px-2 text-xs">
                                      <SelectValue placeholder="+ manager" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {unassignedManagers.map((m) => (
                                        <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>
                            </div>

                            {/* actions */}
                            <div className="ml-auto flex items-center gap-1.5">
                              <Button size="sm" variant={f.status === "active" ? "outline" : "destructive"}
                                onClick={() => toggleStatus(f)}>
                                {f.status}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                                onClick={() => deleteCourt(f)} aria-label={`Delete ${f.name}`}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {categories.length === 0 && (
            <Card className="animate-reveal">
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
                <Building2 className="h-10 w-10 text-muted-foreground/40" />
                <p className="font-display text-lg font-semibold">No facilities yet</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Start with step 1: create a facility type such as Badminton or Discussion Room,
                  then add its individual rooms and courts.
                </p>
                <Button className="mt-2 gap-2" onClick={() => setShowAddCat(true)}>
                  <Plus className="h-4 w-4" /> Create your first facility type
                </Button>
              </CardContent>
            </Card>
          )}
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
                <Select value={newEquip.type} onValueChange={(v) => setNewEquip({ ...newEquip, type: v })}>
                  <SelectTrigger><SelectValue placeholder="Facility type" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
