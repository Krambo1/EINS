import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import {
  consumeMagicLink,
  consumeMagicLinkForPasswordSetup,
} from "@/auth/magic-link";
import { issuePasswordSetupCookie } from "@/auth/password-setup-cookie";
import { writeAudit } from "@/server/audit";
import { db, schema } from "@/db/client";
import { defaultLandingPath } from "@/lib/roles";
import type { Role } from "@/lib/constants";
import { isCrossSiteRequest } from "@/auth/request-origin";
import { getSession } from "@/auth/session";
import { sha256Hex } from "@/lib/crypto";

/** J-6: a second submit of the same login link within this window is a double tap. */
const DOUBLE_SUBMIT_WINDOW_MS = 2 * 60_000;

/**
 * J-6: the login link was just used and this browser already holds the
 * session it created (first of two taps on "Jetzt anmelden"). Returns the
 * landing path, or null when the "consumed" error is genuine.
 */
async function landingForDoubleSubmit(token: string): Promise<string | null> {
  const session = await getSession();
  if (!session || session.impersonatedByAdminId) return null;
  const [row] = await db
    .select({
      userId: schema.magicLinks.userId,
      intent: schema.magicLinks.intent,
      consumedAt: schema.magicLinks.consumedAt,
    })
    .from(schema.magicLinks)
    .where(eq(schema.magicLinks.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row || row.intent !== "login" || !row.consumedAt) return null;
  if (row.userId !== session.userId) return null;
  if (Date.now() - row.consumedAt.getTime() > DOUBLE_SUBMIT_WINDOW_MS) return null;
  return defaultLandingPath(session.role);
}

/**
 * Magic-link consumption endpoint.
 *
 *   GET  /api/auth/callback?token=…  → 303 to /login/link?token=… (read-only
 *        landing page with a button). NEVER consumes: Outlook Safe Links,
 *        Defender and other mail scanners prefetch links with GET, and used to
 *        burn login and invite links before the person clicked (B-1). Kept
 *        only so links mailed before this change keep working.
 *   POST /api/auth/callback (form field `token`, sent by the button on
 *        /login/link) → consumes the token, single-use, inside a transaction:
 *     - intent=login → mint session → role landing page
 *     - intent=invite / set_password / reset_password → no session yet; the
 *       userId goes into a 10-minute httpOnly cookie
 *       (`issuePasswordSetupCookie`) and the user lands on /set-password. An
 *       invited member therefore only gets a session once a password exists.
 *
 * On failure we 303 to /login with an error code (see (auth)/login/page.tsx).
 */
const SEE_OTHER = { status: 303 } as const;

function loginError(req: NextRequest, code: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/login?error=${code}`, req.nextUrl.origin),
    SEE_OTHER
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return loginError(req, "missing_token");
  const target = new URL("/login/link", req.nextUrl.origin);
  target.searchParams.set("token", token);
  const res = NextResponse.redirect(target, SEE_OTHER);
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Login-CSRF guard: the button lives on our own /login/link page, so a
  // cross-site form must not be able to log a victim into another account.
  if (isCrossSiteRequest(req.headers)) return loginError(req, "invalid");

  let token: string | null = null;
  try {
    const form = await req.formData();
    const raw = form.get("token");
    token = typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    token = null;
  }
  if (!token) return loginError(req, "missing_token");

  // Password setup (incl. invite) first — single atomic consume that also
  // validates intent. A login token yields "invalid" here and falls through.
  const pwd = await consumeMagicLinkForPasswordSetup(token);
  if (pwd.ok) {
    await issuePasswordSetupCookie(
      "clinic",
      pwd.userId,
      pwd.intent === "invite" ? "set_password" : pwd.intent
    );
    await writeAudit({
      clinicId: pwd.clinicId,
      actorId: pwd.userId,
      action: "magic_link_consume",
      entityKind: "login",
      diff: { intent: pwd.intent, stage: "callback" },
      impersonatedByAdminId: null,
    });
    return NextResponse.redirect(
      new URL("/set-password", req.nextUrl.origin),
      SEE_OTHER
    );
  }

  const result = await consumeMagicLink(token);
  if (!result.ok) {
    // A password-setup token that was already used reports "consumed" from
    // the first consumer and "invalid" from this one; prefer the more
    // specific reason so the login page can say "schon verwendet".
    const reason =
      pwd.reason !== "invalid" && result.reason === "invalid"
        ? pwd.reason
        : result.reason;
    if (reason === "consumed") {
      const landing = await landingForDoubleSubmit(token);
      if (landing) {
        return NextResponse.redirect(new URL(landing, req.nextUrl.origin), SEE_OTHER);
      }
    }
    return loginError(req, reason);
  }

  await writeAudit({
    clinicId: result.clinicId,
    actorId: result.userId,
    action: "login",
    entityKind: "login",
    diff: { method: "magic_link", intent: result.intent },
    impersonatedByAdminId: null,
  });

  // Role-aware landing: frontdesk (MFA/Sekretariat) → /anfragen, others →
  // /dashboard. Cheap extra read; this path only fires on magic-link login.
  const [{ role } = { role: null }] = await db
    .select({ role: schema.clinicUsers.role })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, result.userId))
    .limit(1);

  return NextResponse.redirect(
    new URL(defaultLandingPath(role as Role | null), req.nextUrl.origin),
    SEE_OTHER
  );
}
