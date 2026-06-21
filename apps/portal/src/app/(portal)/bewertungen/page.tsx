import Link from "next/link";
import { ArrowRight, MessageSquare, Star } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
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
import {
  countNewPatientFeedback,
  listPatientFeedback,
} from "@/server/queries/patient-feedback";
import { PlatformTile } from "./_components/PlatformTile";
import { CopyButton } from "./_components/CopyButton";
import {
  TRACKED_PLATFORMS,
  platformLabelNode,
  type Platform,
} from "./_lib/platforms";
import {
  REPLY_BUCKET_LABELS,
  REPLY_BUCKET_ORDER,
  templatesByBucket,
} from "./_lib/reply-templates";
import { Brand } from "@/app/_components/Brand";
import { ChapterLaunchLink } from "@/app/(portal)/_components/tour/ChapterLaunchLink";

export const metadata = { title: "Bewertungen" };

export default async function BewertungenPage() {
  const session = await requirePermissionOrRedirect("reviews.view");
  const isInhaber = session.role === "inhaber";

  // The /bewertungen sidebar badge counts new patient feedback rows, but
  // until now the index itself didn't surface them — users would see "1 neu"
  // in the navigation and find an empty platform-tile page. Pull the count
  // and a short preview here so the new feedback is visible from the
  // landing tab, with a one-click jump into the dedicated sub-tab.
  const canViewPatientFeedback = can(session.role, "patient_feedback.view");

  const [clinicRows, { latest, trend, history }, newFeedbackCount, feedbackPreview] =
    await Promise.all([
      db
        .select({
          displayName: schema.clinics.displayName,
          googleReviewUrl: schema.clinics.googleReviewUrl,
          jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
          jamedaProfileUrl: schema.clinics.jamedaProfileUrl,
        })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, session.clinicId))
        .limit(1),
      bewertungenPageData(session.clinicId, session.userId, 6),
      canViewPatientFeedback
        ? countNewPatientFeedback(session.clinicId, session.userId)
        : Promise.resolve(0),
      canViewPatientFeedback
        ? listPatientFeedback(session.clinicId, session.userId, { status: "neu" })
        : Promise.resolve([] as Awaited<ReturnType<typeof listPatientFeedback>>),
    ]);
  const clinic = clinicRows[0];
  const recentNewFeedback = feedbackPreview.slice(0, 3);
  const reviewLinks = {
    googleReviewUrl: clinic?.googleReviewUrl ?? null,
    jamedaReviewUrl: clinic?.jamedaReviewUrl ?? null,
    jamedaProfileUrl: clinic?.jamedaProfileUrl ?? null,
  };

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold md:text-4xl">Bewertungen.</h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            Ihre Reputation auf <Brand brand="google" />, <Brand brand="jameda" /> &amp; Co. an einem Ort.
          </p>
        </div>
        {isInhaber && <ChapterLaunchLink chapter="bewertungen" />}
      </header>

      {canViewPatientFeedback && newFeedbackCount > 0 && (
        <Card className="border-tone-warn/40 bg-[var(--tone-warn-bg)]/40">
          <CardContent className="flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tone-warn/15 text-tone-warn">
                <MessageSquare className="h-4 w-4" aria-hidden />
              </span>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">
                    Neues Patientenfeedback
                  </h2>
                  <Badge tone="warn">{newFeedbackCount} neu</Badge>
                </div>
                <p className="text-sm text-fg-secondary">
                  {newFeedbackCount === 1
                    ? "Eine Patientin oder ein Patient hat seit dem letzten Besuch geantwortet."
                    : `${newFeedbackCount} Rückmeldungen warten auf Sichtung.`}
                </p>
                {recentNewFeedback.length > 0 && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {recentNewFeedback.map((f) => (
                      <li key={f.id} className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-0.5 text-tone-warn tabular-nums"
                          aria-label={`${f.rating ?? "—"} von 5 Sternen`}
                        >
                          {f.rating ?? "—"}
                          <Star className="h-3 w-3 fill-current" aria-hidden />
                        </span>
                        <Link
                          href={`/bewertungen/feedback/${f.id}`}
                          className="truncate text-fg-primary hover:text-accent"
                        >
                          {f.freeText?.trim() || "Ohne Kommentar"}
                        </Link>
                        <span className="ml-auto shrink-0 text-xs text-fg-tertiary">
                          {formatDateTime(f.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <Link
              href="/bewertungen/feedback"
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-border bg-bg-primary px-3 py-2 text-sm font-medium text-fg-primary hover:bg-bg-secondary md:self-center"
            >
              Alle ansehen
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Per-platform tiles */}
      <section
        data-tour="bewertungen-platforms"
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
            reviewLinks={reviewLinks}
          />
        ))}
      </section>

      {/* Antwortvorlagen */}
      <Card data-tour="bewertungen-templates">
        <CardHeader>
          <CardTitle>Antwortvorlagen</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-sm text-fg-secondary">
            Vorformulierte, rechtssichere Antworten zum Kopieren. Ersetzen Sie
            die Platzhalter [Praxisname] und [Vorname], bevor Sie eine Antwort
            veröffentlichen.
          </p>
          <Accordion type="single" collapsible>
            {REPLY_BUCKET_ORDER.map((bucket) => (
              <AccordionItem key={bucket} value={bucket}>
                <AccordionTrigger>{REPLY_BUCKET_LABELS[bucket]}</AccordionTrigger>
                <AccordionContent>
                  <ul className="space-y-4">
                    {templatesByBucket(bucket).map((tpl) => (
                      <li
                        key={tpl.id}
                        className="rounded-xl border border-border bg-bg-secondary p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="text-sm font-medium text-fg-primary">
                            {tpl.title}
                          </div>
                          <CopyButton text={tpl.text} label="Kopieren" />
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-fg-secondary">
                          {tpl.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

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
        <thead className="bg-bg-secondary text-left text-fg-secondary">
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
            <tr key={r.id} className="hover:bg-bg-secondary">
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

