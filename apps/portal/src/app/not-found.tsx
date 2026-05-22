import Link from "next/link";

export const metadata = { title: "Seite nicht gefunden" };

/**
 * Root not-found.tsx. Next.js renders this for any unmatched route and for
 * server components that call `notFound()`. The framework attaches the
 * 404 status code automatically — adding this page does not change that;
 * it only replaces the bare default 404 with the German house copy.
 */
export default function NotFoundPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg-primary p-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-fg-primary">
        Seite nicht gefunden
      </h1>
      <p className="text-fg-secondary">
        Die angeforderte Seite existiert nicht oder wurde verschoben.
      </p>
      <Link
        href="/"
        className="mt-2 text-sm text-accent underline underline-offset-4"
      >
        Zur Startseite
      </Link>
    </main>
  );
}
