import { eq } from "drizzle-orm";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { PageHeader } from "../_components/PageHeader";
import { LEITFADEN_PAGE } from "./content";
import { SECTIONS } from "./_lib/sections";
import { LeitfadenView, PdfButton } from "./_components/LeitfadenView";

export const metadata = { title: LEITFADEN_PAGE.title };

/**
 * The Leitfaden for the Frontdesk, mostly with a patient on the phone or a
 * WhatsApp open: what do I say right now? Five cards (Anfragen beantworten,
 * Gespräch führen, Einwände, Termin festmachen, Sag so, nicht so) of rows
 * that open in place, a search over every row and the sections to jump to
 * (`LeitfadenView`). Scripts and templates sit in wells with "Kopieren", the
 * Praxis name filled in.
 *
 * The page shows only the `core` items of `content.ts`, built in
 * `_lib/sections.ts`; the complete playbook is the PDF on Dateien, made from
 * the same file, so the two never drift. Edit copy in `content.ts`, not here.
 */
export default async function LeitfadenPage({
  searchParams,
}: {
  searchParams: Promise<{ suche?: string }>;
}) {
  const session = await requirePermissionOrRedirect("leitfaden.view");
  const [params, clinicRows] = await Promise.all([
    searchParams,
    db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1),
  ]);

  return (
    <>
      {/* From md the search row is the first row and carries the PDF at its
          end (Anfragen); on the phone the title row stays, with the PDF beside
          it. Outside the stack, so the hidden heading adds no spacing step. */}
      <PageHeader
        title={LEITFADEN_PAGE.title}
        className="mb-4 md:sr-only"
        actions={<PdfButton label={LEITFADEN_PAGE.pdf} className="md:hidden" />}
      />
      <LeitfadenView
        sections={SECTIONS}
        labels={LEITFADEN_PAGE}
        praxisName={clinicRows[0]?.displayName ?? null}
        initialQuery={typeof params.suche === "string" ? params.suche : ""}
      />
    </>
  );
}
