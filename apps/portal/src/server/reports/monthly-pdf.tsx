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
import type { KpiSummary } from "@/server/queries/kpis";

/**
 * Monthly report PDF. One-page summary of the clinic's KPIs for a given
 * period. Intentionally minimal — glossy design ships when we have real data
 * to design around.
 *
 * Typography choice: system sans fonts — @react-pdf bundles Helvetica.
 */

export interface RenderMonthlyReportInput {
  clinicName: string;
  period: string; // YYYY-MM
  summary: KpiSummary;
}

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, color: "#10101a" },
  h1: { fontSize: 22, fontWeight: 600, marginBottom: 4 },
  h2: { fontSize: 14, fontWeight: 600, marginTop: 24, marginBottom: 8 },
  subtitle: { fontSize: 12, color: "#4a4a52", marginBottom: 24 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  metricLabel: { color: "#4a4a52" },
  metricValue: { fontWeight: 600 },
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

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const int = new Intl.NumberFormat("de-DE");

export async function renderMonthlyReportPdf(
  input: RenderMonthlyReportInput
): Promise<Buffer> {
  const { clinicName, period, summary } = input;
  const [y, m] = period.split("-");
  const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(
    "de-DE",
    { month: "long", year: "numeric" }
  );

  const doc = (
    <Document
      title={`Monats-Auswertung ${period}`}
      author="EINS Visuals"
      creator="EINS Visuals Portal"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.accentBar} />
        <Text style={styles.h1}>Monats-Auswertung</Text>
        <Text style={styles.subtitle}>
          {clinicName} — {monthName}
        </Text>

        <Text style={styles.h2}>Leistung</Text>
        <Row label="Qualifizierte Anfragen" value={int.format(summary.qualifiedLeads)} />
        <Row label="Termine vereinbart" value={int.format(summary.appointments)} />
        <Row label="Beratungen stattgefunden" value={int.format(summary.consultationsHeld)} />
        <Row label="Behandlungen gewonnen" value={int.format(summary.casesWon)} />

        <Text style={styles.h2}>Finanzen</Text>
        <Row label="Werbebudget" value={euro.format(summary.spendEur)} />
        <Row label="Umsatz (zugeordnet)" value={euro.format(summary.revenueEur)} />
        <Row
          label="Werbeertrag"
          value={summary.roas !== null ? `${summary.roas.toFixed(2)} ×` : "—"}
        />
        <Row
          label="Kosten pro qualifizierte Anfrage"
          value={
            summary.costPerQualifiedLead !== null
              ? euro.format(summary.costPerQualifiedLead)
              : "—"
          }
        />

        <Text style={styles.footer}>
          EINS Visuals — erstellt am {new Date().toLocaleDateString("de-DE")}
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
