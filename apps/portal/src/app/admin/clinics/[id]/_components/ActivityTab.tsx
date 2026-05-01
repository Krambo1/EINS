import { Card, CardContent, Badge } from "@eins/ui";
import {
  formatDateTime,
  formatRelative,
} from "@/lib/formatting";
import type { ClinicActivity } from "@/server/queries/admin";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

export function ActivityTab({ data }: { data: ClinicActivity }) {
  return (
    <div className="space-y-6">
      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <header>
            <h2 className="font-display text-xl font-semibold">Login-Aktivität</h2>
            <p className="text-xs text-fg-secondary">
              Letzter Login pro Teammitglied. „Nie" = noch nicht eingeloggt.
            </p>
          </header>
          {data.logins.length === 0 ? (
            <p className="text-sm text-fg-secondary">Keine Mitglieder.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
                <tr>
                  <th className="py-2">E-Mail</th>
                  <th className="py-2">MFA</th>
                  <th className="py-2 text-right">Letzter Login</th>
                </tr>
              </thead>
              <tbody>
                {data.logins.map((u) => (
                  <tr key={u.userId} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{u.email}</td>
                    <td className="py-2">
                      {u.mfaEnrolled ? (
                        <Badge tone="good">Aktiv</Badge>
                      ) : (
                        <Badge tone="warn">Fehlt</Badge>
                      )}
                    </td>
                    <td className="py-2 text-right text-xs text-fg-secondary">
                      {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "nie"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <header>
            <h2 className="font-display text-xl font-semibold">Audit-Spuren</h2>
            <p className="text-xs text-fg-secondary">
              Letzte 50 Ereignisse aus dem zentralen Audit-Log.
            </p>
          </header>
          {data.audit.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Noch keine Audit-Einträge in den letzten 30 Tagen.
            </p>
          ) : (
            <ol className="space-y-2 text-sm">
              {data.audit.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline gap-2 border-l-2 border-border pl-3"
                >
                  <span className="font-mono text-[11px] text-fg-tertiary">
                    {formatDateTime(a.createdAt)}
                  </span>
                  <Badge tone="neutral">{a.action}</Badge>
                  {a.entityKind && (
                    <span className="text-xs text-fg-secondary">
                      {a.entityKind}
                      {a.entityId ? ` · ${a.entityId.slice(0, 8)}` : ""}
                    </span>
                  )}
                  {a.actorEmail && (
                    <span className="ml-auto font-mono text-xs text-fg-secondary">
                      {a.actorEmail}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <UploadCard
          title="Dokument-Uploads (30 Tage)"
          rows={data.documentUploads.map((d) => ({
            id: d.id,
            title: d.title,
            kind: d.kind,
            createdAt: d.createdAt,
          }))}
        />
        <UploadCard
          title="Medien-Uploads (30 Tage)"
          rows={data.assetUploads.map((d) => ({
            id: d.id,
            title: d.title,
            kind: d.kind,
            createdAt: d.createdAt,
          }))}
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-display text-xl font-semibold">
            Animations-Anfragen
          </h2>
          {data.animationRequests.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Diese Klinik hat noch keine Animationen angefragt.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
                <tr>
                  <th className="py-2">Titel</th>
                  <th className="py-2">Status</th>
                  <th className="py-2 text-right">Angefragt</th>
                  <th className="py-2 text-right">Geliefert</th>
                </tr>
              </thead>
              <tbody>
                {data.animationRequests.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2">{a.title ?? "—"}</td>
                    <td className="py-2">
                      <Badge tone={a.status === "ready" ? "good" : "warn"}>
                        {a.status}
                      </Badge>
                    </td>
                    <td className="py-2 text-right text-xs text-fg-secondary">
                      {a.requestedAt ? formatRelative(a.requestedAt) : "–"}
                    </td>
                    <td className="py-2 text-right text-xs text-fg-secondary">
                      {a.deliveredAt ? formatRelative(a.deliveredAt) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UploadCard({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; title: string; kind: string; createdAt: Date }[];
}) {
  return (
    <Card className={GLOW_CARD}>
      <CardContent className="space-y-3 pt-6">
        <h2 className="font-display text-xl font-semibold">{title}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-fg-secondary">Keine Uploads im Zeitraum.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between gap-2 border-t border-border py-1.5 first:border-t-0"
              >
                <span className="truncate">{r.title}</span>
                <span className="font-mono text-[11px] text-fg-tertiary">
                  {r.kind}
                </span>
                <span className="font-mono text-[11px] text-fg-secondary">
                  {formatRelative(r.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
