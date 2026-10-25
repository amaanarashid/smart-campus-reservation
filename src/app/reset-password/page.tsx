"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ensureProfile } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampusIcon } from "@/components/campus-icon";
import ThemeToggle from "@/components/theme-toggle";
import { KeyRound, Loader2 } from "lucide-react";

const ROLE_ROUTES: Record<string, string> = { student: "/student", facility_manager: "/facility-manager", admin: "/admin" };

/**
 * Opened from the "reset password" email. Supabase reads the recovery token
 * from the link and signs this tab in for the recovery; the person then
 * chooses a new password and goes to their dashboard.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "invalid">("checking");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) { done = true; setState("ready"); }
    });
    // the token may already have been read before we subscribed
    supabase.auth.getSession().then(({ data }) => { if (data.session) { done = true; setState("ready"); } });
    const t = setTimeout(() => { if (!done) setState("invalid"); }, 4000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  async function save() {
    setError(null);
    if (pw.length < 6) { setError("Use at least 6 characters."); return; }
    if (pw !== pw2) { setError("The two passwords don't match."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); setError(error.message); return; }
    const profile = await ensureProfile();
    router.replace(ROLE_ROUTES[profile?.role ?? "student"] ?? "/student");
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-6">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/70 to-primary" />
      <div className="w-full max-w-sm animate-auth-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg"><CampusIcon className="h-7 w-7" /></span>
          <span className="font-display text-lg font-semibold">Campus Reserve</span>
        </div>
        <h1 className="font-display text-2xl font-semibold">Choose a new password</h1>

        {state === "checking" && (
          <p className="flex items-center gap-2 pt-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your link...</p>
        )}

        {state === "invalid" && (
          <div className="space-y-4 pt-3">
            <p className="text-sm text-muted-foreground">
              This reset link has expired or was already used. Ask for a new one from the sign-in page.
            </p>
            <Button className="w-full" onClick={() => router.replace("/login")}>Back to sign in</Button>
          </div>
        )}

        {state === "ready" && (
          <div className="space-y-3 pt-4">
            <Input type="password" placeholder="New password (min 6 chars)" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            <Input type="password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && save()} />
            <Button className="w-full gap-2" onClick={save} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Save new password
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
