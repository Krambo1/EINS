import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pass 2: the agent re-orders events (a retried row goes behind newer ones),
 * so an OLDER PatientUpserted can arrive after a newer one of the same PVS
 * patient. It used to overwrite the newer email / phone, which then broke
 * lead linking (attachRequestsToPatient matches on them) and review emails.
 * A PatientUpserted is not merged when a later one (occurredAt) from the same
 * source is already applied.
 */

let newerApplied: unknown[];
let updates: Array<{ table: string | undefined; vals: Record<string, unknown> }>;

vi.mock("@/db/client", () => {
  const select = () => ({
    from: (table: { __tag?: string }) => ({
      where: (_c: unknown) => ({
        limit: async (_n: number) =>
          table.__tag === "pvs_patient_map"
            ? [{ portalPatientId: "pat-1", method: "external_id" }]
            : table.__tag === "pvs_event_log"
              ? newerApplied
              : [],
      }),
    }),
  });
  const col = (name: string) => ({ name });
  return {
    db: {
      select,
      update: (table: { __tag?: string }) => ({
        set: (vals: Record<string, unknown>) => ({
          where: async (_c: unknown) => {
            updates.push({ table: table.__tag, vals });
            return [];
          },
        }),
      }),
    },
    schema: {
      pvsPatientMap: {
        __tag: "pvs_patient_map",
        clinicId: col("clinic_id"),
        pvsPatientId: col("pvs_patient_id"),
        portalPatientId: col("portal_patient_id"),
        linkMethod: col("link_method"),
      },
      pvsEventLog: {
        __tag: "pvs_event_log",
        id: col("id"),
        clinicId: col("clinic_id"),
        kind: col("kind"),
        bridgeSource: col("bridge_source"),
        payload: col("payload"),
        occurredAt: col("occurred_at"),
        appliedAt: col("applied_at"),
      },
      patients: {
        __tag: "patients",
        id: col("id"),
        email: col("email"),
        phone: col("phone"),
        fullName: col("full_name"),
        dob: col("dob"),
        gender: col("gender"),
        pvsPatientId: col("pvs_patient_id"),
      },
    },
  };
});
vi.mock("@/server/jobs", () => ({ enqueuePvsStatusDerive: async () => {} }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { upsertPatientFromPvs } from "./pvs-linking";

const event = {
  kind: "PatientUpserted" as const,
  clinicId: "11111111-1111-1111-1111-111111111111",
  bridgeSource: "medatixx",
  pvsExternalEventId: "medatixx:patient:7:2026-05-01",
  occurredAt: "2026-05-01T10:00:00.000Z",
  pvsPatientId: "7",
  fullName: "Anna Alt",
  email: "alt@example.de",
  phone: "+49301111111",
};

describe("pass 2: stale PatientUpserted does not overwrite newer patient data", () => {
  beforeEach(() => {
    newerApplied = [];
    updates = [];
  });

  it("merges when no later upsert of this patient is applied", async () => {
    const r = await upsertPatientFromPvs(event as never);
    expect(r.portalPatientId).toBe("pat-1");
    expect(updates.filter((u) => u.table === "patients")).toHaveLength(1);
  });

  it("skips the merge when a later upsert of this patient is already applied, keeps the link", async () => {
    newerApplied = [{ id: "evt-newer" }];
    const r = await upsertPatientFromPvs(event as never);
    expect(r.portalPatientId).toBe("pat-1");
    expect(r.method).toBe("external_id");
    expect(updates.filter((u) => u.table === "patients")).toHaveLength(0);
  });
});

describe("pass 2 (verifier): the PVS id copy on patients never hits patients_pvs_id_unique", () => {
  beforeEach(() => {
    newerApplied = [];
    updates = [];
  });

  it("keeps the current pvs_patient_id when another patient of the clinic still holds it (manual re-link, merge)", async () => {
    await upsertPatientFromPvs(event as never);
    const vals = updates.find((u) => u.table === "patients")!.vals;
    // A plain string here is the old behaviour: UPDATE ... pvs_patient_id = X
    // failed with 23505 on every retry while the old patient still held X.
    expect(typeof vals.pvsPatientId).not.toBe("string");
    const q = new PgDialect().sqlToQuery(vals.pvsPatientId as SQL);
    expect(q.sql).toContain(
      "EXISTS (SELECT 1 FROM patients q WHERE q.clinic_id = patients.clinic_id AND q.id <> patients.id AND q.pvs_patient_id = "
    );
    expect(q.params).toContain("7");
  });
});
