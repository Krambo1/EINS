import type { ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@eins/ui";
import { EinsLogo } from "@/app/_components/EinsLogo";
import { ScrollHint } from "@/app/_components/ScrollHint";
import { DashCard } from "@/app/(portal)/dashboard/_components/dash-ui";
import { DETAIL_LINES, Detail } from "@/app/(portal)/inhalte/_components/parts";
import { CARD_BODY, FRAME_WIDTH, MEDIA_FRAME, TITLE_TOP, WELL } from "../_lib/sizes";

/**
 * The parts of the public Freigabe page, shared with its skeleton where they
 * hold no data. The page is the Praxis side of the portal without the
 * portal's chrome: the canvas, the EINS logo where the shell has it (Stripe
 * Checkout puts the seller's mark top left), and one card.
 */

/** Canvas, logo row and the one width every state uses. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--surface-canvas)] text-fg-primary">
      <main className={cn("mx-auto w-full px-4 pb-8 sm:px-6 sm:pb-12", FRAME_WIDTH)}>
        <div className="flex h-[var(--shell-row)] items-center">
          <EinsLogo className="h-7 w-auto shrink-0" />
        </div>
        {children}
      </main>
    </div>
  );
}

/** The card the post and the decision stand on. */
export function PostCard({ children }: { children: ReactNode }) {
  return <DashCard bodyClassName={CARD_BODY}>{children}</DashCard>;
}

/** Not found, rate limited: one title and one sentence on the same card. */
export function Notice({ title, text }: { title: string; text: string }) {
  return (
    <Frame>
      <DashCard bodyClassName="pt-5 md:pt-6">
        <h1 className="text-lg font-semibold leading-7 text-fg-primary sm:text-xl">{title}</h1>
        <p className="mt-1 text-[15px] leading-6 text-fg-primary">{text}</p>
      </DashCard>
    </Frame>
  );
}

/** The post's file; a video carries the id "Stelle einfügen" finds it by. */
export type PostFile = { url: string; isVideo: boolean; id?: string };

/**
 * The post as the patient will see it (Planable's feed preview, as on
 * Inhalte's "Zur Freigabe"): the Praxis' name above the file, a hairline
 * between them, the file letterboxed below, never cropped. Raised on the card.
 */
export function PostTile({ practiceName, title, file }: { practiceName: string; title: string; file: PostFile | null }) {
  return (
    <div className="elev-raised overflow-hidden rounded-[var(--r-panel)] bg-[var(--surface-raised)]">
      <div className="flex h-11 items-center gap-2 border-b border-border px-3">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg-primary text-xs font-semibold text-white"
        >
          {practiceName.trim().charAt(0).toUpperCase() || "P"}
        </span>
        <span className="min-w-0 break-words text-sm font-semibold leading-4 text-fg-primary">{practiceName}</span>
      </div>
      <div className={cn("flex items-center justify-center bg-[var(--well)]", MEDIA_FRAME)}>
        {file ? (
          file.isVideo ? (
            <video
              id={file.id}
              src={file.url}
              controls
              playsInline
              preload="metadata"
              className="h-full max-h-full w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.url} alt={title} className="h-full max-h-full w-full object-contain" />
          )
        ) : (
          <span className="flex flex-col items-center gap-2 px-6 text-center text-sm text-fg-secondary">
            <ImageOff className="h-5 w-5" aria-hidden />
            Zu diesem Beitrag gibt es keine Vorschau.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Format above the title (Stripe Checkout: the product small and grey over
 * the amount). The title wraps, never cut; room for two lines, so the text
 * and the buttons stand where the skeleton has them for the usual title.
 */
export function PostHead({ format, title }: { format: string; title: string }) {
  return (
    <div className={TITLE_TOP}>
      <p className="h-5 text-sm leading-5 text-fg-secondary">{format}</p>
      <h1 className="min-h-14 break-words text-lg font-semibold leading-7 text-fg-primary sm:text-xl">{title}</h1>
    </div>
  );
}

/** The post's text in a well of one height that scrolls (Inhalte's "Text zum Beitrag"). */
export function CaptionWell({ caption }: { caption: string | null }) {
  return (
    <ScrollHint className={cn("flex flex-col", WELL)}>
      <div
        role="region"
        aria-label="Text zum Beitrag"
        tabIndex={0}
        className="scroll-shadows elev-inset min-h-0 flex-1 rounded-[var(--r-panel)] px-4 py-3 text-[15px] leading-6 text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {caption ? (
          <p className="whitespace-pre-wrap break-words">{caption}</p>
        ) : (
          <p className="text-fg-secondary">Dieser Beitrag hat keinen Text.</p>
        )}
      </div>
    </ScrollHint>
  );
}

/**
 * The decision's band when there is nothing to decide: the recorded decision
 * (a dot and dark text, POST_STATUS' colours) or why not, in the place of the
 * two buttons, so the post above never moves.
 */
export function Outcome({ dot, children, note }: { dot?: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div role="status">
      {/* The dot stays on the first line when the sentence wraps. */}
      <p className="flex min-h-[var(--control-h)] items-center text-[15px] font-medium leading-5 text-fg-primary">
        <span className="flex min-w-0 gap-2">
          {dot && <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot)} />}
          <span className="min-w-0 break-words">{children}</span>
        </span>
      </p>
      {note}
    </div>
  );
}

/**
 * Frist and KI-Hinweis under the decision (Stripe's details list, as on
 * Inhalte). Under the buttons on purpose: a row that only some posts have
 * moves nothing that matters.
 */
export function Facts({ due, ki }: { due: string | null; ki: string | null }) {
  if (!due && !ki) return null;
  return (
    <dl className={cn("mt-4 text-[15px] leading-5", DETAIL_LINES)}>
      {due && (
        <Detail label="Frist">
          <span className="tabular-nums">Bis {due}</span>
          <span className="block text-fg-secondary">Ohne Ihre Freigabe geht kein Beitrag online.</span>
        </Detail>
      )}
      {ki && <Detail label="KI-Hinweis">{ki}</Detail>}
    </dl>
  );
}
