import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-handler tests for POST /api/leads/intake: the source contract
 * (lib/sources.ts ENTRY_SOURCES plus aliases), the self-report and ttclid
 * hand-over to persistLead. Collaborators are mocked; the test is about what
 * the handler accepts and passes on.
 */

const persistLead = vi.fn(async (_clinicId: string, _input: Record<string, unknown>) => ({
  status: "inserted" as const,
  id: "req-1",
}));
const verifyLeadSignature = vi.fn(async () => true as boolean);

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
  after: (cb: () => unknown) => {
    void cb();
  },
}));
vi.mock("@/server/rate-limit", () => ({
  rateLimit: async () => ({ ok: true, resetInSeconds: 60 }),
}));
vi.mock("@/server/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/server/clinic-signature", () => ({ clinicHasIntakeSecret: async () => true }));
vi.mock("@/server/leads", () => ({
  verifyLeadSignature: () => verifyLeadSignature(),
  persistLead: (clinicId: string, input: Record<string, unknown>) => persistLead(clinicId, input),
  ClinicArchivedError: class extends Error {},
  buildLandingConsents: () => ({ basis: "landing_form" }),
  consentTimeOrNow: (d: Date | null) => d ?? new Date(),
}));

const { POST } = await import("./route.js");

const CLINIC = "11111111-1111-4111-8111-111111111111";

function post(body: Record<string, unknown>) {
  const raw = JSON.stringify({ clinicId: CLINIC, dsgvoConsent: true, contactPhone: "0221 1234567", ...body });
  return POST(
    new Request("http://localhost/api/leads/intake", {
      method: "POST",
      headers: { "content-type": "application/json", "x-eins-signature": "sig" },
      body: raw,
    }) as never
  );
}

beforeEach(() => {
  persistLead.mockClear();
  verifyLeadSignature.mockClear();
});

describe("POST /api/leads/intake: source contract", () => {
  it.each(["formular", "meta", "google", "manuell", "whatsapp", "pvs_import"])(
    "accepts %s",
    async (source) => {
      const res = await post({ source });
      expect(res.status).toBe(201);
      expect(persistLead.mock.calls[0]![1].source).toBe(source);
    }
  );

  it.each([
    ["landing_form", "formular"],
    ["meta_lead_ads", "meta"],
    ["manual", "manuell"],
  ])("translates the alias %s to %s", async (alias, canonical) => {
    const res = await post({ source: alias });
    expect(res.status).toBe(201);
    expect(persistLead.mock.calls[0]![1].source).toBe(canonical);
  });

  it.each(["anruf", "buchung", "call_tracking", "booking_link"])(
    "rejects the webhook-only source %j (only the Messweg webhooks write it)",
    async (source) => {
      const res = await post({ source });
      expect(res.status).toBe(400);
      expect(persistLead).not.toHaveBeenCalled();
    }
  );

  it.each(["instagram", "website", "erfunden", ""])("rejects the unknown source %j", async (source) => {
    const res = await post({ source });
    expect(res.status).toBe(400);
    expect(persistLead).not.toHaveBeenCalled();
  });

  it("passes a valid self-report on and drops an unknown one without losing the inquiry", async () => {
    await post({ source: "formular", selfReportedSource: "instagram" });
    expect(persistLead.mock.calls[0]![1].selfReportedSource).toBe("instagram");

    const res = await post({ source: "formular", selfReportedSource: "<script>" });
    expect(res.status).toBe(201);
    expect(persistLead.mock.calls[1]![1].selfReportedSource).toBeNull();
  });

  it("forwards ttclid in the attribution envelope", async () => {
    await post({ source: "formular", attribution: { ttclid: "tt-123" } });
    const attribution = persistLead.mock.calls[0]![1].attribution as { ttclid: string | null };
    expect(attribution.ttclid).toBe("tt-123");
  });

  it("only the EINS form may carry the ads consent", async () => {
    await post({ source: "meta", adsConsent: true });
    expect(persistLead.mock.calls[0]![1].adsConsent).toBe(false);
    await post({ source: "formular", adsConsent: true });
    expect(persistLead.mock.calls[1]![1].adsConsent).toBe(true);
  });
});
