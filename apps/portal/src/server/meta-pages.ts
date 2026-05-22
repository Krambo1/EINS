import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { decryptString, encryptString } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * Meta Pages — helpers for the user→page→leadgen path.
 *
 * The OAuth flow grants us a user access token; lead retrieval requires a
 * page access token. /me/accounts exchanges user-tokens for page-tokens for
 * every page the user admins. We pick the first page (V1: clinics have one)
 * and persist {pageId, pageAccessTokenEnc} on platform_credentials. Webhook
 * lookups then go directly: entry[].id → platform_credentials.meta_page_id.
 *
 * When the user reconnects (token expiry, scope change) the OAuth callback
 * re-runs discoverAndStoreMetaPage to refresh the page token. Page tokens
 * issued from a long-lived user token are themselves long-lived.
 */

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
}

/**
 * Pull the user's pages from /me/accounts and persist the first one onto
 * the clinic's meta credentials. Safe to call repeatedly — overwrites the
 * existing page binding.
 *
 * Returns the discovered page (for audit logging) or null if the user
 * doesn't admin any pages (will happen when the user picked "personal
 * profile" during OAuth — we treat that as success-with-no-pages so the
 * caller can surface a clear message rather than a generic error).
 */
export async function discoverAndStoreMetaPage(
  clinicId: string,
  userAccessToken: string
): Promise<MetaPage | null> {
  const url = new URL(
    `https://graph.facebook.com/${env.META_API_VERSION}/me/accounts`
  );
  url.searchParams.set("fields", "id,name,access_token");
  url.searchParams.set("access_token", userAccessToken);

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`meta /me/accounts http ${res.status}`);
  }
  const body = (await res.json()) as { data?: MetaPage[] };
  const page = body.data?.[0];
  if (!page) return null;

  await db
    .update(schema.platformCredentials)
    .set({
      metaPageId: page.id,
      metaPageAccessTokenEnc: encryptString(page.access_token),
    })
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinicId),
        eq(schema.platformCredentials.platform, "meta")
      )
    );

  return page;
}

/**
 * Look up the credentials for the clinic that owns this Facebook page id.
 * Returns null if no clinic is bound to the page (legitimate Meta retry on
 * an old or unbound page — fail open with a logged warning at the caller).
 */
export async function findCredentialByMetaPageId(
  pageId: string
): Promise<{
  clinicId: string;
  pageAccessToken: string;
} | null> {
  const [row] = await db
    .select({
      clinicId: schema.platformCredentials.clinicId,
      enc: schema.platformCredentials.metaPageAccessTokenEnc,
    })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.platform, "meta"),
        eq(schema.platformCredentials.metaPageId, pageId)
      )
    )
    .limit(1);
  if (!row || !row.enc) return null;
  return {
    clinicId: row.clinicId,
    pageAccessToken: decryptString(row.enc),
  };
}
