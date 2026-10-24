import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V3 Neben 1: archiving a treatment or location with an id that matches no
 * row of the own Praxis (foreign or stale id) must not report success and
 * must not write a "delete" audit row.
 */
const h = vi.hoisted(() => ({
  returnedRows: [] as Array<{ id: string }>,
  writeAudit: vi.fn(async () => undefined),
  flashSuccess: vi.fn(async () => undefined),
  flashError: vi.fn(async () => undefined),
}));

vi.mock("@/auth/guards", () => ({
  requireSession: vi.fn(async () => ({
    clinicId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    email: "inhaber@praxis.de",
    role: "inhaber",
  })),
}));
vi.mock("@/db/client", async () => {
  const schema = await import("@/db/schema");
  const chain = {
    update: () => chain,
    set: () => chain,
    where: () => chain,
    returning: async () => h.returnedRows,
  };
  return {
    db: {},
    schema,
    withClinicContext: vi.fn(
      async (_c: string, _u: string, fn: (tx: unknown) => Promise<unknown>) => fn(chain)
    ),
  };
});
vi.mock("@/server/audit", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/flash", () => ({ flashSuccess: h.flashSuccess, flashError: h.flashError }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/auth/magic-link", () => ({ issueMagicLink: vi.fn() }));
vi.mock("@/auth/session", () => ({ revokeAllSessionsForUser: vi.fn() }));
vi.mock("@/server/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/server/clinic-signature", () => ({ invalidateSignatureSecretCache: vi.fn() }));
vi.mock("@/lib/crypto", () => ({ encryptString: vi.fn() }));

import { archiveLocationAction, archiveTreatmentAction } from "./actions";

const ID = "33333333-3333-4333-8333-333333333333";

function form(field: string): FormData {
  const f = new FormData();
  f.set(field, ID);
  return f;
}

beforeEach(() => {
  h.returnedRows = [];
  h.writeAudit.mockClear();
  h.flashSuccess.mockClear();
  h.flashError.mockClear();
});

describe("archive actions with an id outside the own Praxis (V3 Neben 1)", () => {
  it("treatment: no row, no success, no audit", async () => {
    await archiveTreatmentAction(form("treatmentId"));
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.flashSuccess).not.toHaveBeenCalled();
    expect(h.flashError).toHaveBeenCalledWith(
      "Archivieren fehlgeschlagen",
      "Diese Behandlung wurde nicht gefunden."
    );
  });

  it("location: no row, no success, no audit", async () => {
    await archiveLocationAction(form("locationId"));
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.flashSuccess).not.toHaveBeenCalled();
    expect(h.flashError).toHaveBeenCalledWith(
      "Archivieren fehlgeschlagen",
      "Dieser Standort wurde nicht gefunden."
    );
  });

  it("own row: success and one audit row, as before", async () => {
    h.returnedRows = [{ id: ID }];
    await archiveTreatmentAction(form("treatmentId"));
    await archiveLocationAction(form("locationId"));
    expect(h.writeAudit).toHaveBeenCalledTimes(2);
    expect(h.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete", entityKind: "treatment", entityId: ID })
    );
    expect(h.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete", entityKind: "location", entityId: ID })
    );
    expect(h.flashSuccess).toHaveBeenCalledWith("Behandlung archiviert");
    expect(h.flashSuccess).toHaveBeenCalledWith("Standort archiviert");
    expect(h.flashError).not.toHaveBeenCalled();
  });
});
