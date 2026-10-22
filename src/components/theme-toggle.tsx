"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

/**
 * Light / dark / auto switch. The choice is kept in localStorage (it is a
 * per-browser preference, unlike the login which is per tab). "Auto" follows
 * the computer's setting and changes with it. The class is first applied by
 * the tiny script in layout.tsx before the page paints, so there is no flash.
 */
export type ThemeChoice = "light" | "dark" | "system";
export const THEME_KEY = "campus-theme";

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { light: "dark", dark: "system", system: "light" };
const LABEL: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "Auto (follows your device)" };

export default function ThemeToggle({ onDark = false }: { onDark?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    let saved: ThemeChoice = "system";
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === "light" || v === "dark" || v === "system") saved = v;
    } catch { /* storage blocked: stay on auto */ }
    queueMicrotask(() => setChoice(saved));
    // in auto mode, follow the device when it switches
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let cur: string | null = null;
      try { cur = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
      if (!cur || cur === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  function cycle() {
    const next = NEXT[choice ?? "system"];
    setChoice(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    apply(next);
  }

  const current = choice ?? "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  return (
    <button type="button" onClick={cycle}
      title={`Theme: ${LABEL[current]} - click to change`}
      aria-label={`Theme: ${LABEL[current]}. Click to change.`}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        onDark ? "text-primary-foreground/90 hover:bg-white/15" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}
