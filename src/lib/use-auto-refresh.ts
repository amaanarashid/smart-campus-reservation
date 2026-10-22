"use client";

import { useEffect, useRef } from "react";

/**
 * Keep a page's data fresh without the user pressing reload: call `refresh`
 * every `everyMs` while the tab is visible, and right away when the user
 * comes back to the tab or window. Paused while the tab is hidden, so idle
 * tabs do not keep querying the database.
 *
 * `enabled` lets a page wait until its first load (and the user's profile)
 * is ready. The latest `refresh` is always used, so passing an inline
 * function is fine.
 */
export function useAutoRefresh(refresh: () => unknown, everyMs = 20_000, enabled = true) {
  const fn = useRef(refresh);
  useEffect(() => { fn.current = refresh; }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    let last = Date.now();
    const run = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      last = Date.now();
      try { await fn.current(); } finally { running = false; }
    };
    const t = setInterval(run, everyMs);
    // coming back after a while: refresh at once, but not on every quick alt-tab
    const onBack = () => { if (Date.now() - last > 3_000) run(); };
    const onVisible = () => { if (document.visibilityState === "visible") onBack(); };
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onBack);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [everyMs, enabled]);
}
