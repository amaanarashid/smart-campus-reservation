"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ensureProfile } from "@/lib/profile";
import { ROLE_HOME } from "@/components/app-shell";

/**
 * On the public home page: someone who is already signed in is sent to their
 * own dashboard, so typing "/" or pressing Back never drops them outside the
 * app. The session lives in the browser, so this runs after the page loads;
 * visitors who are not signed in see the page as normal. Renders nothing.
 */
export default function SignedInRedirect() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      const profile = await ensureProfile();
      if (profile && !cancelled) router.replace(ROLE_HOME[profile.role] ?? "/student");
    })();
    return () => { cancelled = true; };
  }, [router]);
  return null;
}
