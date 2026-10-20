"use client";

import { useState, type ComponentType } from "react";
import { supabase } from "@/lib/supabase";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Armchair, CircleHelp, Lightbulb, Loader2, Projector, Send, ShieldAlert, Snowflake, SprayCan, Volume2, Wrench,
} from "lucide-react";
import {
  MAX_DESCRIPTION, REPORT_CATEGORIES, REPORT_URGENCY, validateReport,
  type ReportCategory, type ReportUrgency,
} from "@/lib/reports";

export const CATEGORY_ICON: Record<ReportCategory, ComponentType<{ className?: string }>> = {
  cleanliness: SprayCan, aircon: Snowflake, lighting: Lightbulb, equipment: Wrench, av_wifi: Projector,
  furniture: Armchair, safety: ShieldAlert, noise: Volume2, other: CircleHelp,
};

/**
 * "Report a problem" for a room, opened from the student's booking. The
 * report goes to the room's facility managers (or the admins) at once.
 */
export default function ReportProblemDialog({ open, onOpenChange, facilityId, facilityName, reservationId, onSent }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityId: string;
  facilityName: string;
  reservationId: string | null;
  onSent: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [urgency, setUrgency] = useState<ReportUrgency>("normal");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);

  function reset() { setCategory(null); setUrgency("normal"); setDescription(""); }

  async function send() {
    const v = validateReport({ category: category ?? undefined, urgency, description });
    if (!v.ok) { toast.error(v.error); return; }
    setSending(true);
    // the database fills in the reporter from the login
    const { error } = await supabase.from("room_reports").insert({
      facility_id: facilityId, reservation_id: reservationId,
      category, urgency, description: description.trim(),
    });
    setSending(false);
    if (error) {
      toast.error(/room_reports/.test(error.message) && /exist|schema cache/.test(error.message)
        ? "Reporting is not set up yet (run upgrade-room-reports.sql)."
        : /row-level security/.test(error.message)
        ? "Could not send the report. Sign out and in again; if it keeps happening, run fix-room-reports-insert.sql."
        : error.message);
      return;
    }
    toast.success("Thanks - the facility team has been told");
    reset();
    onOpenChange(false);
    onSent();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">Report a problem</DialogTitle>
          <DialogDescription>
            Something wrong in {facilityName}? The facility team gets this straight away and you will be told when it is handled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="pb-2 text-xs font-medium">What is it about?</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(REPORT_CATEGORIES) as ReportCategory[]).map((c) => {
                const Icon = CATEGORY_ICON[c];
                const on = category === c;
                return (
                  <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={on}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-center text-[11px] leading-tight transition-colors ${
                      on ? "border-primary bg-accent text-accent-foreground" : "hover:bg-muted"}`}>
                    <Icon className="h-4 w-4" />
                    {REPORT_CATEGORIES[c]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="pb-2 text-xs font-medium">How urgent?</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(REPORT_URGENCY) as ReportUrgency[]).map((u) => (
                <button key={u} type="button" onClick={() => setUrgency(u)} aria-pressed={urgency === u}
                  className={`rounded-lg border px-2 py-2 text-[11px] leading-tight transition-colors ${
                    urgency === u
                      ? u === "urgent" ? "border-destructive bg-destructive/10 text-destructive" : "border-primary bg-accent text-accent-foreground"
                      : "hover:bg-muted"}`}>
                  {REPORT_URGENCY[u]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="pb-2 text-xs font-medium">What happened?</p>
            <Textarea value={description} maxLength={MAX_DESCRIPTION} rows={4}
              placeholder="e.g. The air-con is on but blowing warm air"
              onChange={(e) => setDescription(e.target.value)} />
            <p className="pt-1 text-right text-[11px] text-muted-foreground">{description.trim().length}/{MAX_DESCRIPTION}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancel</Button>
          <Button className="gap-1.5" onClick={send} disabled={sending || !category}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
