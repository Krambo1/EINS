/**
 * Tomedo adapter driver.
 *
 * Boots the Tomedo mock, then re-implements the Tomedo client's OAuth +
 * paginate dance against it (mirroring apps/bridge/src/adapters/tomedo/
 * client.ts) and runs each Tomedo record through the bridge's real
 * normalize functions (apps/bridge/src/adapters/tomedo/normalize.ts).
 *
 * The actual TomedoClient class needs a PvsLinkRow from the DB, which the
 * harness doesn't stand up, so we exercise the same code paths inline. The
 * normalize functions are imported directly from the bridge source so the
 * harness fails if their wire shape drifts.
 */
import {
  normalizePatient,
  normalizeAppointment,
  normalizeEncounter,
  normalizeInvoice,
  normalizeRecall,
} from "../../src/adapters/tomedo/normalize.js";
import { startTomedoMock } from "./tomedo-mock.js";
import { startStubPortal } from "./stub-portal.js";
import {
  STUB_PORTAL_URL,
  TEST_CLINIC_ID,
  TOMEDO_MOCK_URL,
  signBody,
  banner,
  isMain,
  summarise,
} from "./shared.js";

const PORTAL = process.env.PORTAL_BASE_URL?.replace(/\/$/, "") ?? STUB_PORTAL_URL;

interface PaginatedResp<T> {
  items: T[];
  total?: number;
}

async function getToken(): Promise<string> {
  const res = await fetch(`${TOMEDO_MOCK_URL}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: "test-client",
      client_secret: "test-secret",
    }),
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function fetchPage<T>(
  token: string,
  path: string,
  modifiedSince = "1970-01-01T00:00:00.000Z",
  offset = 0,
  limit = 500
): Promise<PaginatedResp<T>> {
  const url =
    `${TOMEDO_MOCK_URL}${path}` +
    `?modifiedSince=${encodeURIComponent(modifiedSince)}&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return (await res.json()) as PaginatedResp<T>;
}

async function postEvent(event: unknown): Promise<boolean> {
  const raw = JSON.stringify(event);
  const sig = signBody(raw);
  const res = await fetch(`${PORTAL}/api/pvs/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": sig,
    },
    body: raw,
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`  ✗ POST ${res.status} ${body.slice(0, 200)}`);
  }
  return res.ok;
}

export async function runTomedoDriver(opts: {
  needsStubPortal: boolean;
}): Promise<{ posted: number; failed: number }> {
  banner("tomedo driver");
  const stubPortal = opts.needsStubPortal ? await startStubPortal() : null;
  const tomedoMock = await startTomedoMock();
  console.log(
    `Tomedo mock at ${TOMEDO_MOCK_URL}, portal at ${PORTAL}, clinic ${TEST_CLINIC_ID}`
  );

  let posted = 0;
  let failed = 0;
  try {
    const token = await getToken();
    console.log(`OAuth: got token ${token.slice(0, 16)}…`);

    const ops: Array<{
      path: string;
      normalize: (clinicId: string, row: unknown) => unknown;
    }> = [
      { path: "/patients", normalize: normalizePatient },
      { path: "/appointments", normalize: normalizeAppointment },
      { path: "/encounters", normalize: normalizeEncounter },
      { path: "/invoices", normalize: normalizeInvoice },
      { path: "/recalls", normalize: normalizeRecall },
    ];

    for (const op of ops) {
      const data = await fetchPage<Record<string, unknown>>(token, op.path);
      console.log(`  fetched ${op.path}: ${data.items.length} rows`);
      for (const row of data.items) {
        const event = op.normalize(TEST_CLINIC_ID, row) as {
          kind: string;
          [k: string]: unknown;
        };
        const ok = await postEvent(event);
        if (ok) {
          posted += 1;
          console.log(`    → ${summarise(event)}`);
        } else {
          failed += 1;
        }
      }
    }
  } finally {
    await tomedoMock.stop();
    if (stubPortal) await stubPortal.stop();
  }

  console.log(`Done. posted=${posted} failed=${failed}`);
  return { posted, failed };
}

if (isMain(import.meta.url)) {
  // Standalone mode: spin up our own stub portal too unless caller pointed
  // PORTAL_BASE_URL at a real portal.
  const needsStubPortal = !process.env.PORTAL_BASE_URL;
  runTomedoDriver({ needsStubPortal })
    .then(({ failed }) => process.exit(failed === 0 ? 0 : 1))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
