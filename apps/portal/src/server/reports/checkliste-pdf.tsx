// NB: intentionally NO `import "server-only"` here — same reasoning as
// leitfaden-pdf.tsx. This module is imported by the generate-checkliste-pdf
// CLI (run under tsx, where `server-only`'s index.js throws on import). It is
// never imported by a client component, so the guard would add risk without
// value.
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
  CHECKLIST_BLOCKS,
  ABSCHLUSS_HINWEIS,
  CHECKLISTE_INTRO,
  UPLOAD_PROFILES,
  type ChecklistItem,
  type DeliveryType,
} from "@/app/(portal)/onboarding/checkliste/content";

/**
 * Asset-Liefer-Checkliste as a downloadable, branded PDF.
 *
 * Same content for every Praxis, so it ships as a static asset under
 * public/anleitung/ and is pinned in the Dokumente tab next to the Portal-
 * Anleitung (no per-clinic DB row). The single source of truth is the same
 * `content.ts` the clinic page, the admin tab and the onboarding step read, so
 * the printable list never drifts from the interactive checklist.
 *
 * Built with @react-pdf/renderer (already used by monthly-pdf.tsx and
 * leitfaden-pdf.tsx). The built-in Helvetica covers German umlauts, §, € and
 * the typographic quotes via WinAnsi. The only non-WinAnsi glyph used in the
 * content is the "→" step arrow (in the access instructions); it is down-
 * converted to "›" before rendering.
 *
 * No running page footer: a `fixed` footer reproducibly makes @react-pdf emit a
 * non-finite translate offset on long documents (verified in leitfaden-pdf.tsx).
 * The document is branded via the cover and the accent section rules instead.
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
  coverLead: { fontSize: 12, color: COLORS.muted, lineHeight: 1.5, marginBottom: 24, maxWidth: 430 },
  coverMeta: { fontSize: 9, color: COLORS.faint },
  toc: { marginTop: 26 },
  tocItem: { flexDirection: "row", marginBottom: 5, fontSize: 10, color: COLORS.muted },
  tocNum: { width: 22, color: COLORS.accent, fontWeight: 700 },
  // Section
  section: { fontSize: 16, fontWeight: 700, marginTop: 22, marginBottom: 4 },
  sectionRule: { width: 40, height: 2.5, backgroundColor: COLORS.accent, marginBottom: 10 },
  intro: { fontSize: 9.5, color: COLORS.muted, marginBottom: 10, fontStyle: "italic" },
  // Legend
  legendCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    padding: 12,
    marginTop: 18,
  },
  legendTitle: { fontSize: 11.5, fontWeight: 700, marginBottom: 6 },
  legendRow: { flexDirection: "row", marginBottom: 4 },
  legendTerm: { width: 96, fontSize: 9.5, fontWeight: 700, color: COLORS.fg },
  legendText: { flex: 1, fontSize: 9.5, color: COLORS.muted },
  legendNote: { fontSize: 9.5, color: COLORS.fg, marginTop: 8, lineHeight: 1.5 },
  // Item cards
  card: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  cardBlocker: {
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: 6,
    padding: 10,
    marginBottom: 8,
  },
  itemTitle: { fontSize: 11, fontWeight: 700, marginBottom: 5 },
  itemId: { color: COLORS.accent },
  body: { fontSize: 10, color: COLORS.fg, marginBottom: 2 },
  bodySpacer: { height: 5 },
  warum: { fontSize: 9, color: COLORS.muted, marginTop: 5, fontStyle: "italic" },
  fieldsLine: { fontSize: 9, color: COLORS.muted, marginTop: 5 },
  fieldsLabel: { fontWeight: 700, color: COLORS.fg },
  formatLine: { fontSize: 9, color: COLORS.faint, marginTop: 4 },
  // Badges
  badgeWrap: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  badge: {
    fontSize: 8,
    color: COLORS.muted,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingVertical: 1.5,
    paddingHorizontal: 5,
    marginRight: 5,
    marginBottom: 4,
  },
  badgeWay: { color: COLORS.fg, borderColor: COLORS.accent },
  badgeBlocker: { color: COLORS.bad, borderColor: COLORS.bad },
  // Closing note
  closeCard: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    padding: 12,
    marginTop: 14,
  },
  closeIntro: { fontSize: 9.5, color: COLORS.muted, marginBottom: 6, fontStyle: "italic" },
  listRow: { flexDirection: "row", marginBottom: 2 },
  listMarker: { width: 14, color: COLORS.accent },
  listText: { flex: 1, fontSize: 9.5, color: COLORS.fg },
});

/** Map a delivery type to its human label (matches the portal controls). */
const DELIVERY_LABELS: Record<DeliveryType, string> = {
  einladung: "Einladung",
  upload: "Upload",
  link: "Link",
  upload_oder_link: "Upload oder Link",
  angabe: "Angabe",
  status: "Bestätigen",
};

/** WinAnsi (Helvetica) has no "→"; "›" is in CP1252 and reads as a step arrow. */
function winansi(s: string): string {
  return s.replace(/→/g, "›");
}

function SectionHeading({ letter, title, intro }: { letter: string; title: string; intro?: string }) {
  return (
    <View>
      <Text style={styles.section}>
        {letter}. {title}
      </Text>
      <View style={styles.sectionRule} />
      {intro ? <Text style={styles.intro}>{winansi(intro)}</Text> : null}
    </View>
  );
}

/** Render a multi-line instruction, preserving the numbered-step line breaks. */
function MultiLine({ text }: { text: string }) {
  const lines = winansi(text).split("\n");
  return (
    <View>
      {lines.map((line, i) =>
        line.trim() === "" ? (
          <View key={i} style={styles.bodySpacer} />
        ) : (
          <Text key={i} style={styles.body}>
            {line}
          </Text>
        )
      )}
    </View>
  );
}

function itemBadges(item: ChecklistItem): { label: string; tone: "way" | "blocker" | "default" }[] {
  const badges: { label: string; tone: "way" | "blocker" | "default" }[] = [
    { label: DELIVERY_LABELS[item.deliveryType], tone: "way" },
  ];
  if (item.required) badges.push({ label: "Pflicht", tone: "default" });
  else if (item.recommended) badges.push({ label: "Empfohlen", tone: "default" });
  else badges.push({ label: "Optional", tone: "default" });
  if (item.blocker) badges.push({ label: "Blocker", tone: "blocker" });
  return badges;
}

function ItemCard({ item }: { item: ChecklistItem }) {
  const profile = item.uploadProfile ? UPLOAD_PROFILES[item.uploadProfile] : null;
  const fieldLine =
    item.fields && item.fields.length > 0
      ? item.fields
          .map((f) => `${f.label}${f.optional ? " (optional)" : ""}`)
          .join(", ")
      : null;

  return (
    <View style={item.blocker ? styles.cardBlocker : styles.card} wrap={false}>
      <Text style={styles.itemTitle}>
        <Text style={styles.itemId}>{item.id} </Text>
        {item.title}
      </Text>
      <View style={styles.badgeWrap}>
        {itemBadges(item).map((b, i) => (
          <Text
            key={i}
            style={[
              styles.badge,
              ...(b.tone === "way" ? [styles.badgeWay] : []),
              ...(b.tone === "blocker" ? [styles.badgeBlocker] : []),
            ]}
          >
            {b.label}
          </Text>
        ))}
      </View>
      <MultiLine text={item.anleitung} />
      {profile ? (
        <Text style={styles.formatLine}>Dateiformat: {profile.hint}.</Text>
      ) : null}
      {fieldLine ? (
        <Text style={styles.fieldsLine}>
          <Text style={styles.fieldsLabel}>Im Portal anzugeben: </Text>
          {winansi(fieldLine)}.
        </Text>
      ) : null}
      {item.warum ? <Text style={styles.warum}>Warum: {winansi(item.warum)}</Text> : null}
    </View>
  );
}

export async function generateChecklistePdf(): Promise<Buffer> {
  const today = new Date().toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const doc = (
    <Document
      title="Asset-Liefer-Checkliste"
      author="EINS"
      creator="EINS Portal"
      subject="Onboarding-Checkliste: alle Zugänge, Dateien und Angaben für den Start"
    >
      <Page size="A4" style={styles.page}>
        {/* Cover */}
        <View style={styles.coverAccent} />
        <Text style={styles.brand}>EINS</Text>
        <Text style={styles.coverTitle}>Asset-Liefer-Checkliste.</Text>
        <Text style={styles.coverLead}>{CHECKLISTE_INTRO}</Text>
        <Text style={styles.coverMeta}>Stand: {today}</Text>

        {/* How delivery works — replaces the interactive controls in print. */}
        <View style={styles.legendCard}>
          <Text style={styles.legendTitle}>So funktioniert die Lieferung</Text>
          <View style={styles.legendRow}>
            <Text style={styles.legendTerm}>Einladung</Text>
            <Text style={styles.legendText}>
              Sie laden EINS per Partnerfreigabe ein und haken den Punkt ab. Keine Passwörter.
            </Text>
          </View>
          <View style={styles.legendRow}>
            <Text style={styles.legendTerm}>Upload</Text>
            <Text style={styles.legendText}>Datei direkt im Portal hochladen.</Text>
          </View>
          <View style={styles.legendRow}>
            <Text style={styles.legendTerm}>Link</Text>
            <Text style={styles.legendText}>
              Freigabe-Link (Google Drive, Dropbox, WeTransfer) eintragen.
            </Text>
          </View>
          <View style={styles.legendRow}>
            <Text style={styles.legendTerm}>Angabe</Text>
            <Text style={styles.legendText}>Die Angaben in die Textfelder im Portal eintragen.</Text>
          </View>
          <View style={styles.legendRow}>
            <Text style={styles.legendTerm}>Bestätigen</Text>
            <Text style={styles.legendText}>
              Den Punkt abhaken, sobald er erledigt ist (z. B. ein Termin steht fest).
            </Text>
          </View>
          <Text style={styles.legendNote}>
            Alles läuft über das Portal unter Erste Schritte, Schritt Checkliste, kein Versand per
            E-Mail. Zweistufig: Sie liefern, EINS prüft. Die Blocker-Punkte aus Block A zählen erst
            als erledigt, sobald wir sie geprüft haben. Bitte niemals Passwörter weitergeben, weder
            per E-Mail noch am Telefon, wir fragen auch nie danach.
          </Text>
        </View>

        {/* TOC */}
        <View style={styles.toc}>
          {CHECKLIST_BLOCKS.map((b) => (
            <View key={b.key} style={styles.tocItem}>
              <Text style={styles.tocNum}>{b.key}</Text>
              <Text>{b.title}</Text>
            </View>
          ))}
          <View style={styles.tocItem}>
            <Text style={styles.tocNum}>·</Text>
            <Text>{ABSCHLUSS_HINWEIS.title}</Text>
          </View>
        </View>

        {/* Blocks A–F */}
        {CHECKLIST_BLOCKS.map((block) => (
          <View key={block.key}>
            <SectionHeading letter={block.key} title={block.title} intro={block.intro} />
            {block.items.map((item) => (
              <ItemCard key={item.id} item={item} />
            ))}
          </View>
        ))}

        {/* Closing note (Block G — laufende Mitwirkung, information only) */}
        <View style={styles.closeCard} wrap={false}>
          <Text style={styles.legendTitle}>{ABSCHLUSS_HINWEIS.title}</Text>
          <Text style={styles.closeIntro}>{ABSCHLUSS_HINWEIS.intro}</Text>
          {ABSCHLUSS_HINWEIS.points.map((p, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={styles.listMarker}>•</Text>
              <Text style={styles.listText}>{p}</Text>
            </View>
          ))}
        </View>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
