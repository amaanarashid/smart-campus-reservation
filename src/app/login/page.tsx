"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Role } from "@/lib/types";
import { ensureProfile } from "@/lib/profile";
import { CampusIcon } from "@/components/campus-icon";
import {
  CalendarCheck, Sparkles, Trophy, Volleyball, GraduationCap, Building2,
} from "lucide-react";

const ROLE_ROUTES: Record<string, string> = {
  student: "/student",
  facility_manager: "/facility-manager",
  admin: "/admin",
};

const FLOATERS = [
  { Icon: CalendarCheck, cls: "left-[12%] top-[18%]", delay: "0s", size: "h-7 w-7" },
  { Icon: Trophy, cls: "right-[16%] top-[26%]", delay: "1.2s", size: "h-9 w-9" },
  { Icon: GraduationCap, cls: "left-[20%] bottom-[24%]", delay: "2.1s", size: "h-8 w-8" },
  { Icon: Volleyball, cls: "right-[22%] bottom-[20%]", delay: "0.6s", size: "h-6 w-6" },
  { Icon: Building2, cls: "left-[44%] top-[12%]", delay: "1.8s", size: "h-7 w-7" },
];

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(m: "signin" | "signup") {
    setMode(m); setError(null); setNotice(null);
  }

  async function signIn() {
    setBusy(true); setError(null); setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setBusy(false); return; }
    const profile = await ensureProfile();
    router.push(ROLE_ROUTES[profile?.role ?? "student"] ?? "/student");
  }

  // TEMPORARY: one-tap demo login. Creates the demo account on first use,
  // elevates it via the scoped claim_demo_role function, then signs in.
  // Remove before production.
  async function quickLogin(demoRole: Role) {
    setBusy(true); setError(null); setNotice(null);
    const creds = { email: `${demoRole}@demo.campus`, password: "demo1234" };
    let res = await supabase.auth.signInWithPassword(creds);
    if (res.error) {
      const signUp = await supabase.auth.signUp({
        ...creds,
        options: { data: { full_name: `Demo ${demoRole.replace("_", " ")}` } },
      });
      if (signUp.error) { setError(signUp.error.message); setBusy(false); return; }
      if (!signUp.data.session) {
        setNotice("Demo accounts need email confirmation OFF in Supabase (Auth -> Providers -> Email).");
        setBusy(false); return;
      }
      res = await supabase.auth.signInWithPassword(creds);
      if (res.error) { setError(res.error.message); setBusy(false); return; }
    }
    await ensureProfile();
    // elevate the demo account to its role (no-op for student)
    await supabase.rpc("claim_demo_role", { demo_role: demoRole });
    router.push(ROLE_ROUTES[demoRole]);
  }

  async function signUp() {
    setBusy(true); setError(null); setNotice(null);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: { full_name: fullName || email.split("@")[0] } },
    });
    if (error || !data.user) { setError(error?.message ?? "Sign up failed"); setBusy(false); return; }
    if (!data.session) {
      setNotice("Account created. Check your email for a confirmation link, then sign in.");
      setBusy(false);
      return;
    }
    await ensureProfile();
    router.push("/student");
  }

  const isSignup = mode === "signup";

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ---------- brand panel ---------- */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/80 lg:block">
        {/* animated blobs */}
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-blob" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-white/10 blur-3xl animate-blob [animation-delay:5s]" />
        <div className="pattern-dots absolute inset-0" aria-hidden />

        {/* floating facility icons */}
        {FLOATERS.map(({ Icon, cls, delay, size }, i) => (
          <div key={i}
            className={`absolute ${cls} flex items-center justify-center rounded-2xl bg-white/10 p-3 text-white/80 backdrop-blur-sm animate-float-y`}
            style={{ animationDelay: delay }}>
            <Icon className={size} />
          </div>
        ))}

        {/* copy */}
        <div className="relative flex h-full flex-col justify-between p-12 text-primary-foreground">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 shadow-lg"><CampusIcon className="h-6 w-6" /></span>
            <span className="font-display text-lg font-semibold">Campus Reserve</span>
          </div>
          <div className="max-w-md">
            <h1 className="font-display text-4xl font-semibold leading-tight">
              Every campus space, one tap away.
            </h1>
            <p className="pt-4 text-primary-foreground/80">
              Book discussion rooms, courts, and halls with AI-recommended slots -
              and skip the counter queue for good.
            </p>
            <div className="flex flex-wrap gap-2 pt-6">
              {["AI slot suggestions", "Live availability", "Instant booking"].map((t) => (
                <span key={t} className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs">
                  {t}
                </span>
              ))}
            </div>
          </div>
          <p className="text-xs text-primary-foreground/60">
            Smart campus facility reservation
          </p>
        </div>
      </div>

      {/* ---------- form panel ---------- */}
      <div className="relative flex items-center justify-center bg-background p-6">
        {/* mobile brand */}
        <div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-r from-primary via-primary/70 to-primary" />

        <div key={mode} className="w-full max-w-sm animate-auth-in">
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <span className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg"><CampusIcon className="h-7 w-7" /></span>
            <span className="font-display text-lg font-semibold">Campus Reserve</span>
          </div>

          {/* segmented toggle */}
          <div className="relative mb-7 grid grid-cols-2 rounded-full border bg-muted/60 p-1 text-sm font-medium">
            <span
              className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-full bg-card shadow-sm transition-transform duration-300 ease-out"
              style={{ transform: isSignup ? "translateX(calc(100% + 0.5rem))" : "translateX(0)" }}
              aria-hidden
            />
            <button className={`relative z-10 rounded-full py-2 transition-colors ${!isSignup ? "text-foreground" : "text-muted-foreground"}`}
              onClick={() => switchMode("signin")}>
              Sign in
            </button>
            <button className={`relative z-10 rounded-full py-2 transition-colors ${isSignup ? "text-foreground" : "text-muted-foreground"}`}
              onClick={() => switchMode("signup")}>
              Sign up
            </button>
          </div>

          <div className="mb-6">
            <h2 className="font-display text-2xl font-semibold">
              {isSignup ? "Create your account" : "Welcome back"}
            </h2>
            <p className="pt-1 text-sm text-muted-foreground">
              {isSignup ? "Join to start booking campus facilities" : "Sign in to book campus facilities"}
            </p>
          </div>

          <div className="space-y-3">
            {isSignup && (
              <div className="animate-field-in" style={{ animationDelay: "0.05s" }}>
                <Input placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
            )}
            <div className="animate-field-in" style={{ animationDelay: isSignup ? "0.1s" : "0.05s" }}>
              <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="animate-field-in" style={{ animationDelay: isSignup ? "0.15s" : "0.1s" }}>
              <Input placeholder={isSignup ? "Password (min 6 chars)" : "Password"} type="password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && (isSignup ? signUp() : signIn())} />
            </div>
            <Button className="w-full gap-2 transition-transform active:scale-[0.98]"
              onClick={isSignup ? signUp : signIn} disabled={busy}>
              {busy ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                  {isSignup ? "Creating account..." : "Signing in..."}
                </>
              ) : (
                <>
                  {isSignup ? <Sparkles className="h-4 w-4" /> : <CalendarCheck className="h-4 w-4" />}
                  {isSignup ? "Create account" : "Sign in"}
                </>
              )}
            </Button>
          </div>

          {error && (
            <p className="animate-field-in pt-3 text-sm text-destructive">{error}</p>
          )}
          {notice && (
            <p className="animate-field-in pt-3 text-sm text-muted-foreground">{notice}</p>
          )}

          {isSignup && (
            <p className="pt-4 text-xs text-muted-foreground">
              New accounts start as students. Facility managers and administrators are
              assigned by an administrator.
            </p>
          )}

          <p className="pt-6 text-center text-sm text-muted-foreground">
            {isSignup ? "Already have an account?" : "New to Campus Reserve?"}{" "}
            <button className="font-medium text-primary hover:underline"
              onClick={() => switchMode(isSignup ? "signin" : "signup")}>
              {isSignup ? "Sign in" : "Create one"}
            </button>
          </p>

          {/* TEMPORARY demo shortcuts - remove before production */}
          <div className="mt-6 rounded-xl border border-dashed p-3">
            <p className="pb-2 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              Demo quick access
            </p>
            <div className="grid grid-cols-3 gap-2">
              {([
                ["student", "Student"],
                ["facility_manager", "Manager"],
                ["admin", "Admin"],
              ] as const).map(([r, label]) => (
                <Button key={r} variant="outline" size="sm" disabled={busy}
                  className="transition-transform active:scale-95"
                  onClick={() => quickLogin(r)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
