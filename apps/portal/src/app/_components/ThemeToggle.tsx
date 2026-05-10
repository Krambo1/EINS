"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "eins-portal-theme";

function readStored(): Theme | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "dark" || v === "light" ? v : null;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  else root.removeAttribute("data-theme");
}

export function ThemeToggle() {
  // Read the current value off <html> on first paint. The pre-hydration
  // script in app/layout.tsx has already set this from localStorage, so we
  // never flash the wrong icon.
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const initial: Theme =
      readStored() ??
      (document.documentElement.getAttribute("data-theme") === "dark"
        ? "dark"
        : "light");
    setTheme(initial);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage blocked (private mode, quota) — theme still applies for
      // the session, just won't persist. No user-facing error needed.
    }
  };

  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Helles Design" : "Dunkles Design"}
      title={isDark ? "Helles Design" : "Dunkles Design"}
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-fg-secondary transition hover:bg-bg-secondary hover:text-fg-primary"
    >
      {/* Render both icons after mount so SSR/CSR markup matches regardless
          of the saved theme. Before mount we show the sun (light default). */}
      {mounted && isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
