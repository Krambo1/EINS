"use client";

import type { ReactNode } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "@eins/ui";

type Tone = "good" | "bad";

const TONES: Record<
  Tone,
  { icon: typeof XCircle; border: string; glow: string; iconClass: string; role: "alert" | "status" }
> = {
  bad: {
    icon: XCircle,
    border: "border-[rgba(201,53,43,0.35)]",
    glow: "bg-[rgba(201,53,43,0.08)]",
    iconClass: "text-tone-bad",
    role: "alert",
  },
  good: {
    icon: CheckCircle2,
    border: "border-[rgba(25,163,106,0.35)]",
    glow: "bg-[rgba(25,163,106,0.08)]",
    iconClass: "text-tone-good",
    role: "status",
  },
};

/**
 * Toast, bottom right (bottom, full width on phones). It stays
 * until it is closed or the next attempt starts: no timer, so nobody misses
 * an error while reading the form. `bad` is announced as an alert.
 */
export function AuthToast({
  tone,
  children,
  onClose,
}: {
  tone: Tone;
  children: ReactNode;
  onClose?: () => void;
}) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:bottom-6 sm:right-6">
      <div
        role={t.role}
        className={cn(
          "pointer-events-auto relative isolate flex w-full max-w-[400px] animate-fade-in items-start gap-4 overflow-hidden rounded-2xl border bg-white p-4 shadow-[0_12px_32px_-8px_rgba(16,16,26,0.18)] sm:w-[380px]",
          t.border
        )}
      >
        <span
          aria-hidden
          className={cn("absolute -left-20 -top-4 -z-10 h-[200px] w-[160px] rounded-full blur-lg", t.glow)}
        />
        <Icon aria-hidden className={cn("mt-px h-[18px] w-[18px] shrink-0", t.iconClass)} />
        <div className={cn("flex-1 text-[15px] font-medium leading-5 text-fg-primary", onClose && "pr-6")}>
          {children}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hinweis schließen"
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-fg-secondary transition-colors hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(88,186,181,0.4)]"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
