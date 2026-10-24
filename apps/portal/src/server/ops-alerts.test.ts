import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute, sendEmailOnce } = vi.hoisted(() => ({
  execute: vi.fn(),
  sendEmailOnce: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    execute: (q: unknown) => execute(q),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ name: "Praxis Muster" }] }),
      }),
    }),
  },
  schema: { clinics: { displayName: "displayName", id: "id" } },
}));
vi.mock("@/server/email-once", () => ({
  sendEmailOnce: (p: unknown) => sendEmailOnce(p),
}));

const { notifyOps, _resetOpsAlertWarning, opsAlertScopeKey, opsAlertSendKey, opsAlertPresentation } =
  await import(
  "./ops-alerts"
);

const alert = {
  clinicId: "11111111-1111-4111-8111-111111111111",
  kind: "pvs_agent_health:stream_halted",
  severity: "high" as const,
  title: "PVS: 1 Datenstrom ist angehalten",
  body: "details",
};

beforeEach(() => {
  execute.mockReset().mockResolvedValue([{ scope_key: "x" }]);
  sendEmailOnce.mockReset().mockResolvedValue("sent");
  _resetOpsAlertWarning();
  process.env.OPS_ALERT_EMAIL = "ops@example.test";
});
afterEach(() => {
  delete process.env.OPS_ALERT_EMAIL;
  vi.restoreAllMocks();
});

describe("notifyOps", () => {
  it("emails OPS_ALERT_EMAIL for a high alert", async () => {
    await expect(notifyOps(alert)).resolves.toBe("sent");
    expect(sendEmailOnce).toHaveBeenCalledTimes(1);
    const mail = sendEmailOnce.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(mail.key)).toMatch(/^ops\/[0-9a-f-]+:pvs_agent_health:stream_halted\/\d+$/);
    expect(mail.to).toBe("ops@example.test");
    expect(String(mail.subject)).toContain("Datenstrom");
    expect(String(mail.text)).toContain("Praxis Muster");
    // cross-tenant ops mail: no clinic suppression lookup
    expect(mail.clinicId).toBeNull();
  });

  it("does not email below high severity", async () => {
    await expect(notifyOps({ ...alert, severity: "warn" })).resolves.toBe("skipped");
    expect(sendEmailOnce).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("is rate limited when the claim returns no row (sent < 6 h ago)", async () => {
    execute.mockResolvedValue([]);
    await expect(notifyOps(alert)).resolves.toBe("rate_limited");
    expect(sendEmailOnce).not.toHaveBeenCalled();
  });

  it("skips with a single warning when OPS_ALERT_EMAIL is unset", async () => {
    delete process.env.OPS_ALERT_EMAIL;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(notifyOps(alert)).resolves.toBe("skipped");
    await expect(notifyOps(alert)).resolves.toBe("skipped");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("releases the rate-limit claim when the send fails", async () => {
    sendEmailOnce.mockRejectedValue(new Error("resend down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyOps(alert)).resolves.toBe("failed");
    // claim insert + release delete
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("treats an already-sent key as rate limited", async () => {
    sendEmailOnce.mockResolvedValue("duplicate");
    await expect(notifyOps(alert)).resolves.toBe("rate_limited");
  });

  it("puts two sends at least 6 h apart into different windows", () => {
    const t = new Date("2026-10-07T05:59:00Z");
    const later = new Date(t.getTime() + 6 * 60 * 60 * 1000);
    expect(opsAlertSendKey(alert, t)).not.toBe(opsAlertSendKey(alert, later));
    expect(opsAlertSendKey(alert, t)).toBe(
      opsAlertSendKey(alert, new Date("2026-10-07T00:00:00Z"))
    );
  });

  it("never throws", async () => {
    execute.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyOps(alert)).resolves.toBe("failed");
  });

  it("keys the cooldown per clinic and alert, platform alerts share one key", () => {
    expect(opsAlertScopeKey(alert)).toBe(`${alert.clinicId}:${alert.kind}`);
    expect(opsAlertScopeKey({ clinicId: null, kind: "worker_stale" })).toBe(
      "platform:worker_stale"
    );
  });
});

describe("opsAlertPresentation (INT-C 11)", () => {
  it("PVS prefix and link only for PVS kinds", () => {
    expect(opsAlertPresentation("pvs_agent_health:stream_halted")).toEqual({
      prefix: "[EINS PVS]",
      footer: expect.stringContaining("/api/admin/pvs/alerts"),
    });
    for (const kind of ["worker_stale", "meta_page_ambiguous:123", "db_backup_failed", "retention_blocked"]) {
      expect(opsAlertPresentation(kind)).toEqual({ prefix: "[EINS Portal]", footer: null });
    }
  });
});
