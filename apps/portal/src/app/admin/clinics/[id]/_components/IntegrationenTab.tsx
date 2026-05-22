import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
} from "@eins/ui";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import type { schema } from "@/db/client";
import { Brand } from "@/app/_components/Brand";

const GLOW_CARD = "!bg-bg-secondary/60";

type Cred = typeof schema.platformCredentials.$inferSelect;
interface SyncEvent {
  id: string;
  createdAt: Date;
  diff: unknown;
  action: string;
}

export interface AdsConversionHealth {
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
  recent: Array<{
    id: string;
    channel: string;
    status: string;
    valueEur: string;
    createdAt: Date;
    sentAt: Date | null;
    responseCode: number | null;
    responseBody: unknown;
  }>;
}

export function IntegrationenTab({
  creds,
  syncHistory,
  adsConversion,
}: {
  creds: Cred[];
  syncHistory: SyncEvent[];
  adsConversion: AdsConversionHealth;
}) {
  return (
    <div className="space-y-5">
      <Card className={GLOW_CARD}>
        <CardHeader>
          <CardTitle>Werbekonten</CardTitle>
          <CardDescription>
            Verbundene Plattformen und letzter Synchronisationsstand.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["meta", "google"] as const).map((p) => {
            const c = creds.find((x) => x.platform === p);
            return (
              <div
                key={p}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg-secondary/40 px-4 py-3"
              >
                <div>
                  <div className="font-medium">
                    {p === "meta" ? (
                      <Brand brand="meta">Meta / Instagram</Brand>
                    ) : (
                      <Brand brand="google">Google Ads</Brand>
                    )}
                  </div>
                  <div className="text-xs text-fg-secondary">
                    {c
                      ? `Konto ${c.accountId ?? "?"} · zuletzt ${
                          c.lastSyncedAt ? formatRelative(c.lastSyncedAt) : "nie"
                        }`
                      : "Nicht verbunden"}
                  </div>
                  {c?.lastSyncError && (
                    <div className="mt-1 text-xs text-tone-bad">
                      Fehler: {c.lastSyncError}
                    </div>
                  )}
                </div>
                <div>
                  {c ? (
                    c.lastSyncError ? (
                      <Badge tone="bad">Fehler</Badge>
                    ) : (
                      <Badge tone="good">Verbunden</Badge>
                    )
                  ) : (
                    <Badge tone="neutral">Offen</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardHeader>
          <CardTitle>Closed-Loop Conversion-Outbox</CardTitle>
          <CardDescription>
            Pro bezahlte Rechnung wird je ein Meta-CAPI- und ein
            Google-OCI-Upload in die Outbox geschrieben. Hier sind die
            letzten Ereignisse mit Status und Antwort-Code der Plattformen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-3 text-xs">
            <OutboxStat label="Gesendet" value={adsConversion.sent} tone="good" />
            <OutboxStat
              label="Wartend"
              value={adsConversion.pending}
              tone="neutral"
            />
            <OutboxStat
              label="Übersprungen"
              value={adsConversion.skipped}
              tone="neutral"
            />
            <OutboxStat
              label="Fehlgeschlagen"
              value={adsConversion.failed}
              tone="bad"
            />
          </div>
          {adsConversion.recent.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Noch keine Conversion-Uploads. Erste bezahlte Rechnung mit
              vorhandenem fbclid oder gclid füllt diese Liste.
            </p>
          ) : (
            <ol className="space-y-1.5 text-xs">
              {adsConversion.recent.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-2 border-l-2 border-border pl-3"
                >
                  <span className="font-mono text-[11px] text-fg-tertiary">
                    {formatDateTime(r.createdAt)}
                  </span>
                  <Badge tone="neutral">{r.channel}</Badge>
                  <Badge tone={outboxTone(r.status)}>{r.status}</Badge>
                  <span className="text-fg-secondary">{r.valueEur} €</span>
                  {r.responseCode !== null && r.responseCode !== 0 && (
                    <span className="text-fg-secondary">
                      HTTP {r.responseCode}
                    </span>
                  )}
                  {(r.status === "skipped" || r.status === "failed") &&
                    !!r.responseBody && (
                      <span className="truncate text-fg-secondary">
                        {summarizeOutboxBody(r.responseBody)}
                      </span>
                    )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardHeader>
          <CardTitle>Sync-Historie</CardTitle>
          <CardDescription>
            Audit-Spuren rund um Synchronisations-Ereignisse. Leer, bis ein
            Fehler oder eine Anpassung auftritt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {syncHistory.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Keine Sync-Ereignisse aufgezeichnet.
            </p>
          ) : (
            <ol className="space-y-2 text-sm">
              {syncHistory.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-2 border-l-2 border-border pl-3"
                >
                  <span className="font-mono text-[11px] text-fg-tertiary">
                    {formatDateTime(e.createdAt)}
                  </span>
                  <Badge tone="neutral">{e.action}</Badge>
                  {!!e.diff && (
                    <span className="text-xs text-fg-secondary">
                      {summarizeDiff(e.diff)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function summarizeDiff(diff: unknown): string {
  if (!diff || typeof diff !== "object") return "";
  const d = diff as Record<string, unknown>;
  if (typeof d.error === "string") return d.error.slice(0, 120);
  if (typeof d.platform === "string") return `Plattform: ${d.platform}`;
  return Object.keys(d).slice(0, 3).join(", ");
}

function OutboxStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "neutral" | "bad";
}) {
  return (
    <div className="rounded-md border border-border bg-bg-secondary/40 px-2.5 py-2">
      <div className="text-fg-secondary">{label}</div>
      <div
        className={
          tone === "good"
            ? "text-tone-good"
            : tone === "bad"
              ? "text-tone-bad"
              : "text-fg-primary"
        }
      >
        <span className="text-lg font-semibold">{value}</span>
      </div>
    </div>
  );
}

function outboxTone(status: string): "good" | "neutral" | "warn" | "bad" {
  switch (status) {
    case "sent":
      return "good";
    case "failed":
      return "bad";
    case "skipped":
      return "neutral";
    default:
      return "warn";
  }
}

function summarizeOutboxBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  if (typeof b.reason === "string") return b.reason;
  if (typeof b.error === "string") return b.error.slice(0, 100);
  const err = b.error as Record<string, unknown> | undefined;
  if (err && typeof err.message === "string") return err.message.slice(0, 100);
  return "";
}
