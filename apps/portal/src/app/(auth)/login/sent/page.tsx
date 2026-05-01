export const metadata = { title: "E-Mail versendet" };

type Search = { email?: string };

export default async function MagicLinkSentPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { email } = await searchParams;
  return (
    <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 text-center shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/15 text-2xl">
        ✉
      </div>
      <h1 className="mt-6 text-2xl font-semibold">E-Mail unterwegs.</h1>
      <p className="mt-3 text-base text-fg-primary">
        Wir haben Ihnen einen Anmelde-Link gesendet
        {email ? (
          <>
            {" "}an <strong className="whitespace-nowrap">{email}</strong>
          </>
        ) : null}
        .
      </p>
      <p className="mt-4 text-sm text-fg-secondary">
        Der Link ist 15 Minuten lang gültig und kann nur einmal verwendet werden.
        Sollte die E-Mail nicht in den nächsten Minuten ankommen, prüfen Sie bitte
        Ihren Spam-Ordner.
      </p>
    </div>
  );
}
