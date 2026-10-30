"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CHANGE_TEXT_MAX } from "@/lib/content-approval";
import { CONTROL, CONTROL_SQUARE, DashCard, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { decidePostAction } from "../actions";
import type { WaitingPost } from "../_lib/view";
import {
  CenteredNote,
  Detail,
  DETAIL_LINES,
  FREIGABE_CARD_HEIGHT,
  PREVIEW_FRAME,
  TITLE_BLOCK,
  replaceParam,
} from "./parts";
import { ScrollHint } from "@/app/_components/ScrollHint";

/**
 * The posts that wait for the Praxis' decision, one at a time, like "Jetzt
 * anrufen" on Anfragen (Attio's record header): the post itself on the left,
 * its title, labelled details and its text on the right, the decision at the
 * foot. Everything in the card acts on this one post.
 *
 * Fixed size (DESIGN.md section 10): one height per breakpoint for every
 * post, with or without preview or text, while "Änderung wünschen" is open,
 * after the last decision and for someone who may not decide. The text sits
 * in a well that scrolls; "Änderung wünschen" turns that same well into the
 * text field and the two buttons into "Änderung senden" and "Abbrechen" in
 * the same places. A decision shows at once: the post leaves the card and
 * the next one takes its place while the save runs in the background
 * (`submit`); a failed save puts the post back into the list with its change
 * text, without changing the post on screen (unless the card is empty). The
 * result comes as a toast. Further posts are reached
 * with the arrows in the header (Stripe's page buttons) or from their row in
 * "Alle Beiträge" (`?beitrag=<id>`).
 */
/** The Praxis as it appears above its posts: name and logo. */
export type PracticeFace = { name: string; logoUrl: string | null };

/** Posts decided in this browser: post id -> the approval that was decided. */
type Decided = ReadonlyMap<string, string>;

/**
 * The waiting posts without the ones decided here. Keyed by approval, so a
 * post EINS revises and sends again (new approval) shows up again.
 */
function visibleOf(posts: WaitingPost[], decided: Decided): WaitingPost[] {
  return posts.filter((p) => !(p.approvalId && decided.get(p.id) === p.approvalId));
}

export function FreigabeCard({ posts: allPosts, practice }: { posts: WaitingPost[]; practice: PracticeFace }) {
  const searchParams = useSearchParams();
  const wanted = searchParams.get("beitrag");
  const [decided, setDecided] = useState<Decided>(() => new Map());
  const decidedRef = useRef(decided);
  const postsRef = useRef(allPosts);
  postsRef.current = allPosts;
  // Change texts of posts whose save failed, handed back to the card when it is shown again.
  const restoreRef = useRef(new Map<string, string>());
  const [inFlight, setInFlight] = useState(0);
  const [, startTransition] = useTransition();
  const posts = useMemo(() => visibleOf(allPosts, decided), [allPosts, decided]);
  const [index, setIndex] = useState(() => Math.max(0, posts.findIndex((p) => p.id === wanted)));
  // The post on screen, for a save that fails later.
  const shownRef = useRef<string | null>(null);

  const commit = (next: Decided) => {
    decidedRef.current = next;
    setDecided(next);
  };

  // A save is running: ask before the tab closes (DESIGN.md, uploads).
  useEffect(() => {
    if (inFlight === 0) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [inFlight]);

  // The post leaves the card on the tap; the decision is saved behind it. The
  // optimistic state is local on purpose: several saves may run at once and a
  // failure must bring back only its own post.
  const submit = (post: WaitingPost, decision: "freigegeben" | "aenderung", changeText: string) => {
    const approvalId = post.approvalId;
    if (!approvalId || decidedRef.current.get(post.id) === approvalId) return;
    const before = visibleOf(postsRef.current, decidedRef.current);
    commit(new Map(decidedRef.current).set(post.id, approvalId));
    const after = visibleOf(postsRef.current, decidedRef.current);
    const nextPost = after[Math.min(before.findIndex((p) => p.id === post.id), after.length - 1)];
    replaceParam("beitrag", nextPost?.id ?? null);

    // Back into the list at its place, with the change text kept for when the
    // user pages back to it. The post on screen stays, so what is typed there
    // is not lost; only an empty card shows the failed post.
    const restore = () => {
      const next = new Map(decidedRef.current);
      next.delete(post.id);
      commit(next);
      if (decision === "aenderung") restoreRef.current.set(post.id, changeText);
      const list = visibleOf(postsRef.current, next);
      const shown = shownRef.current;
      const i = list.findIndex((p) => p.id === (shown ?? post.id));
      if (i >= 0) setIndex(i);
      if (shown === null) replaceParam("beitrag", post.id);
    };

    setInFlight((n) => n + 1);
    startTransition(async () => {
      try {
        const res = await decidePostAction({
          approvalId,
          decision,
          changeText: decision === "aenderung" ? changeText : undefined,
        });
        if (!res.ok) restore();
        // Planable's "Review X posts": the toast says what is left, counted
        // without every post decided here.
        const others = visibleOf(postsRef.current, decidedRef.current).length;
        const left =
          others === 0
            ? "Damit wartet nichts mehr auf Sie."
            : others === 1
              ? "Ein Beitrag wartet noch."
              : `Noch ${others} Beiträge warten.`;
        showActionFlash({
          tone: res.ok ? "good" : "bad",
          title: res.title,
          description: res.ok
            ? res.recorded
              ? `${res.description ?? post.title} ${left}`
              : res.description
            : `${post.title}: ${res.description}`,
        });
      } catch {
        restore();
        showActionFlash({
          tone: "bad",
          title: "Nicht gespeichert",
          description: `${post.title}: Keine Verbindung. Bitte versuchen Sie es noch einmal.`,
        });
      } finally {
        setInFlight((n) => n - 1);
      }
    });
  };

  // A row in "Alle Beiträge" picks a post through the URL.
  useEffect(() => {
    if (!wanted) return;
    const i = posts.findIndex((p) => p.id === wanted);
    if (i >= 0) setIndex(i);
  }, [wanted, posts]);

  // After a decision the post leaves the list; the next one takes its place.
  const at = Math.min(index, Math.max(posts.length - 1, 0));
  const post = posts[at] ?? null;
  const count = posts.length;
  shownRef.current = post?.id ?? null;

  const go = (next: number) => {
    const target = posts[next];
    if (!target) return;
    setIndex(next);
    replaceParam("beitrag", target.id);
  };

  return (
    <DashCard
      id="freigabe"
      title={
        <>
          Zur Freigabe
          {count > 0 && <span className="ml-2 font-normal tabular-nums text-fg-secondary">{count}</span>}
        </>
      }
      action={
        // One height with or without the arrows, so the header never changes.
        <div className="flex h-[var(--control-h)] items-center gap-2">
          {count > 0 && (
            <>
              <span className="mr-1 text-sm tabular-nums text-fg-secondary" aria-live="polite">
                {at + 1} von {count}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={at <= 0}
                onClick={() => go(at - 1)}
                aria-label="Vorheriger Beitrag"
                className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={at >= count - 1}
                onClick={() => go(at + 1)}
                aria-label="Nächster Beitrag"
                className={cn(RAISED_CONTROL, CONTROL, CONTROL_SQUARE)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )}
        </div>
      }
      className={cn("flex scroll-mt-4 flex-col", FREIGABE_CARD_HEIGHT)}
      bodyClassName="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-6"
    >
      {post ? (
        <PostDecision
          key={post.id}
          post={post}
          practice={practice}
          onDecide={submit}
          restoredText={restoreRef.current.get(post.id) ?? null}
          onRestored={() => restoreRef.current.delete(post.id)}
        />
      ) : (
        <CenteredNote
          title="Nichts wartet auf Ihre Freigabe."
          text="Neue Beiträge kündigen wir Ihnen per E-Mail an."
        />
      )}
    </DashCard>
  );
}

/** "0:12": a moment in the video for the change request. */
function clock(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PostDecision({
  post,
  practice,
  onDecide,
  restoredText,
  onRestored,
}: {
  post: WaitingPost;
  practice: PracticeFace;
  /** Hands the decision over; this card is gone on the next render. */
  onDecide: (post: WaitingPost, decision: "freigegeben" | "aenderung", changeText: string) => void;
  /** The change text of a failed save: the post comes back in change mode. */
  restoredText: string | null;
  onRestored: () => void;
}) {
  const [changing, setChanging] = useState(restoredText != null);
  const [text, setText] = useState(restoredText ?? "");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoTime, setVideoTime] = useState(0);

  // Frame.io ties a comment to the moment in the video: one tap pauses the
  // video and writes "Bei 0:12: " where the cursor is.
  const insertMoment = () => {
    const video = videoRef.current;
    const field = fieldRef.current;
    if (!video || !field) return;
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

  useEffect(() => {
    if (changing) fieldRef.current?.focus();
  }, [changing]);

  // The failed save of this post came back: the text is in the field again.
  useEffect(() => {
    if (restoredText != null) onRestored();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = (decision: "freigegeben" | "aenderung") => onDecide(post, decision, text);

  const decidable = post.canDecide && !!post.approvalId && !post.decided;
  const reason = !post.approvalId
    ? "Die Freigabe dazu bekommen Sie per E-Mail."
    : post.decided
      ? "Ihre Entscheidung ist gespeichert. EINS übernimmt ab hier."
      : post.inhaberOnly
        ? "Diesen Beitrag gibt die Inhaberin oder der Inhaber frei, weil darin der KI-Klon erscheint."
        : "Diesen Beitrag gibt die Inhaberin, der Inhaber oder das Marketing frei.";
  const labelId = `freigabe-${post.id}`;

  return (
    <>
      {/* The post as the patient will see it (Planable's feed preview): the
          Praxis' name and logo above the file, a hairline between them, the
          file letterboxed below, never cropped. The post stands raised on the
          card like the tiles of the Inhalte card on the Übersicht. */}
      <div
        className={cn(
          "elev-raised flex flex-col overflow-hidden rounded-[var(--r-panel)] bg-[var(--surface-raised)]",
          PREVIEW_FRAME
        )}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          {practice.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={practice.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full bg-[var(--well)] object-contain" />
          ) : (
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg-primary text-xs font-semibold text-white"
            >
              {practice.name.trim().charAt(0).toUpperCase() || "P"}
            </span>
          )}
          <span className="min-w-0 break-words text-sm font-semibold leading-4 text-fg-primary">{practice.name}</span>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-[var(--well)]">
          {post.preview ? (
            post.preview.isVideo ? (
              <video
                ref={videoRef}
                src={post.preview.url}
                controls
                playsInline
                preload="metadata"
                onTimeUpdate={(e) => setVideoTime(e.currentTarget.currentTime)}
                className="h-full max-h-full w-full object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.preview.url} alt={post.title} className="h-full max-h-full w-full object-contain" />
            )
          ) : (
            <span className="flex flex-col items-center gap-2 px-6 text-center text-sm text-fg-secondary">
              <ImageOff className="h-5 w-5" aria-hidden />
              Zu diesem Beitrag gibt es keine Vorschau.
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col lg:mt-0">
        <div className={TITLE_BLOCK}>
          <h3 className="my-auto min-w-0 break-words text-lg font-semibold leading-7 text-fg-primary sm:text-xl">
            {post.title}
          </h3>
        </div>

        {/* Stripe's details list: a hairline above, below and between
            the rows, label left, value right. */}
        <dl className={cn("mt-3 shrink-0 text-[15px] leading-5", DETAIL_LINES)}>
          <Detail label="Format">{post.formatLabel}</Detail>
          <Detail label="Behandlung">
            {post.treatment ?? <span className="text-fg-secondary">Keine Angabe</span>}
          </Detail>
          <Detail label="KI-Klon">{post.usesClone ? "Mit Ihrem KI-Klon" : "Ohne KI-Klon"}</Detail>
          <Detail label="Frist">
            {post.dueLabel ? (
              <span className="tabular-nums">Bis {post.dueLabel}</span>
            ) : (
              <span className="text-fg-secondary">Noch keine Frist</span>
            )}
            {/* What happens when the day passes (Metricool, ContentStudio). */}
            <span className="block text-fg-secondary">Ohne Ihre Freigabe geht der Beitrag nicht online.</span>
          </Detail>
          <Detail label="Gibt frei">
            {post.inhaberOnly ? "Inhaberin oder Inhaber" : "Inhaberin, Inhaber oder Marketing"}
          </Detail>
        </dl>

        {/* The text of the post, or the change request while it is written:
            one well, one size (Karam: "normal sized", scroll inside). */}
        <div className="mt-4 flex h-5 shrink-0 items-center justify-between gap-3 text-sm leading-5">
          <span id={`${labelId}-well`} className="text-fg-secondary">
            {changing ? "Was sollen wir ändern?" : "Text zum Beitrag"}
          </span>
          {changing && post.preview?.isVideo && (
            <button
              type="button"
              onClick={insertMoment}
              className="-my-2 rounded-[var(--r-small)] py-2 font-medium text-fg-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Stelle <span className="tabular-nums">{clock(videoTime)}</span> einfügen
            </button>
          )}
        </div>
        {changing ? (
          <ScrollHint className="mt-1.5 flex min-h-0 flex-1 flex-col" watch={text}>
            <textarea
              ref={fieldRef}
              aria-labelledby={`${labelId}-well`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={CHANGE_TEXT_MAX}
              placeholder={`Zum Beispiel: Bitte am Ende den Hinweis auf das Erstgespräch ergänzen.`}
              className="scroll-shadows elev-inset min-h-0 flex-1 resize-none rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary placeholder:text-fg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </ScrollHint>
        ) : (
          <ScrollHint className="mt-1.5 flex min-h-0 flex-1 flex-col">
            <div
              role="region"
              aria-labelledby={`${labelId}-well`}
              tabIndex={0}
              className="scroll-shadows elev-inset min-h-0 flex-1 rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {post.caption ? (
                <p className="whitespace-pre-wrap break-words">{post.caption}</p>
              ) : (
                <p className="text-fg-secondary">Dieser Beitrag hat keinen Text.</p>
              )}
            </div>
          </ScrollHint>
        )}

        <div className="shrink-0 pt-5">
          <div className="border-t border-border pt-4">
            <div id={labelId} className="mb-2 h-5 text-[15px] font-medium leading-5 text-fg-primary">
              {decidable ? "Ihre Entscheidung" : "Freigabe"}
            </div>
            {/* Two slots of one width: the buttons of both modes sit in the
                same places, so nothing moves when "Änderung wünschen" opens. */}
            <div
              role="group"
              aria-labelledby={labelId}
              className="grid h-[var(--control-h)] grid-cols-2 gap-2 sm:w-[23rem]"
            >
              {!decidable ? (
                <p className="col-span-2 flex items-center text-sm leading-5 text-fg-primary">{reason}</p>
              ) : changing ? (
                <>
                  <Button
                    type="button"
                    disabled={text.trim().length === 0}
                    onClick={() => decide("aenderung")}
                    className={cn(CONTROL, "px-3")}
                  >
                    Änderung senden
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setChanging(false);
                      setText("");
                    }}
                    className={cn(RAISED_CONTROL, CONTROL, "px-3")}
                  >
                    Abbrechen
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={() => decide("freigegeben")}
                    className={cn(CONTROL, "px-3")}
                  >
                    Freigeben
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setChanging(true)}
                    className={cn(RAISED_CONTROL, CONTROL, "px-3")}
                  >
                    Änderung wünschen
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
