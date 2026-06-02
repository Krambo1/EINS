import {
  isValidTokenShape,
  postUnsubscribe,
} from "@/lib/portal-review-tokens";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Vom Bewertungs-Erinnern abmelden",
  robots: { index: false, follow: false },
};

/**
 * EINS Bewertungen — one-click unsubscribe target.
 *
 * Per §7 UWG / RFC 8058, clicking the unsubscribe link MUST take effect
 * without a further confirmation step. We process the request server-side
 * on first render and show a static confirmation page.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: { token?: string };
}) {
  const token = searchParams.token ?? "";
  const valid = isValidTokenShape(token);
  const result = valid
    ? await postUnsubscribe(token)
    : { ok: false, clinicName: null };

  return (
    <main className="min-h-[100dvh] bg-brand-bg-soft">
      <div className="mx-auto max-w-xl px-4 py-16 md:py-24">
        <div className="rounded-brand-lg border border-brand-border bg-brand-bg p-8 text-center sm:p-10">
          {result.ok ? (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary-soft">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-brand-primary"
                  aria-hidden
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h1 className="mt-5 text-2xl font-semibold text-brand-fg">
                Sie sind abgemeldet
              </h1>
              <p className="mt-3 text-brand-fg-muted">
                {result.clinicName ? (
                  <>
                    Sie erhalten ab jetzt keine Erinnerungen mehr von{" "}
                    <strong>{result.clinicName}</strong> rund um Patient:innen-Bewertungen.
                  </>
                ) : (
                  <>
                    Sie erhalten ab jetzt keine Erinnerungen mehr rund um
                    Patient:innen-Bewertungen.
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-2 text-2xl font-semibold text-brand-fg">
                Link nicht gültig
              </h1>
              <p className="mt-3 text-brand-fg-muted">
                Dieser Abmeldelink ist abgelaufen oder unvollständig. Bitte
                antworten Sie direkt auf die Praxis-E-Mail, dann melden wir
                Sie manuell ab.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
