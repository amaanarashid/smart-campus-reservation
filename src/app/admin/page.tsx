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
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast, Toaster } from "sonner";
import AppShell from "@/components/app-shell";
import { ensureProfile } from "@/lib/profile";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  Users, CalendarRange, Clock, Building2, ClipboardCheck, Package,
  Plus, ScrollText, LayoutDashboard, BarChart3,
  MapPin, Users2, ShieldCheck, GraduationCap, UserCog, Activity,
  ArrowRight, Check, X, Loader2, Search, Cpu, MessageSquareWarning, CircuitBoard, Laptop, KeyRound, Unplug, MoreHorizontal,
} from "lucide-react";
import AdminAnalytics from "@/components/admin-analytics";
import FacilityIso from "@/components/facility-iso";
import FacilityDetail from "@/components/facility-detail";
import RoomReports from "@/components/room-reports";
import AdminFacilities from "@/components/admin-facilities";
import SmartRoomConnect, { DEVICE_KIND, type SmartDevice } from "@/components/smart-room-connect";
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
  const [newEquip, setNewEquip] = useState({ type: "", name: "", qty: 1 });
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
  const [devices, setDevices] = useState<SmartDevice[]>([]);       // smart-room devices (Wokwi / MQTT)
  const [connectOpen, setConnectOpen] = useState(false);
  const [rekey, setRekey] = useState<SmartDevice | null>(null);

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
    const viaView = await supabase.from("room_devices_visible").select("*");
    const devs = viaView.error ? (await supabase.from("room_devices").select("*")).data : viaView.data;
    setDevices(((devs as SmartDevice[] | null) ?? []));

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
      if (!prof || prof.role !== "admin") { router.replace("/login"); return; }
      setProfile(prof);
      await load();
      setNowMs(Date.now());
      setLoading(false);
    })();
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [router, load]);

  // stats, approvals, feedback count and the activity log stay current
  useAutoRefresh(load, 30_000, !loading);

  async function changeRole(u: Profile, role: string) {
    if (u.id === profile?.id && role !== "admin") {
      toast.error("You can't remove your own admin access"); return;
    }
    const { error } = await supabase.from("profiles").update({ role }).eq("id", u.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${u.full_name} is now ${role.replace("_", " ")}`);
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


  // ---------- smart rooms: only rooms with an active device ----------
  const openFacility = openFac ? facilities.find((f) => f.id === openFac) ?? null : null;
  const deviceOf = (facilityId: string) => devices.find((d) => d.facility_id === facilityId && d.active);
  const smartRooms = facilities.filter((f) => deviceOf(f.id));
  const smartCats = categories.filter((c) => smartRooms.some((f) => f.category_id === c.id));
  const shownFacilities = smartRooms.filter((f) => {
    const q = facSearch.trim().toLowerCase();
    return (facFilter === "all" || f.category_id === facFilter) &&
      (!q || f.name.toLowerCase().includes(q) || f.venue.toLowerCase().includes(q));
  });
  async function disconnect(d: SmartDevice) {
    if (!window.confirm(`Disconnect ${d.label}? Its key stops working. Its history is kept, and you can connect it again later.`)) return;
    const { error } = await supabase.from("room_devices").update({ active: false }).eq("id", d.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${d.label} disconnected`);
    await load();
  }
  /** "Online" if the device reported in the last 30 s. */
  const seen = (d: SmartDevice) => {
    if (!d.last_seen_at) return { online: false, text: "Never connected" };
    const ago = Math.max(0, Math.round((now - new Date(d.last_seen_at).getTime()) / 1000));
    if (ago < 30) return { online: true, text: "Online" };
    return { online: false, text: ago < 3600 ? `Seen ${Math.round(ago / 60)} min ago` : ago < 86400 ? `Seen ${Math.round(ago / 3600)} h ago` : `Seen ${Math.round(ago / 86400)} d ago` };
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
            <div key="rooms" className="space-y-5">
              <SmartRoomConnect open={connectOpen || !!rekey} rekey={rekey} facilities={facilities} devices={devices}
                onOpenChange={(v) => { if (!v) { setConnectOpen(false); setRekey(null); } }} onDone={load} />
              <div className="animate-reveal flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display flex items-center gap-2 text-xl font-semibold">
                    <Cpu className="h-5 w-5 text-primary" /> Smart rooms
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Rooms with a connected device. Open one for its live 3D twin, readings, remote control and energy.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {smartRooms.length > 0 && (
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input placeholder="Search rooms or venues" value={facSearch}
                        onChange={(e) => setFacSearch(e.target.value)} className="h-9 w-56 pl-8" />
                    </div>
                  )}
                  <Button className="gap-2" onClick={() => setConnectOpen(true)} disabled={facilities.length === 0}>
                    <Plus className="h-4 w-4" /> Connect a room
                  </Button>
                </div>
              </div>

              {smartCats.length > 1 && (
                <div className="animate-reveal flex flex-wrap items-center gap-2">
                  {[{ id: "all", name: "All", n: smartRooms.length },
                    ...smartCats.map((c) => ({ id: c.id, name: c.name, n: smartRooms.filter((f) => f.category_id === c.id).length }))]
                    .map((c) => (
                      <button key={c.id} onClick={() => setFacFilter(c.id)}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          facFilter === c.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                        {c.name}
                        <span className={`rounded-full px-1.5 ${facFilter === c.id ? "bg-primary-foreground/20" : "bg-muted"}`}>{c.n}</span>
                      </button>
                    ))}
                </div>
              )}

              {smartRooms.length === 0 ? (
                <Card className="animate-reveal">
                  <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
                    <Cpu className="h-10 w-10 text-muted-foreground/40" />
                    <p className="font-display text-lg font-semibold">No smart rooms yet</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Connect an existing room to a Wokwi simulation or a real MQTT device. You get a device ID and key to paste into it.
                    </p>
                    <Button className="mt-2 gap-2" onClick={() => setConnectOpen(true)} disabled={facilities.length === 0}>
                      <Plus className="h-4 w-4" /> Connect a room
                    </Button>
                  </CardContent>
                </Card>
              ) : shownFacilities.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">Nothing matches. Try another type or search.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {shownFacilities.map((f, fi) => {
                    const d = deviceOf(f.id)!;
                    const st = seen(d);
                    const busy = inUse.has(f.id);
                    const off = f.status !== "active";
                    const today = todayRes.filter((r) => r.facility_id === f.id).length;
                    const openRoom = () => { setOpenFac(f.id); window.scrollTo({ top: 0, behavior: "smooth" }); };
                    return (
                      <Card key={f.id} style={stagger(fi)}
                        className={`animate-reveal stagger group flex flex-col gap-0 overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-md ${off ? "opacity-75" : ""}`}>
                        <button onClick={openRoom} className="relative h-32 bg-muted/40 text-left" aria-label={`Open ${f.name}`}>
                          <div className={off ? "h-full grayscale" : "h-full"}><FacilityIso type={f.type} busy={busy} /></div>
                          <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium shadow">
                            {off ? f.status : busy ? "In use" : "Free now"}
                          </span>
                          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium shadow">
                            {d.connection === "mqtt" ? <CircuitBoard className="h-3 w-3 text-primary" /> : <Laptop className="h-3 w-3 text-primary" />}
                            {DEVICE_KIND[d.connection === "mqtt" ? "mqtt" : "wokwi"].title}
                          </span>
                        </button>
                        <div className="flex flex-1 flex-col gap-3 p-4">
                          <div>
                            <h3 className="font-display font-semibold leading-tight">{f.name}</h3>
                            <p className="pt-0.5 text-xs text-muted-foreground">{f.venue} · {typeLabel(f.type)}</p>
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${st.online ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                              <span className={st.online ? "font-medium" : "text-muted-foreground"}>{st.text}</span>
                            </span>
                            <span className="flex items-center gap-1 text-muted-foreground"><CalendarRange className="h-3.5 w-3.5" /> {today} today</span>
                          </div>
                          <div className="mt-auto flex gap-2">
                            <Button variant="outline" className="flex-1 gap-2" onClick={openRoom}>
                              Live view <ArrowRight className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" aria-label={`Device actions for ${f.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setRekey(d)}><KeyRound className="h-4 w-4" /> New device key</DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => disconnect(d)}>
                                  <Unplug className="h-4 w-4" /> Disconnect
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
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

          {tab === "facilities" && (
            <AdminFacilities key="fac" categories={categories} facilities={facilities} rules={rules}
              fmRows={fmRows} managers={managers} inUse={inUse} reload={load} />
          )}

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
