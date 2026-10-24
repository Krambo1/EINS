import Link from "next/link";
import { Card, CardContent, Badge } from "@eins/ui";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatRelative,
} from "@/lib/formatting";
import {
  AI_CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  type AiCategory,
  type RequestSource,
} from "@/lib/constants";
import type { AdminLeadRow } from "@/server/queries/admin";
import { responseRuleStartsByClinic } from "@/server/guarantee-clock";
import { withBrandLogos } from "@/app/_components/Brand";
import {
  RESPONSE_STATE_LABELS,
  isPraxisResponseFlag,
  responseState,
} from "@/lib/response-time";

interface Props {
  rows: AdminLeadRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Where the page-link helper should send the user. */
  basePath: string;
  /** Existing query string excluding 'page' so pagination preserves filters. */
  queryWithoutPage: Record<string, string | string[] | undefined>;
  /** Hide the clinic column when scoped to a single clinic. */
  hideClinic?: boolean;
}

export async function LeadsTable({
  rows,
  total,
  page,
  pageSize,
  basePath,
  queryWithoutPage,
  hideClinic,
}: Props) {
  // K-3: per-Praxis rule start (signing date), so inquiries before the
  // signature never show "nicht beantwortet". One query for the page.
  const ruleStarts = await responseRuleStartsByClinic([...new Set(rows.map((r) => r.clinicId))]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // Bookmark to a page that no longer exists (G-23): offer the last page
  // instead of a dead end showing "Seite 99 von 3".
  const outOfRange = page > totalPages && total > 0;

  const linkFor = (p: number) => ({
    pathname: basePath,
    query: { ...queryWithoutPage, page: String(p) },
  });

  return (
    <Card className="!p-0 overflow-hidden">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg-secondary text-left text-xs font-medium text-fg-secondary">
              <tr>
                {!hideClinic && <th className="px-4 py-2">Praxis</th>}
                <th className="px-4 py-2">Kontakt</th>
                <th className="px-4 py-2">Quelle</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">KI-Bewertung</th>
                <th className="px-4 py-2 text-right">Antwortziel</th>
                <th className="px-4 py-2 text-right">Erstkontakt</th>
                <th className="px-4 py-2 text-right">Erstellt</th>
                <th className="px-4 py-2 text-right">Umsatz</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={hideClinic ? 8 : 9}
                    className="px-4 py-10 text-center text-fg-secondary"
                  >
                    {outOfRange ? (
                      <>
                        Diese Seite gibt es nicht mehr.{" "}
                        <Link href={linkFor(totalPages)} className="text-accent hover:underline">
                          Zur letzten Seite
                        </Link>
                      </>
                    ) : (
                      "Keine Anfragen für diese Filter."
                    )}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-b-0 align-top hover:bg-bg-secondary"
                >
                  {!hideClinic && (
                    <td className="px-4 py-2 text-sm">
                      <Link
                        href={`/admin/clinics/${r.clinicId}`}
                        className="hover:text-accent"
                      >
                        {r.clinicName}
                      </Link>
                    </td>
                  )}
                  <td className="px-4 py-2">
                    <div className="text-sm font-medium text-fg-primary">
                      {r.contactName ?? "ohne Namen"}
                    </div>
                    <div className="text-xs text-fg-secondary">
                      {r.contactEmail ?? r.contactPhone ?? "–"}
                    </div>
                    {r.treatmentWish && (
                      <div className="text-[11px] text-fg-tertiary">
                        {r.treatmentWish}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {withBrandLogos(SOURCE_LABELS[r.source as RequestSource] ?? r.source)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={statusTone(r.status)}>
                      {REQUEST_STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                    <ResponseFlag row={r} ruleStart={ruleStarts.get(r.clinicId) ?? null} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.aiScore == null ? (
                      <span className="text-fg-tertiary">–</span>
                    ) : (
                      <span className="tabular-nums">
                        {r.aiScore}
                      </span>
                    )}
                    {r.aiCategory && (
                      <div className="text-sm text-fg-primary">
                        {AI_CATEGORY_LABELS[r.aiCategory as AiCategory] ?? r.aiCategory}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-xs">
                    {r.slaRespondBy ? (
                      r.firstContactedAt ? (
                        <Badge tone="good">erfüllt</Badge>
                      ) : new Date(r.slaRespondBy).getTime() < Date.now() ? (
                        <Badge tone="bad">verletzt</Badge>
                      ) : (
                        <span className="text-fg-secondary">
                          {formatRelative(r.slaRespondBy)}
                        </span>
                      )
                    ) : (
                      "–"
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-fg-secondary">
                    {r.firstContactedAt
                      ? formatRelative(r.firstContactedAt)
                      : "–"}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-fg-secondary">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td className="px-4 py-2 text-right text-xs tabular-nums">
                    {r.convertedRevenueEur == null
                      ? "–"
                      : formatMoney(r.convertedRevenueEur, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && !outOfRange && (
          <nav className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <div className="text-fg-secondary">
              Seite {page} von {totalPages} · {formatNumber(total)} Anfragen
            </div>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={linkFor(page - 1)}
                  className="rounded-md border border-border px-3 py-1 hover:bg-bg-secondary"
                >
                  Zurück
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={linkFor(page + 1)}
                  className="rounded-md border border-border px-3 py-1 hover:bg-bg-secondary"
                >
                  Weiter
                </Link>
              )}
            </div>
          </nav>
        )}
      </CardContent>
    </Card>
  );
}

/** Folge 2 of the 48-Werkstunden rule: only the two Praxis flags show. */
function ResponseFlag({ row, ruleStart }: { row: AdminLeadRow; ruleStart: Date | null }) {
  const state = responseState({ ...row, ruleStart }, new Date());
  if (!isPraxisResponseFlag(state)) return null;
  return (
    <div className={`mt-1 text-[11px] ${state === "nicht_beantwortet" ? "text-tone-bad" : "text-tone-warn"}`}>
      {RESPONSE_STATE_LABELS[state]}
    </div>
  );
}

function statusTone(s: string): "good" | "warn" | "bad" | "neutral" {
  if (s === "gewonnen") return "good";
  if (s === "verloren" || s === "spam") return "bad";
  if (s === "termin_vereinbart" || s === "beratung_erschienen") return "warn";
  return "neutral";
}
