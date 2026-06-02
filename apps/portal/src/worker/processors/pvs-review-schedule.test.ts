import { beforeEach, describe, expect, it, vi } from "vitest";
import { foldEvents, maybeScheduleReviewForCompletedEncounter } from "./pvs-status-derive";

/**
 * EINS Bewertungen — PVS-bridge-driven review scheduling tests.
 *
 * maybeScheduleReviewForCompletedEncounter is the worker hook: it gates on the
 * per-Praxis consent attestation, resolves the patient email from the EINS lead
 * linkage, and hands off to scheduleReviewRequest. Here we lock down the GATING
 * and EMAIL RESOLUTION; the insert + per-appointment dedup live in
 * scheduleReviewRequest and are covered by patient-events.test.ts. We therefore
 * stub scheduleReviewRequest with a spy and assert how the hook calls it.
 *
 * The db mock dispatches by per-table __tag (mirrors pvs-events.apply.test.ts).
 * The bucket is built with the REAL foldEvents so its shape can't drift.
 */

interface MockState {
  clinic: {
    reviewRequestEnabled: boolean;
    reviewConsentAttested: boolean;
    reviewRequestDelayDays: number;
  } | null;
  request: { contactEmail: string | null; contactName: string | null } | null;
  patient: { email: string | null; fullName: string | null } | null;
}

let state: MockState;

function selectRowsFor(table: { __tag?: string }): unknown[] {
  switch (table.__tag) {
    case "clinics":
      return state.clinic ? [state.clinic] : [];
    case "requests":
      return state.request ? [state.request] : [];
    case "patients":
      return state.patient ? [state.patient] : [];
    default:
      return [];
  }
}

vi.mock("@/db/client", () => ({
  db: {
    select: (_cols?: unknown) => ({
      from: (table: { __tag?: string }) => ({
        where: (_clause: unknown) => ({
          limit: async (_n: number) => selectRowsFor(table),
        }),
      }),
    }),
  },
  schema: {
    clinics: {
      __tag: "clinics",
      id: {},
      reviewRequestEnabled: {},
      reviewConsentAttested: {},
      reviewRequestDelayDays: {},
    },
    requests: { __tag: "requests", id: {}, contactEmail: {}, contactName: {} },
    patients: { __tag: "patients", id: {}, email: {}, fullName: {} },
  },
}));

// The insert + dedup logic is tested elsewhere; here scheduleReviewRequest is a
// spy so we can assert the hook's gating + email resolution in isolation.
const { scheduleSpy } = vi.hoisted(() => ({ scheduleSpy: vi.fn() }));
vi.mock("@/server/patient-events", () => ({
  scheduleReviewRequest: scheduleSpy,
}));

const CLINIC = "11111111-2222-3333-4444-555555555555";

const ev = (payload: Record<string, unknown>, occurredAt: string, id: string) => ({
  id,
  kind: payload.kind as string,
  occurredAt: new Date(occurredAt),
  payload,
});

/** A completed-encounter bucket built via the real foldEvents. */
function completedBucket(treatmentLabel = "Hyaluron-Auffrischung") {
  const events = [
    ev(
      {
        kind: "AppointmentCreated",
        pvsAppointmentId: "A1",
        scheduledAt: "2026-05-19T09:00:00.000Z",
        treatmentLabel,
      },
      "2026-05-18T09:00:00.000Z",
      "e1"
    ),
    ev(
      {
        kind: "EncounterCompleted",
        pvsEncounterId: "E1",
        pvsAppointmentId: "A1",
        completedAt: "2026-05-20T10:00:00.000Z",
        treatmentLabel,
      },
      "2026-05-20T10:00:00.000Z",
      "e2"
    ),
  ];
  return foldEvents(events).byAppt.get("A1")!;
}

beforeEach(() => {
  state = {
    clinic: {
      reviewRequestEnabled: true,
      reviewConsentAttested: true,
      reviewRequestDelayDays: 3,
    },
    request: { contactEmail: "lead@praxis-beispiel.de", contactName: "Lead Person" },
    patient: { email: "patient@example.com", fullName: "Patient Name" },
  };
  scheduleSpy.mockReset();
  scheduleSpy.mockResolvedValue({
    status: "scheduled",
    reviewRequestId: "rev-1",
    scheduledFor: "2026-05-23",
  });
});

async function run() {
  await maybeScheduleReviewForCompletedEncounter({
    clinicId: CLINIC,
    portalPatientId: "pat-1",
    requestId: "req-1",
    bucket: completedBucket(),
  });
}

describe("maybeScheduleReviewForCompletedEncounter", () => {
  it("schedules when both flags are on, forwarding the PVS linkage + lead email", async () => {
    await run();
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy.mock.calls[0]![0]).toMatchObject({
      clinicId: CLINIC,
      patientId: "pat-1",
      email: "lead@praxis-beispiel.de", // request email wins over patient email
      patientName: "Lead Person",
      treatmentLabel: "Hyaluron-Auffrischung",
      delayDays: 3,
      requestId: "req-1",
      pvsAppointmentId: "A1",
      pvsEncounterId: "E1",
    });
    expect(scheduleSpy.mock.calls[0]![0].completedAt).toEqual(
      new Date("2026-05-20T10:00:00.000Z")
    );
  });

  it("does NOT schedule when the Praxis has not attested consent", async () => {
    state.clinic!.reviewConsentAttested = false;
    await run();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("does NOT schedule when the master switch is off", async () => {
    state.clinic!.reviewRequestEnabled = false;
    await run();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("falls back to the linked patient's email when the request has none", async () => {
    state.request = { contactEmail: null, contactName: null };
    await run();
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy.mock.calls[0]![0]).toMatchObject({
      email: "patient@example.com",
      patientName: "Patient Name",
    });
  });

  it("skips silently when no email is resolvable (walk-in, no EINS lead)", async () => {
    state.request = { contactEmail: null, contactName: null };
    state.patient = { email: null, fullName: null };
    await run();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });

  it("skips when the clinic row is missing", async () => {
    state.clinic = null;
    await run();
    expect(scheduleSpy).not.toHaveBeenCalled();
  });
});
