import type { Treatment } from "@/lib/types";

export type Branch = "qualified" | "info-only" | null;

export interface QuizState {
  step: number;
  totalSteps: number;
  treatment: string | null;
  timeframe: string | null;
  experience: string | null;
  city: string;
  firstName: string;
  email: string;
  phone: string;
  notes: string;
  consents: {
    privacy: boolean;
    ageGate: boolean;
    marketing: boolean;
  };
  branch: Branch;
  errors: Partial<Record<string, string>>;
  submitting: boolean;
  submitted: boolean;
  serverMessage: string | null;
  /** Stable id we'll send with both the browser pixel and the server CAPI relay. */
  eventId: string;
}

export type QuizAction =
  | { type: "set"; field: keyof QuizState; value: unknown }
  | { type: "setConsent"; key: keyof QuizState["consents"]; value: boolean }
  | { type: "next" }
  | { type: "back" }
  | { type: "branch"; value: Branch }
  | { type: "submitting"; value: boolean }
  | { type: "submitted"; message?: string }
  | { type: "errors"; value: Partial<Record<string, string>> }
  | { type: "reset"; treatment: Treatment };

export function buildInitialState(treatment: Treatment, eventId: string): QuizState {
  const totalSteps = treatment.quiz.askExperience ? 5 : 4;
  return {
    step: 1,
    totalSteps,
    treatment: null,
    timeframe: null,
    experience: null,
    city: treatment.city,
    firstName: "",
    email: "",
    phone: "",
    notes: "",
    consents: { privacy: false, ageGate: false, marketing: false },
    branch: null,
    errors: {},
    submitting: false,
    submitted: false,
    serverMessage: null,
    eventId,
  };
}

export function reducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case "set":
      return { ...state, [action.field]: action.value, errors: { ...state.errors, [action.field]: undefined } };
    case "setConsent":
      return {
        ...state,
        consents: { ...state.consents, [action.key]: action.value },
        errors: { ...state.errors, [action.key]: undefined },
      };
    case "next":
      return { ...state, step: Math.min(state.step + 1, state.totalSteps + 1), errors: {} };
    case "back":
      return { ...state, step: Math.max(state.step - 1, 1), errors: {} };
    case "branch":
      return { ...state, branch: action.value };
    case "submitting":
      return { ...state, submitting: action.value };
    case "submitted":
      return { ...state, submitted: true, submitting: false, serverMessage: action.message ?? null };
    case "errors":
      return { ...state, errors: action.value };
    case "reset":
      return buildInitialState(action.treatment, state.eventId);
    default:
      return state;
  }
}

export const TIMEFRAMES = [
  { id: "asap", label: "So bald wie möglich", hint: "Termine in den nächsten 1–2 Wochen" },
  { id: "this-month", label: "Diesen Monat", hint: "Innerhalb der nächsten 4 Wochen" },
  { id: "next-3-months", label: "In den nächsten 3 Monaten" },
  { id: "later", label: "Später", hint: "Ich plane voraus" },
  { id: "info-only", label: "Ich informiere mich nur", hint: "Noch keine konkrete Behandlungs-Absicht" },
];

export const EXPERIENCES = [
  { id: "first", label: "Wäre meine erste Behandlung dieser Art" },
  { id: "had-similar", label: "Habe schon Erfahrung mit ähnlichen Behandlungen" },
  { id: "had-this", label: "Habe genau diese Behandlung schon einmal gehabt" },
];
