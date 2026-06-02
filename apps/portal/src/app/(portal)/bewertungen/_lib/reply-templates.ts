/**
 * Static, kuratierte Antwortvorlagen für öffentliche Bewertungen und
 * Patientenfeedback. Alle Texte sind HWG-konform (keine Heilversprechen,
 * keine Garantien, keine Behandlungszusagen), formelles Sie.
 *
 * Platzhalter [Praxisname] und [Vorname] bleiben editierbar: die Inhaberin
 * oder der Inhaber ersetzt sie vor dem Versenden.
 *
 * Bewusst als reine Datenquelle gehalten. Eine künftige KI-generierte
 * Quelle kann denselben Typ liefern und sich über `templatesByBucket`
 * einklinken, ohne dass die Aufrufer angepasst werden müssen.
 */

/** Bewertungs-Bucket, abgeleitet aus der Sternebewertung. */
export type ReplyBucket = "positiv" | "neutral" | "kritisch";

export interface ReplyTemplate {
  id: string;
  bucket: ReplyBucket;
  /** Kurzer Titel für die Auswahl-Liste. */
  title: string;
  /** Der einfügbare Antworttext. Enthält editierbare Platzhalter. */
  text: string;
}

export const REPLY_BUCKET_LABELS: Record<ReplyBucket, string> = {
  positiv: "Positiv (4-5 Sterne)",
  neutral: "Neutral (3 Sterne)",
  kritisch: "Kritisch (1-2 Sterne)",
};

/** Reihenfolge der Buckets für die Darstellung. */
export const REPLY_BUCKET_ORDER: ReplyBucket[] = [
  "positiv",
  "neutral",
  "kritisch",
];

/**
 * Ordnet eine Sternebewertung (1-5) einem Bucket zu. Fehlt die Bewertung,
 * nutzen wir "neutral" als sichere, neutrale Voreinstellung.
 */
export function bucketForRating(rating: number | null | undefined): ReplyBucket {
  if (rating == null) return "neutral";
  if (rating >= 4) return "positiv";
  if (rating <= 2) return "kritisch";
  return "neutral";
}

const TEMPLATES: ReplyTemplate[] = [
  // --- Positiv (4-5 Sterne) ---
  {
    id: "positiv-danke-kurz",
    bucket: "positiv",
    title: "Kurzer Dank",
    text:
      "Liebe/r [Vorname], vielen Dank für Ihre freundliche Bewertung. Wir " +
      "haben uns sehr darüber gefreut und geben Ihre Worte gerne an das " +
      "gesamte Team weiter. Auf ein Wiedersehen in der Praxis [Praxisname].",
  },
  {
    id: "positiv-team-weitergabe",
    bucket: "positiv",
    title: "Dank mit Team-Bezug",
    text:
      "Vielen Dank, [Vorname], dass Sie sich die Zeit für Ihre Rückmeldung " +
      "genommen haben. Es freut uns sehr zu lesen, dass Sie sich bei uns gut " +
      "aufgehoben gefühlt haben. Wir freuen uns, Sie auch künftig in der " +
      "Praxis [Praxisname] begrüßen zu dürfen.",
  },
  {
    id: "positiv-weiterempfehlung",
    bucket: "positiv",
    title: "Dank für Weiterempfehlung",
    text:
      "Herzlichen Dank für Ihr Vertrauen, [Vorname]. Eine so positive " +
      "Rückmeldung ist für unser Team die schönste Anerkennung. Bei Fragen " +
      "sind wir jederzeit gerne für Sie da. Ihr Team der Praxis [Praxisname].",
  },

  // --- Neutral (3 Sterne) ---
  {
    id: "neutral-feedback-aufnehmen",
    bucket: "neutral",
    title: "Rückmeldung aufnehmen",
    text:
      "Vielen Dank für Ihre offene Rückmeldung, [Vorname]. Wir nehmen Ihre " +
      "Anmerkungen ernst und schauen uns die genannten Punkte gerne genauer " +
      "an. Wenn Sie möchten, können Sie sich direkt an die Praxis " +
      "[Praxisname] wenden, damit wir Ihr Anliegen in Ruhe besprechen.",
  },
  {
    id: "neutral-gespraech-anbieten",
    bucket: "neutral",
    title: "Gespräch anbieten",
    text:
      "Danke, dass Sie sich die Zeit für eine Bewertung genommen haben, " +
      "[Vorname]. Uns ist wichtig, dass Sie sich gut betreut fühlen. Gerne " +
      "möchten wir verstehen, was wir besser machen können. Melden Sie sich " +
      "bei Gelegenheit gerne bei der Praxis [Praxisname].",
  },

  // --- Kritisch (1-2 Sterne) ---
  {
    id: "kritisch-sachlich-klaeren",
    bucket: "kritisch",
    title: "Sachlich um Klärung bitten",
    text:
      "Vielen Dank für Ihre Rückmeldung, [Vorname]. Es tut uns leid, dass " +
      "Ihr Eindruck nicht Ihren Erwartungen entsprochen hat. Wir nehmen " +
      "Kritik ernst und möchten Ihr Anliegen gerne klären. Bitte wenden Sie " +
      "sich direkt an die Praxis [Praxisname], damit wir gemeinsam eine " +
      "Lösung finden können.",
  },
  {
    id: "kritisch-entschuldigung-kontakt",
    bucket: "kritisch",
    title: "Bedauern und Kontakt anbieten",
    text:
      "Liebe/r [Vorname], es tut uns aufrichtig leid, dass Sie unzufrieden " +
      "waren. Aus Gründen der ärztlichen Schweigepflicht können wir hier " +
      "nicht auf Details eingehen. Wir bitten Sie daher, sich direkt an die " +
      "Praxis [Praxisname] zu wenden, damit wir uns Ihrem Anliegen " +
      "persönlich annehmen können.",
  },
  {
    id: "kritisch-datenschutz-hinweis",
    bucket: "kritisch",
    title: "Hinweis Schweigepflicht",
    text:
      "Danke, dass Sie uns Ihre Sicht geschildert haben, [Vorname]. Eine " +
      "öffentliche Antwort auf einzelne Behandlungsfragen ist uns wegen der " +
      "Schweigepflicht nicht möglich. Wir würden Ihr Anliegen aber sehr " +
      "gerne mit Ihnen besprechen: Bitte kontaktieren Sie die Praxis " +
      "[Praxisname] zu einem für Sie passenden Zeitpunkt.",
  },
];

/** Alle Vorlagen eines Buckets. Stabile Reihenfolge. */
export function templatesByBucket(bucket: ReplyBucket): ReplyTemplate[] {
  return TEMPLATES.filter((t) => t.bucket === bucket);
}

/** Alle Vorlagen, gruppiert nach Bucket in Anzeige-Reihenfolge. */
export function allReplyTemplates(): ReplyTemplate[] {
  return TEMPLATES;
}
