import { createClient } from "@supabase/supabase-js";

/**
 * One login per browser TAB, not per browser.
 *
 * Supabase keeps the session in localStorage by default, which every tab and
 * window of the browser shares - signing in as the admin in one window
 * silently switched the student window to the admin too. Here:
 *   - the session lives in sessionStorage, which is private to the tab;
 *   - the storage key carries a per-tab id (kept in sessionStorage, so it
 *     survives a reload), because Supabase also broadcasts sign-in/sign-out
 *     to other tabs on a channel named after that key - with a shared key,
 *     signing out in one tab would sign out the others.
 * So a student, a facility manager and an admin can be open side by side.
 *
 * Trade-off: closing a tab signs that tab out, and a brand-new tab starts
 * signed out (a duplicated tab keeps its login). On the server there is no
 * window, so the defaults are used.
 */
function tabAuth() {
  if (typeof window === "undefined") return {};
  let tab = window.sessionStorage.getItem("campus-tab-id");
  if (!tab) {
    tab = Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem("campus-tab-id", tab);
  }
  return { storage: window.sessionStorage, storageKey: `campus-auth-${tab}` };
}

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { ...tabAuth(), persistSession: true, autoRefreshToken: true } },
);
