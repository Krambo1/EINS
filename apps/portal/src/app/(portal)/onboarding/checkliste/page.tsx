import { and, asc, eq } from "drizzle-orm";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema, withClinicContext } from "@/db/client";
import {
  BOOKING_LINK_MEDIUM_LABELS,
  TRACKING_NUMBER_CHANNEL_LABELS,
  type BookingLinkMedium,
  type TrackingNumberChannel,
} from "@/lib/messweg";
import { getStorage } from "@/server/storage";
import { HeadCount, OnboardingHead, PageNote } from "../_components/OnboardingHead";
import { ONBOARDING_PAGE } from "../_lib/sizes";
import {
  ALL_CHECKLIST_ITEMS,
  REQUIRED_CHECKLIST_IDS,
  isDelivered,
  type ChecklistAnswer,
  type ChecklistStatus,
} from "./content";
import { ChecklisteForm, type ClientChecklistState } from "./ChecklisteForm";
import { AbschlussCard, MesswegeCard, type MesswegeRows } from "./parts";

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

  // Messwege (Block G): read through the Praxis's RLS context, the tables
  // only grant the app role SELECT on its own rows (migration 0098).
  const messwegePromise = withClinicContext(
    session.clinicId,
    session.userId,
    async (tx) => {
      const numbers = await tx
        .select({
          id: schema.trackingNumbers.id,
          e164: schema.trackingNumbers.e164,
          channel: schema.trackingNumbers.channel,
        })
        .from(schema.trackingNumbers)
        .where(
          and(
            eq(schema.trackingNumbers.clinicId, session.clinicId),
            eq(schema.trackingNumbers.active, true)
          )
        )
        .orderBy(asc(schema.trackingNumbers.createdAt));
      const links = await tx
        .select({
          id: schema.bookingLinks.id,
          url: schema.bookingLinks.url,
          medium: schema.bookingLinks.medium,
        })
        .from(schema.bookingLinks)
        .where(
          and(
            eq(schema.bookingLinks.clinicId, session.clinicId),
            eq(schema.bookingLinks.active, true)
          )
        )
        .orderBy(asc(schema.bookingLinks.createdAt));
      return { numbers, links };
    },
    "onboarding:messwege"
  );

  const [itemRows, fileRows, messwege] = await Promise.all([
    db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.clinicId, session.clinicId)),
    db
      .select()
      .from(schema.checklistFiles)
      .where(eq(schema.checklistFiles.clinicId, session.clinicId))
      .orderBy(asc(schema.checklistFiles.uploadedAt)),
    messwegePromise,
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
      updatedAt: null,
    };
  }
  for (const row of itemRows) {
    if (!state[row.itemId]) continue;
    state[row.itemId] = {
      status: row.status as ChecklistStatus,
      answer: (row.answer ?? {}) as ChecklistAnswer,
      files: [],
      verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
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

  const messwegeRows: MesswegeRows = {
    numbers: messwege.numbers.map((n) => ({
      id: n.id,
      text: `${n.e164} · ${TRACKING_NUMBER_CHANNEL_LABELS[n.channel as TrackingNumberChannel] ?? n.channel}`,
    })),
    links: messwege.links.map((l) => ({
      id: l.id,
      url: l.url,
      label: BOOKING_LINK_MEDIUM_LABELS[l.medium as BookingLinkMedium] ?? l.medium,
    })),
  };

  return (
    <div className={ONBOARDING_PAGE}>
      <OnboardingHead
        back
        title="Checkliste"
        count={<HeadCount>{`${requiredDelivered} von ${REQUIRED_CHECKLIST_IDS.length} Pflichtpunkten`}</HeadCount>}
      />
      {/* The one line kept from "So funktioniert es", word for word. */}
      <PageNote>Bitte geben Sie niemals Passwörter weiter, wir fragen auch nie danach.</PageNote>
      <ChecklisteForm
        initialState={state}
        after={
          <>
            <AbschlussCard />
            <MesswegeCard rows={messwegeRows} />
          </>
        }
      />
    </div>
  );
}
