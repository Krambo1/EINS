import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatDateTime } from "@/lib/formatting";
import { LinkingResolver } from "./_resolver";

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
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen/integrationen"
            className="text-muted-foreground hover:underline"
          >
            ← Übersicht
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Nicht zuordenbare Patienten</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          PVS-Events, deren Patient nicht eindeutig einer EINS-Anfrage zugeordnet
          werden konnte. Bestätigen Sie die richtige Person oder ignorieren Sie
          den Eintrag.
        </p>
      </header>

      {failures.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alles zugeordnet ✓</CardTitle>
            <CardDescription>
              Keine offenen Linking-Failures. Wenn die PVS Events sendet und EINS
              den Patienten nicht zuordnen kann, erscheinen sie hier.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-3">
          {failures.map((f) => {
            const snap = f.pvsPatientSnapshot as Record<string, unknown>;
            const cands = Array.isArray(f.candidates)
              ? (f.candidates as Array<{
                  patientId: string;
                  score: number;
                  reason: string;
                }>)
              : [];
            return (
              <Card key={f.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        PVS-Patient {String(snap.fullName ?? snap.pvsPatientId)}
                      </CardTitle>
                      <CardDescription>
                        seit {formatDateTime(f.createdAt)} · PVS-ID:{" "}
                        <code>{f.pvsPatientId}</code>
                      </CardDescription>
                    </div>
                    <Badge tone="neutral">{cands.length} Vorschläge</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <dl className="mb-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    {typeof snap.email === "string" && snap.email && (
                      <div>
                        <dt className="text-muted-foreground">E-Mail</dt>
                        <dd>{snap.email}</dd>
                      </div>
                    )}
                    {typeof snap.phone === "string" && snap.phone && (
                      <div>
                        <dt className="text-muted-foreground">Telefon</dt>
                        <dd>{snap.phone}</dd>
                      </div>
                    )}
                    {typeof snap.dob === "string" && snap.dob && (
                      <div>
                        <dt className="text-muted-foreground">Geburtsdatum</dt>
                        <dd>{snap.dob}</dd>
                      </div>
                    )}
                    {typeof snap.bemerkung === "string" && snap.bemerkung && (
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Bemerkung</dt>
                        <dd>{snap.bemerkung}</dd>
                      </div>
                    )}
                  </dl>
                  <LinkingResolver
                    failureId={f.id}
                    candidates={cands.map((c) => ({
                      ...c,
                      patient: candidateById.get(c.patientId) ?? null,
                    }))}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
