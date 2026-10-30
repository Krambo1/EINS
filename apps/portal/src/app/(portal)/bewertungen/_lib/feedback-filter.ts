import type { PatientFeedbackStatus } from "@/lib/constants";

/**
 * The filters of the Rückmeldungen list, read from the address the same way
 * in the browser (instant filtering below the row cap), on the server (at
 * the cap) and on a Rückmeldung (its arrows go through the same list).
 *
 * Views (`?status=`): "Offen" first and the default, as in every review and
 * support inbox (Uberall, Linear, Birdeye's "Haven't replied"), then each
 * status, then "Alle". Stars (`?sterne=`): the bands of the reply
 * templates (Nicereply's score filter). Search (`?suche=`): name, e-mail
 * or text (Retently).
 */

export const FEEDBACK_VIEWS = ["offen", "neu", "gesehen", "beantwortet", "geschlossen", "alle"] as const;
export type FeedbackView = (typeof FEEDBACK_VIEWS)[number];

export const FEEDBACK_VIEW_LABELS: Record<FeedbackView, string> = {
  offen: "Offen",
  neu: "Neu",
  gesehen: "Gesehen",
  beantwortet: "Beantwortet",
  geschlossen: "Geschlossen",
  alle: "Alle",
};

/** The list opens on the Rückmeldungen still waiting for the team. */
export const DEFAULT_FEEDBACK_VIEW: FeedbackView = "offen";

export const STAR_BANDS = ["4-5", "3", "1-2"] as const;
export type StarBand = (typeof STAR_BANDS)[number];

export const STAR_BAND_LABELS: Record<StarBand, string> = {
  "4-5": "4-5 Sterne",
  "3": "3 Sterne",
  "1-2": "1-2 Sterne",
};

const BAND_RANGE: Record<StarBand, [number, number]> = { "4-5": [4, 5], "3": [3, 3], "1-2": [1, 2] };

export interface FeedbackFilter {
  view: FeedbackView;
  band: StarBand | null;
  search: string;
}

/** The statuses a view shows; null for all of them. */
export function viewStatuses(view: FeedbackView): PatientFeedbackStatus[] | null {
  if (view === "alle") return null;
  if (view === "offen") return ["neu", "gesehen"];
  return [view];
}

/** The filter in the address; `defaultView` when it names none. */
export function parseFeedbackFilter(
  get: (key: string) => string | null | undefined,
  defaultView: FeedbackView = DEFAULT_FEEDBACK_VIEW
): FeedbackFilter {
  const view = FEEDBACK_VIEWS.find((v) => v === get("status")) ?? defaultView;
  const band = STAR_BANDS.find((b) => b === get("sterne")) ?? null;
  return { view, band, search: (get("suche") ?? "").trim() };
}

/** The address part of a filter (`?status=…&sterne=…`); the view always. */
export function feedbackFilterQuery(f: FeedbackFilter): string {
  const q = new URLSearchParams({ status: f.view });
  if (f.band) q.set("sterne", f.band);
  if (f.search) q.set("suche", f.search);
  return `?${q.toString()}`;
}

export interface FilterableFeedback {
  status: PatientFeedbackStatus;
  rating: number;
  contactName: string | null;
  contactEmail: string | null;
  freeText: string | null;
}

/** Stars and search only: what the counts on the view chips follow. */
export function matchesBandAndSearch(row: FilterableFeedback, f: FeedbackFilter): boolean {
  if (f.band) {
    const [lo, hi] = BAND_RANGE[f.band];
    if (row.rating < lo || row.rating > hi) return false;
  }
  if (f.search) {
    const q = f.search.toLocaleLowerCase("de");
    const hay = [row.contactName, row.contactEmail, row.freeText].filter(Boolean).join("\n").toLocaleLowerCase("de");
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function matchesFeedback(row: FilterableFeedback, f: FeedbackFilter): boolean {
  const statuses = viewStatuses(f.view);
  if (statuses && !statuses.includes(row.status)) return false;
  return matchesBandAndSearch(row, f);
}

/** Count per view from counts per status. */
export function viewCounts(byStatus: Record<PatientFeedbackStatus, number>): Record<FeedbackView, number> {
  return {
    offen: byStatus.neu + byStatus.gesehen,
    neu: byStatus.neu,
    gesehen: byStatus.gesehen,
    beantwortet: byStatus.beantwortet,
    geschlossen: byStatus.geschlossen,
    alle: byStatus.neu + byStatus.gesehen + byStatus.beantwortet + byStatus.geschlossen,
  };
}

/** The same filter for the server query (`listPatientFeedback`). */
export function feedbackQueryFilter(f: FeedbackFilter) {
  const range = f.band ? BAND_RANGE[f.band] : null;
  return {
    statuses: viewStatuses(f.view) ?? undefined,
    ratingMin: range?.[0],
    ratingMax: range?.[1],
    search: f.search || undefined,
  };
}
