export const dynamic = "force-dynamic";

export const metadata = {
  title: "Bestätigungs-Link ungültig",
  robots: { index: false, follow: false },
};

export default function ExpiredPage() {
  return (
    <main className="min-h-[80vh] bg-brand-bg-soft">
      <div className="container mx-auto max-w-xl px-4 py-16 md:py-24">
        <div className="rounded-brand-lg border border-brand-border bg-brand-bg p-8 text-center sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-bg-soft">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-brand-fg-muted"
              aria-hidden
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-brand-fg">
            Bestätigungs-Link ungültig oder abgelaufen
          </h1>
          <p className="mt-3 text-brand-fg-muted">
            Dieser Bestätigungs-Link ist nicht mehr gültig. Sehr wahrscheinlich ist er älter als
            48&nbsp;Stunden — aus Datenschutzgründen laufen Double-Opt-In-Links nach Ablauf dieser
            Frist automatisch aus.
          </p>
          <p className="mt-3 text-sm text-brand-fg-muted">
            Falls Sie weiterhin Informationen erhalten möchten, senden Sie bitte einfach erneut eine
            Anfrage über die Praxis-Seite. Ihre bisherige Anfrage zur Beratung ist hiervon nicht
            betroffen und wurde bereits an die Praxis übermittelt.
          </p>
        </div>
      </div>
    </main>
  );
}
