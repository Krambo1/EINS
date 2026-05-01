import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getSession, type ResolvedSession } from "@/auth/session";
import { ForbiddenError, can, type Permission } from "@/lib/roles";
import { dbApp, withClinicContext } from "@/db/client";
import { writeAudit, type AuditInput } from "./audit";

/**
 * Route-handler composition helpers.
 *
 * All clinic-scoped API routes should go through `withApi()` (no DB context
 * needed) or `withApiTx()` (RLS-scoped transaction). Benefits:
 *   - uniform error -> HTTP status mapping
 *   - session resolution + permission gate in one place
 *   - automatic audit log write on success (optional)
 *   - guarantees dbApp queries inside run with app.current_clinic_id set
 *
 * We use 401 only when there is NO session at all; 403 when the session
 * exists but the permission fails or MFA isn't verified.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

export interface ApiContext {
  session: ResolvedSession;
  request: NextRequest;
}

export interface ApiOptions {
  permission?: Permission;
  /** Emit an audit log row on successful completion. */
  audit?: Omit<AuditInput, "clinicId" | "actorId" | "actorEmail">;
  /** Skip MFA check — used only by the MFA step-up endpoint itself. */
  allowMfaPending?: boolean;
  /**
   * Optional Cache-Control header to set on a successful response. Use only
   * for endpoints that return per-user-safe payloads — the helper enforces
   * `private` so the response never goes into a shared cache.
   */
  cacheControl?: string;
}

type Handler<T> = (ctx: ApiContext) => Promise<T>;

/**
 * Wrap a handler. Resolves session, enforces permission, runs the handler
 * OUTSIDE a transaction, maps errors, and writes an audit row on 2xx.
 */
export function withApi<T>(options: ApiOptions, handler: Handler<T>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const session = await getSession();
      if (!session) {
        return jsonError(401, "unauthorized", "Nicht angemeldet.");
      }
      if (!options.allowMfaPending && session.mfaEnrolled && !session.mfaVerified) {
        return jsonError(403, "mfa_required", "Zwei-Faktor-Bestätigung erforderlich.");
      }
      if (options.permission && !can(session.role, options.permission)) {
        return jsonError(403, "forbidden", "Zugriff verweigert.");
      }

      const result = await handler({ session, request });

      if (options.audit) {
        await writeAudit({
          ...options.audit,
          clinicId: session.clinicId,
          actorId: session.userId,
          actorEmail: session.email,
        });
      }

      const response = NextResponse.json(result);
      if (options.cacheControl) {
        // Force `private` so a shared cache (proxy / CDN) never stores it.
        const cc = options.cacheControl.includes("private")
          ? options.cacheControl
          : `private, ${options.cacheControl}`;
        response.headers.set("Cache-Control", cc);
      }
      return response;
    } catch (err) {
      return mapError(err);
    }
  };
}

/**
 * Variant that opens a clinic-scoped transaction (RLS enforced) and passes
 * the transaction to the handler. Use this for any endpoint that writes
 * clinic-scoped data.
 */
export function withApiTx<T>(
  options: ApiOptions,
  handler: (ctx: ApiContext & { tx: typeof dbApp }) => Promise<T>
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const session = await getSession();
      if (!session) {
        return jsonError(401, "unauthorized", "Nicht angemeldet.");
      }
      if (!options.allowMfaPending && session.mfaEnrolled && !session.mfaVerified) {
        return jsonError(403, "mfa_required", "Zwei-Faktor-Bestätigung erforderlich.");
      }
      if (options.permission && !can(session.role, options.permission)) {
        return jsonError(403, "forbidden", "Zugriff verweigert.");
      }

      const result = await withClinicContext(session.clinicId, session.userId, async (tx) => {
        return await handler({ session, request, tx });
      });

      if (options.audit) {
        await writeAudit({
          ...options.audit,
          clinicId: session.clinicId,
          actorId: session.userId,
          actorEmail: session.email,
        });
      }

      return NextResponse.json(result);
    } catch (err) {
      return mapError(err);
    }
  };
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function mapError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return jsonError(err.status, err.code, err.message);
  }
  if (err instanceof ForbiddenError) {
    return jsonError(403, "forbidden", err.message);
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          message: "Eingabe ist nicht gültig.",
          issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
        },
      },
      { status: 422 }
    );
  }
  console.error("[api] unhandled error:", err);
  return jsonError(500, "internal", "Interner Fehler.");
}
