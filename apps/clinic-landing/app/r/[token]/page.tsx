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
 * EINS Stimme — patient-facing rating landing.
 *
 * Renders the COMPLIANT funnel: every rating sees both the public Google /
 * Jameda CTA AND the private feedback form. Visual prominence flips with
 * the rating (high → public primary, low → private primary) but neither
 * branch is hidden. See `apps/portal/docs/eins-stimme.md` for legal basis
 * (BGH 2022 + Google GMB review policy + UWG §7).
 *
 * Token-as-auth: holding the URL implies the patient is allowed to act.
 * The token resolves on the portal to one clinic + one patient — no
 * cross-clinic data leaks.
 */
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

  // Parse rating from query — clamp to 1..5, default null.
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

  // Effective rating that drives layout primacy: query override > already recorded > none.
  const effectiveRating = rating ?? data.recall.recordedRating;
  const isHighRating = effectiveRating !== null && effectiveRating >= 4;

  const { clinic, patient } = data;
  const greeting = patient.firstName
    ? `Liebe Patientin, lieber Patient ${patient.firstName},`
    : `Liebe Patientin, lieber Patient,`;

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
    <main className="min-h-[100dvh] bg-brand-bg-soft">
      <div className="mx-auto max-w-xl px-4 py-12 md:py-20">
        <div className="rounded-brand-lg border border-brand-border bg-brand-bg p-6 sm:p-10">
          <p className="eyebrow">{clinic.displayName}</p>
          <h1 className="mt-3 text-2xl font-semibold text-brand-fg sm:text-3xl">
            {greeting.replace(/,$/, "")}
          </h1>
          <p className="mt-3 text-brand-fg-muted">
            {effectiveRating !== null
              ? thankYouFor(effectiveRating)
              : "Ihr Feedback hilft uns, besser zu werden. Sie wählen, wie Sie es uns geben möchten."}
          </p>

          {/* Friendly notice when the /go redirector found the requested
              platform (Google/Jameda) wasn't configured for this clinic. */}
          {searchParams.err === "platform_not_configured" && (
            <div
              role="status"
              className="mt-6 rounded-brand border border-brand-border bg-brand-bg-soft p-4 text-sm text-brand-fg"
            >
              {searchParams.p === "google"
                ? "Diese Praxis hat noch kein Google-Profil hinterlegt."
                : searchParams.p === "jameda"
                ? "Diese Praxis hat noch kein Jameda-Profil hinterlegt."
                : "Diese Plattform ist nicht konfiguriert."}{" "}
              Sie können stattdessen gerne unten direkt Feedback hinterlassen.
            </div>
          )}

          {/* Star reminder if we already know the rating */}
          {effectiveRating !== null && (
            <div className="mt-6 inline-flex items-center gap-2 rounded-brand bg-brand-bg-soft px-3 py-1.5 text-sm text-brand-fg">
              <span aria-hidden>{"★".repeat(effectiveRating)}{"☆".repeat(5 - effectiveRating)}</span>
              <span className="tabular-nums">{effectiveRating} / 5</span>
            </div>
          )}

          {/* Two blocks always present. Order flips by rating. */}
          {isHighRating ? (
            <>
              <PublicBlock
                primary
                publicHref={publicHref}
                publicLabel={publicLabel}
                secondaryHref={secondaryHref}
                secondaryLabel={secondaryLabel}
              />
              <Divider />
              <PrivateBlock
                primary={false}
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
              />
            </>
          )}

          <hr className="mt-10 border-brand-border" />
          <p className="mt-4 text-xs text-brand-fg-muted">
            Sie können sich jederzeit von weiteren Erinnerungen{" "}
            <a
              href={`/r/unsubscribe?token=${encodeURIComponent(token)}`}
              className="underline-offset-4 hover:underline"
            >
              abmelden
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}

function thankYouFor(rating: number): string {
  if (rating >= 5) {
    return "Wunderbar, dass Sie zufrieden waren. Schenken Sie anderen Patient:innen Orientierung — oder schreiben Sie uns persönlich. Sie entscheiden.";
  }
  if (rating === 4) {
    return "Schön, dass es überwiegend gut war. Wenn es etwas zu verbessern gibt, sagen Sie es uns direkt — oder teilen Sie Ihre Erfahrung öffentlich.";
  }
  if (rating === 3) {
    return "Danke für Ihre Offenheit. Erzählen Sie uns gerne, was wir besser machen können — diese Rückmeldung sehen ausschließlich wir.";
  }
  return "Das tut uns leid. Bitte geben Sie uns die Chance, es richtigzustellen — Ihre Rückmeldung geht direkt und vertraulich an die Praxisleitung.";
}

function Divider() {
  return (
    <div
      aria-hidden
      className="my-8 flex items-center gap-4 text-xs uppercase tracking-wider text-brand-fg-muted"
    >
      <span className="h-px flex-1 bg-brand-border" />
      oder
      <span className="h-px flex-1 bg-brand-border" />
    </div>
  );
}

function PublicBlock({
  primary,
  publicHref,
  publicLabel,
  secondaryHref,
  secondaryLabel,
}: {
  primary: boolean;
  publicHref: string | null;
  publicLabel: string | null;
  secondaryHref: string | null;
  secondaryLabel: string | null;
}) {
  if (!publicHref || !publicLabel) {
    // Praxis hasn't configured any public review URL. Show a placeholder
    // so the patient understands there's no third option.
    return (
      <section className="mt-8" aria-labelledby="public-h">
        <h2 id="public-h" className="text-sm font-semibold text-brand-fg-muted">
          Öffentlich bewerten
        </h2>
        <p className="mt-2 text-sm text-brand-fg-muted">
          Diese Praxis bietet derzeit keine öffentliche Bewertungsmöglichkeit.
        </p>
      </section>
    );
  }
  return (
    <section className={primary ? "mt-8" : "mt-2"} aria-labelledby="public-h">
      <h2
        id="public-h"
        className={
          primary
            ? "text-lg font-semibold text-brand-fg"
            : "text-sm font-semibold text-brand-fg-muted"
        }
      >
        {primary ? "Öffentlich bewerten" : "Lieber öffentlich teilen?"}
      </h2>
      <p
        className={
          primary ? "mt-2 text-brand-fg-muted" : "mt-1 text-sm text-brand-fg-muted"
        }
      >
        Ihre Bewertung hilft anderen Patient:innen bei der Entscheidung.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={publicHref}
          rel="noopener"
          className={
            primary
              ? "inline-flex items-center justify-center rounded-brand bg-brand-primary px-5 py-3 text-sm font-medium text-white hover:opacity-90"
              : "inline-flex items-center justify-center rounded-brand border border-brand-border bg-brand-bg px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-bg-soft"
          }
        >
          {publicLabel}
        </a>
        {secondaryHref && secondaryLabel && (
          <a
            href={secondaryHref}
            rel="noopener"
            className="inline-flex items-center justify-center rounded-brand border border-brand-border bg-brand-bg px-4 py-2 text-sm text-brand-fg hover:bg-brand-bg-soft"
          >
            {secondaryLabel}
          </a>
        )}
      </div>
    </section>
  );
}

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
    <section className={primary ? "mt-8" : "mt-2"} aria-labelledby="private-h">
      <h2
        id="private-h"
        className={
          primary
            ? "text-lg font-semibold text-brand-fg"
            : "text-sm font-semibold text-brand-fg-muted"
        }
      >
        {primary ? "Direkte Rückmeldung an die Praxis" : "Lieber direkt an uns?"}
      </h2>
      <p
        className={
          primary ? "mt-2 text-brand-fg-muted" : "mt-1 text-sm text-brand-fg-muted"
        }
      >
        Vertraulich, geht ausschließlich an die Praxisleitung — keine
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
