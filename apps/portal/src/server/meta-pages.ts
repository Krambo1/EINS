import "server-only";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { decryptString, encryptString } from "@/lib/crypto";
import { env } from "@/lib/env";
import { describeErrorForLog } from "@/lib/error-log";

/**
 * Meta Pages — helpers for the user→page→leadgen path.
 *
 * The OAuth flow grants us a user access token; lead retrieval requires a
 * page access token. /me/accounts exchanges user-tokens for page-tokens for
 * every page the user admins. We bind exactly one page per clinic and never
 * guess (J-1): the page already bound to this clinic if the user still
 * admins it, else the only page; several pages or a page bound to another
 * clinic is an error. Webhook lookups then go directly: entry[].id →
 * platform_credentials.meta_page_id, which is UNIQUE (migration 0088).
 *
 * E6 (Karam 2026-10-08): with several pages the owner picks one on
 * /einstellungen/integrationen/meta-seite. The picker re-uses the user
 * token the OAuth callback already stored encrypted in
 * platform_credentials.access_token_enc (never a token from the browser),
 * re-reads /me/accounts on render and again on submit, and binds the chosen
 * id only if it is in that fresh list (selectChosenMetaPage), through the
 * same rules as the callback (bindMetaPage).
 *
 * When the user reconnects (token expiry, scope change) the OAuth callback
 * re-runs discoverAndStoreMetaPage to refresh the page token. Page tokens
 * issued from a long-lived user token are themselves long-lived.
 */

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
}

/** A page as the picker shows it. Never carries a token. */
export interface MetaPageSummary {
  id: string;
  name: string;
}

/** Error codes thrown by discoverAndStoreMetaPage (stored in last_sync_error). */
export const META_PAGE_ERRORS = {
  /** The Facebook user admins several pages and none is bound yet. */
  multiplePages: "meta_page_ambiguous_multiple_pages",
  /** The page is already bound to another Praxis. */
  boundElsewhere: "meta_page_bound_to_other_clinic",
  /** More than one Praxis is bound to the page a webhook names. */
  ambiguousBinding: "meta_page_bound_to_several_clinics",
  /** E6: the chosen page is not in the user's fresh /me/accounts list. */
  notAdministered: "meta_page_not_administered",
  /** E6: this Praxis has no Meta connection (row deleted meanwhile). */
  notConnected: "meta_not_connected",
  /** E6: the stored user token has expired or was revoked. */
  tokenExpired: "meta_user_token_expired",
  /**
   * E6b: the page is bound, but subscribing the app to its `leadgen` field
   * failed (Meta sends no lead webhooks for it). Never thrown by the bind;
   * only stored as a German hint in last_sync_error.
   */
  leadgenSubscribeFailed: "meta_leadgen_subscribe_failed",
} as const;

/**
 * Permissions the Meta OAuth start requests (api/integrations/meta/start):
 *  - ads_read, business_management: ad accounts and insights (sync-meta);
 *  - pages_show_list: /me/accounts, the page list and page tokens;
 *  - leads_retrieval: reading a lead with the page token (leadgen webhook);
 *  - pages_manage_metadata (E6b): POST/DELETE /{page-id}/subscribed_apps,
 *    the leadgen subscription. A Praxis connected before E6b lacks it and
 *    must reconnect Meta once.
 */
export const META_OAUTH_SCOPES = [
  "ads_read",
  "leads_retrieval",
  "business_management",
  "pages_show_list",
  "pages_manage_metadata",
] as const;

/** Facebook page ids are numeric strings. A form value must match first. */
export const META_PAGE_ID_PATTERN = /^\d{1,32}$/;

const GRAPH_ORIGIN = "https://graph.facebook.com";
/** /me/accounts is paged; 10 requests of 100 cover any real Praxis. */
const MAX_ACCOUNT_REQUESTS = 10;

/**
 * Local visual check only (E6): with META_PAGES_FIXTURE=1 and NODE_ENV not
 * "production", /me/accounts is not called and these fake pages come back
 * (ids start with zeros; no real page has them). Every Next build runs with
 * NODE_ENV=production, so deployed portals ignore the flag.
 */
export const META_PAGES_FIXTURE: readonly MetaPage[] = [
  { id: "0000000000000001", name: "Praxis Dr. Demo (Testseite)", access_token: "fixture-page-token-1" },
  { id: "0000000000000002", name: "Dr. Demo Ästhetik Zweitseite (Testseite)", access_token: "fixture-page-token-2" },
  { id: "0000000000000003", name: "Privates Profil-Projekt (Testseite)", access_token: "fixture-page-token-3" },
];

function metaPagesFixture(): MetaPage[] | null {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.META_PAGES_FIXTURE !== "1") return null;
  return META_PAGES_FIXTURE.map((p) => ({ ...p }));
}

/**
 * Follow Graph's paging link only back to graph.facebook.com over https:
 * the user token rides in the Authorization header and must never be sent
 * to another host.
 */
export function safeGraphNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  try {
    const u = new URL(next);
    return u.origin === GRAPH_ORIGIN ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Raw /me/accounts entries, all pages followed. Token in the Authorization
 * header, never in the URL (E-16, as sync-meta): URLs end up in logs and
 * error messages. Graph error 190 (token invalid / expired / revoked)
 * becomes META_PAGE_ERRORS.tokenExpired; other failures carry only the
 * HTTP status.
 */
async function fetchAccounts(
  userAccessToken: string,
  fields: "id,name" | "id,name,access_token"
): Promise<unknown[]> {
  const fixture = metaPagesFixture();
  if (fixture) return fixture;

  const out: unknown[] = [];
  let next: string | null =
    `${GRAPH_ORIGIN}/${env.META_API_VERSION}/me/accounts?fields=${fields}&limit=100`;
  for (let i = 0; next && i < MAX_ACCOUNT_REQUESTS; i++) {
    const res: Response = await fetch(next, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${userAccessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: unknown };
      } | null;
      if (body?.error?.code === 190) {
        throw new Error(META_PAGE_ERRORS.tokenExpired);
      }
      throw new Error(`meta /me/accounts http ${res.status}`);
    }
    const body = (await res.json()) as { data?: unknown; paging?: { next?: unknown } };
    if (Array.isArray(body.data)) out.push(...body.data);
    next = safeGraphNext(body.paging?.next);
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Well-formed entries only, first occurrence of each id. A page listed
 * without a page token stays in the list (access_token "") so that it still
 * counts for J-1's "only page" rule; bindMetaPage refuses to bind it.
 */
function parsePages(raw: unknown[], withTokens: true): MetaPage[];
function parsePages(raw: unknown[], withTokens: false): MetaPageSummary[];
function parsePages(raw: unknown[], withTokens: boolean): MetaPageSummary[] | MetaPage[] {
  const seen = new Set<string>();
  const out: MetaPage[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    if (!id || !META_PAGE_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    const name = (str(o.name) ?? "").slice(0, 200);
    out.push({ id, name, access_token: str(o.access_token) ?? "" });
  }
  return withTokens ? out : out.map(({ id, name }) => ({ id, name }));
}

/** Pages the Facebook user admins, with page tokens (server side only). */
export async function fetchMetaPages(userAccessToken: string): Promise<MetaPage[]> {
  return parsePages(await fetchAccounts(userAccessToken, "id,name,access_token"), true);
}

/** Pages the Facebook user admins, names only: what the picker renders. */
export async function fetchMetaPageSummaries(
  userAccessToken: string
): Promise<MetaPageSummary[]> {
  return parsePages(await fetchAccounts(userAccessToken, "id,name"), false);
}

/**
 * E6b: a failed /{page-id}/subscribed_apps call. Carries only the HTTP
 * status and Meta's numeric error code (e.g. 190 token, 200/10 missing
 * permission), never Meta's message or a token.
 */
export class MetaSubscriptionError extends Error {
  constructor(
    readonly status: number,
    readonly graphCode: number | null
  ) {
    super(`meta subscribed_apps http ${status}`);
    this.name = "MetaSubscriptionError";
  }
}

async function subscribedAppsCall(
  method: "POST" | "DELETE",
  pageId: string,
  pageAccessToken: string
): Promise<void> {
  if (!META_PAGE_ID_PATTERN.test(pageId)) throw new MetaSubscriptionError(0, null);
  // Local visual check (META_PAGES_FIXTURE): fake pages, nothing to call.
  if (metaPagesFixture()) return;
  const res = await fetch(
    `${GRAPH_ORIGIN}/${env.META_API_VERSION}/${pageId}/subscribed_apps`,
    {
      method,
      cache: "no-store",
      // Page token in the header, never in the URL (E-16).
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        ...(method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      body: method === "POST" ? "subscribed_fields=leadgen" : undefined,
      signal: AbortSignal.timeout(15_000),
    }
  );
  const body = (await res.json().catch(() => null)) as {
    success?: unknown;
    error?: { code?: unknown };
  } | null;
  if (!res.ok || body?.success !== true) {
    const code = body?.error?.code;
    throw new MetaSubscriptionError(res.status, typeof code === "number" ? code : null);
  }
}

/**
 * E6b: subscribe this app to the page's `leadgen` field so Meta sends the
 * lead webhooks (Graph: POST /{page-id}/subscribed_apps, page token,
 * permission pages_manage_metadata). Idempotent: repeating it for a page
 * that is already subscribed succeeds again.
 */
export async function subscribePageToLeadgen(
  pageId: string,
  pageAccessToken: string
): Promise<void> {
  await subscribedAppsCall("POST", pageId, pageAccessToken);
}

/** E6b: remove this app's subscription from a page (DELETE, page token). */
export async function unsubscribePageFromApp(
  pageId: string,
  pageAccessToken: string
): Promise<void> {
  await subscribedAppsCall("DELETE", pageId, pageAccessToken);
}

function graphCodeOf(err: unknown): number | null {
  return err instanceof MetaSubscriptionError ? err.graphCode : null;
}

/**
 * Pick the page to bind (J-1). Pure, for tests:
 *  - the page this clinic is already bound to, if the user still admins it
 *    (reconnect refreshes its token);
 *  - else the only page;
 *  - else an error: several pages need an explicit choice.
 */
export function chooseMetaPage(
  pages: MetaPage[],
  currentPageId: string | null
): MetaPage | null {
  if (pages.length === 0) return null;
  if (currentPageId) {
    const same = pages.find((p) => p.id === currentPageId);
    if (same) return same;
  }
  if (pages.length === 1) return pages[0]!;
  throw new Error(META_PAGE_ERRORS.multiplePages);
}

/**
 * E6: the page the owner picked must be in the FRESH /me/accounts list.
 * The form's page id is never trusted beyond being looked up here; the
 * page token always comes from the fresh list. Pure, for tests.
 */
export function selectChosenMetaPage<T extends MetaPageSummary>(
  pages: T[],
  chosenId: string
): T {
  if (!META_PAGE_ID_PATTERN.test(chosenId)) {
    throw new Error(META_PAGE_ERRORS.notAdministered);
  }
  const page = pages.find((p) => p.id === chosenId);
  if (!page) throw new Error(META_PAGE_ERRORS.notAdministered);
  return page;
}

/**
 * The DB access page binding needs. Injectable so tests can run the real
 * rules against an in-memory store that mirrors the UNIQUE index of 0088.
 * Every method is scoped to the clinic passed in (from the session or the
 * signed OAuth state, never from a form).
 */
export interface MetaBindingStore {
  /**
   * This Praxis's Meta row: encrypted user token, expiry, bound page and
   * its encrypted page token (E6b: needed to unsubscribe a page it leaves).
   */
  connection(clinicId: string): Promise<{
    accessTokenEnc: Buffer;
    expiresAt: Date | null;
    pageId: string | null;
    pageTokenEnc: Buffer | null;
  } | null>;
  /** The subset of pageIds that another Praxis is bound to. */
  boundToOtherClinic(clinicId: string, pageIds: string[]): Promise<Set<string>>;
  /**
   * Bind the page on this Praxis's Meta row (page token already
   * encrypted). Returns false when the row does not exist. Throws the
   * driver's unique violation (23505) when another Praxis holds the page.
   */
  writeBinding(clinicId: string, pageId: string, pageTokenEnc: Buffer): Promise<boolean>;
  /** E6b: store a German, token-free hint in this Praxis's last_sync_error. */
  setSyncError(clinicId: string, text: string): Promise<void>;
}

/**
 * Texts that last_sync_error holds only because of the page binding
 * (metaPageErrorText, incl. the J-1 wording before E6). A successful
 * binding clears exactly these; a real sync error stays visible.
 */
const PAGE_BINDING_ERROR_TEXTS: string[] = [
  "Ihr Facebook-Konto verwaltet mehrere Seiten. Bitte melden Sie sich bei EINS, wir verbinden die richtige Seite.",
];

/** The SQL store; `handle` is `db` or a transaction (opt-in DB test). */
export function makeDbMetaBindingStore(handle: typeof db): MetaBindingStore {
  return {
    async connection(clinicId) {
      const [row] = await handle
        .select({
          accessTokenEnc: schema.platformCredentials.accessTokenEnc,
          expiresAt: schema.platformCredentials.expiresAt,
          pageId: schema.platformCredentials.metaPageId,
          pageTokenEnc: schema.platformCredentials.metaPageAccessTokenEnc,
        })
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.clinicId, clinicId),
            eq(schema.platformCredentials.platform, "meta")
          )
        )
        .limit(1);
      return row ?? null;
    },

    async boundToOtherClinic(clinicId, pageIds) {
      if (pageIds.length === 0) return new Set();
      const rows = await handle
        .select({ pageId: schema.platformCredentials.metaPageId })
        .from(schema.platformCredentials)
        .where(
          and(
            eq(schema.platformCredentials.platform, "meta"),
            inArray(schema.platformCredentials.metaPageId, pageIds),
            ne(schema.platformCredentials.clinicId, clinicId)
          )
        );
      return new Set(rows.flatMap((r) => (r.pageId ? [r.pageId] : [])));
    },

    async writeBinding(clinicId, pageId, pageTokenEnc) {
      const col = schema.platformCredentials.lastSyncError;
      const rows = await handle
        .update(schema.platformCredentials)
        .set({
          metaPageId: pageId,
          metaPageAccessTokenEnc: pageTokenEnc,
          lastSyncError: sql`CASE WHEN ${inArray(col, pageBindingErrorTexts())} THEN NULL ELSE ${col} END`,
        })
        .where(
          and(
            eq(schema.platformCredentials.clinicId, clinicId),
            eq(schema.platformCredentials.platform, "meta")
          )
        )
        .returning({ id: schema.platformCredentials.id });
      return rows.length > 0;
    },

    async setSyncError(clinicId, text) {
      await handle
        .update(schema.platformCredentials)
        .set({ lastSyncError: text })
        .where(
          and(
            eq(schema.platformCredentials.clinicId, clinicId),
            eq(schema.platformCredentials.platform, "meta")
          )
        );
    },
  };
}

export const dbMetaBindingStore: MetaBindingStore = makeDbMetaBindingStore(db);

function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    if ((cur as { code?: unknown }).code === "23505") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

function decryptOrNull(enc: Buffer | null): string | null {
  if (!enc) return null;
  try {
    return decryptString(enc);
  } catch {
    return null;
  }
}

/**
 * E6b, best effort: a page no Praxis is bound to any more should not keep
 * sending lead webhooks to EINS. Unsubscribes only when no Praxis other
 * than `clinicId` holds the page (call it after `clinicId` has left it).
 * Failures are logged (clinic id + Graph error code only) and swallowed.
 * Exported for the "Trennen" path (see FX-DECISIONS E6b).
 */
export async function releaseMetaPageSubscription(
  store: MetaBindingStore,
  clinicId: string,
  pageId: string,
  pageAccessToken: string | null
): Promise<void> {
  if (!pageAccessToken) return;
  try {
    const held = await store.boundToOtherClinic(clinicId, [pageId]);
    if (held.has(pageId)) return;
    await unsubscribePageFromApp(pageId, pageAccessToken);
  } catch (err) {
    console.warn(
      "[meta-pages] leadgen unsubscribe failed:",
      JSON.stringify({ clinicId, graphCode: graphCodeOf(err) })
    );
  }
}

/**
 * "Trennen" in Einstellungen (E6b): the clinic's Meta row is already
 * deleted; unsubscribe its page unless another Praxis still holds it. Same
 * best-effort rules as releaseMetaPageSubscription.
 */
export async function releaseDisconnectedMetaPage(
  clinicId: string,
  pageId: string | null,
  pageTokenEnc: Buffer | null,
  store: MetaBindingStore = dbMetaBindingStore
): Promise<void> {
  if (!pageId) return;
  await releaseMetaPageSubscription(store, clinicId, pageId, decryptOrNull(pageTokenEnc));
}

export interface MetaBindResult {
  /** The page this Praxis was bound to before (null: none). */
  previousPageId: string | null;
  /** E6b: false when Meta refused the leadgen subscription (hint stored). */
  leadgenSubscribed: boolean;
}

/**
 * Bind `page` to the clinic's Meta row (J-1 rules, shared by the OAuth
 * callback and the E6 picker): refuse a page another Praxis is bound to,
 * never take it over; store the page token AES-GCM encrypted. Re-binding
 * to another page releases the old one; the UNIQUE index keeps every page
 * on at most one Praxis even under a race (23505 -> boundElsewhere).
 *
 * E6b, after the binding is written: subscribe the app to the page's
 * `leadgen` field (idempotent). A failed subscription keeps the binding and
 * stores META_PAGE_ERRORS.leadgenSubscribeFailed as a German hint. When the
 * Praxis switched from page A, A is unsubscribed if no Praxis holds it any
 * more, with A's token from `freshPages` (/me/accounts) or else the stored
 * one.
 */
export async function bindMetaPage(
  store: MetaBindingStore,
  clinicId: string,
  page: MetaPage,
  freshPages: MetaPage[] = []
): Promise<MetaBindResult> {
  // Listed without a page token: the Facebook user lacks the rights on
  // that page, leads could never be read with it.
  if (!page.access_token) throw new Error(META_PAGE_ERRORS.notAdministered);
  const before = await store.connection(clinicId);
  if (!before) throw new Error(META_PAGE_ERRORS.notConnected);
  const elsewhere = await store.boundToOtherClinic(clinicId, [page.id]);
  if (elsewhere.has(page.id)) throw new Error(META_PAGE_ERRORS.boundElsewhere);
  let written: boolean;
  try {
    written = await store.writeBinding(clinicId, page.id, encryptString(page.access_token));
  } catch (err) {
    // Race with another clinic binding the same page: the unique index
    // (0088) refuses the second binding.
    if (isUniqueViolation(err)) throw new Error(META_PAGE_ERRORS.boundElsewhere);
    throw err;
  }
  if (!written) throw new Error(META_PAGE_ERRORS.notConnected);

  let leadgenSubscribed = true;
  try {
    await subscribePageToLeadgen(page.id, page.access_token);
  } catch (err) {
    leadgenSubscribed = false;
    console.warn(
      "[meta-pages] leadgen subscribe failed:",
      JSON.stringify({ clinicId, graphCode: graphCodeOf(err) })
    );
    try {
      await store.setSyncError(
        clinicId,
        metaPageErrorText(new Error(META_PAGE_ERRORS.leadgenSubscribeFailed))
      );
    } catch {
      console.warn("[meta-pages] storing the leadgen hint failed:", JSON.stringify({ clinicId }));
    }
  }

  const previousPageId = before.pageId;
  if (previousPageId && previousPageId !== page.id) {
    const token =
      freshPages.find((p) => p.id === previousPageId && p.access_token)?.access_token ??
      decryptOrNull(before.pageTokenEnc);
    await releaseMetaPageSubscription(store, clinicId, previousPageId, token);
  }
  return { previousPageId, leadgenSubscribed };
}

/**
 * Pull the user's pages from /me/accounts and bind one to the clinic's meta
 * credentials (see chooseMetaPage). Safe to call repeatedly. Never takes
 * over a page that another Praxis is bound to.
 *
 * Returns the discovered page (for audit logging, no token) and whether the
 * leadgen subscription worked (E6b), or null if the user doesn't admin any
 * pages (will happen when the user picked "personal profile" during OAuth;
 * we treat that as success-with-no-pages so the caller can surface a clear
 * message rather than a generic error).
 */
export async function discoverAndStoreMetaPage(
  clinicId: string,
  userAccessToken: string,
  store: MetaBindingStore = dbMetaBindingStore
): Promise<{ page: MetaPageSummary; leadgenSubscribed: boolean } | null> {
  const pages = await fetchMetaPages(userAccessToken);
  const current = await store.connection(clinicId);
  const page = chooseMetaPage(pages, current?.pageId ?? null);
  if (!page) return null;
  const { leadgenSubscribed } = await bindMetaPage(store, clinicId, page, pages);
  return { page: { id: page.id, name: page.name }, leadgenSubscribed };
}

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= Date.now();
}

/** What the E6 picker page renders. No token is part of it. */
export type MetaPagePickerData =
  | { status: "not_connected" }
  | { status: "token_expired" }
  | { status: "fetch_failed" }
  | {
      status: "ok";
      /** Bound page id, also when this Facebook user no longer admins it. */
      currentPageId: string | null;
      pages: Array<MetaPageSummary & { current: boolean; boundElsewhere: boolean }>;
    };

/**
 * E6 picker, render side: decrypt the stored user token, read the page
 * names from /me/accounts (no page tokens requested) and mark the bound
 * page and pages another Praxis holds (the action refuses those anyway).
 */
export async function loadMetaPagePicker(
  clinicId: string,
  store: MetaBindingStore = dbMetaBindingStore
): Promise<MetaPagePickerData> {
  const conn = await store.connection(clinicId);
  if (!conn) return { status: "not_connected" };
  if (isExpired(conn.expiresAt)) return { status: "token_expired" };
  let pages: MetaPageSummary[];
  try {
    pages = await fetchMetaPageSummaries(decryptString(conn.accessTokenEnc));
  } catch (err) {
    if (err instanceof Error && err.message === META_PAGE_ERRORS.tokenExpired) {
      return { status: "token_expired" };
    }
    console.warn("[meta-pages] picker /me/accounts failed:", JSON.stringify(describeErrorForLog(err)));
    return { status: "fetch_failed" };
  }
  const elsewhere = await store.boundToOtherClinic(
    clinicId,
    pages.map((p) => p.id)
  );
  return {
    status: "ok",
    currentPageId: conn.pageId,
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      current: p.id === conn.pageId,
      boundElsewhere: elsewhere.has(p.id),
    })),
  };
}

/**
 * E6 picker, submit side. `chosenId` is the only input from the form; the
 * clinic comes from the session. Re-reads /me/accounts with the stored
 * user token, requires the chosen id in that fresh list and binds it with
 * the page token from that list (bindMetaPage). Returns no token.
 */
export async function chooseAndStoreMetaPage(
  clinicId: string,
  chosenId: string,
  store: MetaBindingStore = dbMetaBindingStore
): Promise<{ page: MetaPageSummary } & MetaBindResult> {
  if (!META_PAGE_ID_PATTERN.test(chosenId)) {
    throw new Error(META_PAGE_ERRORS.notAdministered);
  }
  const conn = await store.connection(clinicId);
  if (!conn) throw new Error(META_PAGE_ERRORS.notConnected);
  if (isExpired(conn.expiresAt)) throw new Error(META_PAGE_ERRORS.tokenExpired);
  const pages = await fetchMetaPages(decryptString(conn.accessTokenEnc));
  const page = selectChosenMetaPage(pages, chosenId);
  const result = await bindMetaPage(store, clinicId, page, pages);
  return { page: { id: page.id, name: page.name }, ...result };
}

/**
 * Look up the credentials for the clinic that owns this Facebook page id.
 * Returns null if no clinic is bound to the page (legitimate Meta retry on
 * an old or unbound page — fail open with a logged warning at the caller).
 * Throws META_PAGE_ERRORS.ambiguousBinding when more than one clinic is
 * bound (legacy rows from before the unique index): a patient inquiry must
 * never land at a guessed Praxis (J-1).
 */
export async function findCredentialByMetaPageId(
  pageId: string
): Promise<{
  clinicId: string;
  pageAccessToken: string;
} | null> {
  const rows = await db
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
    .limit(2);
  if (rows.length > 1) throw new Error(META_PAGE_ERRORS.ambiguousBinding);
  const row = rows[0];
  if (!row || !row.enc) return null;
  return {
    clinicId: row.clinicId,
    pageAccessToken: decryptString(row.enc),
  };
}

/**
 * J-1: the Praxis sees last_sync_error on the Werbebudget page, so the error
 * codes from discoverAndStoreMetaPage become sentences for the Praxis. The
 * technical detail stays in the server log.
 */
export function metaPageErrorText(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  if (code === META_PAGE_ERRORS.multiplePages) {
    return "Ihr Facebook-Konto verwaltet mehrere Seiten. Bitte wählen Sie unter Einstellungen bei den Werbekonten die Facebook-Seite Ihrer Praxis.";
  }
  if (code === META_PAGE_ERRORS.boundElsewhere) {
    return "Diese Facebook-Seite ist bereits mit einer anderen Praxis verbunden. Bitte melden Sie sich bei EINS.";
  }
  if (code === META_PAGE_ERRORS.leadgenSubscribeFailed) {
    return "Die Facebook-Seite ist verbunden, aber Meta schickt noch keine Anfragen an Ihr Portal. Bitte verbinden Sie Meta erneut und bestätigen Sie dabei alle Berechtigungen. Hilft das nicht, melden Sie sich bei EINS.";
  }
  return "Die Facebook-Seite konnte nicht verbunden werden. Bitte verbinden Sie Meta erneut oder melden Sie sich bei EINS.";
}

/** See PAGE_BINDING_ERROR_TEXTS: every text the binding itself may leave. */
function pageBindingErrorTexts(): string[] {
  return [
    ...PAGE_BINDING_ERROR_TEXTS,
    metaPageErrorText(new Error(META_PAGE_ERRORS.multiplePages)),
    metaPageErrorText(new Error(META_PAGE_ERRORS.boundElsewhere)),
    metaPageErrorText(new Error(META_PAGE_ERRORS.leadgenSubscribeFailed)),
    metaPageErrorText(new Error("other")),
  ];
}

/** E6: German result text for the picker's server action. */
export function metaPageChoiceErrorText(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err);
  switch (code) {
    case META_PAGE_ERRORS.boundElsewhere:
      return "Diese Facebook-Seite ist bereits mit einer anderen Praxis verbunden. Bitte wählen Sie eine andere Seite oder melden Sie sich bei EINS.";
    case META_PAGE_ERRORS.notAdministered:
      // Not in the fresh list, or listed without a page token (the
      // Facebook user lacks the needed rights on that page).
      return "Diese Seite können Sie mit Ihrem Facebook-Konto nicht verbinden. Entweder ist sie dort nicht mehr zu finden, oder Ihnen fehlen auf der Seite die nötigen Rechte. Bitte laden Sie die Seite neu und wählen Sie erneut.";
    case META_PAGE_ERRORS.notConnected:
      return "Meta ist nicht mehr verbunden. Bitte verbinden Sie Meta in den Einstellungen erneut.";
    case META_PAGE_ERRORS.tokenExpired:
      return "Die Verbindung zu Facebook ist abgelaufen. Bitte verbinden Sie Meta erneut, danach können Sie die Seite wählen.";
    default:
      return "Die Seite konnte gerade nicht verbunden werden. Bitte versuchen Sie es in ein paar Minuten erneut.";
  }
}
