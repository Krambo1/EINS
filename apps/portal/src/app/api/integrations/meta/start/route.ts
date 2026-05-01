import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { env, hasMeta } from "@/lib/env";
import { signState, setStateCookie } from "@/server/oauth";
import { writeAudit } from "@/server/audit";

/**
 * Kick off Meta (Facebook/Instagram) OAuth. Inhaber-only.
 *
 * If Meta isn't configured in this environment, we bounce back to
 * /einstellungen with a friendly error so dev environments aren't broken.
 */
export async function GET(_request: NextRequest) {
  const session = await requireSession();
  if (!can(session.role, "settings.integrations")) {
    return NextResponse.redirect(new URL("/einstellungen?error=forbidden", env.APP_ORIGIN));
  }

  if (!hasMeta() || !env.META_REDIRECT_URI) {
    return NextResponse.redirect(
      new URL("/einstellungen?error=not_configured&platform=meta", env.APP_ORIGIN)
    );
  }

  const nonce = randomBytes(16).toString("hex");
  const state = await signState({
    clinicId: session.clinicId,
    userId: session.userId,
    platform: "meta",
    nonce,
  });
  await setStateCookie(state);

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    actorEmail: session.email,
    action: "oauth_start",
    entityKind: "platform_credential",
    diff: { platform: "meta" },
  });

  // Facebook Login dialog — we ask for ads_read + leads_retrieval + business_management.
  const authUrl = new URL(`https://www.facebook.com/${env.META_API_VERSION}/dialog/oauth`);
  authUrl.searchParams.set("client_id", env.META_APP_ID!);
  authUrl.searchParams.set("redirect_uri", env.META_REDIRECT_URI);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set(
    "scope",
    ["ads_read", "leads_retrieval", "business_management", "pages_show_list"].join(",")
  );
  authUrl.searchParams.set("response_type", "code");

  return NextResponse.redirect(authUrl);
}
