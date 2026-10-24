import { notFound } from "next/navigation";
import {
  isValidTokenShape,
  resolveToken,
} from "@/lib/portal-review-tokens";
import { saveRating } from "./actions";
import { AutoOpenPublic } from "./auto-open-public";
import { FeedbackForm } from "./feedback-form";
import { SaveOnInteraction } from "./save-on-interaction";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ihre Bewertung",
  robots: { index: false, follow: false },
};

/**
 * EINS Bewertungen: where a star from the review-request email lands
 * (apps/portal/src/server/email/templates/review-request.ts).
 *
 * Routing by stars (Karam's decision of 2026-10-10; known risks in
 * apps/portal/docs/eins-bewertungen.md):
 *   - 4 or 5 stars: no page of our own. The public review (Google, or Jameda
 *     when that is the practice's platform) opens at once (AutoOpenPublic).
 *   - 1 to 3 stars: a message form that goes only to the practice.
 *   - no stars (bare link or a bounced redirect): the five stars first.
 *
 * Opening a link books nothing (E-31): link scanners open every star link.
 * 4 and 5 are booked by the POST to /r/<token>/go that the page submits by
 * script; 1 to 3 on the patient's first real interaction (SaveOnInteraction),
 * on a star tap (saveRating) or with the message.
 *
 * Token-as-auth: holding the URL implies the patient may act. The token
 * resolves on the portal to one clinic and one patient.
 */

// Neutral palette and system font for the patient-facing review surface,
// injected as CSS vars so the per-clinic brand defaults from globals.css stay
// scoped to the landing pages.
const theme = {
  "--brand-primary": "#10101a",
  "--brand-primary-soft": "#f4f4f6",
  "--brand-bg": "#ffffff",
  "--brand-bg-soft": "#f4f4f6",
  "--brand-fg": "#10101a",
  "--brand-fg-muted": "#6a6a74",
  "--brand-border": "#e4e4e7",
  "--brand-radius": "12px",
  "--brand-font": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  "--brand-font-display": "var(--brand-font)",
  fontFamily: "var(--brand-font)",
} as React.CSSProperties;

const STAR_GOLD = "#F5B400";
const STAR_EMPTY = "#E4E4E7";

type Platform = "google" | "jameda";

export default async function Page({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { rating?: string; err?: string; p?: string };
}) {
  const { token } = params;
  if (!isValidTokenShape(token)) notFound();

  const data = await resolveToken(token);
  if (!data) notFound();

  const ratingRaw = searchParams.rating ? Number(searchParams.rating) : null;
  const rating =
    ratingRaw !== null && Number.isInteger(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5
      ? ratingRaw
      : null;

  const recorded = data.recall.recordedRating;
  // After a message the submitted rating is final (the portal ignores later
  // star clicks), so the page only thanks.
  const feedbackDone = Boolean(data.recall.feedbackAt);
  const shown = feedbackDone ? recorded : rating ?? recorded;
  const needsSave = !feedbackDone && rating !== null && rating !== recorded;
  const bounced = searchParams.err === "platform_not_configured" || searchParams.err === "invalid_review_url";

  const { clinic } = data;
  const primary = primaryPlatform(clinic);
  const shell = (children: React.ReactNode) => (
    <Shell clinicName={clinic.displayName} token={token}>
      {children}
    </Shell>
  );

  if (feedbackDone) {
    return shell(
      <>
        <Headline>Danke für Ihre Nachricht.</Headline>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-brand-fg-muted">
          Sie ist bei der Praxisleitung angekommen.
        </p>
      </>
    );
  }

  // A platform redirect bounced (profile missing or not an allowed host):
  // no second redirect, offer the message instead.
  if (bounced) {
    return shell(
      <>
        <Headline>Danke für Ihre Bewertung.</Headline>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-brand-fg-muted">
          Das Bewertungsprofil der Praxis ist gerade nicht erreichbar. Schreiben Sie
          der Praxis gern direkt.
        </p>
        <div className="mt-7">
          <FeedbackForm token={token} rating={shown} requireText={false} />
        </div>
      </>
    );
  }

  if (shown === null) {
    return shell(
      <>
        <Headline>Wie war Ihr Besuch?</Headline>
        <StarPicker token={token} selected={null} />
        <p className="mt-2 text-center text-[13px] text-brand-fg-muted">
          Tippen Sie auf einen Stern.
        </p>
      </>
    );
  }

  if (shown >= 4) {
    if (primary) {
      const name = platformName(primary);
      return shell(
        <>
          <Headline>Danke, das freut uns!</Headline>
          <p className="mt-3 text-center text-[15px] leading-relaxed text-brand-fg-muted">
            {name} öffnet sich. Dort tippen Sie Ihre Sterne noch einmal an, ein Satz reicht.
          </p>
          <AutoOpenPublic
            href={`/r/${encodeURIComponent(token)}/go?platform=${primary}`}
            rating={shown}
            label={`${name} öffnen`}
            onceKey={`eins-review-open:${token}`}
          />
        </>
      );
    }
    // No public profile configured: thank and leave room for a message.
    return shell(
      <>
        {needsSave && rating !== null && <SaveOnInteraction token={token} rating={rating} />}
        <Headline>Danke, das freut uns!</Headline>
        <p className="mt-3 text-center text-[15px] leading-relaxed text-brand-fg-muted">
          Möchten Sie der Praxis noch etwas mitteilen?
        </p>
        <div className="mt-7">
          <FeedbackForm token={token} rating={shown} requireText={false} />
        </div>
      </>
    );
  }

  // 1 to 3 stars: message to the practice only.
  return shell(
    <>
      {needsSave && rating !== null && <SaveOnInteraction token={token} rating={rating} />}
      <Headline>{shown === 3 ? "Danke für Ihre Rückmeldung." : "Das tut uns leid."}</Headline>
      <p className="mt-3 text-center text-[15px] leading-relaxed text-brand-fg-muted">
        Was können wir besser machen? Ihre Nachricht geht direkt an die
        Praxisleitung und wird nicht veröffentlicht.
      </p>
      <StarPicker token={token} selected={shown} />
      <div className="mt-6">
        <FeedbackForm token={token} rating={shown} requireText />
      </div>
    </>
  );
}

function primaryPlatform(clinic: {
  googleReviewUrl: string | null;
  jamedaReviewUrl: string | null;
  suggestedPlatform: Platform | null;
}): Platform | null {
  if (clinic.suggestedPlatform === "jameda" && clinic.jamedaReviewUrl) return "jameda";
  if (clinic.googleReviewUrl) return "google";
  if (clinic.jamedaReviewUrl) return "jameda";
  return null;
}

function platformName(p: Platform): string {
  return p === "google" ? "Google" : "Jameda";
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Shell({
  clinicName,
  token,
  children,
}: {
  clinicName: string;
  token: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-[100dvh] bg-brand-bg-soft px-4 py-8 sm:py-14" style={theme}>
      <div className="mx-auto w-full max-w-[460px]">
        <article className="rounded-[20px] border border-brand-border bg-brand-bg px-6 py-8 shadow-[0_1px_2px_rgba(16,16,26,0.04),0_16px_40px_-20px_rgba(16,16,26,0.14)] sm:px-9 sm:py-10">
          <p className="text-center text-[13px] font-semibold tracking-[0.01em] text-brand-fg-muted">
            {clinicName}
          </p>
          {children}
        </article>
        <p className="mt-5 px-2 text-center text-[12px] leading-relaxed text-brand-fg-muted">
          <a
            href={`/r/unsubscribe?token=${encodeURIComponent(token)}`}
            className="underline underline-offset-2 hover:text-brand-fg"
          >
            Keine weiteren E-Mails dieser Art
          </a>
          {" · "}Versand über EINS im Auftrag der Praxis
        </p>
      </div>
    </main>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mt-3 text-center text-[24px] font-semibold leading-tight tracking-[-0.01em] text-brand-fg">
      {children}
    </h1>
  );
}

/**
 * Five stars as one form: each star is a submit button carrying its value,
 * so a tap books the rating (saveRating) and reloads with ?rating=N, which
 * then routes like a star from the email. Works without JavaScript.
 */
function StarPicker({ token, selected }: { token: string; selected: number | null }) {
  return (
    <form action={saveRating} className="mt-6 flex justify-center gap-1.5" aria-label="Sterne vergeben">
      <input type="hidden" name="token" value={token} />
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="submit"
          name="rating"
          value={n}
          aria-label={`${n} von 5 Sternen`}
          aria-pressed={selected === n}
          className="rounded-[10px] p-1 transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-fg active:scale-95"
        >
          <StarIcon filled={selected !== null && n <= selected} />
        </button>
      ))}
    </form>
  );
}

/** Same rounded star as the portal's star-rating.svg, filled. */
function StarIcon({ filled }: { filled: boolean }) {
  const color = filled ? STAR_GOLD : STAR_EMPTY;
  return (
    <svg viewBox="0 0 100 100" aria-hidden className="h-11 w-11">
      <path
        d="M50 9 L60.58 39.44 L92.79 40.12 L67.12 59.56 L76.41 90.42 L50 72 L23.59 90.42 L32.88 59.56 L7.21 40.12 L39.42 39.44 Z"
        fill={color}
        stroke={color}
        strokeWidth={8}
        strokeLinejoin="round"
      />
    </svg>
  );
}
