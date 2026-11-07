"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { DEFAULT_THRESHOLD, labelOf, type CalBin, type Scores } from "@/lib/noshow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Loader2, RefreshCw, UserX } from "lucide-react";

interface ModelRow {
  version: number;
  mode: "baseline" | "logreg";
  threshold: number;
  trained_at: string;
  n_train: number;
  metrics: {
    n_test?: number;
    n_noshow?: number;
    test?: { logreg: Scores | null; baseline: Scores; campus: Scores; user_rate: Scores; category: Scores };
  };
}
interface RiskRow { reservation_id: string; reminded_at: string | null }
interface ResRow { id: string; start_time: string; end_time: string; no_show: boolean; checked_in_at: string | null }

const TIP = { fontSize: 12, borderRadius: 8, background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)" };
const fmt = (x: number | null | undefined, d = 3) => (x == null ? "-" : x.toFixed(d));
const pct = (x: number | null) => (x == null ? "-" : `${Math.round(x * 100)}%`);

/** No-show rate among finished, labelled bookings that started in [from, to). */
function rate(rows: ResRow[], from: number, to: number, nowMs: number): { n: number; rate: number | null } {
  const ys = rows
    .filter((r) => { const s = new Date(r.start_time).getTime(); return s >= from && s < to && new Date(r.end_time).getTime() <= nowMs; })
    .map(labelOf).filter((y): y is 0 | 1 => y !== null);
  return { n: ys.length, rate: ys.length ? ys.reduce<number>((a, b) => a + b, 0) / ys.length : null };
}

/** Admin Analytics: the no-show model, how well it predicts, and the reminders' effect. */
export default function NoShowCard() {
  const [model, setModel] = useState<ModelRow | null>(null);
  const [risks, setRisks] = useState<RiskRow[]>([]);
  const [res, setRes] = useState<ResRow[]>([]);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    (async () => {
      const [{ data: m, error }, { data: br }, { data: r }] = await Promise.all([
        supabase.from("noshow_model").select("version,mode,threshold,trained_at,n_train,metrics")
          .order("version", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("booking_risk").select("reservation_id,reminded_at"),
        supabase.from("reservations").select("id,start_time,end_time,no_show,checked_in_at"),
      ]);
      setMissing(!!error);
      setModel((m as ModelRow | null) ?? null);
      setRisks((br as RiskRow[]) ?? []);
      setRes((r as ResRow[]) ?? []);
      setNowMs(Date.now());
      setLoading(false);
    })();
  }, [reload]);

  async function retrain() {
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/noshow/retrain", {
        method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      });
      const body = await r.json();
      if (!body.ok) toast.error(body.error ?? "Retrain failed");
      else {
        (body.stored ? toast.success : toast.info)(`${body.note} (${body.labelled} labelled bookings, ${body.no_shows} no-shows)`);
        setReload((x) => x + 1);
      }
    } catch {
      toast.error("Could not reach the server");
    }
    setBusy(false);
  }

  if (loading) return null;

  const mode = model?.mode ?? "baseline";
  const threshold = model?.threshold ?? DEFAULT_THRESHOLD;
  const test = model?.metrics.test;
  const rows: [string, Scores | null | undefined][] = [
    ["Logistic model", test?.logreg], ["Cold-start baseline", test?.baseline], ["Student rate only", test?.user_rate],
    ["Room type rate", test?.category], ["Campus rate", test?.campus],
  ];
  const cal = ((mode === "logreg" ? test?.logreg?.calibration : test?.baseline?.calibration) ?? [])
    .filter((b: CalBin) => b.n > 0).map((b: CalBin) => ({ p: b.mean_p, observed: b.rate, n: b.n }));

  // before vs after reminders started (not a controlled experiment: other things change too)
  const reminded = risks.filter((r) => r.reminded_at).map((r) => new Date(r.reminded_at!).getTime());
  const firstReminder = reminded.length ? Math.min(...reminded) : null;
  const before = firstReminder ? rate(res, 0, firstReminder, nowMs) : rate(res, 0, Infinity, nowMs);
  const after = firstReminder ? rate(res, firstReminder, Infinity, nowMs) : null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="font-display flex items-center gap-2 text-lg">
            <UserX className="h-5 w-5 text-primary" /> No-show prediction
            <Badge variant={mode === "logreg" ? "default" : "secondary"}>{mode === "logreg" ? "logistic model" : "baseline"}</Badge>
          </CardTitle>
          <CardDescription>
            Sends one &ldquo;Still coming?&rdquo; reminder for high-risk bookings and shows managers a badge.
            It never blocks, penalises or cancels anyone.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || missing} onClick={retrain}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retrain
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {missing ? (
          <p className="text-sm text-muted-foreground">Not set up yet - run <code>supabase/upgrade-noshow.sql</code>.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Version</p>
                <p className="font-display text-2xl font-semibold">{model ? `v${model.version}` : "-"}</p>
                <p className="text-xs text-muted-foreground">
                  {model ? `trained ${new Date(model.trained_at).toLocaleDateString([], { day: "2-digit", month: "short" })}` : "not trained yet"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Training size</p>
                <p className="font-display text-2xl font-semibold">{model?.n_train ?? 0}</p>
                <p className="text-xs text-muted-foreground">labelled bookings{model?.metrics.n_noshow != null ? `, ${model.metrics.n_noshow} no-shows` : ""}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Reminder threshold</p>
                <p className="font-display text-2xl font-semibold">{pct(threshold)}</p>
                <p className="text-xs text-muted-foreground">{reminded.length} reminders sent</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">No-show rate before / after</p>
                <p className="font-display text-2xl font-semibold">{pct(before.rate)} / {after ? pct(after.rate) : "-"}</p>
                <p className="text-xs text-muted-foreground">
                  {after ? `${before.n} vs ${after.n} bookings; not a controlled test` : "no reminders sent yet"}
                </p>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <p className="pb-2 text-sm font-medium">Test set (newest 20%{test ? `, ${model?.metrics.n_test} bookings` : ""})</p>
                {!test ? (
                  <p className="text-sm text-muted-foreground">Press Retrain to score the model against the baselines.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="pb-1 font-medium">Predictor</th><th className="pb-1 font-medium">AUC ↑</th><th className="pb-1 font-medium">Brier ↓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(([name, s]) => (
                        <tr key={name} className="border-t">
                          <td className="py-1.5">{name}</td>
                          <td className="py-1.5 tabular-nums">{fmt(s?.auc)}</td>
                          <td className="py-1.5 tabular-nums">{fmt(s?.brier, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="pt-2 text-xs text-muted-foreground">
                  AUC: how well it ranks no-shows above shows (0.5 = guessing). Brier: average squared error of p.
                  The model is used only when there are 200+ labelled bookings and 20+ no-shows, and only if it beats the student-rate baseline.
                </p>
              </div>
              <div>
                <p className="pb-2 text-sm font-medium">Calibration ({mode === "logreg" ? "logistic model" : "baseline"})</p>
                {cal.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Appears after the first retrain with a test set.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={cal} margin={{ left: -16, right: 12, top: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" dataKey="p" domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                      <YAxis domain={[0, 1]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                      <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                      <Tooltip contentStyle={TIP} formatter={(v) => pct(Number(v))} labelFormatter={(v) => `predicted ${pct(Number(v))}`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="observed" name="observed no-show rate" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
