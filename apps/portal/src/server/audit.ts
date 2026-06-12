import "server-only";
import { headers } from "next/headers";
import { db, schema } from "../db/client";
import { trustedIpFromHeaders } from "../lib/client-ip";

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
    });
  } catch (err) {
    // Don't bubble audit failures — the user-facing action has already succeeded.
    console.error("[audit] write failed:", err);
  }
}
