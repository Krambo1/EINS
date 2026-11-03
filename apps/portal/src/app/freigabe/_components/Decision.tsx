"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buttonVariants, cn } from "@eins/ui";
import { CHANGE_TEXT_MAX } from "@/lib/content-approval";
import { DecisionSubmitButton } from "@/app/(portal)/inhalte/_components/DecisionSubmitButton";
import { CONTROL, RAISED_CONTROL } from "@/app/(portal)/dashboard/_components/dash-ui";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { DECISION_BAND, FIELD, SLOT_LEFT, SLOT_RIGHT, SLOT_ROW } from "../_lib/sizes";

type Choice = "freigegeben" | "aenderung";

/** "0:12": a moment in the video for the change request (as on Inhalte). */
function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The two buttons under the post's text, in Inhalte's two slots, and
 * "Änderung wünschen" (Inhalte's change mode): the field takes the place of
 * the text, "Freigeben" and "Änderung wünschen" turn into "Änderung senden"
 * and "Abbrechen" in the same places, so nothing moves.
 *
 * Plain HTML forms that POST to /api/freigabe/<token>, which answers with a
 * 303 back to the page; the change mode is a `<details>`, so all of it works
 * with JavaScript off. With JavaScript on: the tapped button greys out until
 * the server has answered (not optimistic, a ref stops a second submit;
 * `DecisionSubmitButton` does not see a plain form's submit), the field gets
 * the focus, "Stelle einfügen" writes the video's moment (Frame.io) and an
 * empty change shows the server's error without the round trip.
 */
export function Decision({
  action,
  well,
  videoId,
  startChanging,
  error: serverError,
  emptyError,
}: {
  action: string;
  /** The post's text well; the change field takes its place. */
  well: ReactNode;
  /** The id of the post's video, if it is one. */
  videoId: string | null;
  /** The server sent the page back with "the change text is missing" or "too long". */
  startChanging: boolean;
  error: string | null;
  /** The server's copy for an empty change text. */
  emptyError: string;
}) {
  const [changing, setChanging] = useState(startChanging);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Choice | null>(null);
  const [error, setError] = useState(serverError);
  const [hydrated, setHydrated] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const sending = useRef(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setHydrated(true), []);

  // Back to the page from the browser's cache: the buttons work again.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      sending.current = false;
      setPending(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  useEffect(() => {
    if (!videoId) return;
    const video = document.getElementById(videoId);
    if (!(video instanceof HTMLVideoElement)) return;
    const tick = () => setVideoTime(video.currentTime);
    video.addEventListener("timeupdate", tick);
    return () => video.removeEventListener("timeupdate", tick);
  }, [videoId]);

  const guard = (choice: Choice) => (e: FormEvent<HTMLFormElement>) => {
    if (sending.current) {
      e.preventDefault();
      return;
    }
    if (choice === "aenderung" && text.trim().length === 0) {
      e.preventDefault();
      setError(emptyError);
      fieldRef.current?.focus();
      return;
    }
    sending.current = true;
    setPending(choice);
  };

  // Also fires for a page that arrives open (an empty change sent without
  // JavaScript): only a real change of mode resets anything.
  const toggle = (open: boolean) => {
    if (open === changing) return;
    setChanging(open);
    setError(null);
    if (open) requestAnimationFrame(() => fieldRef.current?.focus());
    else setText("");
  };

  // Frame.io ties a comment to the moment in the video: one tap pauses the
  // video and writes "Bei 0:12: " where the cursor is.
  const insertMoment = () => {
    const video = videoId ? document.getElementById(videoId) : null;
    const field = fieldRef.current;
    if (!(video instanceof HTMLVideoElement) || !field) return;
    video.pause();
    const mark = `Bei ${clock(video.currentTime)}: `;
    const start = field.selectionStart ?? text.length;
    const end = field.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const next = `${before}${lead}${mark}${text.slice(end)}`.slice(0, CHANGE_TEXT_MAX);
    setText(next);
    const caret = Math.min(before.length + lead.length + mark.length, next.length);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret, caret);
    });
  };

  return (
    <>
      {/* The buttons stand over the band's empty slot row at the foot of
          this box; the field covers the well at its top. */}
      <div className="relative">
        <details
          open={changing}
          onToggle={(e) => toggle(e.currentTarget.open)}
          className="group/change peer/change"
        >
          <summary
            aria-disabled={pending ? true : undefined}
            onClick={(e) => {
              if (pending) e.preventDefault();
            }}
            className={cn(
              buttonVariants({ variant: "outline" }),
              RAISED_CONTROL,
              CONTROL,
              "absolute cursor-pointer list-none px-3 [&::-webkit-details-marker]:hidden",
              SLOT_RIGHT,
              pending && "pointer-events-none opacity-50"
            )}
          >
            <span className="group-open/change:hidden">Änderung wünschen</span>
            <span className="hidden group-open/change:inline">Abbrechen</span>
          </summary>
          <form method="post" action={action} onSubmit={guard("aenderung")}>
            <input type="hidden" name="decision" value="aenderung" />
            <div className="absolute inset-x-0 top-0">
              <div className="flex h-5 items-center justify-between gap-3 text-sm leading-5">
                <label htmlFor="changeText" className="text-fg-secondary">
                  Was sollen wir ändern?
                </label>
                {hydrated && videoId && (
                  <button
                    type="button"
                    onClick={insertMoment}
                    className="-my-2 rounded-[var(--r-small)] py-2 font-medium text-fg-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Stelle <span className="tabular-nums">{clock(videoTime)}</span> einfügen
                  </button>
                )}
              </div>
              <ScrollHint className={cn("mt-1.5 flex flex-col", FIELD)} watch={text}>
                <textarea
                  ref={fieldRef}
                  id="changeText"
                  name="changeText"
                  required
                  maxLength={CHANGE_TEXT_MAX}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-describedby={error ? "freigabe-error" : undefined}
                  placeholder="Zum Beispiel: Bitte am Ende den Hinweis auf das Erstgespräch ergänzen."
                  className="scroll-shadows elev-inset min-h-0 flex-1 resize-none rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </ScrollHint>
            </div>
            <DecisionSubmitButton disabled={pending !== null} className={cn(CONTROL, "absolute px-3", SLOT_LEFT)}>
              {pending === "aenderung" ? "Wird gespeichert …" : "Änderung senden"}
            </DecisionSubmitButton>
          </form>
        </details>

        <div className="peer-open/change:invisible">{well}</div>

        <form
          method="post"
          action={action}
          onSubmit={guard("freigegeben")}
          className={cn("absolute peer-open/change:invisible", SLOT_LEFT)}
        >
          <input type="hidden" name="decision" value="freigegeben" />
          <DecisionSubmitButton disabled={pending !== null} className={cn(CONTROL, "w-full px-3")}>
            {pending === "freigegeben" ? "Wird gespeichert …" : "Freigeben"}
          </DecisionSubmitButton>
        </form>

        <div aria-hidden className={DECISION_BAND}>
          <div className={SLOT_ROW} />
        </div>
      </div>

      {error && (
        <p id="freigabe-error" role="alert" className="mt-3 text-sm font-medium leading-5 text-tone-bad">
          {error}
        </p>
      )}
    </>
  );
}
