import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@eins/ui";
import { formatDate, formatDateTime } from "@/lib/formatting";
import {
  BOOKING_LINK_MEDIA,
  BOOKING_LINK_MEDIUM_LABELS,
  TRACKING_NUMBER_CHANNELS,
  TRACKING_NUMBER_CHANNEL_LABELS,
  type BookingLinkMedium,
  type TrackingNumberChannel,
} from "@/lib/messweg";
import { MATELSO_PUSH_TEMPLATE } from "@/lib/messweg-adapters";
import { PendingSubmitButton } from "../../../_components/PendingSubmitButton";
import { DangerSubmitButton } from "../../../_components/DangerSubmitButton";
import {
  createBookingLinkAction,
  createTrackingNumberAction,
  deactivateBookingLinkAction,
  deactivateTrackingNumberAction,
} from "../messweg-actions";

export interface MesswegeTabData {
  clinicId: string;
  trackingNumbers: Array<{
    id: string;
    e164: string;
    channel: string;
    provider: string;
    label: string | null;
    active: boolean;
    createdAt: Date;
    deactivatedAt: Date | null;
  }>;
  bookingLinks: Array<{
    id: string;
    url: string;
    externalRef: string;
    medium: string;
    label: string | null;
    active: boolean;
    createdAt: Date;
    deactivatedAt: Date | null;
  }>;
  events: Array<{
    id: string;
    kind: string;
    outcome: string;
    occurredAt: Date;
    requestId: string | null;
  }>;
  /** Events with clinic_id NULL in the last 30 days, across all Praxen. */
  unassignedLast30Days: number;
}

const PORTAL_ORIGIN = "https://portal.eins.ag";

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const OUTCOME_LABELS: Record<string, string> = {
  angelegt: "Anfrage angelegt",
  zusammengefasst: "Zur bestehenden Anfrage (30 Tage)",
  ohne_praxis: "Keiner Praxis zugeordnet",
  ignoriert: "Ignoriert",
};

const OUTCOME_TONES: Record<string, "good" | "neutral" | "warn" | "bad"> = {
  angelegt: "good",
  zusammengefasst: "neutral",
  ohne_praxis: "warn",
  ignoriert: "neutral",
};

function channelLabel(c: string): string {
  return TRACKING_NUMBER_CHANNEL_LABELS[c as TrackingNumberChannel] ?? c;
}

function mediumLabel(m: string): string {
  return BOOKING_LINK_MEDIUM_LABELS[m as BookingLinkMedium] ?? m;
}

/**
 * Admin view of the EINS-Messwege "Anruf" and "Buchung" for one Praxis:
 * tracking numbers, booking links, the latest provider events and the setup
 * help for the Matelso push and the Calendly webhook.
 */
export function MesswegeTab({ data }: { data: MesswegeTabData }) {
  const { clinicId, trackingNumbers, bookingLinks, events, unassignedLast30Days } = data;

  return (
    <div className="space-y-8">
      {/* Tracking-Nummern */}
      <Card>
        <CardHeader>
          <CardTitle>Tracking-Nummern</CardTitle>
          <CardDescription>
            Jeder Anruf auf eine aktive Nummer wird zur Anfrage dieser Praxis. Eine
            Nummer kann immer nur bei einer Praxis aktiv sein.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {trackingNumbers.length === 0 ? (
            <p className="text-sm text-fg-secondary">Noch keine Tracking-Nummer eingetragen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-secondary">
                    <th className="py-2 pr-4 font-medium">Nummer</th>
                    <th className="py-2 pr-4 font-medium">Kanal</th>
                    <th className="py-2 pr-4 font-medium">Anbieter</th>
                    <th className="py-2 pr-4 font-medium">Aktiv seit</th>
                    <th className="py-2 pr-4 font-medium">Deaktiviert am</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {trackingNumbers.map((n) => (
                    <tr key={n.id} className={n.active ? "" : "text-fg-secondary"}>
                      <td className="py-2 pr-4">
                        <span className="font-mono tabular-nums">{n.e164}</span>
                        {n.label && <div className="text-xs text-fg-secondary">{n.label}</div>}
                      </td>
                      <td className="py-2 pr-4">{channelLabel(n.channel)}</td>
                      <td className="py-2 pr-4">{n.provider === "matelso" ? "Matelso" : n.provider}</td>
                      <td className="py-2 pr-4 tabular-nums">{formatDate(n.createdAt)}</td>
                      <td className="py-2 pr-4 tabular-nums">
                        {n.deactivatedAt ? formatDate(n.deactivatedAt) : "-"}
                      </td>
                      <td className="py-2 text-right">
                        {n.active ? (
                          <form action={deactivateTrackingNumberAction}>
                            <input type="hidden" name="clinicId" value={clinicId} />
                            <input type="hidden" name="id" value={n.id} />
                            <DangerSubmitButton
                              size="sm"
                              confirm={`Nummer ${n.e164} deaktivieren? Anrufe darauf werden danach keiner Praxis mehr zugeordnet.`}
                              pendingLabel="Wird deaktiviert …"
                            >
                              Deaktivieren
                            </DangerSubmitButton>
                          </form>
                        ) : (
                          <Badge tone="neutral">Inaktiv</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form
            action={createTrackingNumberAction}
            className="grid gap-4 border-t border-border pt-5 md:grid-cols-12"
          >
            <input type="hidden" name="clinicId" value={clinicId} />
            <div className="md:col-span-4">
              <Label htmlFor="mw-number">Nummer</Label>
              <Input
                id="mw-number"
                name="number"
                required
                maxLength={40}
                inputMode="tel"
                placeholder="z. B. +49 221 1234567"
              />
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="mw-channel">Kanal</Label>
              <select id="mw-channel" name="channel" defaultValue="profil" className={SELECT_CLASS} required>
                {TRACKING_NUMBER_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {TRACKING_NUMBER_CHANNEL_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-5">
              <Label htmlFor="mw-number-label">Bezeichnung (optional)</Label>
              <Input id="mw-number-label" name="label" maxLength={200} placeholder="z. B. Instagram-Bio" />
            </div>
            <div className="flex items-center justify-between gap-3 md:col-span-12">
              <p className="text-xs text-fg-secondary">Anbieter: Matelso</p>
              <PendingSubmitButton>Nummer hinzufügen</PendingSubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Buchungslinks */}
      <Card>
        <CardHeader>
          <CardTitle>Buchungslinks</CardTitle>
          <CardDescription>
            Jede Buchung über einen aktiven Link wird zur Anfrage dieser Praxis.
            Zugeordnet wird über den Calendly-Ereignistyp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {bookingLinks.length === 0 ? (
            <p className="text-sm text-fg-secondary">Noch kein Buchungslink eingetragen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-secondary">
                    <th className="py-2 pr-4 font-medium">Link</th>
                    <th className="py-2 pr-4 font-medium">Medium</th>
                    <th className="py-2 pr-4 font-medium">Calendly-Ereignistyp</th>
                    <th className="py-2 pr-4 font-medium">Aktiv</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bookingLinks.map((l) => (
                    <tr key={l.id} className={l.active ? "" : "text-fg-secondary"}>
                      <td className="max-w-[18rem] py-2 pr-4">
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate hover:text-accent"
                        >
                          {l.url}
                        </a>
                        {l.label && <div className="text-xs text-fg-secondary">{l.label}</div>}
                      </td>
                      <td className="py-2 pr-4">{mediumLabel(l.medium)}</td>
                      <td className="max-w-[18rem] py-2 pr-4">
                        <span className="block truncate font-mono text-xs" title={l.externalRef}>
                          {l.externalRef}
                        </span>
                      </td>
                      <td className="py-2 pr-4 tabular-nums">
                        {l.active
                          ? `seit ${formatDate(l.createdAt)}`
                          : `nein, seit ${formatDate(l.deactivatedAt)}`}
                      </td>
                      <td className="py-2 text-right">
                        {l.active ? (
                          <form action={deactivateBookingLinkAction}>
                            <input type="hidden" name="clinicId" value={clinicId} />
                            <input type="hidden" name="id" value={l.id} />
                            <DangerSubmitButton
                              size="sm"
                              confirm="Buchungslink deaktivieren? Buchungen darüber werden danach keiner Praxis mehr zugeordnet."
                              pendingLabel="Wird deaktiviert …"
                            >
                              Deaktivieren
                            </DangerSubmitButton>
                          </form>
                        ) : (
                          <Badge tone="neutral">Inaktiv</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <form
            action={createBookingLinkAction}
            className="grid gap-4 border-t border-border pt-5 md:grid-cols-12"
          >
            <input type="hidden" name="clinicId" value={clinicId} />
            <div className="md:col-span-6">
              <Label htmlFor="mw-url">Link</Label>
              <Input
                id="mw-url"
                name="url"
                type="url"
                required
                maxLength={500}
                pattern="https://.*"
                placeholder="https://calendly.com/…"
              />
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="mw-medium">Medium</Label>
              <select id="mw-medium" name="medium" defaultValue="profil_link" className={SELECT_CLASS} required>
                {BOOKING_LINK_MEDIA.map((m) => (
                  <option key={m} value={m}>
                    {BOOKING_LINK_MEDIUM_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <Label htmlFor="mw-link-label">Bezeichnung (optional)</Label>
              <Input id="mw-link-label" name="label" maxLength={200} />
            </div>
            <div className="md:col-span-12">
              <Label htmlFor="mw-external-ref">Calendly-Ereignistyp</Label>
              <Input
                id="mw-external-ref"
                name="externalRef"
                required
                maxLength={500}
                placeholder="https://api.calendly.com/event_types/…"
              />
              <p className="mt-1 text-xs text-fg-secondary">
                Die URI des Calendly-Ereignistyps, z. B. https://api.calendly.com/event_types/…
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 md:col-span-12">
              <p className="text-xs text-fg-secondary">Anbieter: Calendly</p>
              <PendingSubmitButton>Buchungslink hinzufügen</PendingSubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Letzte Ereignisse */}
      <Card>
        <CardHeader>
          <CardTitle>Letzte Messweg-Ereignisse</CardTitle>
          <CardDescription>Die letzten 20 Anrufe und Buchungen dieser Praxis.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unassignedLast30Days > 0 ? (
            <p
              role="status"
              className="rounded-md border border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] px-4 py-3 text-sm text-fg-primary"
            >
              Anrufe oder Buchungen auf nicht zugeordnete Nummern/Links (letzte 30 Tage, alle
              Praxen): <span className="font-semibold tabular-nums">{unassignedLast30Days}</span>
            </p>
          ) : (
            <p className="text-xs text-fg-secondary">
              Anrufe oder Buchungen auf nicht zugeordnete Nummern/Links (letzte 30 Tage, alle
              Praxen): 0
            </p>
          )}
          {events.length === 0 ? (
            <p className="text-sm text-fg-secondary">Noch keine Anrufe oder Buchungen.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-secondary">
                    <th className="py-2 pr-4 font-medium">Zeit</th>
                    <th className="py-2 pr-4 font-medium">Art</th>
                    <th className="py-2 pr-4 font-medium">Ergebnis</th>
                    <th className="py-2 font-medium">Anfrage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="py-2 pr-4 tabular-nums">{formatDateTime(e.occurredAt)}</td>
                      <td className="py-2 pr-4">
                        {e.kind === "anruf" ? "Anruf" : e.kind === "buchung" ? "Buchung" : e.kind}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge tone={OUTCOME_TONES[e.outcome] ?? "neutral"}>
                          {OUTCOME_LABELS[e.outcome] ?? e.outcome}
                        </Badge>
                      </td>
                      <td className="py-2">
                        {e.requestId ? (
                          <span className="font-mono text-xs" title={e.requestId}>
                            {e.requestId.slice(0, 8)}
                          </span>
                        ) : (
                          <span className="text-fg-secondary">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Einrichtung */}
      <Card>
        <CardHeader>
          <CardTitle>Einrichtung beim Anbieter</CardTitle>
          <CardDescription>Einmal pro Anbieter-Konto, nicht pro Praxis.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <details className="group rounded-md border border-border p-4">
            <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
              Matelso-Push einrichten
            </summary>
            <div className="mt-3 space-y-3 text-sm text-fg-primary">
              <p>
                Ziel-URL:{" "}
                <span className="font-mono">{PORTAL_ORIGIN}/api/webhooks/messweg/matelso</span> (POST,
                JSON).
              </p>
              <p>
                Header <span className="font-mono">X-EINS-Messweg-Token</span> muss den Messweg-Token
                von EINS tragen. Matelso signiert nicht, ohne den Token wird der Push abgelehnt.
              </p>
              <p>Inhalt des Push (Felder aus dem Matelso-Datenverzeichnis befüllen):</p>
              <pre className="overflow-x-auto rounded-md bg-bg-secondary p-3 font-mono text-xs">
                {JSON.stringify(MATELSO_PUSH_TEMPLATE, null, 2)}
              </pre>
            </div>
          </details>
          <details className="group rounded-md border border-border p-4">
            <summary className="cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden">
              Calendly-Webhook einrichten
            </summary>
            <div className="mt-3 space-y-3 text-sm text-fg-primary">
              <p>
                Ziel-URL:{" "}
                <span className="font-mono">{PORTAL_ORIGIN}/api/webhooks/messweg/calendly</span>
              </p>
              <p>
                Ereignis: <span className="font-mono">invitee.created</span>
              </p>
              <p>
                Beim Anlegen des Webhooks einen Signaturschlüssel setzen. Derselbe Schlüssel muss bei
                EINS hinterlegt sein, sonst wird jede Buchung abgelehnt.
              </p>
              <p>
                Den Calendly-Ereignistyp (URI) jedes Buchungslinks oben eintragen, sonst landet die
                Buchung als „Keiner Praxis zugeordnet“.
              </p>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
