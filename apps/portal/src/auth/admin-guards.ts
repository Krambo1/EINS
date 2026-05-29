import "server-only";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getAdminSession, type ResolvedAdmin } from "./admin";

/**
 * Guard for admin pages. Redirects to /admin/login if not signed in.
 */
export async function requireAdmin(): Promise<ResolvedAdmin> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

/**
 * Guard for `/api/admin/*` JSON routes. Same check as `requireAdmin` but
 * never redirects: instead returns a NextResponse the caller can short-
 * circuit with. Page-style `redirect()` on a JSON endpoint produces a
 * 307→/admin/login HTML body to a fetch() client, which has to be parsed as
 * JSON and explodes; 401 with a structured error is the right answer.
 *
 * Usage:
 *   const gate = await requireAdminForApi();
 *   if (!gate.ok) return gate.response;
 *   const admin = gate.admin;
 */
export type RequireAdminApiResult =
  | { ok: true; admin: ResolvedAdmin }
  | { ok: false; response: NextResponse };

export async function requireAdminForApi(): Promise<RequireAdminApiResult> {
  const session = await getAdminSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "not_authenticated" } },
        { status: 401 }
      ),
    };
  }
  return { ok: true, admin: session };
}
