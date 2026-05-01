import { Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from "@eins/ui";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { formatRelative } from "@/lib/formatting";
import type { schema } from "@/db/client";
import { ImpersonateButton } from "./ImpersonateButton";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

type TeamMember = typeof schema.clinicUsers.$inferSelect;

export function TeamTab({ team }: { team: TeamMember[] }) {
  const mfaCovered = team.filter((u) => u.mfaEnrolled && !u.archivedAt).length;
  const active = team.filter((u) => !u.archivedAt).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Mitglieder aktiv" value={active.toString()} />
        <Stat
          label="MFA-Abdeckung"
          value={
            active === 0 ? "–" : `${Math.round((mfaCovered / active) * 100)} %`
          }
        />
        <Stat
          label="MFA fehlt"
          value={(active - mfaCovered).toString()}
          tone={active - mfaCovered > 0 ? "warn" : "good"}
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardHeader>
          <CardTitle>Team ({team.length})</CardTitle>
          <CardDescription>
            Verwaltung erfolgt durch den Inhaber im Kundenportal. „Als Benutzer
            öffnen" startet eine sichere Impersonation in einem neuen Tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {team.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-fg-secondary">
              Noch keine Benutzer angelegt.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-t border-border bg-bg-secondary/40 text-left text-xs text-fg-secondary">
                  <tr>
                    <th className="px-4 py-2">E-Mail</th>
                    <th className="px-4 py-2">Name</th>
                    <th className="px-4 py-2">Rolle</th>
                    <th className="px-4 py-2">MFA</th>
                    <th className="px-4 py-2">Letzter Login</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Ansicht</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((u) => (
                    <tr
                      key={u.id}
                      className="border-t border-border last:border-b-0"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                      <td className="px-4 py-2">{u.fullName ?? "—"}</td>
                      <td className="px-4 py-2">
                        <Badge tone={u.role === "inhaber" ? "good" : "neutral"}>
                          {ROLE_LABELS[u.role as Role] ?? u.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        {u.mfaEnrolled ? (
                          <Badge tone="good">Aktiv</Badge>
                        ) : (
                          <Badge tone="warn">Nicht aktiv</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-fg-secondary">
                        {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "nie"}
                      </td>
                      <td className="px-4 py-2">
                        {u.archivedAt ? (
                          <Badge tone="bad">Archiviert</Badge>
                        ) : u.invitedAt && !u.lastLoginAt ? (
                          <Badge tone="warn">Eingeladen</Badge>
                        ) : (
                          <Badge tone="good">Aktiv</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {u.archivedAt ? (
                          <span className="text-xs text-fg-secondary">—</span>
                        ) : (
                          <ImpersonateButton
                            targetUserId={u.id}
                            targetEmail={u.email}
                          />
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
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/60 p-4">
      <div className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
        {label}
      </div>
      <div
        className={`mt-1 font-display text-2xl font-semibold tabular-nums ${
          tone === "warn"
            ? "text-tone-warn"
            : tone === "bad"
              ? "text-tone-bad"
              : tone === "good"
                ? "text-tone-good"
                : "text-fg-primary"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
