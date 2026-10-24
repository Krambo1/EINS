import { describe, expect, it, vi } from "vitest";

// The module wires real DB deps by default; tests inject their own, so the
// client only needs to exist, never to connect.
vi.mock("@/db/client", () => ({ db: { execute: vi.fn() }, schema: {} }));

const { runNewRequestNotification, selectRecipients, operatorRecipient } = await import("./request-notify");
const { env } = await import("@/lib/env");
type Deps = Parameters<typeof runNewRequestNotification>[1];
type Claimed = NonNullable<Awaited<ReturnType<Deps["claim"]>>>;

const CLINIC = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";

function claimed(over: Partial<Claimed> = {}): Claimed {
  return {
    id: REQ,
    clinicId: CLINIC,
    clinicName: "Praxis Muster",
    clinicArchived: false,
    source: "formular",
    treatmentWish: "Botox",
    quizTreatment: null,
    catalogNames: ["Botox", "Hyaluron-Filler"],
    // 2026-10-07 16:30 UTC = 18:30 Berlin (summer time)
    createdAt: new Date("2026-10-07T16:30:00Z"),
    ...over,
  };
}

const users = [
  { email: "Inhaber@praxis.de", role: "inhaber", archivedAt: null },
  { email: "empfang@praxis.de", role: "frontdesk", archivedAt: null },
  { email: "marketing@praxis.de", role: "marketing", archivedAt: null },
  { email: "alt@praxis.de", role: "frontdesk", archivedAt: new Date("2026-01-01") },
  { email: "inhaber@praxis.de", role: "frontdesk", archivedAt: null },
];

/** In-memory stand-in for the atomic UPDATE ... WHERE notified_at IS NULL. */
function makeDeps(over: Partial<Deps> = {}) {
  const notified = new Set<string>();
  const delivered = new Set<string>();
  const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const deps: Deps = {
    claim: vi.fn(async (id: string) => {
      if (notified.has(id)) return null;
      notified.add(id);
      return claimed();
    }),
    release: vi.fn(async (id: string) => {
      notified.delete(id);
    }),
    markDelivered: vi.fn(async (id: string) => {
      delivered.add(id);
    }),
    loadUsers: vi.fn(async () => users),
    isSuppressed: vi.fn(async () => false),
    send: vi.fn(async (m) => {
      sent.push(m);
    }),
    portalOrigin: () => "https://portal.eins.ag/",
    ...over,
  };
  return { deps, sent, notified, delivered };
}

describe("selectRecipients", () => {
  it("keeps active inhaber + frontdesk, dedupes case-insensitively, drops suppressed", () => {
    expect(selectRecipients(users, new Set())).toEqual([
      "inhaber@praxis.de",
      "empfang@praxis.de",
    ]);
    expect(selectRecipients(users, new Set(["empfang@praxis.de"]))).toEqual([
      "inhaber@praxis.de",
    ]);
  });

  it("returns nothing for a Praxis with only marketing users", () => {
    expect(
      selectRecipients([{ email: "m@x.de", role: "marketing", archivedAt: null }], new Set())
    ).toEqual([]);
  });
});

describe("runNewRequestNotification", () => {
  it("mails each recipient once, without patient data, with Berlin time and deep link", async () => {
    const { deps, sent } = makeDeps();
    const out = await runNewRequestNotification(REQ, deps);
    expect(out).toEqual({ status: "sent", sent: 2, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["inhaber@praxis.de", "empfang@praxis.de"]);
    const m = sent[0]!;
    expect(m.subject).toBe("Neue Anfrage: Botox");
    expect(m.text).toContain("07.10.2026, 18:30 Uhr");
    expect(m.text).toContain(`https://portal.eins.ag/anfragen/${REQ}`);
    expect(m.text).toContain("Zielseiten-Formular");
    expect(m.text).not.toContain("—");
  });

  it("sends nothing on a second call for the same request (claim already taken)", async () => {
    const { deps, sent } = makeDeps();
    await runNewRequestNotification(REQ, deps);
    const second = await runNewRequestNotification(REQ, deps);
    expect(second.status).toBe("already_notified");
    expect(sent).toHaveLength(2);
  });

  it("concurrent calls send exactly one round", async () => {
    const { deps, sent } = makeDeps();
    const results = await Promise.all([
      runNewRequestNotification(REQ, deps),
      runNewRequestNotification(REQ, deps),
      runNewRequestNotification(REQ, deps),
    ]);
    expect(results.filter((r) => r.status === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  it("one failing recipient does not stop the others and keeps the claim", async () => {
    const send = vi.fn(async (m: { to: string }) => {
      if (m.to === "inhaber@praxis.de") throw new Error("boom");
    });
    const { deps, notified } = makeDeps({ send });
    const out = await runNewRequestNotification(REQ, deps);
    expect(out).toEqual({ status: "sent", sent: 1, failed: 1 });
    expect(notified.has(REQ)).toBe(true);
  });

  it("releases the claim when every send failed, so a retry can mail later", async () => {
    const { deps, notified } = makeDeps({
      send: vi.fn(async () => {
        throw new Error("resend down");
      }),
    });
    const out = await runNewRequestNotification(REQ, deps);
    expect(out.status).toBe("all_failed");
    expect(deps.release).toHaveBeenCalledWith(REQ);
    expect(notified.has(REQ)).toBe(false);
  });

  it("skips suppressed addresses", async () => {
    const { deps, sent } = makeDeps({
      isSuppressed: vi.fn(async (_c: string, e: string) => e === "inhaber@praxis.de"),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent.map((m) => m.to)).toEqual(["empfang@praxis.de"]);
  });

  it("does not mail an archived Praxis", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () => claimed({ clinicArchived: true })),
    });
    const out = await runNewRequestNotification(REQ, deps);
    expect(out.status).toBe("no_recipients");
    expect(sent).toHaveLength(0);
  });

  it("does not mail the Praxis about its own front-desk entry and marks it delivered", async () => {
    for (const source of ["manuell", "manual"]) {
      const { deps, sent, delivered } = makeDeps({
        claim: vi.fn(async () => claimed({ source })),
      });
      const out = await runNewRequestNotification(REQ, deps);
      expect(out.status).toBe("own_entry");
      expect(sent).toHaveLength(0);
      expect(delivered.has(REQ)).toBe(true);
    }
  });

  it("falls back to a neutral subject without treatment", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () => claimed({ treatmentWish: null, quizTreatment: null, source: "meta" })),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent[0]!.subject).toBe("Neue Anfrage über EINS");
    expect(sent[0]!.text).toContain("Meta / Instagram");
  });

  it("an operator-check failure never blocks the Praxis mail", async () => {
    const { deps, sent } = makeDeps({
      operatorCandidate: vi.fn(async () => {
        throw new Error("guarantee query failed");
      }),
    });
    const out = await runNewRequestNotification(REQ, deps);
    expect(out.status).toBe("sent");
    expect(sent).toHaveLength(2);
  });
});

describe("claim vs. delivery (V4 Neben 2)", () => {
  it("marks the request delivered only after a mail was accepted", async () => {
    const { deps, delivered } = makeDeps();
    const out = await runNewRequestNotification(REQ, deps);
    expect(out.status).toBe("sent");
    expect(delivered.has(REQ)).toBe(true);
    const sendOrder = (deps.send as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    const markOrder = (deps.markDelivered as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!;
    expect(markOrder).toBeGreaterThan(sendOrder);
  });

  it("all sends failed: released, never marked delivered", async () => {
    const { deps, delivered } = makeDeps({
      send: vi.fn(async () => {
        throw new Error("resend down");
      }),
    });
    await runNewRequestNotification(REQ, deps);
    expect(delivered.has(REQ)).toBe(false);
    expect(deps.release).toHaveBeenCalledWith(REQ);
  });

  it("no recipient: claim stays undelivered so the catch-up retries it once stale", async () => {
    const { deps, delivered } = makeDeps({ loadUsers: vi.fn(async () => []) });
    const out = await runNewRequestNotification(REQ, deps);
    expect(out.status).toBe("no_recipients");
    expect(delivered.has(REQ)).toBe(false);
    expect(deps.release).not.toHaveBeenCalled();
  });

  it("archived Praxis: nothing to send, marked done", async () => {
    const { deps, delivered } = makeDeps({
      claim: vi.fn(async () => claimed({ clinicArchived: true })),
    });
    await runNewRequestNotification(REQ, deps);
    expect(delivered.has(REQ)).toBe(true);
  });

  it("a failing delivered mark never throws and keeps the sent result", async () => {
    const { deps } = makeDeps({
      markDelivered: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const out = await runNewRequestNotification(REQ, deps);
    expect(out.status).toBe("sent");
  });

  it("uses the same Idempotency-Key per recipient on a retry", async () => {
    const first = makeDeps();
    await runNewRequestNotification(REQ, first.deps);
    const second = makeDeps();
    await runNewRequestNotification(REQ, second.deps);
    const keys = (d: typeof first) =>
      (d.deps.send as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys(second)).toEqual(keys(first));
  });
});

describe("operatorRecipient (INT-C 6)", () => {
  it("does not throw on the raw env of SKIP_ENV_VALIDATION (ADMIN_EMAILS unset)", () => {
    // Reproduces "operator candidate check failed ... reading '0'": under the
    // test setup env.ADMIN_EMAILS is undefined, not an array.
    const raw = (env as Record<string, unknown>).ADMIN_EMAILS;
    expect(Array.isArray(raw)).toBe(false);
    expect(() => operatorRecipient(undefined, raw)).not.toThrow();
    expect(operatorRecipient(undefined, raw)).toBeNull();
  });

  it("prefers OPS_ALERT_EMAIL, then the first admin address", () => {
    expect(operatorRecipient(" ops@eins.ag ", ["karam@eins.ag"])).toBe("ops@eins.ag");
    expect(operatorRecipient("", ["Karam@eins.ag", "b@eins.ag"])).toBe("karam@eins.ag");
    expect(operatorRecipient(undefined, [])).toBeNull();
  });

  it("parses a raw comma string instead of returning its first character", () => {
    expect(operatorRecipient(undefined, " Karam@eins.ag , b@eins.ag")).toBe("karam@eins.ag");
    expect(operatorRecipient(undefined, " , ")).toBeNull();
  });
});

describe("catalogue treatment (L-13)", () => {
  it("uses the catalogue name even when the free text would be hidden", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () =>
        claimed({ treatmentWish: "Anna Muster 0171 1234567", catalogTreatment: "Faltenbehandlung" })
      ),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent[0]!.subject).toBe("Neue Anfrage: Faltenbehandlung");
    expect(sent[0]!.text).not.toContain("0171");
  });

  it("H2: a bare patient name never reaches the subject", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () => claimed({ treatmentWish: "Brigitte Meier", catalogTreatment: null })),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent[0]!.subject).toBe("Neue Anfrage über EINS");
    expect(sent[0]!.text).not.toContain("Brigitte");
    expect(sent[0]!.html).not.toContain("Meier");
  });

  it("H2: free text equal to a catalogue name uses the catalogue spelling", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () => claimed({ treatmentWish: "  botox ", catalogTreatment: null })),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent[0]!.subject).toBe("Neue Anfrage: Botox");
  });

  it("H2: a quiz selection outside the catalogue gives the generic subject", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () =>
        claimed({ treatmentWish: null, quizTreatment: "Fadenlifting", catalogTreatment: null })
      ),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent[0]!.subject).toBe("Neue Anfrage über EINS");
  });

  it("H2: a matching quiz selection is shown", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () =>
        claimed({ treatmentWish: null, quizTreatment: "hyaluron-filler", catalogTreatment: null })
      ),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent[0]!.subject).toBe("Neue Anfrage: Hyaluron-Filler");
  });

  it("hides free text that carries contact data when no catalogue entry matched", async () => {
    const { deps, sent } = makeDeps({
      claim: vi.fn(async () => claimed({ treatmentWish: "Anna Muster 0171 1234567", catalogTreatment: null })),
    });
    await runNewRequestNotification(REQ, deps);
    expect(sent[0]!.subject).toBe("Neue Anfrage über EINS");
    expect(sent[0]!.text).not.toContain("0171");
    expect(sent[0]!.text).not.toContain("Anna");
  });
});
