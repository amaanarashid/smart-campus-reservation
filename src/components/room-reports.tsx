"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, CircleCheck, Loader2, MessageSquareWarning, Play, X } from "lucide-react";
import { CATEGORY_ICON } from "@/components/report-problem-dialog";
import {
  REPORT_CATEGORIES, REPORT_STATUS, isOpen, sortForInbox, waitingFor,
  type ReportStatus, type RoomReport,
} from "@/lib/reports";
import { fmtRelativeDay, fmtTime, myDateKey } from "@/lib/time";

interface Row extends RoomReport {
  profiles: { full_name: string } | null;
  facilities: { name: string; venue: string } | null;
}

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
const FILTERS = [["active", "Open"], ["resolved", "Resolved"], ["dismissed", "Dismissed"], ["all", "All"]] as const;

/**
 * Room problems reported by students. The database decides what each person
 * sees: a facility manager gets the reports for the rooms they manage, an
 * admin gets every report. `facilityId` narrows it to one room.
 */
export default function RoomReports({ facilityId, onActiveCount, compact = false }: {
  facilityId?: string | null;
  onActiveCount?: (n: number) => void;
  compact?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("active");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  // keep the latest callback without making `load` change on every parent render
  const countCb = useRef(onActiveCount);
  useEffect(() => { countCb.current = onActiveCount; }, [onActiveCount]);

  const load = useCallback(async () => {
    // plain query, then names and rooms separately: no reliance on embedded joins
    const { data, error } = await supabase.from("room_reports")
      .select("*").order("created_at", { ascending: false }).limit(300);
    if (error) {
      const missing = /room_reports/.test(error.message) && /exist|schema cache|not find/.test(error.message);
      setErrorText(error.message);
      setState(missing ? "missing" : "error");
      return;
    }
    const reports = (data as RoomReport[]) ?? [];
    const userIds = Array.from(new Set(reports.map((r) => r.reporter_id)));
    const facIds = Array.from(new Set(reports.map((r) => r.facility_id)));
    const [{ data: people }, { data: facs }] = await Promise.all([
      userIds.length ? supabase.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
      facIds.length ? supabase.from("facilities_full").select("id, name, venue").in("id", facIds) : Promise.resolve({ data: [] }),
    ]);
    const nameOf = new Map(((people as { id: string; full_name: string }[] | null) ?? []).map((p) => [p.id, p.full_name]));
    const facOf = new Map(((facs as { id: string; name: string; venue: string }[] | null) ?? []).map((f) => [f.id, f]));
    const list: Row[] = reports.map((r) => ({
      ...r,
      profiles: nameOf.has(r.reporter_id) ? { full_name: nameOf.get(r.reporter_id)! } : null,
      facilities: facOf.get(r.facility_id) ?? null,
    }));
    setRows(list);
    countCb.current?.(list.filter((r) => isOpen(r.status)).length);
    setNowMs(Date.now());
    setState("ready");
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  async function setStatus(r: Row, status: ReportStatus) {
    if (acting) return;
    const note = (notes[r.id] ?? r.staff_note ?? "").trim();
    if ((status === "resolved" || status === "dismissed") && !note) {
      toast.error("Add a short note for the student first (what was done, or why it was closed).");
      return;
    }
    setActing(r.id);
    const { error } = await supabase.from("room_reports").update({ status, staff_note: note || null }).eq("id", r.id);
    setActing(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Report marked ${REPORT_STATUS[status].toLowerCase()} - the student has been told`);
    await load();
  }

  const scoped = facilityId ? rows.filter((r) => r.facility_id === facilityId) : rows;
  const shown = sortForInbox(scoped.filter((r) =>
    filter === "all" ? true : filter === "active" ? isOpen(r.status) : r.status === filter));
  const activeCount = scoped.filter((r) => isOpen(r.status)).length;
  const now = new Date(nowMs || 0);

  return (
    <Card className="animate-reveal">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="font-display flex items-center gap-2">
              <MessageSquareWarning className="h-5 w-5 text-primary" /> Room problems reported
              {activeCount > 0 && <Badge className="ml-1">{activeCount}</Badge>}
            </CardTitle>
            <CardDescription>Students report problems from their booking; resolve them here and they are told</CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === k ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className={compact ? "max-h-[32rem] overflow-y-auto" : ""}>
        {state === "loading" ? (
          <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="skeleton h-24" />)}</div>
        ) : state === "error" ? (
          <p className="py-8 text-center text-sm text-destructive">Could not load reports: {errorText}</p>
        ) : state === "missing" ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Room reporting is not set up yet - run supabase/upgrade-room-reports.sql.
          </p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CircleCheck className="h-9 w-9 text-primary/60" />
            <p className="font-medium">{filter === "active" ? "No open problems" : "Nothing here"}</p>
            <p className="text-sm text-muted-foreground">Reports from students appear here as soon as they are sent.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((r, i) => {
              const Icon = CATEGORY_ICON[r.category];
              const open = isOpen(r.status);
              const created = new Date(r.created_at);
              return (
                <div key={r.id} style={stagger(i)}
                  className={`animate-reveal stagger rounded-xl border p-3 transition-all ${
                    r.urgency === "urgent" && open ? "border-destructive/50 bg-destructive/5" : open ? "bg-card" : "bg-muted/30"}`}>
                  <div className="flex flex-wrap items-start gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      r.urgency === "urgent" && open ? "bg-destructive text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        {REPORT_CATEGORIES[r.category]}
                        <span className="text-sm font-normal text-muted-foreground">· {r.facilities?.name ?? "Room"}</span>
                        {r.urgency === "urgent" && <Badge variant="destructive">urgent</Badge>}
                        {r.urgency === "low" && <Badge variant="outline">low</Badge>}
                        <Badge variant={r.status === "resolved" ? "default" : r.status === "open" ? "secondary" : "outline"}>
                          {REPORT_STATUS[r.status]}
                        </Badge>
                      </p>
                      <p className="pt-1 text-sm">&ldquo;{r.description}&rdquo;</p>
                      <p className="pt-1 text-xs text-muted-foreground">
                        {r.profiles?.full_name ?? "A student"} · {fmtRelativeDay(myDateKey(created), now)}, {fmtTime(created)}
                        {open && ` · waiting ${waitingFor(r.created_at, nowMs)}`}
                      </p>
                      {!open && r.staff_note && (
                        <p className="pt-1 text-xs"><span className="font-medium">Note to student:</span> {r.staff_note}</p>
                      )}
                    </div>
                  </div>
                  {open && (
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                      <Input className="h-8 min-w-[12rem] flex-1 text-xs" maxLength={1000}
                        placeholder="Note for the student, e.g. Technician coming at 3pm"
                        defaultValue={r.staff_note ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                      {r.status === "open" && (
                        <Button size="sm" variant="outline" className="gap-1" disabled={!!acting} onClick={() => setStatus(r, "in_progress")}>
                          <Play className="h-3.5 w-3.5" /> Start
                        </Button>
                      )}
                      <Button size="sm" className="gap-1" disabled={!!acting} onClick={() => setStatus(r, "resolved")}>
                        {acting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Resolve
                      </Button>
                      <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" disabled={!!acting} onClick={() => setStatus(r, "dismissed")}>
                        <X className="h-3.5 w-3.5" /> Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
