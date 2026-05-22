import Fastify from "fastify";
import { TOMEDO_MOCK_PORT, banner, isMain } from "./shared.js";

/**
 * Mock Zollsoft Tomedo cloud REST API.
 *
 * Mirrors the surface that apps/bridge/src/adapters/tomedo/client.ts pokes:
 *   POST /oauth/token
 *   GET  /meta/health
 *   GET  /patients    ?modifiedSince=ISO&limit=N&offset=N
 *   GET  /appointments
 *   GET  /encounters
 *   GET  /invoices
 *   GET  /recalls
 *
 * Responses use the same JSON shape the normalize functions in
 * apps/bridge/src/adapters/tomedo/normalize.ts expect: id / patientId /
 * scheduledAt / modifiedAt / firstName / lastName / etc.
 *
 * Seed data is generated deterministically (no randomness) so re-runs hit
 * the same dedup keys.
 */

const SEED_PATIENTS = [
  {
    id: "p-101",
    firstName: "Lena",
    lastName: "Hoffmann",
    email: "lena.hoffmann@example.test",
    phone: "+49 30 5550101",
    dob: "1990-06-15",
    gender: "w",
    comment: "EINS-Lead-cafebabe — über Instagram-Anzeige",
    modifiedAt: "2026-05-10T10:00:00.000Z",
  },
  {
    id: "p-102",
    firstName: "Markus",
    lastName: "Schneider",
    email: "markus.schneider@example.test",
    phone: "+49 89 5550102",
    dob: "1978-11-03",
    gender: "m",
    comment: "Erstkontakt Hyaluron Stirn",
    modifiedAt: "2026-05-12T09:30:00.000Z",
  },
  {
    id: "p-103",
    firstName: "Sophia",
    lastName: "Becker",
    email: "sophia.becker@example.test",
    phone: "+49 40 5550103",
    dob: "1995-02-28",
    gender: "w",
    comment: "EINS-Lead-12345678",
    modifiedAt: "2026-05-15T14:15:00.000Z",
  },
] as const;

const SEED_APPOINTMENTS = [
  {
    id: "a-201",
    patientId: "p-101",
    scheduledAt: "2026-05-20T09:00:00.000Z",
    treatmentCode: "BTX-STIRN",
    treatmentName: "Botox Stirnpartie",
    locationId: "berlin-1",
    locationName: "Praxis Berlin Mitte",
    comment: "Erstberatung",
    status: "booked",
    modifiedAt: "2026-05-10T10:05:00.000Z",
  },
  {
    id: "a-202",
    patientId: "p-102",
    scheduledAt: "2026-05-22T15:30:00.000Z",
    treatmentCode: "HYAL-STIRN",
    treatmentName: "Hyaluron Stirnglättung",
    locationId: "muc-1",
    locationName: "Praxis München",
    comment: "Folgebehandlung",
    status: "booked",
    modifiedAt: "2026-05-12T09:35:00.000Z",
  },
  {
    id: "a-203",
    patientId: "p-103",
    scheduledAt: "2026-05-25T11:00:00.000Z",
    treatmentCode: "BTX-AUGEN",
    treatmentName: "Botox Augenpartie",
    locationId: "hh-1",
    locationName: "Praxis Hamburg",
    comment: "Wunsch: dezent",
    status: "booked",
    modifiedAt: "2026-05-15T14:20:00.000Z",
  },
] as const;

const SEED_ENCOUNTERS = [
  {
    id: "e-301",
    patientId: "p-101",
    appointmentId: "a-201",
    completedAt: "2026-05-20T09:45:00.000Z",
    treatmentCode: "BTX-STIRN",
    treatmentName: "Botox Stirnpartie",
    practitionerName: "Dr. Petra Müller",
    modifiedAt: "2026-05-20T09:50:00.000Z",
  },
] as const;

const SEED_INVOICES = [
  {
    id: "i-401",
    patientId: "p-101",
    appointmentId: "a-201",
    encounterId: "e-301",
    amountCents: 39000,
    paidAt: "2026-05-20T10:00:00.000Z",
    modifiedAt: "2026-05-20T10:05:00.000Z",
  },
] as const;

const SEED_RECALLS = [
  {
    id: "r-501",
    patientId: "p-101",
    recallAt: "2026-11-20T10:00:00.000Z",
    treatmentCode: "BTX-STIRN-FOLLOWUP",
    treatmentName: "Auffrischung Botox Stirnpartie",
    modifiedAt: "2026-05-20T10:10:00.000Z",
  },
] as const;

interface PaginatedResp<T> {
  items: T[];
  total: number;
}

function filtered<T extends { modifiedAt: string }>(
  rows: readonly T[],
  modifiedSince?: string
): T[] {
  if (!modifiedSince) return [...rows];
  return rows.filter((r) => r.modifiedAt > modifiedSince);
}

function page<T>(rows: T[], limit: number, offset: number): PaginatedResp<T> {
  const slice = rows.slice(offset, offset + limit);
  return { items: slice, total: rows.length };
}

export async function startTomedoMock(): Promise<{
  stop: () => Promise<void>;
}> {
  const app = Fastify({ logger: false });

  // The bridge's TomedoClient submits its OAuth request as
  // application/x-www-form-urlencoded — Fastify has no built-in parser for
  // that, so register one. We don't care about the body contents here
  // (the mock issues any token), we just need the route to not 415.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      const parsed: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(body as string)) parsed[k] = v;
      done(null, parsed);
    }
  );

  app.post("/oauth/token", async () => ({
    access_token: "mock-access-token-" + Date.now(),
    token_type: "Bearer",
    expires_in: 3600,
  }));

  app.get("/meta/health", async () => ({ status: "ok" }));

  type PageQuery = { modifiedSince?: string; limit?: string; offset?: string };

  const makeListHandler =
    <T extends { modifiedAt: string }>(rows: readonly T[]) =>
    async (
      request: { query: PageQuery },
      _reply: unknown
    ): Promise<PaginatedResp<T>> => {
      const limit = Number(request.query.limit ?? 500);
      const offset = Number(request.query.offset ?? 0);
      return page(filtered(rows, request.query.modifiedSince), limit, offset);
    };

  app.get("/patients", makeListHandler(SEED_PATIENTS));
  app.get("/appointments", makeListHandler(SEED_APPOINTMENTS));
  app.get("/encounters", makeListHandler(SEED_ENCOUNTERS));
  app.get("/invoices", makeListHandler(SEED_INVOICES));
  app.get("/recalls", makeListHandler(SEED_RECALLS));

  await app.listen({ port: TOMEDO_MOCK_PORT, host: "127.0.0.1" });
  return {
    async stop() {
      await app.close();
    },
  };
}

if (isMain(import.meta.url)) {
  banner("tomedo-mock");
  startTomedoMock()
    .then(() => {
      console.log(
        `Tomedo mock listening on http://127.0.0.1:${TOMEDO_MOCK_PORT}`
      );
      console.log(
        `Seed: ${SEED_PATIENTS.length} patients, ${SEED_APPOINTMENTS.length} appointments, ` +
          `${SEED_ENCOUNTERS.length} encounters, ${SEED_INVOICES.length} invoices, ` +
          `${SEED_RECALLS.length} recalls`
      );
    })
    .catch((err) => {
      console.error("[tomedo-mock] failed:", err);
      process.exit(1);
    });
}
