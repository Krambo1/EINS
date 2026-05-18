import { Star } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { formatDateTime, formatNumber } from "@/lib/formatting";
import {
  bewertungenPageData,
  type ReviewSnapshot,
  type ReviewTrendRow,
  type listReviews,
} from "@/server/queries/reviews";
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
        className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
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
                description="Schnappschüsse werden automatisch von Google und Jameda übernommen. Sobald die Verbindung aktiv ist, erscheint hier der Verlauf."
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

