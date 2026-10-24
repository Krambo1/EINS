import "server-only";
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import { DISPLAY_TIME_ZONE, formatEuro, formatMoney, formatNumber } from "@/lib/formatting";
import type { CurrencyCode } from "@/lib/formatting";
import type { KpiSummary } from "@/server/queries/kpis";
import type { ResponseCounts } from "@/lib/response-time";

/**
 * Monthly report PDF. One-page summary of the clinic's KPIs for a given
 * period. Intentionally minimal; glossy design ships when we have real data
 * to design around.
 *
 * Typography choice: system sans fonts, @react-pdf bundles Helvetica.
 */

export interface RenderMonthlyReportInput {
  clinicName: string;
  period: string; // YYYY-MM
  summary: KpiSummary;
  /** Praxis billing currency. Formats the attributed-revenue line (own PVS
   *  revenue, EUR or CHF); agency-side spend + cost-per-lead stay EUR. */
  currency: CurrencyCode;
  /** Folge 2 of the 48-Werkstunden rule. Counts only, no patient data. */
  responseCounts?: ResponseCounts;
}

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, color: "#10101a" },
  h1: { fontSize: 22, fontWeight: 600, marginBottom: 4 },
  h2: { fontSize: 14, fontWeight: 600, marginTop: 24, marginBottom: 8 },
  subtitle: { fontSize: 12, color: "#4a4a52", marginBottom: 24 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  metricLabel: { color: "#4a4a52" },
  metricValue: { fontWeight: 600 },
  note: { fontSize: 9, color: "#4a4a52", marginTop: 6 },
  accentBar: {
    width: 48,
    height: 3,
    backgroundColor: "#58BAB5",
    marginBottom: 16,
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 9,
    color: "#8a8a94",
    textAlign: "center",
  },
});

export async function renderMonthlyReportPdf(
  input: RenderMonthlyReportInput
): Promise<Buffer> {
  const { clinicName, period, summary, currency, responseCounts } = input;
  const [y, m] = period.split("-");
  const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(
    "de-DE",
    { month: "long", year: "numeric", timeZone: DISPLAY_TIME_ZONE }
  );

  const doc = (
    <Document
      title={`Monats-Auswertung ${period}`}
      author="EINS"
      creator="EINS Portal"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.accentBar} />
        <Text style={styles.h1}>Monats-Auswertung</Text>
        <Text style={styles.subtitle}>
          {clinicName}, {monthName}
        </Text>

        <Text style={styles.h2}>Leistung</Text>
        <Row label="Anfragen" value={formatNumber(summary.leads)} />
        <Row label="Termine vereinbart" value={formatNumber(summary.appointments)} />
        <Row label="Beratungen stattgefunden" value={formatNumber(summary.consultationsHeld)} />
        <Row label="Behandlungen gewonnen" value={formatNumber(summary.casesWon)} />

        <Text style={styles.h2}>Finanzen</Text>
        <Row label="Werbebudget" value={formatEuro(summary.spendEur)} />
        <Row
          label="Umsatz (zugeordnet)"
          value={formatMoney(summary.revenueEur, currency)}
        />
        <Row
          label="Werbeertrag"
          value={summary.roas !== null ? `${summary.roas.toFixed(2)} ×` : "k. A."}
        />
        <Row
          label="Kosten pro Anfrage"
          value={
            summary.costPerLead !== null
              ? formatEuro(summary.costPerLead)
              : "k. A."
          }
        />

        {responseCounts && (
          <>
            <Text style={styles.h2}>Antwortzeit der Praxis</Text>
            <Row label="Anfragen ohne Spam" value={formatNumber(responseCounts.total)} />
            <Row
              label="Rechtzeitig kontaktiert (48 Werkstunden)"
              value={formatNumber(responseCounts.rechtzeitig)}
            />
            <Row
              label="Von der Praxis zu spät beantwortet"
              value={formatNumber(responseCounts.zuSpaet)}
            />
            <Row
              label="Von der Praxis nicht beantwortet"
              value={formatNumber(responseCounts.nichtBeantwortet)}
            />
            {responseCounts.offen > 0 && (
              <Row label="Frist läuft noch" value={formatNumber(responseCounts.offen)} />
            )}
            <Text style={styles.note}>
              Diese Anfragen stehen getrennt von den Kennzahlen zur Leistung von EINS
              (Garantie-Anhang § 6 Abs. (5) lit. b).
            </Text>
            {responseCounts.vorRegel > 0 && (
              <Text style={styles.note}>
                {`Nicht mitgezählt: ${formatNumber(responseCounts.vorRegel)} Anfragen vor dem 06.10.2026 oder vor Ihrem Vertragsbeginn, für die noch keine Frist galt.`}
              </Text>
            )}
          </>
        )}

        <Text style={styles.footer}>
          EINS, erstellt am {new Date().toLocaleDateString("de-DE", { timeZone: DISPLAY_TIME_ZONE })}
        </Text>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}
