import { and, desc, eq } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatDateTime } from "@/lib/formatting";
import { DashCard } from "../../../dashboard/_components/dash-ui";
import { EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../_components/SettingsHead";
import { CardBody } from "../../_components/settings-ui";
import { COLUMNS, STACK } from "../../_lib/sizes";
import { LinkingCard } from "./_resolver";
import { NOTHING_OPEN } from "./_copy";

export const metadata = { title: "Nicht zuordenbare Patienten" };

export default async function LinkingFailuresPage() {
  const session = await requireSession();

  const failures = await db
    .select({
      id: schema.linkingFailures.id,
      pvsPatientId: schema.linkingFailures.pvsPatientId,
      pvsPatientSnapshot: schema.linkingFailures.pvsPatientSnapshot,
      candidates: schema.linkingFailures.candidates,
      status: schema.linkingFailures.status,
      createdAt: schema.linkingFailures.createdAt,
    })
    .from(schema.linkingFailures)
    .where(
      and(
        eq(schema.linkingFailures.clinicId, session.clinicId),
        eq(schema.linkingFailures.status, "open")
      )
    )
    .orderBy(desc(schema.linkingFailures.createdAt))
    .limit(100);

  // Gather candidate patient details in one round-trip.
  const candidatePatientIds = new Set<string>();
  for (const f of failures) {
    const arr = Array.isArray(f.candidates)
      ? (f.candidates as Array<{ patientId: string }>)
      : [];
    for (const c of arr) candidatePatientIds.add(c.patientId);
  }
  const candidates =
    candidatePatientIds.size === 0
      ? []
      : await db
          .select({
            id: schema.patients.id,
            email: schema.patients.email,
            phone: schema.patients.phone,
            fullName: schema.patients.fullName,
            dob: schema.patients.dob,
          })
          .from(schema.patients)
          .where(
            and(
              eq(schema.patients.clinicId, session.clinicId)
              // No idiomatic IN-set helper in Drizzle's basic mode; the
              // resolver UI handles per-failure rendering.
            )
          );
  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  return (
    <div className={STACK}>
      <SettingsHead title="Nicht zuordenbare Patienten" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE]} />
      <div className={COLUMNS}>
        <div className={STACK}>
          {failures.length === 0 ? (
            <DashCard bodyClassName="p-0 md:p-0">
              <CardBody className="pt-5 md:pt-6">
                <p className="text-[15px] leading-6 text-fg-primary">{NOTHING_OPEN}</p>
              </CardBody>
            </DashCard>
          ) : (
            failures.map((f) => {
              const snap = f.pvsPatientSnapshot as Record<string, unknown>;
              const cands = Array.isArray(f.candidates)
                ? (f.candidates as Array<{
                    patientId: string;
                    score: number;
                    reason: string;
                  }>)
                : [];
              const facts: Array<[string, string]> = [];
              if (typeof snap.email === "string" && snap.email) facts.push(["E-Mail", snap.email]);
              if (typeof snap.phone === "string" && snap.phone) facts.push(["Telefon", snap.phone]);
              if (typeof snap.dob === "string" && snap.dob) facts.push(["Geburtsdatum", snap.dob]);
              const note = typeof snap.bemerkung === "string" && snap.bemerkung ? snap.bemerkung : null;
              return (
                <LinkingCard
                  key={f.id}
                  failureId={f.id}
                  name={String(snap.fullName ?? snap.pvsPatientId)}
                  meta={`Seit ${formatDateTime(f.createdAt)} · Nummer in der Praxis-Software: ${f.pvsPatientId}`}
                  candidates={cands.map((c) => ({
                    ...c,
                    patient: candidateById.get(c.patientId) ?? null,
                  }))}
                >
                  {(facts.length > 0 || note) && (
                    // What the Praxis-Software sent, label over value (Stripe's
                    // customer details).
                    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                      {facts.map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-sm leading-5 text-fg-secondary">{label}</dt>
                          <dd className="break-words text-[15px] leading-6 text-fg-primary">{value}</dd>
                        </div>
                      ))}
                      {note && (
                        <div className="min-w-0 sm:col-span-2">
                          <dt className="text-sm leading-5 text-fg-secondary">Bemerkung</dt>
                          <dd className="break-words text-[15px] leading-6 text-fg-primary">{note}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </LinkingCard>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
