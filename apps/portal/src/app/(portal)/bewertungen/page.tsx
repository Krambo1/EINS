import { Star } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { can } from "@/lib/roles";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import {
  bewertungenPageData,
  type ReviewSnapshot,
  type ReviewTrendRow,
  type listReviews,
} from "@/server/queries/reviews";
import { logReviewSnapshotAction } from "../einstellungen/actions";
import { PlatformTile } from "./_components/PlatformTile";
import {
  TRACKED_PLATFORMS,
  platformLabelNode,
  type Platform,
} from "./_lib/platforms";
import { Brand } from "@/app/_components/Brand";

export const metadata = { title: "Bewertungen" };

export default async function BewertungenPage() {
  const session = await requirePermissionOrRedirect("reviews.view");
  const canManage = can(session.role, "reviews.manage");

  const [clinicRows, { latest, trend, history }] = await Promise.all([
    db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1),
    bewertungenPageData(session.clinicId, session.userId, 6),
  ]);
  const clinic = clinicRows[0];

  const byPlatform = new Map<string, ReviewSnapshot>();
  for (const snap of latest) byPlatform.set(snap.platform, snap);

  const trendByPlatform = new Map<string, ReviewTrendRow[]>();
  for (const row of trend) {
    const arr = trendByPlatform.get(row.platform) ?? [];
    arr.push(row);
    trendByPlatform.set(row.platform, arr);
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Bewertungen.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihre Reputation auf <Brand brand="google" />, <Brand brand="jameda" /> &amp; Co. an einem Ort.
        </p>
      </header>

      {/* Per-platform tiles */}
      <section
        aria-label="Bewertungen pro Plattform"
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        {TRACKED_PLATFORMS.map((p) => (
          <PlatformTile
            key={p}
            platform={p}
            snapshot={byPlatform.get(p) ?? null}
            trend={trendByPlatform.get(p) ?? []}
            clinicName={clinic?.displayName ?? ""}
          />
        ))}
      </section>

      {/* Inhaber-only: log a new snapshot */}
      {canManage && (
        <section className="space-y-3">
          <div>
            <h3 className="opa-h3 text-fg-primary">Schnappschuss erfassen</h3>
            <p className="mt-1 text-sm text-fg-secondary">
              Tragen Sie regelmäßig Ihren aktuellen Stand pro Plattform ein
              (z. B. monatlich). So sehen Sie und Ihr Team den Verlauf.
            </p>
          </div>
          <form
            action={logReviewSnapshotAction}
            className="grid gap-3 rounded-xl border border-border bg-bg-secondary/40 p-4 md:grid-cols-[10rem_8rem_8rem_1fr_auto]"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">
                Plattform
              </label>
              <select
                name="platform"
                defaultValue="google"
                className="h-11 w-full rounded-xl border border-border bg-bg-primary px-3 text-base"
              >
                <option value="google">Google</option>
                <option value="jameda">Jameda</option>
                <option value="trustpilot">Trustpilot</option>
                <option value="manual">Eigene</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">
                Bewertung (0–5)
              </label>
              <Input
                name="rating"
                type="number"
                step="0.1"
                min={0}
                max={5}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">
                Anzahl
              </label>
              <Input name="totalCount" type="number" min={0} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-fg-secondary">
                Notiz (optional)
              </label>
              <Input name="notes" maxLength={500} />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full md:w-auto">
                <Star className="h-4 w-4" />
                Erfassen
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Full history */}
      <Card>
        <CardHeader>
          <CardTitle>Verlauf</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Star className="h-8 w-8" />}
                title="Noch keine Bewertungen erfasst"
                description={
                  canManage
                    ? "Tragen Sie oben Ihren ersten Schnappschuss ein."
                    : "Ihre Praxisinhaber:in hat noch keinen Schnappschuss eingetragen."
                }
              />
            </div>
          ) : (
            <HistoryTable rows={history} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ----------------------------------------------------------------- helpers ----

function HistoryTable({
  rows,
}: {
  rows: Awaited<ReturnType<typeof listReviews>>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary/50 text-left text-fg-secondary">
          <tr>
            <Th>Datum</Th>
            <Th>Plattform</Th>
            <Th align="right">Bewertung</Th>
            <Th align="right">Anzahl</Th>
            <Th>Notiz</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-bg-secondary/40">
              <Td>{formatDateTime(r.recordedAt)}</Td>
              <Td>{platformLabelNode(r.platform as Platform)}</Td>
              <Td align="right">
                <span className="tabular-nums">
                  {r.rating.toFixed(1).replace(".", ",")} ★
                </span>
              </Td>
              <Td align="right">{formatNumber(r.totalCount)}</Td>
              <Td>
                {r.notes ? (
                  <span className="text-fg-secondary">{r.notes}</span>
                ) : (
                  <span className="text-fg-tertiary">—</span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium uppercase tracking-wide ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </td>
  );
}

