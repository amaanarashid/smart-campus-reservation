"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Facility, Profile, Reservation, Equipment, typeLabel,
  LostFoundItem, LostFoundCategory, LostFoundStatus, LOST_FOUND_CATEGORIES,
} from "@/lib/types";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast, Toaster } from "sonner";
import AppShell from "@/components/app-shell";
import { ensureProfile } from "@/lib/profile";

interface Row extends Reservation {
  profiles: { full_name: string } | null;
}

export default function ManagerDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [pending, setPending] = useState<Row[]>([]);
  const [upcoming, setUpcoming] = useState<Row[]>([]);

  const [equipByRes, setEquipByRes] = useState<Record<string, string>>({});
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [newEquip, setNewEquip] = useState({ type: "", name: "", qty: 1 });

  const [lostItems, setLostItems] = useState<LostFoundItem[]>([]);
  const [lfFilter, setLfFilter] = useState<"all" | LostFoundStatus>("unclaimed");
  const emptyLf = {
    facility_id: "", item_name: "", category: "other" as LostFoundCategory,
    description: "", found_location: "", found_date: new Date().toISOString().slice(0, 10),
    reporter_name: "",
  };
  const [newLf, setNewLf] = useState({ ...emptyLf });

  const load = useCallback(async (prof: Profile) => {
    const { data: f } = await supabase.from("facilities_full").select("*").order("name");
    const facs = (f as Facility[]) ?? [];
    setFacilities(facs);

    // scope: admins see everything; managers only their assigned facilities
    let ids: string[];
    if (prof.role === "admin") {
      ids = facs.map((x) => x.id);
    } else {
      const { data: fm } = await supabase
        .from("facility_managers").select("facility_id").eq("manager_id", prof.id);
      ids = (fm ?? []).map((x) => x.facility_id);
    }
    setAssignedIds(ids);

    if (ids.length === 0) {
      setPending([]); setUpcoming([]); setEquipment([]); setEquipByRes({});
      return;
    }

    const { data: p } = await supabase
      .from("reservations").select("*, profiles(full_name)")
      .eq("status", "pending").in("facility_id", ids).order("start_time");
    setPending((p as Row[]) ?? []);
    // requested equipment per pending reservation
    const resIds = (p ?? []).map((x) => x.id);
    if (resIds.length > 0) {
      const { data: re } = await supabase
        .from("reservation_equipment")
        .select("reservation_id, qty, equipment(name)")
        .in("reservation_id", resIds);
      const m: Record<string, string> = {};
      (re as { reservation_id: string; qty: number; equipment: { name: string } | null }[] | null)?.forEach((x) => {
        const label = `${x.qty}x ${x.equipment?.name ?? "item"}`;
        m[x.reservation_id] = m[x.reservation_id] ? `${m[x.reservation_id]}, ${label}` : label;
      });
      setEquipByRes(m);
    } else setEquipByRes({});

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { data: u } = await supabase
      .from("reservations").select("*, profiles(full_name)")
      .eq("status", "approved").in("facility_id", ids)
      .gte("start_time", todayStart.toISOString())
      .order("start_time").limit(30);
    setUpcoming((u as Row[]) ?? []);

    // equipment for my facility categories
    const myTypes = Array.from(new Set(facs.filter((x) => ids.includes(x.id)).map((x) => x.type)));
    const { data: eq } = await supabase
      .from("equipment").select("*").in("facility_type", myTypes).order("name");
    setEquipment((eq as Equipment[]) ?? []);

    // lost & found for my facilities
    const { data: lf } = await supabase
      .from("lost_and_found").select("*").in("facility_id", ids)
      .order("created_at", { ascending: false });
    setLostItems((lf as LostFoundItem[]) ?? []);
  }, []);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const prof = await ensureProfile();
      if (!prof) { router.push("/login"); return; }
      if (prof.role !== "facility_manager" && prof.role !== "admin") { router.push("/login"); return; }
      setProfile(prof);
      await load(prof);
      setLoading(false);
    })();
  }, [router, load]);

  async function decide(r: Reservation, status: "approved" | "rejected") {
    const { error } = await supabase.from("reservations").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Request ${status}`);
    if (profile) await load(profile);
  }

  async function markAttendance(r: Reservation, kind: "checked_in" | "no_show") {
    const patch = kind === "checked_in"
      ? { checked_in_at: new Date().toISOString(), no_show: false }
      : { no_show: true };
    const { error } = await supabase.from("reservations").update(patch).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success(kind === "checked_in" ? "Marked as attended" : "Marked as no-show");
    if (profile) await load(profile);
  }

  async function saveQty(e: Equipment, qty: number) {
    const { error } = await supabase.from("equipment").update({ total_qty: qty }).eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${e.name}: ${qty} in inventory`);
    if (profile) await load(profile);
  }

  async function addEquipment() {
    if (!newEquip.type || !newEquip.name) { toast.error("Category and item name required"); return; }
    const { error } = await supabase.from("equipment").insert({
      facility_type: newEquip.type, name: newEquip.name, total_qty: newEquip.qty,
    });
    if (error) { toast.error(error.message); return; }
    setNewEquip({ type: "", name: "", qty: 1 });
    if (profile) await load(profile);
  }

  async function logLostItem() {
    if (!newLf.facility_id || !newLf.item_name) {
      toast.error("Facility and item name are required"); return;
    }
    const { error } = await supabase.from("lost_and_found").insert({
      facility_id: newLf.facility_id,
      item_name: newLf.item_name,
      category: newLf.category,
      description: newLf.description || null,
      found_location: newLf.found_location || null,
      found_date: newLf.found_date,
      reporter_name: newLf.reporter_name || null,
      logged_by: profile?.id ?? null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Item logged to lost & found");
    setNewLf({ ...emptyLf });
    if (profile) await load(profile);
  }

  async function setLfStatus(item: LostFoundItem, status: LostFoundStatus) {
    let patch: Partial<LostFoundItem> = { status };
    if (status === "claimed") {
      const name = window.prompt("Claimant name:");
      if (name === null) return;
      const contact = window.prompt("Claimant contact (email or phone):") ?? "";
      patch = { status, claimant_name: name || null, claimant_contact: contact || null };
    }
    const { error } = await supabase.from("lost_and_found").update(patch).eq("id", item.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marked ${status}`);
    if (profile) await load(profile);
  }

  const myTypes = Array.from(
    new Set(facilities.filter((f) => assignedIds.includes(f.id)).map((f) => f.type))
  );
  const myFacilities = facilities.filter((f) => assignedIds.includes(f.id));
  const fLabel = (id: string) => facilities.find((f) => f.id === id)?.name ?? "-";
  const filteredLost = lfFilter === "all" ? lostItems : lostItems.filter((i) => i.status === lfFilter);
  const LF_STATUS_COLOR: Record<LostFoundStatus, "default" | "secondary" | "destructive" | "outline"> = {
    unclaimed: "secondary", claimed: "default", returned: "outline", disposed: "destructive",
  };

  const fname = (id: string) => facilities.find((f) => f.id === id)?.name ?? "-";
  const fmt = (s: string) => new Date(s).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

  return (
    <AppShell
      title="Facility Management"
      subtitle="Review booking requests and monitor upcoming reservations"
      role="facility_manager"
      userName={profile?.full_name}
    >
      <Toaster richColors />
      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">Loading...</div>
      ) : assignedIds.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
          <p className="font-medium">No facilities assigned to you yet</p>
          <p className="text-sm text-muted-foreground">
            Ask an administrator to assign you to a facility - your approval queue and
            equipment inventory will appear here.
          </p>
        </div>
      ) : (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Approval queue</CardTitle>
            <CardDescription>{pending.length} request(s) waiting</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead><TableHead>Requested by</TableHead>
                  <TableHead>When</TableHead><TableHead>Pax</TableHead>
                  <TableHead>Purpose</TableHead><TableHead>Equipment</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fname(r.facility_id)}</TableCell>
                    <TableCell>{r.profiles?.full_name ?? "-"}</TableCell>
                    <TableCell>{fmt(r.start_time)}</TableCell>
                    <TableCell>{r.participants}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{r.purpose ?? "-"}</TableCell>
                    <TableCell className="max-w-[160px] text-xs text-muted-foreground">{equipByRes[r.id] ?? "-"}</TableCell>
                    <TableCell className="space-x-2 whitespace-nowrap">
                      <Button size="sm" onClick={() => decide(r, "approved")}>Approve</Button>
                      <Button size="sm" variant="outline" onClick={() => decide(r, "rejected")}>Reject</Button>
                    </TableCell>
                  </TableRow>
                ))}
                {pending.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-muted-foreground">Queue is empty</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today &amp; upcoming</CardTitle>
            <CardDescription>Approved bookings - track attendance for sessions that have started</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Facility</TableHead><TableHead>Booked by</TableHead>
                  <TableHead>When</TableHead><TableHead>Attendance</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {upcoming.map((r) => {
                  const started = new Date(r.start_time).getTime() <= Date.now();
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{fname(r.facility_id)}</TableCell>
                      <TableCell>{r.profiles?.full_name ?? "-"}</TableCell>
                      <TableCell>{fmt(r.start_time)}</TableCell>
                      <TableCell>
                        {r.checked_in_at ? <Badge>checked in</Badge>
                          : r.no_show ? <Badge variant="destructive">no-show</Badge>
                          : started ? <Badge variant="secondary">awaiting</Badge>
                          : <span className="text-xs text-muted-foreground">not started</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {started && !r.checked_in_at && !r.no_show && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => markAttendance(r, "checked_in")}>
                              Mark attended
                            </Button>
                            <Button size="sm" variant="ghost" className="ml-1 text-destructive"
                              onClick={() => markAttendance(r, "no_show")}>No-show</Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {upcoming.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-muted-foreground">Nothing today or upcoming</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipment inventory</CardTitle>
            <CardDescription>
              Items for your facility categories ({myTypes.map(typeLabel).join(", ") || "none"}).
              Edit a quantity and press Enter to save.
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
                {equipment.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-muted-foreground">No equipment yet</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <div className="grid gap-2 sm:grid-cols-4">
              <Select value={newEquip.type} onValueChange={(v) => setNewEquip({ ...newEquip, type: v })}>
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {myTypes.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
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

        {/* lost & found */}
        <Card className="animate-reveal" style={{ animationDelay: "120ms" }}>
          <CardHeader>
            <CardTitle className="font-display">Lost &amp; found</CardTitle>
            <CardDescription>
              Log items handed in at your facilities and track them until they are claimed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* log form */}
            <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-3">
              <Select value={newLf.facility_id} onValueChange={(v) => setNewLf({ ...newLf, facility_id: v })}>
                <SelectTrigger><SelectValue placeholder="Found at facility" /></SelectTrigger>
                <SelectContent>
                  {myFacilities.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Item (e.g. black wallet)" value={newLf.item_name}
                onChange={(e) => setNewLf({ ...newLf, item_name: e.target.value })} />
              <Select value={newLf.category} onValueChange={(v) => setNewLf({ ...newLf, category: v as LostFoundCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOST_FOUND_CATEGORIES) as LostFoundCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{LOST_FOUND_CATEGORIES[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Where exactly (e.g. under table 3)" value={newLf.found_location}
                onChange={(e) => setNewLf({ ...newLf, found_location: e.target.value })} />
              <Input type="date" value={newLf.found_date}
                onChange={(e) => setNewLf({ ...newLf, found_date: e.target.value })} />
              <Input placeholder="Handed in by (optional)" value={newLf.reporter_name}
                onChange={(e) => setNewLf({ ...newLf, reporter_name: e.target.value })} />
              <Textarea className="sm:col-span-2" placeholder="Description / distinguishing details (optional)"
                value={newLf.description} onChange={(e) => setNewLf({ ...newLf, description: e.target.value })} />
              <Button onClick={logLostItem}>Log item</Button>
            </div>

            {/* filter */}
            <div className="flex flex-wrap gap-1.5">
              {(["unclaimed", "claimed", "returned", "disposed", "all"] as const).map((s) => (
                <button key={s}
                  className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                    lfFilter === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                  onClick={() => setLfFilter(s)}>
                  {s}
                </button>
              ))}
            </div>

            {/* list */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead><TableHead>Facility</TableHead>
                  <TableHead>Found</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLost.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <span className="font-medium">{i.item_name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {LOST_FOUND_CATEGORIES[i.category]}
                        {i.found_location ? ` - ${i.found_location}` : ""}
                        {i.claimant_name ? ` - claimed by ${i.claimant_name}` : ""}
                      </span>
                    </TableCell>
                    <TableCell>{fLabel(i.facility_id)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(i.found_date).toLocaleDateString([], { day: "2-digit", month: "short" })}
                    </TableCell>
                    <TableCell><Badge variant={LF_STATUS_COLOR[i.status]}>{i.status}</Badge></TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap">
                      {i.status === "unclaimed" && (
                        <>
                          <Button size="sm" onClick={() => setLfStatus(i, "claimed")}>Claimed</Button>
                          <Button size="sm" variant="outline" onClick={() => setLfStatus(i, "disposed")}>Dispose</Button>
                        </>
                      )}
                      {i.status === "claimed" && (
                        <Button size="sm" variant="outline" onClick={() => setLfStatus(i, "returned")}>Mark returned</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredLost.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-muted-foreground">No items in this view</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </>
      )}
    </AppShell>
  );
}
