import "server-only";
import { headers } from "next/headers";
import { db, schema } from "../db/client";
import { trustedIpFromHeaders } from "../lib/client-ip";
import { describeErrorForLog } from "../lib/error-log";

/**
 * Append-only audit log writer. Every mutating API/server-action SHOULD call
 * this. Failures are swallowed (logged) so an audit write never blocks a user.
 *
 * Entity kinds we actually use (loose string — no check constraint in schema):
 *   request, request_activity, asset, animation_instance, document,
 *   platform_credential, clinic_user, login, logout,
 *   mfa_enroll, mfa_verify, magic_link_request, settings, hwg_check,
 *   dsgvo_export, dsgvo_delete, admin_clinic.
 *
 * Action verbs: create, update, delete, view, login, logout, invite,
 * assign, transition, download, upload, deliver, approve, reject, export.
 */

export interface AuditInput {
  clinicId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityKind?: string;
  entityId?: string;
  diff?: Record<string, unknown>;
  /**
   * Optional pre-extracted request metadata. Pass this when the call site
   * already has `headers()` resolved (or has captured IP/UA from a
   * NextRequest) — lets the audit write run inside `after()` without
   * re-entering the request-scoped headers() API after the response has
   * been flushed.
   */
  requestMeta?: { ip?: string | null; ua?: string | null };
  /**
   * admin_users.id when the action runs inside an admin impersonation session
   * ("Als Benutzer öffnen"). Leave it undefined and writeAudit resolves it
   * from the current request's session, so every existing call site is
   * attributed without changes (B-24 / G-10). Pass it explicitly (or null)
   * when calling from `after()` / with `requestMeta`, where the request
   * cookies are no longer read.
   */
  impersonatedByAdminId?: string | null;
}

/**
 * Resolve the impersonating admin for this audit row. Explicit input wins;
 * with `requestMeta` (deferred / non-session callers) nothing is looked up;
 * otherwise the request's session decides. getSession() is React-cached, so
 * inside a page render or server action that already authenticated this is
 * free. Never throws: outside a request scope (worker) it yields null.
 */
export async function resolveImpersonatingAdminId(
  input: Pick<AuditInput, "impersonatedByAdminId" | "requestMeta">,
  lookup: () => Promise<{ impersonatedByAdminId: string | null } | null> = defaultSessionLookup
): Promise<string | null> {
  if (input.impersonatedByAdminId !== undefined) {
    return input.impersonatedByAdminId;
  }
  if (input.requestMeta) return null;
  try {
    const session = await lookup();
    return session?.impersonatedByAdminId ?? null;
  } catch {
    return null;
  }
}

async function defaultSessionLookup(): Promise<{
  impersonatedByAdminId: string | null;
} | null> {
  // Dynamic import keeps the auth/session graph out of worker processes that
  // only ever pass requestMeta / run outside a request.
  const { getSession } = await import("../auth/session");
  return await getSession();
}

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    let ip = input.requestMeta?.ip ?? null;
    let ua = input.requestMeta?.ua ?? null;
    if (!input.requestMeta) {
      const hdrs = await headers();
      ua = hdrs.get("user-agent") ?? null;
      ip = trustedIpFromHeaders(
        hdrs.get("x-forwarded-for"),
        hdrs.get("x-real-ip")
      );
    }

    const impersonatedByAdminId = await resolveImpersonatingAdminId(input);

    await db.insert(schema.auditLog).values({
      clinicId: input.clinicId ?? undefined,
      actorId: input.actorId ?? undefined,
      actorEmail: input.actorEmail ?? undefined,
      action: input.action,
      entityKind: input.entityKind,
      entityId: input.entityId,
      diff: input.diff ?? null,
      ipAddress: ip ?? undefined,
      userAgent: ua ?? undefined,
      impersonatedByAdminId: impersonatedByAdminId ?? undefined,
    });
  } catch (err) {
    // Don't bubble audit failures — the user-facing action has already succeeded.
    // L-8: a Postgres error `detail` can quote row values; log it scrubbed.
    console.error("[audit] write failed:", JSON.stringify(describeErrorForLog(err)));
  }
}
