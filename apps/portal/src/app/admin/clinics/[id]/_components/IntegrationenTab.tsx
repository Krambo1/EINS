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

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

type Cred = typeof schema.platformCredentials.$inferSelect;
interface SyncEvent {
  id: string;
  createdAt: Date;
  diff: unknown;
  action: string;
}

export function IntegrationenTab({
  creds,
  syncHistory,
}: {
  creds: Cred[];
  syncHistory: SyncEvent[];
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
                    {p === "meta" ? "Meta / Instagram" : "Google Ads"}
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
