import { isValidTokenShape } from "@/lib/portal-review-tokens";
import { confirmUnsubscribe } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Vom Bewertungs-Erinnern abmelden",
  robots: { index: false, follow: false },
};

/**
 * EINS Bewertungen: unsubscribe page for the footer link of the review mail.
 *
 * GET shows ONE button and changes nothing (B-22): mail security scanners
 * open every link and would otherwise opt patients out silently. The button
 * posts to a server action, which calls the portal. Mail clients with RFC 8058
 * one-click POST straight to the portal API (List-Unsubscribe header) and
 * never see this page.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: { token?: string; status?: string };
}) {
  const token = searchParams.token ?? "";
  const valid = isValidTokenShape(token);
  const status = searchParams.status;
  const result = {
    ok: valid && status === "done",
    clinicName: null as string | null,
  };

  if (valid && status !== "done" && status !== "failed") {
    return (
      <main className="min-h-[100dvh] bg-brand-bg-soft">
        <div className="mx-auto max-w-xl px-4 py-16 md:py-24">
          <div className="rounded-brand-lg border border-brand-border bg-brand-bg p-8 text-center sm:p-10">
            <h1 className="mt-2 text-2xl font-semibold text-brand-fg">
              Keine Bewertungs-Erinnerungen mehr?
            </h1>
            <p className="mt-3 text-brand-fg-muted">
              Mit einem Klick melden Sie sich ab. Danach erhalten Sie von dieser
              Praxis keine Erinnerungen rund um Bewertungen mehr per E-Mail.
            </p>
            <form action={confirmUnsubscribe} className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-brand bg-brand-primary px-5 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                Jetzt abmelden
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  }

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
