"use client";

import { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ThemeToggle from "@/components/theme-toggle";
import NotificationBell from "@/components/notification-bell";
import { CampusIcon } from "@/components/campus-icon";

const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  facility_manager: "Facility Manager",
  admin: "Administrator",
};

/** Where the logo takes a signed-in person: their own dashboard, never out to the public home page. */
export const ROLE_HOME: Record<string, string> = {
  student: "/student",
  facility_manager: "/facility-manager",
  admin: "/admin",
};

export function BrandMark({ light = false, href = "/" }: { light?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
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
  focused = false,
  wide,
  children,
}: {
  title: string;
  subtitle?: string;
  role?: string;
  userName?: string;
  /** One-task page: a narrower column and a shorter title band. */
  focused?: boolean;
  /** With `focused`, let the column grow on big screens: "rail" makes room for a
   *  side column, "full" is for working dashboards. Phones and tablets are unchanged. */
  wide?: "rail" | "full";
  children: ReactNode;
}) {
  const router = useRouter();
  // signed in: the logo stays inside the app (own dashboard, or this section if the role is not known yet)
  const pathname = usePathname();
  const home = (role && ROLE_HOME[role]) || `/${pathname.split("/")[1] ?? ""}`;
  const width = !focused || wide === "full" ? "max-w-[1680px]"
    : wide === "rail" ? "max-w-5xl xl:max-w-7xl" : "max-w-5xl";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="h-1 bg-gradient-to-r from-primary via-primary/70 to-primary" />
      <header className="sticky top-0 z-40 border-b bg-card/95 shadow-sm backdrop-blur">
        <div className={`mx-auto flex h-16 w-full ${width} items-center justify-between px-4 sm:px-6 lg:px-10`}>
          <BrandMark href={home} />
          <div className="flex items-center gap-3">
            <ThemeToggle />
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
                await supabase.auth.signOut({ scope: "local" });   // this tab only
                router.replace("/");   // only signing out leads back to the public home page
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="relative overflow-hidden border-b bg-gradient-to-br from-primary via-primary to-primary/80">
        <div className="pattern-dots absolute inset-0" aria-hidden />
        <div className={`relative mx-auto w-full ${width} px-4 sm:px-6 lg:px-10 ${focused ? "py-4" : "py-8"}`}>
          <h1 className={`font-display font-semibold text-primary-foreground ${focused ? "text-2xl" : "text-3xl"}`}>{title}</h1>
          {subtitle && <p className={`text-sm text-primary-foreground/80 ${focused ? "pt-0.5" : "pt-1.5"}`}>{subtitle}</p>}
        </div>
      </div>

      <main className={`mx-auto w-full ${width} flex-1 px-4 sm:px-6 lg:px-10 ${focused ? "space-y-5 py-5" : "space-y-6 py-8"}`}>{children}</main>

      <footer className="border-t bg-card">
        <div className={`mx-auto flex w-full ${width} flex-col items-center justify-between gap-2 px-4 sm:px-6 lg:px-10 py-5 text-xs text-muted-foreground sm:flex-row`}>
          <span>Campus Reserve - Smart Facility Reservation System</span>
          <span>Book campus facilities online</span>
        </div>
      </footer>
    </div>
  );
}
