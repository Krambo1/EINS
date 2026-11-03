"use client";

import { Children, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@eins/ui";
import { AUTH_FOCUS } from "./auth-ui";

type Tone = "good" | "bad";

// The portal toast's look (packages/ui Toast, solid like ActionFlashToast):
// the page colour under the tone's tint, so nothing shows through.
const TONES: Record<Tone, { className: string; role: "alert" | "status" }> = {
  bad: {
    className:
      "border-[var(--tone-bad-border)] bg-bg-primary text-tone-bad [background-image:linear-gradient(var(--tone-bad-bg),var(--tone-bad-bg))]",
    role: "alert",
  },
  good: {
    className:
      "border-[var(--tone-good-border)] bg-bg-primary text-tone-good [background-image:linear-gradient(var(--tone-good-bg),var(--tone-good-bg))]",
    role: "status",
  },
};

/**
 * Splits a message at its first sentence: the portal toast's title, then the
 * rest as its description ("Zu viele Versuche." / "Bitte später erneut.").
 */
function split(text: string): [string, string | null] {
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text.trim());
  return m ? [m[1], m[2]] : [text, null];
}

/**
 * Toast in the portal's look and place: 16 px from the phone's edges, from
 * sm bottom right at most 388 px wide, as the portal's ToastViewport puts
 * it. It stays until it is closed or the next attempt starts: no timer, so
 * nobody misses an error while reading the form. `bad` is announced as an
 * alert. A plain-text message is split into title and description at its
 * first sentence; anything else (a message with a link) is shown as given.
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
  // The message's first sentence is the title; the rest, and anything after
  // the text (the admin's "Neuen Link anfordern" link), the description.
  const [first, ...after] = Children.toArray(children);
  const [title, rest] = typeof first === "string" ? split(first) : [first, null];
  const description = rest || after.length > 0 ? <>{rest}{after}</> : null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] sm:inset-x-auto sm:bottom-8 sm:right-8 sm:w-[388px]">
      <div
        data-auth-toast
        role={t.role}
        className={cn(
          "pointer-events-auto relative flex w-full animate-fade-in items-start gap-3 overflow-hidden rounded-lg border p-4 shadow-lg",
          onClose && "pr-8",
          t.className
        )}
      >
        <div className="grid gap-1">
          <p className="text-sm font-semibold">{title}</p>
          {description && <p className="text-sm opacity-90">{description}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hinweis schließen"
            className={cn("absolute right-2 top-2 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100", AUTH_FOCUS)}
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
