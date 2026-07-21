import type { Treatment } from "@/lib/types";

/**
 * Quiz v2 state machine.
 *
 * Steps are a derived array, not hard-coded numbers:
 *   Injectables:  treatment → timeframe → contact                    (3 steps)
 *   OP-level:     treatment → timeframe → budget → distance → contact (4–5 steps)
 *   Info-branch:  treatment → timeframe → contact (email-only copy)
 *
 * The branch is DERIVED from answers (timeframe "info-only" or budget
 * "erst-informieren"), never stored — going back and changing an answer can
 * therefore never leave a stale branch behind.
 */

export type Branch = "qualified" | "info-only";

export type StepId = "treatment" | "timeframe" | "budget" | "distance" | "contact";

export interface QuizState {
  /** Index into the derived steps array. */
  stepIndex: number;
  treatment: string | null;
  timeframe: string | null;
  budget: string | null;
  distance: string | null;
  firstName: string;
  email: string;
  phone: string;
  /**
   * Single combined consent: Datenschutz zur Kenntnis + ≥18 self-declared.
   * Maps to BOTH `consents.privacy` and `consents.ageGate` in the payload
   * (wire format unchanged). Marketing opt-in lives on the confirmation
   * screen; aiProcessing is always false (notes field removed in v2).
   */
  consent: boolean;
  errors: Partial<Record<string, string>>;
  submitting: boolean;
  submitted: boolean;
  /** Stable id we'll send with both the browser pixel and the server CAPI relay. */
  eventId: string;
}

export type QuizAction =
  | { type: "set"; field: "treatment" | "timeframe" | "budget" | "distance" | "firstName" | "email" | "phone"; value: string }
  | { type: "setConsent"; value: boolean }
  | { type: "next" }
  | { type: "back" }
  | { type: "goto"; index: number }
  | { type: "submitting"; value: boolean }
  | { type: "submitted" }
  | { type: "errors"; value: Partial<Record<string, string>> };

export function buildInitialState(eventId: string): QuizState {
  return {
    stepIndex: 0,
    treatment: null,
    timeframe: null,
    budget: null,
    distance: null,
    firstName: "",
    email: "",
    phone: "",
    consent: false,
    errors: {},
    submitting: false,
    submitted: false,
    eventId,
  };
}

/** Branch derived from answers — see module docblock. */
export function deriveBranch(state: QuizState): Branch {
  if (state.timeframe === "info-only") return "info-only";
  if (state.budget === "erst-informieren") return "info-only";
  return "qualified";
}

/**
 * The active steps for this treatment + current answers.
 *
 * A step that CAUSED the info branch stays in the path (budget), so going
 * back from the contact step always lands on the question the patient last
 * answered — changing that answer re-expands the qualified path.
 */
export function stepsFor(treatment: Treatment, state: QuizState): StepId[] {
  const steps: StepId[] = ["treatment", "timeframe"];
  if (state.timeframe === "info-only") {
    steps.push("contact");
    return steps;
  }
  if (treatment.quiz.askBudget) {
    steps.push("budget");
    if (state.budget === "erst-informieren") {
      steps.push("contact");
      return steps;
    }
  }
  if (treatment.quiz.askDistance) steps.push("distance");
  steps.push("contact");
  return steps;
}

export function reducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case "set":
      return {
        ...state,
        [action.field]: action.value,
        errors: { ...state.errors, [action.field]: undefined },
      };
    case "setConsent":
      return { ...state, consent: action.value, errors: { ...state.errors, consent: undefined } };
    case "next":
      return { ...state, stepIndex: state.stepIndex + 1, errors: {} };
    case "back":
      return { ...state, stepIndex: Math.max(state.stepIndex - 1, 0), errors: {} };
    case "goto":
      return { ...state, stepIndex: Math.max(action.index, 0), errors: {} };
    case "submitting":
      return { ...state, submitting: action.value };
    case "submitted":
      return { ...state, submitted: true, submitting: false };
    case "errors":
      return { ...state, errors: action.value };
    default:
      return state;
  }
}

export const TIMEFRAMES = [
  { id: "asap", label: "So bald wie möglich", hint: "Termine in den nächsten 1–2 Wochen" },
  { id: "this-month", label: "Diesen Monat", hint: "Innerhalb der nächsten 4 Wochen" },
  { id: "next-3-months", label: "In den nächsten 3 Monaten" },
  { id: "later", label: "Später", hint: "Ich plane voraus" },
  { id: "info-only", label: "Ich informiere mich erst", hint: "Ich möchte Informationen, noch keinen Termin" },
];

export const BUDGET_OPTIONS = [
  { id: "ja", label: "Ja, das passt" },
  { id: "unsicher", label: "Ich bin unsicher", hint: "Wir rechnen es im Gespräch transparent durch" },
  { id: "erst-informieren", label: "Ich möchte erst mehr erfahren", hint: "Sie erhalten Informationen per E-Mail" },
];

export const DISTANCE_OPTIONS = [
  { id: "in-der-naehe", label: "Ich wohne in der Nähe" },
  { id: "bis-1-stunde", label: "Bis zu 1 Stunde entfernt" },
  { id: "weiter-entfernt", label: "Weiter entfernt", hint: "Wir bündeln Termine für Ihre Anreise" },
];
