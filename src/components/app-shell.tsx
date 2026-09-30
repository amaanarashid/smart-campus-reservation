"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import NotificationBell from "@/components/notification-bell";
import { CampusIcon } from "@/components/campus-icon";

const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  facility_manager: "Facility Manager",
  admin: "Administrator",
};

export function BrandMark({ light = false }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/80 text-primary-foreground shadow-sm">
        <CampusIcon className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className={`font-display block text-[15px] font-semibold tracking-tight ${light ? "text-white" : ""}`}>
          Campus Reserve
        </span>
        <span className={`block text-[11px] ${light ? "text-white/70" : "text-muted-foreground"}`}>
          Facility Reservation
        </span>
      </span>
    </Link>
  );
}

export default function AppShell({
  title,
  subtitle,
  role,
  userName,
  children,
}: {
  title: string;
  subtitle?: string;
  role?: string;
  userName?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-1 bg-gradient-to-r from-primary via-primary/70 to-primary" />
      <header className="sticky top-0 z-40 border-b bg-card/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <BrandMark />
          <div className="flex items-center gap-3">
            <NotificationBell />
            {role && (
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {ROLE_LABELS[role] ?? role}
              </Badge>
            )}
            {userName && (
              <span className="hidden text-sm text-muted-foreground md:inline">{userName}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await supabase.auth.signOut();
                router.push("/login");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="relative overflow-hidden border-b bg-gradient-to-br from-primary via-primary to-primary/80">
        <div className="pattern-dots absolute inset-0" aria-hidden />
        <div className="relative mx-auto w-full max-w-6xl px-4 py-8">
          <h1 className="font-display text-3xl font-semibold text-primary-foreground">{title}</h1>
          {subtitle && <p className="pt-1.5 text-sm text-primary-foreground/80">{subtitle}</p>}
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8">{children}</main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row">
          <span>Campus Reserve - Smart Facility Reservation System</span>
          <span>Book campus facilities online</span>
        </div>
      </footer>
    </div>
  );
}
