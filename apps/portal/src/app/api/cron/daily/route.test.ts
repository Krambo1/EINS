import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendEmailInput } from "@/server/email";

// The whole daily run with every processor stubbed: proves the deletion
// alert is wired into the route and sends one mail per run.
const m = vi.hoisted(() => ({
  send: vi.fn(async (_mail: SendEmailInput) => {}),
  purgeRetention: vi.fn(async () => ({})),
  purgeAudit: vi.fn(async () => ({})),
}));

vi.mock("@/db/client", () => {
  // Every query chain resolves to no rows (no clinics, nothing to score).
  const chain: unknown = new Proxy(() => {}, {
    get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown[]) => void) => resolve([]) : () => chain),
  });
  return { db: { select: () => chain }, schema: new Proxy({}, { get: () => new Proxy({}, { get: () => "col" }) }) };
});
vi.mock("@/server/email", async () => {
  const actual = await vi.importActual<typeof import("@/server/email")>("@/server/email");
  return { ...actual, getEmailSender: () => ({ send: m.send }) };
});
const noop = () => vi.fn(async () => undefined);
vi.mock("@/worker/processors/refresh-oauth", () => ({ processRefreshOauth: noop() }));
vi.mock("@/worker/processors/sync-meta", () => ({ processSyncMeta: noop() }));
vi.mock("@/worker/processors/sync-google", () => ({ processSyncGoogle: noop() }));
vi.mock("@/worker/processors/kpi-rebuild", () => ({ processKpiRebuild: noop() }));
vi.mock("@/worker/processors/forecast-snapshot", () => ({ processForecastSnapshot: noop() }));
vi.mock("@/worker/processors/sync-reviews-google", () => ({ processSyncReviewsGoogle: noop() }));
vi.mock("@/worker/processors/sync-reviews-jameda", () => ({ processSyncReviewsJameda: noop() }));
vi.mock("@/worker/processors/anomaly-scan", () => ({ processAnomalyScan: noop() }));
vi.mock("@/worker/processors/ai-score", () => ({ processAiScore: noop() }));
vi.mock("@/worker/processors/pvs-csv-ingest", () => ({ catchUpPvsCsvIngest: noop() }));
vi.mock("@/worker/processors/purge-retention", () => ({ processPurgeRetention: m.purgeRetention }));
vi.mock("@/worker/processors/purge-audit", () => ({ processPurgeAudit: m.purgeAudit }));
// Sunday 01.11.2026, so the weekly audit purge runs too.
vi.mock("@/worker/processors/berlin-days", () => ({
  berlinToday: () => "2026-11-01",
  berlinYesterday: () => "2026-10-31",
  addDaysIso: () => "2026-10-25",
}));

const { GET } = await import("./route");

const request = () => ({ headers: new Headers({ authorization: "Bearer test-secret" }) }) as never;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  m.send.mockClear();
  m.purgeRetention.mockReset().mockResolvedValue({});
  m.purgeAudit.mockReset().mockResolvedValue({});
});

describe("GET /api/cron/daily deletion alert", () => {
  it("sends no mail when the deletion steps work", async () => {
    const body = await (await GET(request())).json();
    expect(body.ok).toBe(true);
    expect(m.send).not.toHaveBeenCalled();
    expect(body.steps.map((s: { step: string }) => s.step)).not.toContain("deletion-failure-mail");
  });

  it("sends exactly one mail for two failed deletion steps and records it", async () => {
    m.purgeRetention.mockRejectedValue(new Error("deadlock detected"));
    m.purgeAudit.mockRejectedValue(new Error("statement timeout"));
    const body = await (await GET(request())).json();

    expect(m.send).toHaveBeenCalledTimes(1);
    const mail = m.send.mock.calls[0]![0];
    expect(mail.to).toBe("team@eins.ag");
    expect(mail.text).toContain("purge-retention");
    expect(mail.text).toContain("deadlock detected");
    expect(mail.text).toContain("purge-audit");
    expect(mail.text).toContain("statement timeout");

    expect(body.ok).toBe(false);
    expect(body.steps.at(-1)).toMatchObject({ step: "deletion-failure-mail", ok: true });
  });

  it("still answers with the summary when the mail itself fails", async () => {
    m.purgeRetention.mockRejectedValue(new Error("deadlock detected"));
    m.send.mockRejectedValueOnce(new Error("Resend down"));
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps.at(-1)).toMatchObject({ step: "deletion-failure-mail", ok: false, error: "Resend down" });
  });
});
