"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Facility } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

interface Res {
  facility_id: string;
  start_time: string;
  created_at: string;
  status: string;
  participants: number;
  checked_in_at: string | null;
  no_show: boolean;
}

const HOUR_LABEL = (h: number) =>
  h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const STATUS_COLOR: Record<string, string> = {
  approved: "var(--chart-4)", pending: "var(--chart-3)",
  rejected: "var(--destructive)", cancelled: "var(--chart-5)",
};

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-display pt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AdminAnalytics() {
  const [res, setRes] = useState<Res[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [evalEvents, setEvalEvents] = useState<{ kind: string; bool_value: boolean | null }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: r }, { data: f }, { data: ev }] = await Promise.all([
        supabase.from("reservations").select("facility_id,start_time,created_at,status,participants,checked_in_at,no_show"),
        supabase.from("facilities_full").select("*"),
        supabase.from("evaluation_events").select("kind,bool_value"),
      ]);
      setRes((r as Res[]) ?? []);
      setFacilities((f as Facility[]) ?? []);
      setEvalEvents((ev as { kind: string; bool_value: boolean | null }[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const evalMetrics = useMemo(() => {
    const shown = evalEvents.filter((e) => e.kind === "rec_shown").length;
    const accepted = evalEvents.filter((e) => e.kind === "rec_accepted").length;
    const acceptRate = shown ? Math.round((accepted / shown) * 100) : null;
    const feedback = evalEvents.filter((e) => e.kind === "chat_feedback");
    const helpful = feedback.filter((e) => e.bool_value).length;
    const helpfulRate = feedback.length ? Math.round((helpful / feedback.length) * 100) : null;
    return { acceptRate, helpfulRate, feedbackCount: feedback.length };
  }, [evalEvents]);

  const fname = (id: string) => facilities.find((f) => f.id === id)?.name ?? "-";

  const kpis = useMemo(() => {
    const total = res.length;
    const approved = res.filter((r) => r.status === "approved").length;
    const decided = res.filter((r) => r.status === "approved" || r.status === "rejected").length;
    const rate = decided ? Math.round((approved / decided) * 100) : 0;
    const avgPax = total ? (res.reduce((s, r) => s + (r.participants || 0), 0) / total).toFixed(1) : "0";
    const byFac: Record<string, number> = {};
    res.forEach((r) => { byFac[r.facility_id] = (byFac[r.facility_id] ?? 0) + 1; });
    const busiest = Object.entries(byFac).sort((a, b) => b[1] - a[1])[0];
    // no-show rate: of approved bookings that have already started
    const elapsed = res.filter((r) => r.status === "approved" && new Date(r.start_time).getTime() <= Date.now());
    const noShows = elapsed.filter((r) => r.no_show).length;
    const noShowRate = elapsed.length ? Math.round((noShows / elapsed.length) * 100) : 0;
    return { total, rate, avgPax, busiest: busiest ? fname(busiest[0]) : "-", noShowRate };
  }, [res, facilities]);

  const daily = useMemo(() => {
    const days: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString([], { day: "2-digit", month: "short" });
      const count = res.filter((r) => r.created_at.slice(0, 10) === key).length;
      days.push({ date: label, count });
    }
    return days;
  }, [res]);

  const byFacility = useMemo(() => {
    const m: Record<string, number> = {};
    res.forEach((r) => { m[r.facility_id] = (m[r.facility_id] ?? 0) + 1; });
    return Object.entries(m)
      .map(([id, count]) => ({ name: fname(id), count }))
      .sort((a, b) => b.count - a.count).slice(0, 8);
  }, [res, facilities]);

  const byStatus = useMemo(() => {
    const m: Record<string, number> = {};
    res.forEach((r) => { m[r.status] = (m[r.status] ?? 0) + 1; });
    return Object.entries(m).map(([name, value]) => ({ name, value }));
  }, [res]);

  const byHour = useMemo(() => {
    const arr = Array.from({ length: 24 }, (_, h) => ({ hour: HOUR_LABEL(h), count: 0, h }));
    res.forEach((r) => { arr[new Date(r.start_time).getHours()].count++; });
    return arr.filter((x) => x.h >= 7 && x.h <= 22);
  }, [res]);

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-muted-foreground">Loading analytics...</div>;
  }
  if (res.length === 0) {
    return (
      <Card><CardContent className="py-16 text-center text-muted-foreground">
        No booking data yet. Charts appear once facilities start getting booked.
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total bookings" value={String(kpis.total)} />
        <Kpi label="Approval rate" value={`${kpis.rate}%`} />
        <Kpi label="No-show rate" value={`${kpis.noShowRate}%`} />
        <Kpi label="Avg. group size" value={kpis.avgPax} />
        <Kpi label="Busiest facility" value={kpis.busiest} />
      </div>

      <div className="rounded-xl border bg-muted/30 p-4">
        <p className="font-display text-sm font-semibold">AI evaluation metrics (for Phase 2)</p>
        <div className="grid gap-4 pt-3 sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Recommendation acceptance</p>
            <p className="font-display text-2xl font-semibold">
              {evalMetrics.acceptRate === null ? "-" : `${evalMetrics.acceptRate}%`}
            </p>
            <p className="text-xs text-muted-foreground">of shown suggestions booked</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Chatbot helpfulness</p>
            <p className="font-display text-2xl font-semibold">
              {evalMetrics.helpfulRate === null ? "-" : `${evalMetrics.helpfulRate}%`}
            </p>
            <p className="text-xs text-muted-foreground">rated helpful ({evalMetrics.feedbackCount} ratings)</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Status</p>
            <p className="pt-1 text-sm text-muted-foreground">
              Captured live from student use - export this table for the Phase 2 evaluation chapter.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Bookings over time</CardTitle>
            <CardDescription>New requests, last 14 days</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={daily} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={1} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Area type="monotone" dataKey="count" stroke="var(--primary)"
                  fill="var(--primary)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Peak hours</CardTitle>
            <CardDescription>When bookings start, across all facilities</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byHour} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={1} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="var(--chart-3)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Most-booked facilities</CardTitle>
            <CardDescription>Top facilities by total bookings</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byFacility} layout="vertical" margin={{ left: 40, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="count" fill="var(--chart-2)" radius={[0, 3, 3, 0]}>
                  {byFacility.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Booking status</CardTitle>
            <CardDescription>Breakdown of all requests</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {byStatus.map((s) => <Cell key={s.name} fill={STATUS_COLOR[s.name] ?? "var(--chart-5)"} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3 pt-1">
              {byStatus.map((s) => (
                <span key={s.name} className="flex items-center gap-1.5 text-xs capitalize">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s.name] ?? "var(--chart-5)" }} />
                  {s.name} ({s.value})
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
