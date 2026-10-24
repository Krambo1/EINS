import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import {
  ENFORCEMENT_KIND_LABELS,
  ENFORCEMENT_THRESHOLD,
  formatCureDeadline,
  warningEmailText,
  type EnforcementKind,
} from "@/lib/response-time";
import { endOfNextWerktag, formatBerlinDateTime } from "@/lib/werkstunden";
import { listRueckrufLage, type RueckrufRow } from "@/server/response-enforcement";
import { demoClinicIds } from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { CopyLinkButton } from "../videos/_components/CopyLinkButton";
import { recordPauseAction, recordResumeAction, recordWarningAction, sendWarningAction } from "./actions";
import { PendingSubmitButton } from "../_components/PendingSubmitButton";
import { DangerSubmitButton } from "../_components/DangerSubmitButton";
import { HowCalculated } from "../_components/HowCalculated";
import { RueckrufLageBadges } from "./_components/RueckrufLageBadges";

export const metadata = { title: "Rückruf-Lage · Admin" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminRueckrufPage({ searchParams }: PageProps) {
  await requireAdmin();
  const now = new Date();
  const [all, demo] = await Promise.all([
    listRueckrufLage(now),
    demoClinicIds().catch(() => new Set<string>()),
  ]);
  // The demo Praxis stays visible but last and marked (counts in no badge).
  const rows = [...all.filter((r) => !demo.has(r.clinicId)), ...all.filter((r) => demo.has(r.clinicId))];
  const sp = await searchParams;
  const error = typeof sp.fehler === "string" ? sp.fehler : null;
  const attention = rows.filter(
    (r) =>
      r.state.overdueOpen.length >= ENFORCEMENT_THRESHOLD || r.state.paused || r.state.activeWarning !== null
  );

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Rückruf-Lage"
        subtitle="Anfragen länger als 48 Werkstunden ohne Kontaktversuch der Praxis."
      />

      <HowCalculated>
        <p>
          Gezählt werden Anfragen, die länger als 48 Werkstunden ohne Kontaktversuch der Praxis liegen
          (Garantie-Anhang § 6 Abs. (5) lit. c).
        </p>
        <p>
          Die Warnung können Sie hier senden (Text und Empfänger werden gespeichert) oder selbst senden und
          vermerken. Die Anzeigen-Pause machen Sie im Werbekonto und vermerken sie hier. Nur im Admin sichtbar.
        </p>
      </HowCalculated>

      {error && (
        <p role="alert" className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] px-4 py-3 text-base text-tone-bad">
          {error}
        </p>
      )}

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-lg font-semibold">Alle Praxen</h2>
          {rows.length === 0 ? (
            <p className="text-base text-fg-primary">Noch keine Praxis angelegt.</p>
          ) : (
            <div className="overflow-x-auto">
              {/* DS5: below md only Praxis (with ads pause), open count and Lage. */}
              <table className="w-full text-left text-sm md:min-w-[820px]">
                <thead className="border-b border-border text-fg-primary">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Praxis</th>
                    <th className="py-2 pr-4 text-right font-medium">Offen ohne Kontaktversuch</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Älteste Frist abgelaufen</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Letzte Warnung</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Anzeigen</th>
                    <th className="py-2 font-medium">Lage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <OverviewRow key={r.clinicId} r={r} isDemo={demo.has(r.clinicId)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {attention.map((r) => (
        <ClinicCard key={r.clinicId} r={r} now={now} isDemo={demo.has(r.clinicId)} />
      ))}
    </div>
  );
}

function OverviewRow({ r, isDemo }: { r: RueckrufRow; isDemo: boolean }) {
  const s = r.state;
  const count = s.overdueOpen.length;
  const oldest = s.overdueOpen[0] ?? null;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pr-4 font-medium">
        {r.clinicName}
        {isDemo && (
          <div className="mt-1">
            <Badge>Demo, zählt nicht mit</Badge>
          </div>
        )}
        {s.paused && (
          <div className="mt-1 md:hidden">
            <Badge tone="warn">Anzeigen pausiert</Badge>
          </div>
        )}
      </td>
      <td className="py-3 pr-4 text-right tabular-nums">
        <span className={count >= ENFORCEMENT_THRESHOLD ? "font-semibold text-tone-bad" : undefined}>{count}</span>
      </td>
      <td className="hidden py-3 pr-4 whitespace-nowrap tabular-nums md:table-cell">
        {oldest ? formatBerlinDateTime(oldest.deadline) : "–"}
      </td>
      <td className="hidden py-3 pr-4 whitespace-nowrap tabular-nums md:table-cell">
        {s.lastWarning ? formatBerlinDateTime(s.lastWarning.occurredAt) : "–"}
      </td>
      <td className="hidden py-3 pr-4 whitespace-nowrap md:table-cell">
        {s.paused ? (
          <Badge tone="warn">Pausiert seit {formatBerlinDateTime(s.pause!.occurredAt)}</Badge>
        ) : (
          "Laufen"
        )}
      </td>
      <td className="py-3">
        <div className="flex flex-wrap gap-2">
          <RueckrufLageBadges s={s} />
        </div>
      </td>
    </tr>
  );
}

function ClinicCard({ r, now, isDemo }: { r: RueckrufRow; now: Date; isDemo: boolean }) {
  const s = r.state;
  const count = s.overdueOpen.length;
  // Cure deadline if the warning goes out now.
  const cureDeadline = endOfNextWerktag(now);
  const email = warningEmailText({ count, cureDeadline });
  const emailText = `Betreff: ${email.subject}\n\n${email.body}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{r.clinicName}</CardTitle>
        {isDemo && (
          <div>
            <Badge>Demo, zählt nicht mit</Badge>
          </div>
        )}
        <CardDescription>
          {count} {count === 1 ? "Anfrage" : "Anfragen"} länger als 48 Werkstunden ohne Kontaktversuch.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium text-fg-primary">Warnung</dt>
          <dd>
            {s.activeWarning
              ? `vermerkt am ${formatBerlinDateTime(s.activeWarning.occurredAt)}, Frist bis Ende ${formatCureDeadline(s.cureDeadline!)}`
              : "keine offene Warnung"}
            {s.overdueAtCureDeadline !== null &&
              ` · bei Fristende offen: ${s.overdueAtCureDeadline}`}
          </dd>
          <dt className="font-medium text-fg-primary">Anzeigen-Pause</dt>
          <dd>
            {s.paused
              ? `seit ${formatBerlinDateTime(s.pause!.occurredAt)}, von ${s.pause!.requestIds.length} Anfragen noch ${s.stillOpenFromPause.length} ohne Kontaktversuch`
              : s.canPause
                ? "möglich"
                : `nicht möglich: ${s.pauseBlockedReason}`}
          </dd>
          {s.resumeDue && (
            <>
              <dt className="font-medium text-fg-primary">Fortsetzen</dt>
              <dd className="font-semibold text-tone-bad">
                Fällig: Die Praxis hat alle Anfragen der Pause kontaktiert. Anzeigen unverzüglich fortsetzen.
              </dd>
            </>
          )}
        </dl>

        <div className="flex flex-wrap items-end gap-4">
          {!s.paused && (
            <ActionForm
              clinicId={r.clinicId}
              action={sendWarningAction}
              label="Warnung senden"
              disabled={!s.canWarn}
              confirm={`Warn-E-Mail jetzt an die Inhaber von ${r.clinicName} senden? Die Frist läuft bis Ende ${formatCureDeadline(cureDeadline)}.`}
            />
          )}
          {!s.paused && (
            <ActionForm
              clinicId={r.clinicId}
              action={recordWarningAction}
              label="Nur vermerken (selbst gesendet)"
              disabled={!s.canWarn}
              expectedCureDeadline={cureDeadline.toISOString()}
              confirm="Warnung vermerken? Die Frist im Mail-Text, den Sie selbst gesendet haben, muss zum angezeigten Text passen."
            />
          )}
          {!s.paused && (
            <ActionForm
              clinicId={r.clinicId}
              action={recordPauseAction}
              label="Anzeigen-Pause vermerken"
              disabled={!s.canPause}
              requireAdsRunning
              danger
              confirm="Anzeigen-Pause vermerken? Das gilt als Nachweis, dass die Anzeigen jetzt pausiert sind."
            />
          )}
          {s.paused && (
            <ActionForm
              clinicId={r.clinicId}
              action={recordResumeAction}
              label="Fortsetzung vermerken"
              confirm="Fortsetzung der Anzeigen vermerken?"
            />
          )}
        </div>

        {!s.paused && count >= ENFORCEMENT_THRESHOLD && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">Warn-E-Mail (Text, den „Warnung senden“ verschickt)</h3>
              <CopyLinkButton url={emailText} label="Text kopieren" />
            </div>
            <textarea
              readOnly
              value={emailText}
              rows={14}
              className="w-full rounded-md border border-border bg-bg-secondary p-3 text-sm"
            />
          </div>
        )}

        {r.events.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-base font-semibold">Verlauf</h3>
            <ul className="space-y-1 text-sm">
              {[...r.events].reverse().map((e) => (
                <li key={e.id}>
                  {formatBerlinDateTime(e.occurredAt)} · {ENFORCEMENT_KIND_LABELS[e.kind as EnforcementKind] ?? e.kind}
                  {e.requestIds.length > 0 ? ` · ${e.requestIds.length} Anfragen` : ""}
                  {e.createdBy ? ` · ${e.createdBy}` : ""}
                  {e.note ? ` · ${e.note}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActionForm({
  clinicId,
  action,
  label,
  disabled,
  confirm,
  expectedCureDeadline,
  requireAdsRunning,
  danger,
}: {
  clinicId: string;
  action: (formData: FormData) => Promise<void>;
  label: string;
  disabled?: boolean;
  confirm?: string;
  expectedCureDeadline?: string;
  /** K-14: Folge 3 applies only while paid ads run. */
  requireAdsRunning?: boolean;
  /** DS5: red button for the hard-to-undo step (Anzeigen-Pause). */
  danger?: boolean;
}) {
  const id = `${label}-${clinicId}`.replace(/\s+/g, "-");
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
      <input type="hidden" name="clinicId" value={clinicId} />
      {expectedCureDeadline && (
        <input type="hidden" name="expectedCureDeadline" value={expectedCureDeadline} />
      )}
      <div>
        <Label htmlFor={id}>Notiz (optional)</Label>
        <Input id={id} name="note" maxLength={500} className="w-56" />
      </div>
      {requireAdsRunning && (
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" name="adsRunning" value="1" required disabled={disabled} />
          Bezahlte Anzeigen laufen für diese Praxis
        </label>
      )}
      {danger && confirm ? (
        <DangerSubmitButton disabled={disabled} confirm={confirm} pendingLabel="Wird vermerkt …">
          {label}
        </DangerSubmitButton>
      ) : (
        <PendingSubmitButton variant="outline" disabled={disabled} confirm={confirm} pendingLabel="Wird ausgeführt …">
          {label}
        </PendingSubmitButton>
      )}
    </form>
  );
}
