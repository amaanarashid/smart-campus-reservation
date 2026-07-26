"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AppNotification } from "@/lib/types";
import { Bell, CheckCheck } from "lucide-react";

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const DOT: Record<string, string> = {
  booking_approved: "bg-green-500",
  booking_rejected: "bg-destructive",
  new_request: "bg-primary",
};

export default function NotificationBell() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [uid, setUid] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("notifications").select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(30);
    setItems((data as AppNotification[]) ?? []);
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUid(user.id);
      await load(user.id);
      timer = setInterval(() => load(user.id), 30000);
    })();
    return () => { if (timer) clearInterval(timer); };
  }, [load]);

  // close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const unread = items.filter((i) => !i.read).length;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0 && uid) {
      // mark all read when opening
      await supabase.from("notifications").update({ read: true }).eq("user_id", uid).eq("read", false);
      setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border bg-card shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="font-display text-sm font-semibold">Notifications</span>
            {items.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <CheckCheck className="h-3.5 w-3.5" /> up to date
              </span>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                No notifications yet
              </p>
            ) : (
              items.map((n) => (
                <div key={n.id} className="flex gap-3 border-b px-4 py-3 last:border-0">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[n.type] ?? "bg-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                    <p className="pt-0.5 text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
