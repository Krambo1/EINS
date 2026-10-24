/**
 * LOCAL ONLY (E6 visual check): give a Praxis a fake Meta connection so the
 * page picker /einstellungen/integrationen/meta-seite can be looked at
 * without a real Meta app. Pair it with META_PAGES_FIXTURE=1 in .env.local
 * (dev server only; production builds ignore the flag): /me/accounts is then
 * not called and three fake pages (ids 0000000000000001-3) come back.
 *
 *   pnpm --filter portal exec tsx scripts/dev-meta-pages-fixture.ts
 *       [--clinic <uuid>]        Praxis to connect (default: demo Praxis)
 *       [--fremd <uuid>]         also bind fake page 3 to this other Praxis
 *                                (shows "Mit einer anderen Praxis verbunden")
 *       [--entfernen]            undo: restore the seed row / remove the row
 *
 * Refuses unless DATABASE_URL points at localhost and NODE_ENV is not
 * production. Never touches a real connection: it only changes rows that do
 * not exist yet, the seed's placeholder row ("DEMO_TOKEN_NOT_REAL") or its
 * own fake rows. --entfernen puts the seed placeholder back (row with an
 * account id, as the seed writes it) or deletes a row it created.
 */

// MUST be first: neutralizes the `server-only` throw (see shim file).
import "../src/worker/shim-server-only";
import "../src/lib/load-env";

import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/db/client";
import { decryptString, encryptString } from "../src/lib/crypto";
import {
  META_PAGES_FIXTURE,
  META_PAGE_ERRORS,
  metaPageErrorText,
} from "../src/server/meta-pages";

const DEMO_CLINIC_ID = "c7d88b71-72da-4920-b939-5158b13d3449";
const FAKE_USER_TOKEN = "fixture-user-token";
/** What src/db/seed.ts stores as access_token_enc (never decrypted in dev). */
const SEED_PLACEHOLDER = Buffer.from("DEMO_TOKEN_NOT_REAL", "utf8");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pc = schema.platformCredentials;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function isFake(enc: Buffer): boolean {
  try {
    return decryptString(enc) === FAKE_USER_TOKEN;
  } catch {
    return false;
  }
}

function isSeedPlaceholder(enc: Buffer): boolean {
  return Buffer.from(enc).equals(SEED_PLACEHOLDER);
}

async function metaRow(clinicId: string) {
  const [row] = await db
    .select({ id: pc.id, enc: pc.accessTokenEnc, accountId: pc.accountId })
    .from(pc)
    .where(and(eq(pc.clinicId, clinicId), eq(pc.platform, "meta")))
    .limit(1);
  return row ?? null;
}

async function connect(clinicId: string, pageId: string | null) {
  const page = pageId ? META_PAGES_FIXTURE.find((p) => p.id === pageId)! : null;
  const values = {
    accessTokenEnc: encryptString(FAKE_USER_TOKEN),
    expiresAt: new Date(Date.now() + 60 * 86_400_000),
    metaPageId: page?.id ?? null,
    metaPageAccessTokenEnc: page ? encryptString(page.access_token) : null,
    lastSyncError: page ? null : metaPageErrorText(new Error(META_PAGE_ERRORS.multiplePages)),
  };
  const existing = await metaRow(clinicId);
  if (!existing) {
    await db.insert(pc).values({ clinicId, platform: "meta", ...values });
    return;
  }
  if (!isFake(existing.enc) && !isSeedPlaceholder(existing.enc)) {
    throw new Error(`Praxis ${clinicId} hat eine echte Meta-Verbindung, Abbruch.`);
  }
  await db.update(pc).set(values).where(eq(pc.id, existing.id));
}

async function undo(clinicId: string) {
  const row = await metaRow(clinicId);
  if (!row || !isFake(row.enc)) return;
  if (row.accountId) {
    // Seed row: back to the placeholder state the seed writes.
    await db
      .update(pc)
      .set({
        accessTokenEnc: SEED_PLACEHOLDER,
        expiresAt: null,
        metaPageId: null,
        metaPageAccessTokenEnc: null,
        lastSyncError: null,
      })
      .where(eq(pc.id, row.id));
    console.log(`Praxis ${clinicId}: Seed-Zeile wiederhergestellt.`);
  } else {
    await db.delete(pc).where(eq(pc.id, row.id));
    console.log(`Praxis ${clinicId}: Testverbindung entfernt.`);
  }
}

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "postgres://invalid").hostname;
  if (
    process.env.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
  ) {
    console.error("Nur lokal: DATABASE_URL muss auf localhost zeigen, NODE_ENV nicht production. Abbruch.");
    process.exit(2);
  }
  const clinicId = arg("--clinic") ?? DEMO_CLINIC_ID;
  const fremd = arg("--fremd");
  for (const id of [clinicId, fremd]) {
    if (id && !UUID.test(id)) {
      console.error(`Keine gültige Praxis-ID: ${id}`);
      process.exit(2);
    }
  }
  if (fremd && fremd === clinicId) {
    console.error("--fremd muss eine andere Praxis sein.");
    process.exit(2);
  }

  if (process.argv.includes("--entfernen")) {
    for (const id of [clinicId, fremd]) if (id) await undo(id);
    process.exit(0);
  }

  await connect(clinicId, null);
  console.log(`Praxis ${clinicId}: Meta-Testverbindung ohne Seite.`);
  if (fremd) {
    await connect(fremd, META_PAGES_FIXTURE[2]!.id);
    console.log(`Praxis ${fremd}: Testseite ${META_PAGES_FIXTURE[2]!.id} gebunden.`);
  }
  console.log(
    "Dann META_PAGES_FIXTURE=1 in .env.local, Dev-Server (neu) starten, /einstellungen/integrationen/meta-seite öffnen."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
