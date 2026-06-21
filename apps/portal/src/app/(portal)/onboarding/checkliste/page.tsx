import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowLeft, Info } from "lucide-react";
import { Card, CardContent } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { getStorage } from "@/server/storage";
import {
  ABSCHLUSS_HINWEIS,
  ALL_CHECKLIST_ITEMS,
  CHECKLISTE_INTRO,
  REQUIRED_CHECKLIST_IDS,
  isDelivered,
  type ChecklistAnswer,
  type ChecklistStatus,
} from "./content";
import { ChecklisteForm, type ClientChecklistState } from "./ChecklisteForm";

export const metadata = { title: "Checkliste zum Start" };

/**
 * Asset-Liefer-Checkliste (Kunden-Onboarding Teil 2). Inhaber-only, like the
 * rest of /onboarding. The clinic delivers assets here (uploads, links,
 * angaben, self-checks); EINS confirms each in the admin. Reads run on the
 * superuser connection scoped explicitly to the session clinic (same pattern
 * as the Fragebogen page).
 */
export default async function ChecklistePage() {
  const session = await requirePermissionOrRedirect("onboarding.complete");

  const [itemRows, fileRows] = await Promise.all([
    db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.clinicId, session.clinicId)),
    db
      .select()
      .from(schema.checklistFiles)
      .where(eq(schema.checklistFiles.clinicId, session.clinicId))
      .orderBy(asc(schema.checklistFiles.uploadedAt)),
  ]);

  const filesWithUrls = await Promise.all(
    fileRows.map(async (f) => ({
      id: f.id,
      itemId: f.itemId,
      name: f.originalFilename,
      sizeBytes: f.sizeBytes,
      url: await getStorage().urlFor(f.storageKey),
    }))
  );

  // Assemble the per-item client state.
  const state: ClientChecklistState = {};
  for (const item of ALL_CHECKLIST_ITEMS) {
    state[item.id] = {
      status: "offen",
      answer: {},
      files: [],
      verifiedAt: null,
    };
  }
  for (const row of itemRows) {
    if (!state[row.itemId]) continue;
    state[row.itemId] = {
      status: row.status as ChecklistStatus,
      answer: (row.answer ?? {}) as ChecklistAnswer,
      files: [],
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    };
  }
  for (const f of filesWithUrls) {
    const bucket = state[f.itemId];
    if (!bucket) continue;
    bucket.files.push({
      id: f.id,
      name: f.name,
      sizeBytes: f.sizeBytes,
      url: f.url,
    });
  }

  const requiredDelivered = REQUIRED_CHECKLIST_IDS.filter((id) =>
    isDelivered(state[id]?.status)
  ).length;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href="/onboarding"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zu den ersten Schritten
        </Link>
        <h1 className="mt-3 text-3xl font-semibold md:text-4xl">
          Checkliste zum Start
        </h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          {CHECKLISTE_INTRO}
        </p>
      </header>

      <Card className="p-5 md:p-6">
        <CardContent className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <p className="text-sm text-fg-primary">
            <span className="font-medium">So funktioniert es:</span> Sie liefern
            jeden Punkt direkt hier im Portal (Häkchen, Datei-Upload, Link oder
            kurze Angabe). Wir prüfen jede Lieferung und bestätigen sie. Sie
            müssen nichts per E-Mail schicken. Bitte geben Sie niemals Passwörter
            weiter, wir fragen auch nie danach.
          </p>
        </CardContent>
      </Card>

      <ChecklisteForm initialState={state} requiredDelivered={requiredDelivered} />

      {/* Block G — laufende Mitwirkung. Information only. */}
      <Card className="p-5 md:p-6">
        <CardContent className="space-y-3">
          <h2 className="text-lg font-semibold">{ABSCHLUSS_HINWEIS.title}</h2>
          <p className="text-sm text-fg-secondary">{ABSCHLUSS_HINWEIS.intro}</p>
          <ul className="space-y-2">
            {ABSCHLUSS_HINWEIS.points.map((p) => (
              <li key={p} className="flex items-start gap-2 text-base text-fg-primary">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
