"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Toast,
  ToastProvider,
  ToastViewport,
  ToastTitle,
  ToastDescription,
  ToastClose,
} from "@eins/ui";

const STORAGE_KEY = "eins.detail.intro.v2.seen";

/**
 * Renders a one-time toast the first time a user flips into Detail mode after
 * the v2 launch. Also wires the `g d` chord shortcut so power users can flip
 * without using the toggle button.
 */
export function DetailIntroToast({
  uiMode,
}: {
  uiMode: "einfach" | "detail";
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (uiMode !== "detail") return;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(STORAGE_KEY) === "1") return;
    window.localStorage.setItem(STORAGE_KEY, "1");
    setOpen(true);
  }, [uiMode]);

  // `g d` chord shortcut to toggle Detail mode.
  React.useEffect(() => {
    let primed = false;
    let primedAt = 0;
    const onKey = async (e: KeyboardEvent) => {
      // Skip while typing in an input/textarea/contenteditable.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        primed = true;
        primedAt = Date.now();
        return;
      }
      if (
        primed &&
        Date.now() - primedAt < 1500 &&
        e.key.toLowerCase() === "d"
      ) {
        primed = false;
        e.preventDefault();
        const next = uiMode === "detail" ? "einfach" : "detail";
        await fetch("/api/me/ui-mode", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: next }),
        });
        router.refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [uiMode, router]);

  return (
    <ToastProvider>
      <Toast open={open} onOpenChange={setOpen} duration={9000}>
        <div className="grid gap-1">
          <ToastTitle>Detail-Modus jetzt mit deutlich mehr Tiefe</ToastTitle>
          <ToastDescription>
            Schauen Sie auf jeder Seite nach den neuen Kacheln, Diagrammen und
            Aufschlüsselungen. Mit „g d" wechseln Sie blitzschnell.
          </ToastDescription>
        </div>
        <ToastClose />
      </Toast>
      <ToastViewport />
    </ToastProvider>
  );
}
