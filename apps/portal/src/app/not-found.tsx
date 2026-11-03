import Link from "next/link";
import { PAGE_TITLE } from "./(portal)/_components/PageHeader";

export const metadata = { title: "Seite nicht gefunden" };

/**
 * Root not-found.tsx. Next.js renders this for any unmatched route and for
 * server components that call `notFound()`. The framework attaches the
 * 404 status code automatically — adding this page does not change that;
 * it only replaces the bare default 404 with the German house copy.
 *
 * It shows on its own: an unknown address, and an admin page's `notFound()`
 * (admin has no not-found of its own). A portal page's `notFound()` gets
 * `(portal)/not-found.tsx`, inside the shell. On the canvas (the admin
 * host's dark ground in its dark theme): the title, one sentence and the way
 * home, centred as on Linear's not-found page. The canvas is a fixed layer
 * behind the page, so it fills the screen, and the block stays short enough
 * not to scroll.
 */
export default function NotFoundPage() {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-2 p-6 text-center before:fixed before:inset-0 before:-z-10 before:bg-[var(--surface-canvas)] [[data-theme=dark]_&]:before:bg-bg-primary">
      <h1 className={PAGE_TITLE}>Seite nicht gefunden</h1>
      <p className="text-[15px] leading-6 text-fg-secondary">
        Die angeforderte Seite existiert nicht oder wurde verschoben.
      </p>
      <Link
        href="/"
        className="mt-2 rounded-[var(--r-small)] text-sm font-medium text-fg-primary underline underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Zur Startseite
      </Link>
    </main>
  );
}
