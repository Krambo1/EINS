import { notFound } from "next/navigation";
import {
  isValidTokenShape,
  postClick,
  resolveToken,
} from "@/lib/portal-review-tokens";
import { FeedbackForm } from "./feedback-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Ihre Rückmeldung",
  robots: { index: false, follow: false },
};

/**
 * EINS Bewertungen  patient-facing rating landing.
 *
 * Visual shell mirrors the review-request email (apps/portal/src/server/email/
 * templates/review-request.ts) so the patient feels continuity from inbox to
 * page: same soft-gray surface, white card with composite shadow, 20px radius,
 * tiny EINS infra mark in the corner, Praxis lockup as visible brand.
 *
 * Compliance funnel preserved: every rating sees both the public Google /
 * Jameda CTA AND the private feedback form. Visual prominence flips with the
 * rating (high : public hero, private subtle link / low : private primary,
 * public secondary). Neither side is hidden. See apps/portal/docs/eins-bewertungen.md
 * for legal basis (BGH 2022 + Google GMB review policy + UWG §7).
 *
 * Token-as-auth: holding the URL implies the patient is allowed to act. The
 * token resolves on the portal to one clinic + one patient. No cross-clinic
 * data leaks.
 */

// EINS palette (matches review-request.ts email tokens 1:1) injected as CSS
// vars on the main element so the per-clinic brand defaults from globals.css
// stay scoped to other surfaces.
const einsTheme = {
  "--brand-primary": "#58BAB5",
  "--brand-primary-soft": "#dff1ef",
  "--brand-bg": "#ffffff",
  "--brand-bg-soft": "#f2f2f4",
  "--brand-fg": "#10101a",
  "--brand-fg-muted": "#6a6a74",
  "--brand-border": "#e4e4e7",
  "--brand-radius": "14px",
} as React.CSSProperties;

// Layered composite drop shadow taken from the email card.
const cardShadow =
  "0 1px 2px rgba(16,16,26,0.05), 0 6px 18px -4px rgba(16,16,26,0.08), 0 24px 48px -22px rgba(16,16,26,0.10)";

// Soft mint glow under the primary CTA.
const primaryButtonShadow =
  "0 1px 2px rgba(16,16,26,0.05), 0 10px 24px -8px rgba(88,186,181,0.45)";

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

  // Parse rating from query, clamp to 1..5, default null.
  const ratingRaw = searchParams.rating ? Number(searchParams.rating) : null;
  const rating =
    ratingRaw !== null &&
    Number.isInteger(ratingRaw) &&
    ratingRaw >= 1 &&
    ratingRaw <= 5
      ? (ratingRaw as 1 | 2 | 3 | 4 | 5)
      : null;

  // Record the landing click (best-effort, awaited so failures don't surprise).
  if (rating !== null) {
    await postClick(token, { rating, target: "land" });
  }

  // Effective rating that drives layout primacy: query override > already
  // recorded > none.
  const effectiveRating = rating ?? data.recall.recordedRating;
  const isHighRating = effectiveRating !== null && effectiveRating >= 4;

  const { clinic, patient } = data;
  const greeting = patient.firstName
    ? `Liebe Patientin, lieber Patient ${patient.firstName}`
    : `Liebe Patientin, lieber Patient`;

  const publicHref =
    clinic.suggestedPlatform === "google" && clinic.googleReviewUrl
      ? `/r/${encodeURIComponent(token)}/go?platform=google`
      : clinic.suggestedPlatform === "jameda" && clinic.jamedaReviewUrl
      ? `/r/${encodeURIComponent(token)}/go?platform=jameda`
      : null;

  const secondaryHref =
    clinic.suggestedPlatform === "google" && clinic.jamedaReviewUrl
      ? `/r/${encodeURIComponent(token)}/go?platform=jameda`
      : clinic.suggestedPlatform === "jameda" && clinic.googleReviewUrl
      ? `/r/${encodeURIComponent(token)}/go?platform=google`
      : null;

  const publicLabel =
    clinic.suggestedPlatform === "google"
      ? "Bei Google bewerten"
      : clinic.suggestedPlatform === "jameda"
      ? "Bei Jameda bewerten"
      : null;
  const secondaryLabel =
    clinic.suggestedPlatform === "google" && clinic.jamedaReviewUrl
      ? "Lieber Jameda? Hier entlang."
      : clinic.suggestedPlatform === "jameda" && clinic.googleReviewUrl
      ? "Lieber Google? Hier entlang."
      : null;

  return (
    <main
      className="min-h-[100dvh] bg-brand-bg-soft py-8 sm:py-14"
      style={einsTheme}
    >
      <div className="mx-auto w-full max-w-[640px] px-4">
        <article
          className="rounded-[20px] border border-brand-border bg-brand-bg p-6 sm:p-12"
          style={{ boxShadow: cardShadow }}
        >
          <BrandRow />
          <PracticeLockup name={clinic.displayName} />

          <h1 className="mb-5 text-[28px] font-semibold leading-[1.15] tracking-[-0.005em] text-brand-fg">
            {greeting},
          </h1>

          <p className="text-[15.5px] leading-[1.6] tracking-[0.005em] text-brand-fg">
            {effectiveRating !== null
              ? thankYouFor(effectiveRating)
              : "Ihr Feedback hilft uns, besser zu werden. Sie wählen, wie Sie es uns geben möchten."}
          </p>

          {/* Friendly notice when the /go redirector found the requested
              platform (Google/Jameda) wasn't configured for this Praxis. */}
          {searchParams.err === "platform_not_configured" && (
            <div
              role="status"
              className="mt-6 rounded-[12px] border border-brand-border bg-brand-bg-soft p-4 text-[13.5px] leading-[1.5] text-brand-fg"
            >
              {searchParams.p === "google"
                ? "Diese Praxis hat noch kein Google-Profil hinterlegt."
                : searchParams.p === "jameda"
                ? "Diese Praxis hat noch kein Jameda-Profil hinterlegt."
                : "Diese Plattform ist nicht konfiguriert."}{" "}
              Sie können stattdessen gerne unten direkt Feedback hinterlassen.
            </div>
          )}

          {effectiveRating !== null && (
            <div className="mt-6">
              <StarBadge rating={effectiveRating} />
            </div>
          )}

          <div className="mt-7">
            {isHighRating ? (
              <>
                <PublicHero
                  publicHref={publicHref}
                  publicLabel={publicLabel}
                  secondaryHref={secondaryHref}
                  secondaryLabel={secondaryLabel}
                  publicPlatform={clinic.suggestedPlatform}
                />
                <PrivateSubtle
                  token={token}
                  effectiveRating={effectiveRating ?? 5}
                />
              </>
            ) : (
              <>
                <PrivateBlock
                  primary
                  token={token}
                  effectiveRating={effectiveRating ?? 3}
                />
                <Divider />
                <PublicBlock
                  primary={false}
                  publicHref={publicHref}
                  publicLabel={publicLabel}
                  secondaryHref={secondaryHref}
                  secondaryLabel={secondaryLabel}
                  publicPlatform={clinic.suggestedPlatform}
                />
              </>
            )}
          </div>

          <div className="mt-9 h-px bg-brand-border" />
          <p className="mt-5 text-[12.5px] leading-[1.55] tracking-[0.012em] text-brand-fg-muted">
            Sie können sich jederzeit von weiteren Erinnerungen{" "}
            <a
              href={`/r/unsubscribe?token=${encodeURIComponent(token)}`}
              className="text-brand-fg underline underline-offset-2 hover:opacity-70"
            >
              abmelden
            </a>
            .
          </p>
        </article>

        <p className="mt-5 px-2 text-[12px] leading-[1.5] tracking-[0.012em] text-brand-fg-muted">
          Versendet über EINS &middot; Antworten landen direkt in Ihrer
          Praxis-Inbox.
        </p>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function BrandRow() {
  return (
    <div className="mb-5 flex items-center gap-2">
      <img
        src="/eins-logo.png"
        alt="EINS"
        width={35}
        height={14}
        className="block h-[14px] w-[35px]"
      />
      <span className="text-[12px] leading-none tracking-[0.012em] text-brand-fg-muted">
        Versendet im Auftrag Ihrer Praxis
      </span>
    </div>
  );
}

function PracticeLockup({ name }: { name: string }) {
  return (
    <div className="mb-8 text-[22px] font-semibold leading-[1.15] tracking-[-0.005em] text-brand-fg">
      {name}
    </div>
  );
}

function StarBadge({ rating }: { rating: number }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-brand-bg-soft px-3 py-1.5">
      <span aria-hidden className="text-[14px] leading-none">
        <span style={{ color: "#E8B73C" }}>{"★".repeat(rating)}</span>
        <span style={{ color: "#d1d1d6" }}>{"☆".repeat(5 - rating)}</span>
      </span>
      <span className="text-[12.5px] tabular-nums text-brand-fg-muted">
        {rating} / 5
      </span>
    </div>
  );
}

function thankYouFor(rating: number): string {
  if (rating >= 5) {
    return "Wunderbar, dass Sie zufrieden waren. Schenken Sie anderen Patient:innen Orientierung, oder schreiben Sie uns persönlich. Sie entscheiden.";
  }
  if (rating === 4) {
    return "Schön, dass es überwiegend gut war. Wenn es etwas zu verbessern gibt, sagen Sie es uns direkt, oder teilen Sie Ihre Erfahrung öffentlich.";
  }
  if (rating === 3) {
    return "Danke für Ihre Offenheit. Erzählen Sie uns gerne, was wir besser machen können. Diese Rückmeldung sehen ausschließlich wir.";
  }
  return "Das tut uns leid. Bitte geben Sie uns die Chance, es richtigzustellen. Ihre Rückmeldung geht direkt und vertraulich an die Praxisleitung.";
}

function Divider() {
  return <div aria-hidden className="my-7 h-px bg-brand-border" />;
}

// ---------------------------------------------------------------------------
// Public block (Google / Jameda CTA)
// ---------------------------------------------------------------------------

/**
 * Inline Google "G" mark, 4-color, on white. Renders inside a white pill so
 * the logo always sits on a white background even when the surrounding button
 * uses the EINS mint primary. This matches Google's brand guidelines for the
 * "G" mark (must appear on a white or light surface).
 */
function GoogleG({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
    >
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-0.792 2.237-2.231 4.166-4.087 5.571 0.001-0.001 0.002-0.001 0.003-0.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

/**
 * PublicHero  hero CTA used when the patient just rated 4 or 5 stars.
 * Full-width pill button, soft mint glow shadow, Google G mark inside a
 * white pill when the public platform is Google.
 */
function PublicHero({
  publicHref,
  publicLabel,
  secondaryHref,
  secondaryLabel,
  publicPlatform,
}: {
  publicHref: string | null;
  publicLabel: string | null;
  secondaryHref: string | null;
  secondaryLabel: string | null;
  publicPlatform: "google" | "jameda" | null;
}) {
  if (!publicHref || !publicLabel) {
    return (
      <section aria-labelledby="public-h">
        <h2 id="public-h" className="text-[13px] font-semibold text-brand-fg-muted">
          Öffentlich bewerten
        </h2>
        <p className="mt-2 text-[13.5px] text-brand-fg-muted">
          Diese Praxis bietet derzeit keine öffentliche Bewertungsmöglichkeit.
        </p>
      </section>
    );
  }
  const showGoogleG = publicPlatform === "google";
  return (
    <section aria-labelledby="public-h">
      <h2 id="public-h" className="sr-only">
        Öffentlich bewerten
      </h2>
      <a
        href={publicHref}
        rel="noopener"
        className="group flex w-full items-center justify-center gap-3 rounded-[14px] bg-brand-primary px-5 py-[18px] text-[16px] font-semibold text-white transition hover:brightness-95 sm:py-[22px] sm:text-[17px]"
        style={{ boxShadow: primaryButtonShadow }}
      >
        {showGoogleG && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
            <GoogleG className="h-[18px] w-[18px]" />
          </span>
        )}
        <span>{publicLabel}</span>
        <span
          aria-hidden
          className="transition-transform group-hover:translate-x-0.5"
        >
          →
        </span>
      </a>
      {secondaryHref && secondaryLabel && (
        <div className="mt-3 text-center">
          <a
            href={secondaryHref}
            rel="noopener"
            className="text-[13px] text-brand-fg-muted underline-offset-4 hover:underline"
          >
            {secondaryLabel}
          </a>
        </div>
      )}
    </section>
  );
}

/**
 * PrivateSubtle  the private feedback path kept reachable but visually
 * deemphasized under the hero CTA. Required by the compliant funnel rule:
 * even for high ratings the patient must be able to pick "directly to the
 * Praxis" without going hunting (BGH 09.08.2022, Google GMB policy,
 * EINS Bewertungen spec).
 */
function PrivateSubtle({
  token,
  effectiveRating,
}: {
  token: string;
  effectiveRating: number;
}) {
  return (
    <div className="mt-7 border-t border-brand-border pt-5 text-center">
      <FeedbackForm
        token={token}
        defaultRating={effectiveRating}
        collapsed
      />
      <p className="mt-2 text-[12px] leading-[1.5] text-brand-fg-muted">
        Vertraulich, geht ausschließlich an die Praxisleitung.
      </p>
    </div>
  );
}

/**
 * PrivateBlock  primary or secondary private-feedback section, used in the
 * low-rating branch.
 */
function PrivateBlock({
  primary,
  token,
  effectiveRating,
}: {
  primary: boolean;
  token: string;
  effectiveRating: number;
}) {
  return (
    <section aria-labelledby="private-h">
      <h2
        id="private-h"
        className={
          primary
            ? "text-[17px] font-semibold text-brand-fg"
            : "text-[13px] font-semibold text-brand-fg-muted"
        }
      >
        {primary ? "Direkte Rückmeldung an die Praxis" : "Lieber direkt an uns?"}
      </h2>
      <p
        className={
          primary
            ? "mt-2 text-[14.5px] leading-[1.55] text-brand-fg-muted"
            : "mt-1 text-[13.5px] text-brand-fg-muted"
        }
      >
        Vertraulich, geht ausschließlich an die Praxisleitung. Keine
        Veröffentlichung.
      </p>
      <div className={primary ? "mt-4" : "mt-3"}>
        <FeedbackForm
          token={token}
          defaultRating={effectiveRating}
          collapsed={!primary}
        />
      </div>
    </section>
  );
}

/**
 * PublicBlock  secondary public-CTA section, used in the low-rating branch.
 * Smaller button, no hero shadow.
 */
function PublicBlock({
  primary,
  publicHref,
  publicLabel,
  secondaryHref,
  secondaryLabel,
  publicPlatform,
}: {
  primary: boolean;
  publicHref: string | null;
  publicLabel: string | null;
  secondaryHref: string | null;
  secondaryLabel: string | null;
  publicPlatform: "google" | "jameda" | null;
}) {
  if (!publicHref || !publicLabel) {
    return (
      <section aria-labelledby="public-h">
        <h2 id="public-h" className="text-[13px] font-semibold text-brand-fg-muted">
          Öffentlich bewerten
        </h2>
        <p className="mt-2 text-[13.5px] text-brand-fg-muted">
          Diese Praxis bietet derzeit keine öffentliche Bewertungsmöglichkeit.
        </p>
      </section>
    );
  }
  const showGoogleG = publicPlatform === "google";
  return (
    <section aria-labelledby="public-h">
      <h2
        id="public-h"
        className={
          primary
            ? "text-[17px] font-semibold text-brand-fg"
            : "text-[13px] font-semibold text-brand-fg-muted"
        }
      >
        {primary ? "Öffentlich bewerten" : "Lieber öffentlich teilen?"}
      </h2>
      <p
        className={
          primary
            ? "mt-2 text-[14.5px] leading-[1.55] text-brand-fg-muted"
            : "mt-1 text-[13.5px] text-brand-fg-muted"
        }
      >
        Ihre Bewertung hilft anderen Patient:innen bei der Entscheidung.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={publicHref}
          rel="noopener"
          className="inline-flex items-center gap-2 rounded-[12px] border border-brand-border bg-brand-bg px-4 py-2.5 text-[14px] font-medium text-brand-fg transition hover:bg-brand-bg-soft"
        >
          {showGoogleG && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white">
              <GoogleG className="h-[14px] w-[14px]" />
            </span>
          )}
          {publicLabel}
        </a>
        {secondaryHref && secondaryLabel && (
          <a
            href={secondaryHref}
            rel="noopener"
            className="inline-flex items-center justify-center rounded-[12px] px-2 py-2.5 text-[13.5px] text-brand-fg-muted underline-offset-4 hover:underline"
          >
            {secondaryLabel}
          </a>
        )}
      </div>
    </section>
  );
}
