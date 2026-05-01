import Link from "next/link";
import { Card, CardContent, Badge } from "@eins/ui";
import {
  formatDateTime,
  formatEuro,
  formatNumber,
  formatRelative,
} from "@/lib/formatting";
import {
  REQUEST_STATUS_LABELS,
  SOURCE_LABELS,
  type RequestSource,
} from "@/lib/constants";
import type { AdminLeadRow } from "@/server/queries/admin";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

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

export function LeadsTable({
  rows,
  total,
  page,
  pageSize,
  basePath,
  queryWithoutPage,
  hideClinic,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const linkFor = (p: number) => ({
    pathname: basePath,
    query: { ...queryWithoutPage, page: String(p) },
  });

  return (
    <Card className={`${GLOW_CARD} !p-0 overflow-hidden`}>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-bg-secondary/40 text-left text-xs text-fg-secondary">
              <tr>
                {!hideClinic && <th className="px-4 py-2">Klinik</th>}
                <th className="px-4 py-2">Kontakt</th>
                <th className="px-4 py-2">Quelle</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">KI-Score</th>
                <th className="px-4 py-2 text-right">SLA</th>
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
                    Keine Anfragen für diese Filter.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-b-0 align-top hover:bg-bg-secondary/30"
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
                      {r.contactEmail ?? r.contactPhone ?? "—"}
                    </div>
                    {r.treatmentWish && (
                      <div className="text-[11px] text-fg-tertiary">
                        {r.treatmentWish}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {SOURCE_LABELS[r.source as RequestSource] ?? r.source}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={statusTone(r.status)}>
                      {REQUEST_STATUS_LABELS[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.aiScore == null ? (
                      <span className="text-fg-tertiary">–</span>
                    ) : (
                      <span className="font-mono tabular-nums">
                        {r.aiScore}
                      </span>
                    )}
                    {r.aiCategory && (
                      <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
                        {r.aiCategory}
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
                  <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                    {r.convertedRevenueEur == null
                      ? "–"
                      : formatEuro(r.convertedRevenueEur)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
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

function statusTone(s: string): "good" | "warn" | "bad" | "neutral" {
  if (s === "gewonnen") return "good";
  if (s === "verloren" || s === "spam") return "bad";
  if (s === "termin_vereinbart" || s === "beratung_erschienen") return "warn";
  return "neutral";
}
