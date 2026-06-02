// NB: intentionally NO `import "server-only"` here. Unlike monthly-pdf.tsx,
// this module is imported by Node entrypoints (the db seed + the
// generate-leitfaden-pdf CLI) that run under tsx, where `server-only`'s
// index.js throws on import. It is never imported by a client component (the
// page reads content.ts directly), so the guard would add risk without value.
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  PRINCIPLES,
  KPIS,
  PREP_STEPS,
  OPENING_SCRIPTS,
  DISCOVERY_INTRO,
  DISCOVERY_BLOCKS,
  OBJECTION_GROUPS,
  OBJECTIONS,
  HWG_TABLES,
  CLOSE_STEPS,
  NO_SHOW_INTRO,
  NO_SHOW_CADENCE,
  NO_SHOW_TEMPLATES,
  NO_SHOW_DONTS,
  VERMEIDEN_DONTS,
  RECHTSGRUNDLAGEN,
  RECHTSGRUNDLAGEN_NOTE,
  CHEAT_SHEET,
  type DontWarning,
} from "@/app/(portal)/leitfaden/content";

/**
 * Full Vertriebsleitfaden as a downloadable, branded PDF.
 *
 * This is the COMPLETE playbook — every objection, every HWG table, every
 * No-Show template, plus the warnings, the cheat-sheet and the legal index.
 * The staff-facing page (`leitfaden/page.tsx`) shows only the `core` subset;
 * both read from the same `content.ts`, so the page and the PDF never drift.
 *
 * Built with @react-pdf/renderer (already used by `monthly-pdf.tsx`). The
 * built-in Helvetica covers German umlauts, §, € and the typographic quotes
 * via WinAnsi. The reception cheat-sheet uses box-drawing rules (U+2500) that
 * WinAnsi lacks, so those are down-converted to hyphens before rendering.
 *
 * No running page footer: a `fixed` page-number footer reproducibly makes
 * @react-pdf 4.5.1 emit a non-finite translate offset ("unsupported number")
 * on a document of this length and node mix, regardless of the footer's exact
 * shape (verified by bisection). The document is branded via the cover and the
 * accent section rules instead.
 */

const COLORS = {
  fg: "#10101a",
  muted: "#4a4a52",
  faint: "#8a8a94",
  accent: "#58BAB5",
  bad: "#b3261e",
  surface: "#f4f6f6",
  border: "#e1e4e4",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 54,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontSize: 10,
    lineHeight: 1.45,
    color: COLORS.fg,
  },
  // Cover
  coverAccent: { width: 64, height: 4, backgroundColor: COLORS.accent, marginBottom: 20 },
  brand: { fontSize: 11, fontWeight: 700, letterSpacing: 1, color: COLORS.accent, marginBottom: 8 },
  coverTitle: { fontSize: 30, fontWeight: 700, marginBottom: 12 },
  coverLead: { fontSize: 12, color: COLORS.muted, lineHeight: 1.5, marginBottom: 24, maxWidth: 420 },
  coverMeta: { fontSize: 9, color: COLORS.faint },
  toc: { marginTop: 28 },
  tocItem: { flexDirection: "row", marginBottom: 5, fontSize: 10, color: COLORS.muted },
  tocNum: { width: 22, color: COLORS.accent, fontWeight: 700 },
  // Section
  section: { fontSize: 16, fontWeight: 700, marginTop: 22, marginBottom: 4 },
  sectionRule: { width: 40, height: 2.5, backgroundColor: COLORS.accent, marginBottom: 10 },
  intro: { fontSize: 9.5, color: COLORS.muted, marginBottom: 10, fontStyle: "italic" },
  groupTitle: { fontSize: 11.5, fontWeight: 700, marginTop: 14, marginBottom: 6, color: COLORS.fg },
  // Cards / items
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  itemTitle: { fontSize: 11, fontWeight: 700, marginBottom: 4 },
  body: { fontSize: 10, color: COLORS.fg, marginBottom: 3 },
  patientLine: { fontSize: 10, fontWeight: 700, marginBottom: 4 },
  label: { fontSize: 8, fontWeight: 700, color: COLORS.faint, marginTop: 6, marginBottom: 2, textTransform: "uppercase", letterSpacing: 0.5 },
  note: { fontSize: 9, color: COLORS.muted, marginTop: 4, fontStyle: "italic" },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accent,
    backgroundColor: COLORS.surface,
    paddingVertical: 6,
    paddingHorizontal: 9,
    marginVertical: 3,
    fontStyle: "italic",
    fontSize: 10,
  },
  listRow: { flexDirection: "row", marginBottom: 2 },
  listMarker: { width: 16, color: COLORS.muted },
  listText: { flex: 1, fontSize: 10 },
  avoidRow: { flexDirection: "row", marginBottom: 1.5 },
  avoidMarker: { width: 10, color: COLORS.bad },
  avoidText: { flex: 1, fontSize: 9, color: COLORS.bad },
  // KPI strip
  kpiStrip: { flexDirection: "row", marginBottom: 4 },
  kpiCard: { flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, padding: 8, marginRight: 8 },
  kpiLabel: { fontSize: 8, color: COLORS.faint, textTransform: "uppercase", letterSpacing: 0.5 },
  kpiValue: { fontSize: 16, fontWeight: 700, marginTop: 2 },
  kpiHint: { fontSize: 8, color: COLORS.faint, marginTop: 1 },
  // Tables
  table: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, marginBottom: 8 },
  tHeadRow: { flexDirection: "row", backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.border },
  tRowLast: { flexDirection: "row" },
  th: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, padding: 6 },
  td: { fontSize: 9, padding: 6 },
  thBad: { color: COLORS.bad },
  thGood: { color: COLORS.accent },
  // Principle row
  principleRow: { flexDirection: "row", marginBottom: 7 },
  principleDot: { width: 18, fontSize: 11, fontWeight: 700, color: COLORS.accent },
  // Mono / cheat sheet
  mono: {
    fontFamily: "Courier",
    fontSize: 8,
    lineHeight: 1.35,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    padding: 10,
  },
  // Badges
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  badge: {
    fontSize: 8.5,
    color: COLORS.muted,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 5,
    marginRight: 5,
    marginBottom: 5,
  },
});

function SectionHeading({ n, title, intro }: { n: number; title: string; intro?: string }) {
  return (
    <View>
      <Text style={styles.section}>
        {n}. {title}
      </Text>
      <View style={styles.sectionRule} />
      {intro ? <Text style={styles.intro}>{intro}</Text> : null}
    </View>
  );
}

function Quote({ children }: { children: string }) {
  return (
    <Text style={styles.quote}>
      „{children}“
    </Text>
  );
}

function NumberedList({ items, start = 1 }: { items: string[]; start?: number }) {
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={styles.listRow}>
          <Text style={styles.listMarker}>{start + i}.</Text>
          <Text style={styles.listText}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={styles.listRow}>
          <Text style={styles.listMarker}>•</Text>
          <Text style={styles.listText}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

function AvoidList({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((it, i) => (
        <View key={i} style={styles.avoidRow}>
          <Text style={styles.avoidMarker}>×</Text>
          <Text style={styles.avoidText}>{it}</Text>
        </View>
      ))}
    </View>
  );
}

function DontCard({ d }: { d: DontWarning }) {
  return (
    <View style={styles.card} wrap={false}>
      <Text style={styles.itemTitle}>{d.title}</Text>
      <Text style={styles.body}>{d.body}</Text>
    </View>
  );
}

export async function generateLeitfadenPdf(): Promise<Buffer> {
  const today = new Date().toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // WinAnsi (Helvetica/Courier) has no box-drawing glyph; down-convert rules.
  const cheatSheet = CHEAT_SHEET.replace(/─+/g, (m) => "-".repeat(m.length));

  const doc = (
    <Document
      title="Vertriebsleitfaden"
      author="EINS"
      creator="EINS Portal"
      subject="HWG-konformer Vertriebsleitfaden für Praxen für ästhetische Medizin"
    >
      <Page size="A4" style={styles.page}>
        {/* Cover */}
        <View style={styles.coverAccent} />
        <Text style={styles.brand}>EINS</Text>
        <Text style={styles.coverTitle}>Vertriebsleitfaden.</Text>
        <Text style={styles.coverLead}>
          So verwandeln Sie eine Anfrage in einen Beratungstermin, ohne gegen
          HWG, MBO-Ä oder DSGVO zu verstoßen. Bewährte Abläufe für eingehende
          Anrufe aus Meta- und Google-Anzeigen. Vollständige Fassung.
        </Text>
        <Text style={styles.coverMeta}>Stand: {today}</Text>

        <View style={styles.toc}>
          {[
            "Sechs goldene Prinzipien",
            "KPI-Ziele für jeden Anruf",
            "Vor jedem Anruf in 30 Sekunden",
            "Gesprächs-Eröffnung, wortwörtlich",
            "Discovery: 14 Fragen in vier Blöcken",
            "Einwandbehandlung: 23 Patienten-Einwände",
            "HWG-Quick-Reference: Sag-So, Sag-So-Nicht",
            "Termin-Close und DSGVO-Datenaufnahme",
            "No-Show-Prävention: Cadence und Vorlagen",
            "Was Sie unbedingt vermeiden",
            "Cheat-Sheet zum Ausdrucken",
            "Rechtsgrundlagen, kompakt",
          ].map((t, i) => (
            <View key={i} style={styles.tocItem}>
              <Text style={styles.tocNum}>{i + 1}</Text>
              <Text>{t}</Text>
            </View>
          ))}
        </View>

        {/* 1. Prinzipien */}
        <SectionHeading n={1} title="Sechs goldene Prinzipien" />
        {PRINCIPLES.map((p, i) => (
          <View key={p.id} style={styles.principleRow} wrap={false}>
            <Text style={styles.principleDot}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemTitle}>{p.title}</Text>
              <Text style={styles.body}>{p.body}</Text>
            </View>
          </View>
        ))}

        {/* 2. KPI */}
        <SectionHeading n={2} title="KPI-Ziele für jeden Anruf" />
        <View style={styles.kpiStrip}>
          {KPIS.map((k) => (
            <View key={k.id} style={styles.kpiCard}>
              <Text style={styles.kpiLabel}>{k.label}</Text>
              <Text style={styles.kpiValue}>{k.value}</Text>
              <Text style={styles.kpiHint}>{k.hint}</Text>
            </View>
          ))}
        </View>

        {/* 3. Prep */}
        <SectionHeading n={3} title="Vor jedem Anruf in 30 Sekunden" />
        <NumberedList items={PREP_STEPS.map((s) => s.text)} />

        {/* 4. Eröffnung */}
        <SectionHeading n={4} title="Gesprächs-Eröffnung, wortwörtlich" />
        {OPENING_SCRIPTS.map((s) => (
          <View key={s.id} style={styles.card} wrap={false}>
            <Text style={styles.itemTitle}>{s.title}</Text>
            {s.patientLine ? <Text style={styles.patientLine}>{s.patientLine}</Text> : null}
            <Quote>{s.quote}</Quote>
            <Text style={styles.note}>{s.note}</Text>
          </View>
        ))}

        {/* 5. Discovery */}
        <SectionHeading n={5} title="Discovery: 14 Fragen in vier Blöcken" intro={DISCOVERY_INTRO} />
        {DISCOVERY_BLOCKS.map((b) => (
          <View key={b.id} style={styles.card} wrap={false}>
            <Text style={styles.itemTitle}>{b.title}</Text>
            {b.list === "ol" ? (
              <NumberedList items={b.items} start={b.start ?? 1} />
            ) : (
              <BulletList items={b.items} />
            )}
            {b.note ? <Text style={styles.note}>{b.note}</Text> : null}
          </View>
        ))}

        {/* 6. Einwandbehandlung */}
        <SectionHeading
          n={6}
          title="Einwandbehandlung: 23 Patienten-Einwände"
          intro="Pro Eintrag: eigentliche Sorge, HWG-konforme Antwort wortwörtlich, was zu vermeiden ist."
        />
        {OBJECTION_GROUPS.map((g) => {
          const items = OBJECTIONS.filter((o) => o.group === g.id);
          if (items.length === 0) return null;
          return (
            <View key={g.id}>
              <Text style={styles.groupTitle}>{g.label}</Text>
              {items.map((o) => (
                <View key={o.id} style={styles.card}>
                  <Text style={styles.itemTitle}>{o.title}</Text>
                  <Text style={styles.label}>Eigentliche Sorge</Text>
                  <Text style={styles.body}>{o.concern}</Text>
                  <Text style={styles.label}>HWG-konforme Antwort, Sie-Form</Text>
                  <Quote>{o.answer}</Quote>
                  <Text style={styles.label}>Was vermeiden</Text>
                  <AvoidList items={o.avoid} />
                </View>
              ))}
            </View>
          );
        })}

        {/* 7. HWG tables */}
        <SectionHeading
          n={7}
          title="HWG-Quick-Reference: Sag-So, Sag-So-Nicht"
          intro="Sieben Tabellen mit konkreten Formulierungen. Jede Sag-So-Nicht-Zeile ist ein konkretes HWG-, MBO-Ä- oder UWG-Risiko."
        />
        {HWG_TABLES.map((t) => (
          <View key={t.id} wrap={false}>
            <Text style={styles.groupTitle}>{t.title}</Text>
            <View style={styles.table}>
              <View style={styles.tHeadRow}>
                <Text style={[styles.th, styles.thBad, { width: "50%" }]}>Sag-So-Nicht</Text>
                <Text style={[styles.th, styles.thGood, { width: "50%" }]}>Sag-So</Text>
              </View>
              {t.rows.map((row, i) => (
                <View key={i} style={i === t.rows.length - 1 ? styles.tRowLast : styles.tRow}>
                  <Text style={[styles.td, { width: "50%" }]}>{row[0]}</Text>
                  <Text style={[styles.td, { width: "50%" }]}>{row[1]}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* 8. Close + DSGVO */}
        <SectionHeading n={8} title="Termin-Close und DSGVO-Datenaufnahme" />
        {CLOSE_STEPS.map((s) => (
          <View key={s.id} style={styles.card} wrap={false}>
            <Text style={styles.itemTitle}>{s.title}</Text>
            {s.quote ? <Quote>{s.quote}</Quote> : null}
            {s.list ? <NumberedList items={s.list} /> : null}
            {s.note ? <Text style={styles.note}>{s.note}</Text> : null}
          </View>
        ))}

        {/* 9. No-Show */}
        <SectionHeading n={9} title="No-Show-Prävention: Cadence und Vorlagen" intro={NO_SHOW_INTRO} />
        <View style={styles.table} wrap={false}>
          <View style={styles.tHeadRow}>
            <Text style={[styles.th, { width: "25%" }]}>Zeitpunkt</Text>
            <Text style={[styles.th, { width: "30%" }]}>Kanal</Text>
            <Text style={[styles.th, { width: "45%" }]}>Zweck</Text>
          </View>
          {NO_SHOW_CADENCE.map((r, i) => (
            <View key={i} style={i === NO_SHOW_CADENCE.length - 1 ? styles.tRowLast : styles.tRow}>
              <Text style={[styles.td, { width: "25%", fontWeight: 700 }]}>{r.time}</Text>
              <Text style={[styles.td, { width: "30%" }]}>{r.channel}</Text>
              <Text style={[styles.td, { width: "45%" }]}>{r.purpose}</Text>
            </View>
          ))}
        </View>
        {NO_SHOW_TEMPLATES.map((t) => (
          <View key={t.id} style={styles.card}>
            <Text style={styles.itemTitle}>{t.title}</Text>
            <Text style={styles.mono}>{t.text}</Text>
          </View>
        ))}
        {NO_SHOW_DONTS.map((d) => (
          <DontCard key={d.id} d={d} />
        ))}

        {/* 10. Vermeiden */}
        <SectionHeading n={10} title="Was Sie unbedingt vermeiden" />
        {VERMEIDEN_DONTS.map((d) => (
          <DontCard key={d.id} d={d} />
        ))}

        {/* 11. Cheat-Sheet */}
        <View break>
          <SectionHeading n={11} title="Cheat-Sheet zum Ausdrucken" />
          <Text style={styles.mono}>{cheatSheet}</Text>
        </View>

        {/* 12. Rechtsgrundlagen */}
        <SectionHeading n={12} title="Rechtsgrundlagen, kompakt" />
        <View style={styles.badgeWrap}>
          {RECHTSGRUNDLAGEN.map((r, i) => (
            <Text key={i} style={styles.badge}>
              {r}
            </Text>
          ))}
        </View>
        <Text style={styles.note}>{RECHTSGRUNDLAGEN_NOTE}</Text>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
