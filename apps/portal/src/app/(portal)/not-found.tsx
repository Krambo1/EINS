import Link from "next/link";
import { Button } from "@eins/ui";
import { PageHeader } from "./_components/PageHeader";
import { CardBody, CardFoot, PRIMARY_BUTTON } from "./einstellungen/_components/settings-ui";

export const metadata = { title: "Seite nicht gefunden" };

/**
 * Not-found for every page inside the portal shell (sidebar stays). Without
 * it, a page's `notFound()` falls through to the root `app/not-found.tsx`,
 * which a production build renders above `(portal)/layout.tsx`, so the
 * sidebar and the logo disappear.
 *
 * Laid out like the in-shell `error.tsx`: the title on the logo row, one
 * card with the sentence and the way out. It reads no params and looks
 * nothing up, so an id of another Praxis and an id that never existed show
 * the same page. The layout's session gate has already run when this
 * renders; unknown addresses never reach it and still get the root
 * `app/not-found.tsx`.
 */
export default function PortalNotFound() {
  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <PageHeader title="Seite nicht gefunden" />
      <div className="anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]">
        <CardBody className="pt-5 md:pt-6">
          <p className="text-[15px] leading-6 text-fg-primary">
            Die angeforderte Seite existiert nicht oder wurde verschoben.
          </p>
        </CardBody>
        <CardFoot>
          <Button asChild className={PRIMARY_BUTTON}>
            <Link href="/">Zur Übersicht</Link>
          </Button>
        </CardFoot>
      </div>
    </div>
  );
}
