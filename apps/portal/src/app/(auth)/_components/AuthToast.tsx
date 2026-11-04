"use client";

import { Children, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@eins/ui";
import { TOAST_CARD, TOAST_CLOSE, TOAST_TEXT, TOAST_TITLE, ToastIcon } from "@/app/_components/toast-look";
import { AUTH_FOCUS } from "./auth-ui";

type Tone = "good" | "bad";

// The portal toast's look (toast-look, as ActionFlashToast): a solid white
// card, dark text, the tone in the icon.
const ROLES: Record<Tone, "alert" | "status"> = { bad: "alert", good: "status" };

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
  // The message's first sentence is the title; the rest, and anything after
  // the text (the admin's "Neuen Link anfordern" link), the description.
  const [first, ...after] = Children.toArray(children);
  const [title, rest] = typeof first === "string" ? split(first) : [first, null];
  const description = rest || after.length > 0 ? <>{rest}{after}</> : null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] sm:inset-x-auto sm:bottom-8 sm:right-8 sm:w-[388px]">
      <div
        data-auth-toast
        role={ROLES[tone]}
        className={cn(TOAST_CARD, "animate-fade-in", !onClose && "pr-3.5")}
      >
        <ToastIcon tone={tone} />
        <div className="grid min-w-0 gap-1">
          <p className={TOAST_TITLE}>{title}</p>
          {description && <p className={cn(TOAST_TEXT, "[&_a]:font-medium [&_a]:text-fg-primary")}>{description}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Hinweis schließen"
            className={cn(TOAST_CLOSE, AUTH_FOCUS)}
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
