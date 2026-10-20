"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
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
  Trash2, MapPin, Users2, ShieldCheck, GraduationCap, UserCog, Activity,
  ArrowRight, Check, X, Loader2, Search, Cpu, MessageSquareWarning,
} from "lucide-react";
import AdminAnalytics from "@/components/admin-analytics";
import FacilityIso from "@/components/facility-iso";
import FacilityDetail from "@/components/facility-detail";
import RoomReports from "@/components/room-reports";
import { fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";

interface FmRow { id: string; facility_id: string; manager_id: string }
interface PendingRow extends Reservation { profiles: { full_name: string } | null }

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
const initials = (name?: string | null) =>
  (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const ROLE_META = {
  student: { label: "Student", Icon: GraduationCap },
  facility_manager: { label: "Facility Manager", Icon: UserCog },
  admin: { label: "Administrator", Icon: ShieldCheck },
} as const;

function AdminSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-11" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[88px]" />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="skeleton h-80" /><div className="skeleton h-80" />
      </div>
    </div>
  );
}

// step 1: a category owns the venue and the rules
const NEW_CATEGORY_DEFAULTS = {
  name: "", venue: "",
  open_time: "08:00", close_time: "22:00", slot_minutes: 60,
  min_duration_mins: 30, max_duration_mins: 120,
  max_advance_days: 14, cancellation_hours: 24, auto_approve: false,
  checkin_grace_mins: null as number | null,
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
  const [tab, setTab] = useState<"overview" | "analytics" | "rooms" | "facilities" | "users" | "approvals" | "feedback" | "equipment" | "records">("overview");
  const [allUsers, setAllUsers] = useState<Profile[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | keyof typeof ROLE_META>("all");
  const [todayRes, setTodayRes] = useState<Reservation[]>([]); // approved + pending, today (MYT)
  const [acting, setActing] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0); // ticking clock; never Date.now() during render
  const [feedbackCount, setFeedbackCount] = useState(0);         // open room problems
  const [openFac, setOpenFac] = useState<string | null>(null);   // facility detail open
  const [facFilter, setFacFilter] = useState<string>("all");
  const [facSearch, setFacSearch] = useState("");
  const [smartIds, setSmartIds] = useState<Set<string>>(new Set()); // rooms with a Wokwi device

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

    // today's bookings across campus, for the live venue overview
    const today = myDateKey();
    const { data: td } = await supabase
      .from("reservations").select("*")
      .in("status", ["approved", "pending"])
      .gte("start_time", myAt(today, "00:00").toISOString())
      .lt("start_time", myAt(today, "23:59").toISOString());
    setTodayRes((td as Reservation[]) ?? []);

    // which rooms have a smart device (view from upgrade-room-end.sql; absent = none)
    const { data: devs } = await supabase.from("room_devices_visible").select("facility_id");
    setSmartIds(new Set(((devs as { facility_id: string }[] | null) ?? []).map((d) => d.facility_id)));

    // open room problems reported by students (table from upgrade-room-reports.sql)
    const { count: fb } = await supabase.from("room_reports")
      .select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]);
    setFeedbackCount(fb ?? 0);

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
      setNowMs(Date.now());
      setLoading(false);
    })();
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [router, load]);

  // ---------- step 1: categories (own the rules) ----------
  async function createCategory() {
    if (!nc.name || !nc.venue) { toast.error("Category name and venue are required"); return; }
    const slug = nc.name.trim().toLowerCase().replace(/\s+/g, "_");
    // only send the grace rule when set, so this still works before
    // upgrade-auto-release.sql has added the column
    const { checkin_grace_mins, ...base } = nc;
    const { error } = await supabase.from("facility_categories")
      .insert({ ...base, slug, ...(checkin_grace_mins ? { checkin_grace_mins } : {}) });
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
    setOpenFac(null);
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
    setOpenFac(null);
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
    if (acting) return;
    setActing(r.id);
    const { error } = await supabase.from("reservations").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); setActing(null); return; }
    toast.success(`Request ${status}`);
    await load();
    setActing(null);
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
    { key: "room_report", label: "Room problems", entities: ["room_report"] },
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

  // ---------- live overview ----------
  const now = nowMs;
  const inUse = new Set(todayRes.filter((r) =>
    r.status === "approved" &&
    new Date(r.start_time).getTime() <= now && new Date(r.end_time).getTime() > now,
  ).map((r) => r.facility_id));
  const facVenues = Array.from(new Set(facilities.map((f) => f.venue)));
  const roleCount = (r: keyof typeof ROLE_META) => allUsers.filter((u) => u.role === r).length;
  const shownUsers = allUsers.filter((u) => {
    const q = userSearch.trim().toLowerCase();
    const inRole = roleFilter === "all" || u.role === roleFilter;
    return inRole && (!q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  });


  // ---------- facilities: grid + detail ----------
  const openFacility = openFac ? facilities.find((f) => f.id === openFac) ?? null : null;
    const shownFacilities = facilities.filter((f) => {
    const q = facSearch.trim().toLowerCase();
    return (facFilter === "all" || f.category_id === facFilter) &&
      (!q || f.name.toLowerCase().includes(q) || f.venue.toLowerCase().includes(q));
  });

  return (
    <AppShell
      title="Administration"
      subtitle="Facilities, managers, booking policy and inventory"
      role="admin"
      userName={profile?.full_name}
    >
      <Toaster richColors />
      {loading ? (
        <AdminSkeleton />
      ) : (
        <>
          {/* section nav */}
          <nav className="sticky top-16 z-30 -mx-4 mb-2 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
            {([
              ["overview", "Overview", LayoutDashboard, 0],
              ["analytics", "Analytics", BarChart3, 0],
              ["rooms", "Smart room", Cpu, 0],
              ["users", "Users", Users, allUsers.length],
              ["facilities", "Facilities", Building2, facilities.length],
              ["approvals", "Approvals", ClipboardCheck, unassignedPending.length],
              ["feedback", "Feedback", MessageSquareWarning, feedbackCount],
              ["equipment", "Equipment", Package, 0],
              ["records", "Records", ScrollText, 0],
            ] as const).map(([key, label, Icon, count]) => (
              <button key={key} onClick={() => { setTab(key); if (key === "rooms") setOpenFac(null); }}
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
          <div key="ov" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {([
                ["Registered users", stats.users, Users, "users"],
                ["Total bookings", stats.bookings, CalendarRange, "analytics"],
                ["Pending approval", stats.pending, Clock, "approvals"],
                ["Rooms in use now", `${inUse.size} / ${facilities.length}`, Building2, "facilities"],
              ] as const).map(([label, n, Icon, go], i) => (
                <button key={label} onClick={() => setTab(go)}
                  className="animate-reveal stagger group rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
                  style={stagger(i)}>
                  <div className="flex items-center gap-4 p-5">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-6 w-6" />
                    </span>
                    <div className="flex-1">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
                      <p className="font-display animate-count text-3xl font-semibold leading-tight">{n}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </button>
              ))}
            </div>

            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
              {/* campus right now */}
              <Card className="animate-reveal" style={{ animationDelay: "200ms" }}>
                <CardHeader>
                  <CardTitle className="font-display flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" /> Campus right now
                  </CardTitle>
                  <CardDescription>Every venue at a glance: rooms in use and bookings today</CardDescription>
                </CardHeader>
                <CardContent>
                  {facVenues.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-12 text-center">
                      <Building2 className="h-9 w-9 text-muted-foreground/50" />
                      <p className="font-medium">No facilities yet</p>
                      <Button size="sm" className="mt-1 gap-1.5" onClick={() => setTab("facilities")}>
                        <Plus className="h-4 w-4" /> Add your first facility
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                      {facVenues.map((v, i) => {
                        const rooms = facilities.filter((f) => f.venue === v);
                        const busy = rooms.filter((f) => inUse.has(f.id)).length;
                        const today = todayRes.filter((r) => rooms.some((f) => f.id === r.facility_id));
                        const waiting = today.filter((r) => r.status === "pending").length;
                        const pct = rooms.length ? Math.round((busy / rooms.length) * 100) : 0;
                        return (
                          <button key={v} onClick={() => setTab("facilities")}
                            className="animate-reveal stagger overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg"
                            style={stagger(i)}>
                            <div className="relative h-28 bg-muted/40">
                              <FacilityIso type={rooms[0].type} busy={busy === rooms.length && busy > 0} />
                              {waiting > 0 && (
                                <span className="animate-pop-in absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow">
                                  {waiting} pending today
                                </span>
                              )}
                            </div>
                            <div className="space-y-2 p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <h3 className="font-display font-semibold leading-tight">{v}</h3>
                                  <p className="text-xs text-muted-foreground">
                                    {Array.from(new Set(rooms.map((f) => typeLabel(f.type)))).join(", ")}
                                  </p>
                                </div>
                                <Badge variant={busy ? "destructive" : "default"} className="shrink-0">
                                  {busy} / {rooms.length} in use
                                </Badge>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
                              </div>
                              <p className="text-xs text-muted-foreground">{today.length} booking{today.length === 1 ? "" : "s"} today</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* recent activity */}
              <Card className="animate-reveal xl:sticky xl:top-36" style={{ animationDelay: "260ms" }}>
                <CardHeader>
                  <CardTitle className="font-display flex items-center gap-2">
                    <Activity className="h-5 w-5 text-primary" /> Recent activity
                  </CardTitle>
                  <CardDescription>Latest actions across the system</CardDescription>
                </CardHeader>
                <CardContent>
                  {activity.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
                  ) : (
                    <ol className="relative space-y-4 border-l pl-5">
                      {activity.slice(0, 8).map((a, i) => (
                        <li key={a.id} className="animate-reveal stagger relative" style={stagger(i)}>
                          <span className={`absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-card ${
                            ACTION_COLOR[a.action] === "destructive" ? "bg-destructive" : "bg-primary"}`} />
                          <p className="text-sm leading-snug">{a.summary}</p>
                          <p className="pt-0.5 text-xs text-muted-foreground">
                            {fmtRelativeDay(myDateKey(new Date(a.at)), new Date(now || 0))}, {fmtTime(new Date(a.at))}
                            {a.actor_name ? ` · ${a.actor_name}` : ""}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                  <Button variant="ghost" size="sm" className="mt-4 w-full gap-1.5" onClick={() => setTab("records")}>
                    View all records <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
          )}

          {tab === "analytics" && (
            <div key="an" className="animate-reveal"><AdminAnalytics /></div>
          )}

          {tab === "rooms" && openFacility && (
            <FacilityDetail key={openFacility.id} facility={openFacility} rule={rules[openFacility.id]}
              onBack={() => setOpenFac(null)} />
          )}

          {tab === "rooms" && !openFacility && (
            <div key="rooms" className="space-y-6">
              <div className="animate-reveal">
                <h2 className="font-display flex items-center gap-2 text-xl font-semibold">
                  <Cpu className="h-5 w-5 text-primary" /> Smart rooms
                </h2>
                <p className="text-sm text-muted-foreground">
                  Open a room for its live 3D twin, readings and energy. Rooms marked Live 3D have a Wokwi device;
                  the rest are shown from their bookings.
                </p>
              </div>
              {facilities.length === 0 && (
                <p className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No facilities yet - add them in the Facilities tab.
                </p>
              )}
          {/* ---------- one panel per room; click opens its detail ---------- */}
          {facilities.length > 0 && (
            <div className="animate-reveal flex flex-wrap items-center gap-2">
              {[{ id: "all", name: "All", n: facilities.length },
                ...categories.map((c) => ({ id: c.id, name: c.name, n: facilities.filter((f) => f.category_id === c.id).length }))]
                .map((c) => (
                  <button key={c.id} onClick={() => setFacFilter(c.id)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      facFilter === c.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    {c.name}
                    <span className={`rounded-full px-1.5 ${facFilter === c.id ? "bg-primary-foreground/20" : "bg-muted"}`}>{c.n}</span>
                  </button>
                ))}
              <div className="relative ml-auto w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search rooms or venues..." value={facSearch}
                  onChange={(e) => setFacSearch(e.target.value)} className="pl-8" />
              </div>
            </div>
          )}

          {facilities.length > 0 && (
            shownFacilities.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed py-12 text-center">
                <Building2 className="h-7 w-7 text-muted-foreground/50" />
                <p className="text-sm font-medium">Nothing matches</p>
                <p className="text-xs text-muted-foreground">
                  Try another type or search.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {shownFacilities.map((f, fi) => {
                  const busy = inUse.has(f.id);
                  const off = f.status !== "active";
                  const smart = smartIds.has(f.id);
                  const today = todayRes.filter((r) => r.facility_id === f.id).length;
                  const mgrs = fmRows.filter((x) => x.facility_id === f.id).length;
                  return (
                    <button key={f.id} onClick={() => { setOpenFac(f.id); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={stagger(fi)}
                      className={`animate-reveal stagger group overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg ${off ? "opacity-75" : ""}`}>
                      <div className="relative h-32 bg-muted/40">
                        <div className={off ? "h-full grayscale" : "h-full"}><FacilityIso type={f.type} busy={busy} /></div>
                        <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium shadow">
                          {off ? f.status : busy ? "In use" : "Free now"}
                        </span>
                        {smart && (
                          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow">
                            <Cpu className="h-3 w-3" /> Live 3D
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-display font-semibold leading-tight">{f.name}</h3>
                          <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                        </div>
                        <p className="text-xs text-muted-foreground">{f.venue} · {typeLabel(f.type)}</p>
                        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Users2 className="h-3.5 w-3.5" /> {f.capacity}</span>
                          <span className="flex items-center gap-1"><CalendarRange className="h-3.5 w-3.5" /> {today} today</span>
                          <span className="flex items-center gap-1"><UserCog className="h-3.5 w-3.5" /> {mgrs ? `${mgrs} manager${mgrs > 1 ? "s" : ""}` : "admin"}</span>
                          {rules[f.id]?.has_override && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">custom rules</Badge>}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}

            </div>
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
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ["all", "Everyone", allUsers.length, Users],
                  ["student", "Students", roleCount("student"), GraduationCap],
                  ["facility_manager", "Managers", roleCount("facility_manager"), UserCog],
                  ["admin", "Admins", roleCount("admin"), ShieldCheck],
                ] as const).map(([key, label, n, Icon]) => (
                  <button key={key} onClick={() => setRoleFilter(key)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      roleFilter === key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    <Icon className="h-3.5 w-3.5" /> {label}
                    <span className={`rounded-full px-1.5 ${roleFilter === key ? "bg-primary-foreground/20" : "bg-muted"}`}>{n}</span>
                  </button>
                ))}
                <div className="relative ml-auto w-full sm:w-64">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search by name or email..." value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)} className="pl-8" />
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2.5">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                              u.role === "admin" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
                              {initials(u.full_name)}
                            </span>
                            <span>
                              {u.full_name}{u.id === profile?.id && <span className="text-xs text-muted-foreground"> (you)</span>}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          <Select value={u.role} onValueChange={(v) => changeRole(u, v)}>
                            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(Object.keys(ROLE_META) as (keyof typeof ROLE_META)[]).map((k) => {
                                const { label, Icon } = ROLE_META[k];
                                return (
                                  <SelectItem key={k} value={k}>
                                    <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{label}</span>
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  {shownUsers.length === 0 && (
                    <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                      {allUsers.length === 0 ? "No users yet" : "Nobody matches this filter"}
                    </TableCell></TableRow>
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
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">
                          Check-in grace (min) - blank = never auto-release
                        </label>
                        <Input type="number" min={1} max={120} placeholder="off"
                          value={nc.checkin_grace_mins ?? ""}
                          onChange={(e) => setNc({
                            ...nc,
                            checkin_grace_mins: e.target.value === "" ? null : Number(e.target.value),
                          })} />
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
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Check-in grace (min)</label>
                        <Input type="number" min={1} max={120} placeholder="off - never release"
                          defaultValue={c.checkin_grace_mins ?? ""}
                          title="Release a booking if nobody checks in within this many minutes of its start. Blank = off."
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            const v = (e.target as HTMLInputElement).value;
                            saveCategoryRule(c.id, { checkin_grace_mins: v === "" ? null : Number(v) });
                          }} />
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
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {courts.map((f, fi) => {
                        const r = rules[f.id];
                        const assigned = fmRows.filter((x) => x.facility_id === f.id);
                        const unassignedManagers = managers.filter(
                          (m) => !assigned.some((a) => a.manager_id === m.id)
                        );
                        const busy = inUse.has(f.id);
                        const off = f.status !== "active";
                        return (
                          <div key={f.id} style={stagger(fi)}
                            className={`animate-reveal stagger flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${off ? "opacity-75" : ""}`}>
                            <div className="relative h-28 bg-muted/40">
                              <div className={off ? "h-full grayscale" : "h-full"}>
                                <FacilityIso type={f.type} busy={busy} />
                              </div>
                              <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium shadow">
                                {off ? f.status : busy ? "In use" : "Free now"}
                              </span>
                              <Button size="sm" variant="ghost"
                                className="absolute right-1.5 top-1.5 h-7 w-7 bg-card/80 p-0 text-destructive hover:bg-destructive/10"
                                onClick={() => deleteCourt(f)} aria-label={`Delete ${f.name}`}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <div className="flex flex-1 flex-col gap-3 p-3">
                            {/* name + capacity */}
                            <div>
                              <p className="font-display font-semibold">{f.name}</p>
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
                            <div>
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
                            <div className="flex-1">
                              <p className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Managers</p>
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
                            <Button size="sm" className="w-full" variant={off ? "default" : "outline"}
                              onClick={() => toggleStatus(f)}>
                              {off ? "Reactivate" : "Take offline"}
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

          {tab === "feedback" && (
            <div key="fb" className="animate-reveal"><RoomReports onActiveCount={setFeedbackCount} /></div>
          )}

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
              {unassignedPending.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <ClipboardCheck className="h-9 w-9 text-primary/60" />
                  <p className="font-medium">All caught up</p>
                  <p className="text-sm text-muted-foreground">
                    Requests for rooms without a manager land here.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 2xl:grid-cols-2">
                  {unassignedPending.map((r, i) => {
                    const f = facilities.find((x) => x.id === r.facility_id);
                    const start = new Date(r.start_time);
                    const over = f ? r.participants > f.capacity : false;
                    return (
                      <div key={r.id} style={stagger(i)}
                        className="animate-reveal stagger flex gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-sm">
                        <div className="hidden h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-muted/40 sm:block">
                          {f && <FacilityIso type={f.type} busy={false} />}
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                              {initials(r.profiles?.full_name)}
                            </span>
                            <span className="font-medium">{r.profiles?.full_name ?? "Student"}</span>
                            <span className="text-xs text-muted-foreground">wants {fname(r.facility_id)}</span>
                          </div>
                          <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1 font-medium text-foreground">
                              <CalendarRange className="h-3.5 w-3.5 text-primary" />
                              <span className="capitalize">{fmtRelativeDay(myDateKey(start), new Date(now || 0))}</span>,
                              {" "}{fmtTime(start)} - {fmtTime(new Date(r.end_time))}
                            </span>
                            <span className={`flex items-center gap-1 ${over ? "font-medium text-destructive" : ""}`}>
                              <Users2 className="h-3.5 w-3.5" /> {r.participants}{f ? ` / ${f.capacity}` : ""}
                            </span>
                          </p>
                          {r.purpose && <p className="line-clamp-2 text-sm">&ldquo;{r.purpose}&rdquo;</p>}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1.5">
                          <Button size="sm" className="gap-1" disabled={!!acting} onClick={() => decide(r, "approved")}>
                            {acting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1" disabled={!!acting}
                            onClick={() => decide(r, "rejected")}>
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
              <div className="max-h-[420px] overflow-y-auto rounded-lg border xl:max-h-[calc(100vh-22rem)]">
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
