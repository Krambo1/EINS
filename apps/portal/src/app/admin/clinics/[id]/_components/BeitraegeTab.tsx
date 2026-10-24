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
import { formatDate, formatDateTime, berlinDateString } from "@/lib/formatting";
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABELS,
  CONTENT_PLATFORMS,
  CONTENT_STATUS_LABELS,
  canPublish,
  type ContentFormat,
} from "@/lib/content-status";
import { CONTENT_LINK_MEDIUM_LABELS } from "@/lib/content-links";
import { CONTENT_STATUS_TONES, adminOfferedMoves, isEditableStatus } from "@/lib/content-items";
import type { ContentItemView, UnknownPostCode } from "@/server/content";
import {
  loadApprovalAdminData,
  type AdminApprovalData,
  type AdminBatchView,
  type GateView,
} from "@/server/content-approval";
import { GATE_REASON_LABELS, NO_BEFORE_AFTER_CONFIRMATION } from "@/lib/content-gate";
import { APPROVAL_DECISION_LABELS, formatApprovalDue } from "@/lib/content-approval";
import { formatIsoDate } from "@/lib/guarantee-clock";
import { CopyButton } from "@/app/(portal)/bewertungen/_components/CopyButton";
import { PendingSubmitButton } from "../../../_components/PendingSubmitButton";
import { DangerSubmitButton } from "../../../_components/DangerSubmitButton";
import {
  acknowledgeHwgWarningsAction,
  addPublicationAction,
  moveBeitragStatusAction,
  runHwgCheckAction,
  sendApprovalBatchAction,
  setNoBeforeAfterAction,
  regenerateBeitragLinksAction,
  stopBeitragAction,
  updateBeitragAction,
} from "../beitrag-actions";
import { BeitragCreateForm, type BeitragFormOptions } from "./BeitragCreateForm";

export interface BeitraegeTabData {
  clinicId: string;
  items: ContentItemView[];
  options: BeitragFormOptions;
  /** Null when clinics.review_landing_origin is missing or not https. */
  zielseiteOrigin: string | null;
  unknownCodes: UnknownPostCode[];
}

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-border bg-bg-primary px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const PLATFORM_LABELS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };

const MOVE_LABELS: Record<string, string> = {
  entwurf: "Zurück in den Entwurf",
  geplant: "Als geplant markieren",
};

const MISSING_ORIGIN = "Zielseiten-Adresse fehlt (Stammdaten: Zielseiten-Origin)";

function formatLabel(f: string): string {
  return CONTENT_FORMAT_LABELS[f as ContentFormat] ?? f;
}

/**
 * Admin tab "Beiträge" of one Praxis: create posts (optionally with a new
 * file), edit while in Entwurf or Änderung gewünscht, move status, paste the
 * permalink (goes live), stop with a reason, and copy the tagged links.
 */
export async function BeitraegeTab({ data }: { data: BeitraegeTabData }) {
  const { clinicId, items, options, zielseiteOrigin, unknownCodes } = data;
  // Phase 4 data is loaded here, not by the page, so the page stays as it is.
  const approval = await loadApprovalAdminData(clinicId);

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Neuer Beitrag</CardTitle>
          <CardDescription>
            Jeder Beitrag bekommt einen eigenen Code. Anfragen über seine Links werden ihm zugeordnet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!zielseiteOrigin && (
            <p
              role="status"
              className="rounded-md border border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] px-4 py-3 text-sm text-fg-primary"
            >
              {MISSING_ORIGIN}. Beiträge lassen sich anlegen, Links entstehen erst mit der Adresse.
            </p>
          )}
          <BeitragCreateForm clinicId={clinicId} options={options} />
        </CardContent>
      </Card>

      <FreigabePaketCard clinicId={clinicId} items={items} approval={approval} />

      {unknownCodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Unbekannte Beitragscodes</CardTitle>
            <CardDescription>
              Anfragen der letzten 90 Tage mit einem Beitragscode, zu dem bei der Anfrage kein Beitrag dieser Praxis
              gehörte.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {unknownCodes.map((u) => (
                <li key={u.code} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Badge tone="warn">Unbekannter Beitragscode</Badge>
                    <span className="font-mono">{u.code}</span>
                  </span>
                  <span className="text-fg-secondary tabular-nums">
                    {u.count} {u.count === 1 ? "Anfrage" : "Anfragen"}, zuletzt {formatDateTime(u.lastAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-fg-secondary">Noch keine Beiträge angelegt.</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <BeitragCard
              key={item.id}
              clinicId={clinicId}
              item={item}
              options={options}
              zielseiteOrigin={zielseiteOrigin}
              gate={approval.gate.get(item.id) ?? null}
              latest={approval.latest.get(item.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BeitragCard({
  clinicId,
  item,
  options,
  zielseiteOrigin,
  gate,
  latest,
}: {
  clinicId: string;
  item: ContentItemView;
  options: BeitragFormOptions;
  zielseiteOrigin: string | null;
  gate: GateView | null;
  latest: LatestApproval | null;
}) {
  const moves = adminOfferedMoves(item.status);
  const editable = isEditableStatus(item.status);
  const publishable = canPublish(item.status);
  const stoppable = item.status !== "gestoppt";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-lg">{item.title}</CardTitle>
            <p className="mt-1 text-sm text-fg-secondary">
              Code <span className="font-mono text-fg-primary">{item.code}</span> · {formatLabel(item.format)}
              {item.treatmentName ? ` · ${item.treatmentName}` : ""}
              {item.usesClone ? " · KI-Klon" : ""}
              {item.aiContent ? " · KI-Inhalt" : ""}
            </p>
          </div>
          <Badge tone={CONTENT_STATUS_TONES[item.status]}>{CONTENT_STATUS_LABELS[item.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-fg-secondary">Live seit</dt>
            <dd className="tabular-nums">{item.liveSince ? formatDate(item.liveSince) : "-"}</dd>
          </div>
          <div>
            <dt className="text-fg-secondary">Gestoppt</dt>
            <dd className="tabular-nums">
              {item.stoppedAt ? formatDate(item.stoppedAt) : "-"}
              {item.stopReason ? <span className="block text-fg-secondary">Grund: {item.stopReason}</span> : null}
            </dd>
          </div>
          <div className="lg:col-span-2">
            <dt className="text-fg-secondary">Anfragen</dt>
            <dd className="tabular-nums">
              <span className="font-semibold">{item.inquiries.total}</span> (Formular {item.inquiries.formular}, Anruf{" "}
              {item.inquiries.anruf}, Buchung {item.inquiries.buchung}, ohne Messweg {item.inquiries.ohne})
            </dd>
          </div>
          {item.assetTitle && item.assetStorageKey && (
            <div className="sm:col-span-2 lg:col-span-4">
              <dt className="text-fg-secondary">Datei</dt>
              <dd>
                <a
                  href={`/api/admin/files/${encodeURI(item.assetStorageKey)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all hover:text-accent"
                >
                  {item.assetTitle}
                </a>
              </dd>
            </div>
          )}
        </dl>

        {item.publications.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="text-fg-secondary">Live-Links</p>
            <ul className="space-y-1">
              {item.publications.map((p) => (
                <li key={p.id} className="break-all">
                  <span className="mr-2">{PLATFORM_LABELS[p.platform] ?? p.platform}:</span>
                  <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="hover:text-accent">
                    {p.permalink}
                  </a>
                  <span className="ml-2 text-fg-secondary tabular-nums">
                    seit {formatDate(p.publishedAt)}
                    {p.stoppedAt ? `, gestoppt ${formatDate(p.stoppedAt)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {item.caption && (
          <details className="rounded-md border border-border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Beitragstext</summary>
            <p className="mt-2 whitespace-pre-wrap">{item.caption}</p>
          </details>
        )}

        {/* Link builder */}
        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Links für diesen Beitrag</p>
            {zielseiteOrigin && (
              <form action={regenerateBeitragLinksAction}>
                <input type="hidden" name="clinicId" value={clinicId} />
                <input type="hidden" name="id" value={item.id} />
                <PendingSubmitButton size="sm" variant="outline" pendingLabel="Wird erzeugt …">
                  Links neu erzeugen
                </PendingSubmitButton>
              </form>
            )}
          </div>
          {!zielseiteOrigin ? (
            <p className="text-sm text-tone-warn">{MISSING_ORIGIN}</p>
          ) : item.links.length === 0 ? (
            <p className="text-sm text-fg-secondary">Noch keine Links erzeugt.</p>
          ) : (
            <ul className="space-y-3">
              {item.links.map((l) => (
                <li key={l.medium} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-fg-secondary">{CONTENT_LINK_MEDIUM_LABELS[l.medium] ?? l.medium}</p>
                    <p className="break-all font-mono text-xs">{l.url}</p>
                  </div>
                  <CopyButton text={l.url} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {item.status === "zur_freigabe" && latest && (
          <p className="text-sm text-fg-primary">
            Wartet auf Freigabe{latest.inhaberOnly ? " durch die Inhaberin oder den Inhaber" : ""} bis{" "}
            {formatApprovalDue(latest.dueAt)}.
          </p>
        )}
        {item.status === "aenderung" && latest?.decision?.changeText && (
          <div className="rounded-md border border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] p-3 text-sm">
            <p className="font-medium">Änderungswunsch der Praxis ({formatDateTime(latest.decision.decidedAt)})</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{latest.decision.changeText}</p>
          </div>
        )}
        {gate && isEditableStatus(item.status) && <GateSection clinicId={clinicId} item={item} gate={gate} />}

        {/* Status and actions */}
        <div className="flex flex-wrap items-center gap-2">
          {moves.map((to) => (
            <form key={to} action={moveBeitragStatusAction}>
              <input type="hidden" name="clinicId" value={clinicId} />
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="to" value={to} />
              <PendingSubmitButton size="sm" variant="outline">
                {MOVE_LABELS[to] ?? CONTENT_STATUS_LABELS[to]}
              </PendingSubmitButton>
            </form>
          ))}
          {item.status === "entwurf" && (
            <span className="text-xs text-fg-secondary">Zur Freigabe geht der Beitrag über das Freigabe-Paket oben.</span>
          )}
        </div>

        <div className="space-y-3">
          {editable && (
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Bearbeiten</summary>
              <form action={updateBeitragAction} className="mt-3 grid gap-4 md:grid-cols-12">
                <input type="hidden" name="clinicId" value={clinicId} />
                <input type="hidden" name="id" value={item.id} />
                <div className="md:col-span-6">
                  <Label htmlFor={`bt-title-${item.id}`}>Titel</Label>
                  <Input id={`bt-title-${item.id}`} name="title" required maxLength={200} defaultValue={item.title} />
                </div>
                <div className="md:col-span-3">
                  <Label htmlFor={`bt-format-${item.id}`}>Format</Label>
                  <select id={`bt-format-${item.id}`} name="format" defaultValue={item.format} className={SELECT_CLASS}>
                    {CONTENT_FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {CONTENT_FORMAT_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <Label htmlFor={`bt-treatment-${item.id}`}>Behandlung</Label>
                  <select
                    id={`bt-treatment-${item.id}`}
                    name="treatmentId"
                    defaultValue={item.treatmentId ?? ""}
                    className={SELECT_CLASS}
                  >
                    <option value="">Keine</option>
                    {options.treatments.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.isActive ? "" : " (inaktiv)"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-12">
                  <Label htmlFor={`bt-caption-${item.id}`}>Beitragstext</Label>
                  <Textarea
                    id={`bt-caption-${item.id}`}
                    name="caption"
                    rows={4}
                    maxLength={5000}
                    defaultValue={item.caption ?? ""}
                  />
                </div>
                <div className="md:col-span-6">
                  <Label htmlFor={`bt-asset-${item.id}`}>Datei</Label>
                  <select id={`bt-asset-${item.id}`} name="assetId" defaultValue={item.assetId ?? ""} className={SELECT_CLASS}>
                    <option value="">Keine</option>
                    {options.assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title} ({a.kind === "video" ? "Video" : "Bild"})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2 md:col-span-6">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" name="usesClone" defaultChecked={item.usesClone} className="h-4 w-4" />
                    Mit KI-Klon des Inhabers
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" name="aiContent" defaultChecked={item.aiContent} className="h-4 w-4" />
                    KI-Inhalt
                  </label>
                </div>
                <div className="flex justify-end md:col-span-12">
                  <PendingSubmitButton size="sm" pendingLabel="Wird gespeichert …">
                    Speichern
                  </PendingSubmitButton>
                </div>
              </form>
            </details>
          )}

          {publishable && (
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Permalink eintragen</summary>
              <form action={addPublicationAction} className="mt-3 grid gap-4 md:grid-cols-12">
                <input type="hidden" name="clinicId" value={clinicId} />
                <input type="hidden" name="id" value={item.id} />
                <div className="md:col-span-3">
                  <Label htmlFor={`bt-platform-${item.id}`}>Plattform</Label>
                  <select id={`bt-platform-${item.id}`} name="platform" defaultValue="instagram" className={SELECT_CLASS}>
                    {CONTENT_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {PLATFORM_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-6">
                  <Label htmlFor={`bt-permalink-${item.id}`}>Permalink</Label>
                  <Input
                    id={`bt-permalink-${item.id}`}
                    name="permalink"
                    type="url"
                    required
                    maxLength={500}
                    pattern="https://.*"
                    placeholder="https://www.instagram.com/reel/…"
                  />
                </div>
                <div className="md:col-span-3">
                  <Label htmlFor={`bt-date-${item.id}`}>Veröffentlicht am</Label>
                  <Input
                    id={`bt-date-${item.id}`}
                    name="publishedAt"
                    type="date"
                    required
                    defaultValue={berlinDateString()}
                    max={berlinDateString()}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 md:col-span-12">
                  <p className="text-xs text-fg-secondary">Danach steht der Beitrag auf Live.</p>
                  <PendingSubmitButton size="sm" pendingLabel="Wird eingetragen …">
                    Permalink eintragen
                  </PendingSubmitButton>
                </div>
              </form>
            </details>
          )}

          {stoppable && (
            <details className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Stoppen</summary>
              <form action={stopBeitragAction} className="mt-3 space-y-3">
                <input type="hidden" name="clinicId" value={clinicId} />
                <input type="hidden" name="id" value={item.id} />
                <div>
                  <Label htmlFor={`bt-reason-${item.id}`}>Grund</Label>
                  <Input
                    id={`bt-reason-${item.id}`}
                    name="reason"
                    required
                    maxLength={500}
                    placeholder="z. B. Praxis wünscht keine weitere Ausspielung"
                  />
                </div>
                <div className="flex justify-end">
                  <DangerSubmitButton
                    size="sm"
                    confirm={`Beitrag „${item.title}“ stoppen? Das lässt sich nicht rückgängig machen.`}
                    pendingLabel="Wird gestoppt …"
                  >
                    Stoppen
                  </DangerSubmitButton>
                </div>
              </form>
            </details>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type LatestApproval = AdminApprovalData["latest"] extends Map<string, infer V> ? V : never;

const VERDICT_LABELS: Record<"clean" | "warn" | "violation", string> = {
  clean: "Ohne Treffer",
  warn: "Hinweise",
  violation: "Verstoß",
};
const VERDICT_TONES: Record<"clean" | "warn" | "violation", "good" | "warn" | "bad"> = {
  clean: "good",
  warn: "warn",
  violation: "bad",
};

/** Prüf-Schranke of one post: what blocks it, the HWG check and the confirmations by name. */
function GateSection({ clinicId, item, gate }: { clinicId: string; item: ContentItemView; gate: GateView }) {
  const hwg = gate.hwg;
  const reasons = gate.result.ok ? [] : gate.result.reasons.filter((r) => r !== "status");
  const ready = item.status === "entwurf" && gate.result.ok;
  return (
    <div className="space-y-3 rounded-md border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Prüf-Schranke</p>
        {ready ? <Badge tone="good">Bereit zur Freigabe</Badge> : <Badge tone="warn">Noch nicht bereit</Badge>}
      </div>
      {reasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {reasons.map((r) => (
            <li key={r}>{GATE_REASON_LABELS[r]}</li>
          ))}
        </ul>
      )}
      {item.status === "aenderung" && (
        <p className="text-fg-secondary">Nach der Änderung zurück in den Entwurf, dann kann der Beitrag erneut zur Freigabe.</p>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg-secondary">HWG-Prüfung:</span>
          {hwg ? (
            <>
              <Badge tone={hwg.current ? VERDICT_TONES[hwg.verdict] : "neutral"}>{VERDICT_LABELS[hwg.verdict]}</Badge>
              <span className="text-fg-secondary">
                {formatDateTime(hwg.checkedAt)}
                {hwg.current ? "" : ", für einen älteren Beitragstext"}
              </span>
            </>
          ) : (
            <span>noch nicht ausgeführt</span>
          )}
          {item.caption && (
            <form action={runHwgCheckAction}>
              <input type="hidden" name="clinicId" value={clinicId} />
              <input type="hidden" name="id" value={item.id} />
              <PendingSubmitButton size="sm" variant="outline" pendingLabel="Wird geprüft …">
                HWG-Prüfung ausführen
              </PendingSubmitButton>
            </form>
          )}
        </div>
        {hwg && hwg.current && hwg.findings.length > 0 && (
          <ul className="space-y-1">
            {hwg.findings.map((f, i) => (
              <li key={i} className="break-words">
                <Badge tone={f.severity === "red" ? "bad" : "warn"}>{f.severity === "red" ? "Verstoß" : "Hinweis"}</Badge>{" "}
                „{f.match}“: {f.reason}
                {f.reference ? <span className="text-fg-secondary"> ({f.reference})</span> : null}
              </li>
            ))}
          </ul>
        )}
        {hwg && hwg.current && hwg.verdict === "warn" ? (
          gate.hwgWarningsAckBy ? (
            <p className="text-fg-secondary">
              Hinweise bestätigt von {gate.hwgWarningsAckBy}
              {gate.hwgWarningsAckAt ? ` am ${formatDateTime(gate.hwgWarningsAckAt)}` : ""}.
            </p>
          ) : (
            <form action={acknowledgeHwgWarningsAction}>
              <input type="hidden" name="clinicId" value={clinicId} />
              <input type="hidden" name="id" value={item.id} />
              <PendingSubmitButton
                size="sm"
                variant="outline"
                confirm="Hinweise gelesen und vertretbar? Ihre E-Mail-Adresse wird als Bestätigung gespeichert."
              >
                Hinweise bestätigen
              </PendingSubmitButton>
            </form>
          )
        ) : null}
      </div>

      {gate.noBeforeAfterConfirmedBy ? (
        <form action={setNoBeforeAfterAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="clinicId" value={clinicId} />
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="confirmed" value="0" />
          <span className="text-fg-secondary">
            „{NO_BEFORE_AFTER_CONFIRMATION}“ bestätigt von {gate.noBeforeAfterConfirmedBy}
            {gate.noBeforeAfterConfirmedAt ? ` am ${formatDateTime(gate.noBeforeAfterConfirmedAt)}` : ""}.
          </span>
          <PendingSubmitButton size="sm" variant="ghost">
            Zurücknehmen
          </PendingSubmitButton>
        </form>
      ) : (
        <form action={setNoBeforeAfterAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="clinicId" value={clinicId} />
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="confirmed" value="1" />
          <label className="inline-flex items-start gap-2">
            <input type="checkbox" name="check" required className="mt-0.5 h-4 w-4" />
            <span>{NO_BEFORE_AFTER_CONFIRMATION}</span>
          </label>
          <PendingSubmitButton size="sm" variant="outline">
            Bestätigen
          </PendingSubmitButton>
        </form>
      )}
    </div>
  );
}

function decisionText(d: NonNullable<AdminBatchView["posts"][number]["decision"]>): string {
  const via = d.decidedVia === "link" ? "per Link" : "im Portal";
  return `${APPROVAL_DECISION_LABELS[d.decision]} am ${formatDateTime(d.decidedAt)} ${via}`;
}

/** Freigabe-Paket: pick gate-passing drafts and send them; the sent batches below. */
function FreigabePaketCard({
  clinicId,
  items,
  approval,
}: {
  clinicId: string;
  items: ContentItemView[];
  approval: AdminApprovalData;
}) {
  const drafts = items.filter((i) => i.status === "entwurf");
  const ready = drafts.filter((i) => approval.gate.get(i.id)?.result.ok);
  const notReady = drafts.length - ready.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Freigabe-Paket</CardTitle>
        <CardDescription>
          Die Praxis bekommt eine E-Mail mit einem Link pro Beitrag und sieht dieselben Knöpfe unter Beiträge. Es gilt
          die erste Entscheidung. Frist: 2 Werktage. Klon-Beiträge gehen nur an Inhaber-Zugänge.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {ready.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            Kein Entwurf erfüllt die Prüf-Schranke.
            {notReady > 0
              ? ` ${notReady} ${notReady === 1 ? "Entwurf wartet" : "Entwürfe warten"} noch auf Prüfung oder Bestätigung.`
              : ""}
          </p>
        ) : (
          <form action={sendApprovalBatchAction} className="space-y-3">
            <input type="hidden" name="clinicId" value={clinicId} />
            <ul className="space-y-2">
              {ready.map((i) => (
                <li key={i.id}>
                  <label className="inline-flex items-start gap-2 text-sm">
                    <input type="checkbox" name="itemIds" value={i.id} defaultChecked className="mt-0.5 h-4 w-4" />
                    <span>
                      {i.title}{" "}
                      <span className="text-fg-secondary">
                        ({formatLabel(i.format)}
                        {i.usesClone ? ", KI-Klon" : ""})
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {notReady > 0 && (
              <p className="text-xs text-fg-secondary">
                {notReady} {notReady === 1 ? "weiterer Entwurf erfüllt" : "weitere Entwürfe erfüllen"} die Prüf-Schranke
                noch nicht.
              </p>
            )}
            <PendingSubmitButton
              size="sm"
              pendingLabel="Wird gesendet …"
              confirm="Freigabe-Paket jetzt an die Praxis senden? Die Beiträge stehen danach auf „Wartet auf Freigabe“."
            >
              Zur Freigabe senden
            </PendingSubmitButton>
          </form>
        )}

        {approval.batches.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Gesendete Pakete</p>
            <ul className="space-y-3">
              {approval.batches.map((b) => {
                const open = b.posts.filter((p) => !p.decision).length;
                return (
                  <li key={b.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Gesendet {formatDateTime(b.sentAt)}</span>
                      <span className="text-fg-secondary">Frist bis {formatApprovalDue(b.dueAt)}</span>
                      {open === 0 ? <Badge tone="good">Entschieden</Badge> : <Badge tone="warn">{open} offen</Badge>}
                      {b.verzug && (
                        <Badge tone="bad">
                          Verzug ab {formatIsoDate(b.verzug.fromDate)}
                          {b.verzug.toDate ? ` bis ${formatIsoDate(b.verzug.toDate)}` : ""}
                          {b.verzug.notifiedAt ? "" : ", nicht mitgeteilt"}
                        </Badge>
                      )}
                    </div>
                    <ul className="space-y-1">
                      {b.posts.map((p) => (
                        <li key={p.itemId} className="break-words">
                          <span>{p.title}</span>
                          {p.inhaberOnly ? <span className="text-fg-secondary"> (nur Inhaber)</span> : null}
                          <span className="text-fg-secondary">: {p.decision ? decisionText(p.decision) : "offen"}</span>
                          {p.decision?.changeText ? (
                            <span className="block whitespace-pre-wrap text-fg-primary">„{p.decision.changeText}“</span>
                          ) : null}
                        </li>
                      ))}
                      {b.posts.length === 0 && <li className="text-fg-secondary">Alle Beiträge zurückgeholt.</li>}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
