import Link from "next/link";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@eins/ui";
import { formatDate, formatDateTime } from "@/lib/formatting";
import { CONTENT_STATUS_LABELS, isContentStatus } from "@/lib/content-status";
import { cloneSteps, modelBlockReason, type CloneStepState } from "@/lib/clone-record";
import type { CloneRecord, StopRequestedPost } from "@/server/clone";
import { PendingSubmitButton } from "../../../_components/PendingSubmitButton";
import { DangerSubmitButton } from "../../../_components/DangerSubmitButton";
import { KlonDocumentForm } from "./KlonDocumentForm";
import {
  createKlonAction,
  markKlonDeletedAction,
  revokeKlonAction,
  setKlonContractEndAction,
  setKlonModelAction,
} from "../klon-actions";

export interface KlonTabData {
  clinicId: string;
  records: CloneRecord[];
  stopRequested: StopRequestedPost[];
  /** Berlin calendar day, YYYY-MM-DD. */
  today: string;
}

const STEP_TONE: Record<CloneStepState, "good" | "neutral" | "bad"> = {
  erledigt: "good",
  offen: "neutral",
  ueberfaellig: "bad",
};

const STEP_STATE_LABEL: Record<CloneStepState, string> = {
  erledigt: "erledigt",
  offen: "offen",
  ueberfaellig: "überfällig",
};

function fileUrl(key: string): string {
  return `/api/admin/files/${encodeURI(key)}`;
}

/**
 * Admin view of the KI-Klon of one Praxis: per record the steps in order
 * (consent, training opt-out, model, contract end, deletion), the actions
 * for each, the irreversible revocation, and the posts that are "zu stoppen".
 * Admin only: the Praxis never sees this tab or the documents.
 */
export function KlonTab({ data }: { data: KlonTabData }) {
  const { clinicId, records, stopRequested, today } = data;

  return (
    <div className="space-y-8">
      {stopRequested.length > 0 && (
        <Card className="!border-[var(--tone-bad-border)]">
          <CardHeader>
            <CardTitle>Beiträge zu stoppen</CardTitle>
            <CardDescription>
              Nach einem Widerruf markiert. Ein Beitrag verschwindet von dieser Liste, sobald er im Tab
              Beiträge gestoppt ist.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y divide-border">
              {stopRequested.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <span className="font-medium text-fg-primary">{p.title}</span>{" "}
                    <span className="font-mono text-sm text-fg-secondary">{p.code}</span>
                    <div className="text-sm text-fg-secondary">{p.stopRequestedReason ?? "Zu stoppen"}</div>
                  </div>
                  <Badge tone="warn">
                    {isContentStatus(p.status) ? CONTENT_STATUS_LABELS[p.status] : p.status}
                  </Badge>
                </li>
              ))}
            </ul>
            <Link
              href={`/admin/clinics/${clinicId}?tab=beitraege`}
              className="inline-block text-base text-accent hover:underline"
            >
              Zum Tab Beiträge
            </Link>
          </CardContent>
        </Card>
      )}

      {records.length === 0 && (
        <p className="text-base text-fg-primary">Für diese Praxis ist noch kein KI-Klon angelegt.</p>
      )}

      {records.map((r) => (
        <KlonRecordCard key={r.id} clinicId={clinicId} record={r} today={today} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle>KI-Klon anlegen</CardTitle>
          <CardDescription>
            Ein Eintrag je Person und Werkzeug. Das Modell darf erst angelegt werden, wenn die Einwilligung
            unterschrieben und der Trainings-Widerspruch des Werkzeugs dokumentiert ist.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createKlonAction} className="grid gap-4 md:grid-cols-12">
            <input type="hidden" name="clinicId" value={clinicId} />
            <div className="md:col-span-6">
              <Label htmlFor="klon-person">Person (Gesicht und Stimme)</Label>
              <Input id="klon-person" name="personName" required maxLength={200} placeholder="z. B. Dr. Anna Beispiel" />
            </div>
            <div className="md:col-span-6">
              <Label htmlFor="klon-tool">Werkzeug</Label>
              <Input id="klon-tool" name="tool" required maxLength={200} placeholder="z. B. HeyGen" />
            </div>
            <div className="flex justify-end md:col-span-12">
              <PendingSubmitButton>KI-Klon anlegen</PendingSubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function KlonRecordCard({ clinicId, record: r, today }: { clinicId: string; record: CloneRecord; today: string }) {
  const steps = cloneSteps(
    {
      consentSignedAt: r.consentSignedAt,
      consentDocumentKey: r.consentDocumentKey,
      trainingOptoutDocumentKey: r.trainingOptoutDocumentKey,
      trainingOptoutConfirmedAt: r.trainingOptoutConfirmedAt,
      modelCreatedAt: r.modelCreatedAt,
      revokedAt: r.revokedAt,
      deletedAt: r.deletedAt,
      contractEndOn: r.contractEndOn,
    },
    today
  );
  const modelBlocked = modelBlockReason(r);
  const editableDocs = !r.modelCreatedAt && !r.revokedAt && !r.deletedAt;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{r.personName}</CardTitle>
          {r.deletedAt ? (
            <Badge tone="neutral">Gelöscht</Badge>
          ) : r.revokedAt ? (
            <Badge tone="bad">Widerrufen</Badge>
          ) : r.modelCreatedAt ? (
            <Badge tone="good">Modell angelegt</Badge>
          ) : (
            <Badge tone="warn">In Vorbereitung</Badge>
          )}
        </div>
        <CardDescription>
          Werkzeug: {r.tool}. Angelegt am {formatDate(r.createdAt)}
          {r.createdBy ? ` von ${r.createdBy}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {r.revokedAt && (
          <p
            role="status"
            className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] px-4 py-3 text-base text-fg-primary"
          >
            Widerruf erfasst am {formatDateTime(r.revokedAt)}. {r.revokedNote}
          </p>
        )}

        <ol className="divide-y divide-border">
          {steps.map((s, i) => (
            <li key={s.key} className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <span className="text-base text-fg-primary">
                <span className="mr-2 tabular-nums text-fg-secondary">{i + 1}.</span>
                {s.label}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums text-fg-primary">{s.date ?? "-"}</span>
                <Badge tone={STEP_TONE[s.state]}>{STEP_STATE_LABEL[s.state]}</Badge>
              </span>
            </li>
          ))}
        </ol>

        {(r.consentDocumentKey || r.trainingOptoutDocumentKey) && (
          <ul className="space-y-1 text-sm">
            {r.consentDocumentKey && (
              <li>
                <a href={fileUrl(r.consentDocumentKey)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  Einwilligung ansehen
                </a>
              </li>
            )}
            {r.trainingOptoutDocumentKey && (
              <li>
                <a
                  href={fileUrl(r.trainingOptoutDocumentKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Nachweis Trainings-Widerspruch ansehen
                </a>
              </li>
            )}
          </ul>
        )}

        {editableDocs && (
          <div className="space-y-3">
            <h3 className="text-base font-medium">
              {r.consentSignedAt ? "Einwilligung ersetzen" : "Einwilligung hochladen"}
            </h3>
            <KlonDocumentForm clinicId={clinicId} recordId={r.id} kind="einwilligung" today={today} />
            <h3 className="text-base font-medium">
              {r.trainingOptoutConfirmedAt ? "Trainings-Widerspruch ersetzen" : "Trainings-Widerspruch dokumentieren"}
            </h3>
            <KlonDocumentForm clinicId={clinicId} recordId={r.id} kind="widerspruch" today={today} />
          </div>
        )}

        {!r.modelCreatedAt && !r.deletedAt && (
          <form action={setKlonModelAction} className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-end">
            <input type="hidden" name="clinicId" value={clinicId} />
            <input type="hidden" name="id" value={r.id} />
            <div>
              <Label htmlFor={`klon-model-${r.id}`}>Modell angelegt am</Label>
              <Input id={`klon-model-${r.id}`} name="day" type="date" max={today} defaultValue={today} required disabled={!!modelBlocked} />
            </div>
            <div className="space-y-1">
              <PendingSubmitButton disabled={!!modelBlocked}>Modell angelegt</PendingSubmitButton>
            </div>
            {modelBlocked && <p className="text-sm text-tone-bad sm:self-center">{modelBlocked}</p>}
          </form>
        )}

        {!r.deletedAt && (
          <form action={setKlonContractEndAction} className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-end">
            <input type="hidden" name="clinicId" value={clinicId} />
            <input type="hidden" name="id" value={r.id} />
            <div>
              <Label htmlFor={`klon-end-${r.id}`}>Vertragsende</Label>
              <Input id={`klon-end-${r.id}`} name="contractEndOn" type="date" defaultValue={r.contractEndOn ?? ""} />
            </div>
            <PendingSubmitButton variant="secondary">Vertragsende speichern</PendingSubmitButton>
            <p className="text-sm text-fg-secondary sm:self-center">Leer lassen und speichern entfernt das Datum.</p>
          </form>
        )}

        {!r.revokedAt && (
          <form action={revokeKlonAction} className="space-y-3 border-t border-border pt-5">
            <input type="hidden" name="clinicId" value={clinicId} />
            <input type="hidden" name="id" value={r.id} />
            <h3 className="text-base font-medium">Widerruf erfassen</h3>
            <p className="text-sm text-fg-primary">
              Der Widerruf lässt sich nicht zurücknehmen. Alle Beiträge dieser Praxis mit dem KI-Klon, die noch
              nicht gestoppt sind, werden als „zu stoppen“ markiert, EINS bekommt eine E-Mail, und kein neuer
              Beitrag mit dem KI-Klon kommt mehr durch die Prüf-Schranke.
            </p>
            <div>
              <Label htmlFor={`klon-revoke-${r.id}`}>Notiz (wie und wann eingegangen)</Label>
              <Textarea id={`klon-revoke-${r.id}`} name="note" required maxLength={2000} rows={2} />
            </div>
            <div className="flex justify-end">
              <DangerSubmitButton
                confirm={`Widerruf für ${r.personName} erfassen? Das lässt sich nicht rückgängig machen. Alle Beiträge mit dem KI-Klon werden als „zu stoppen“ markiert.`}
                pendingLabel="Wird erfasst …"
              >
                Widerruf erfassen
              </DangerSubmitButton>
            </div>
          </form>
        )}

        {r.deletedAt ? (
          <p className="border-t border-border pt-5 text-sm text-fg-primary">
            Gelöscht am {formatDateTime(r.deletedAt)}. {r.deletedNote}
          </p>
        ) : (
          <form action={markKlonDeletedAction} className="space-y-3 border-t border-border pt-5">
            <input type="hidden" name="clinicId" value={clinicId} />
            <input type="hidden" name="id" value={r.id} />
            <h3 className="text-base font-medium">Löschung vermerken</h3>
            <div>
              <Label htmlFor={`klon-delete-${r.id}`}>Notiz (wo und wie gelöscht)</Label>
              <Textarea id={`klon-delete-${r.id}`} name="note" required maxLength={2000} rows={2} />
            </div>
            <div className="flex justify-end">
              <DangerSubmitButton
                confirm={`Löschung des KI-Klons von ${r.personName} vermerken? Danach ändert sich an diesem Eintrag nichts mehr.`}
                pendingLabel="Wird vermerkt …"
              >
                Gelöscht vermerken
              </DangerSubmitButton>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
