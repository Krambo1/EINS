"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { issueAdminMagicLink } from "@/auth/admin-magic-link";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";

const Schema = z.object({
  email: z.string().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
});

/**
 * Issue an admin magic-link. Behaviour is uniform regardless of whether the
 * submitted email is in the allowlist — `issueAdminMagicLink` silently
 * no-ops on unknown addresses, so enumeration can't leak the allowlist.
 * On any valid-looking input we redirect to /admin/login/sent; rate-limit
 * breaches also redirect (with a query flag) so that same response-shape
 * constraint holds.
 */
export async function requestAdminMagicLinkAction(formData: FormData): Promise<void> {
  const parsed = Schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    redirect("/admin/login?error=invalid_email");
  }
  const email = parsed.data.email.toLowerCase();

  const hdrs = await headers();
  const ip =
    (hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? "")
      .split(",")[0]
      ?.trim() || "unknown";

  const rl = await rateLimit("admin-login", email, { limit: 5, windowSeconds: 60 * 60 });
  const rlIp = await rateLimit("admin-login:ip", ip, { limit: 20, windowSeconds: 60 * 60 });
  if (!rl.ok || !rlIp.ok) {
    redirect("/admin/login?error=rate_limited");
  }

  await issueAdminMagicLink(email);
  await writeAudit({
    actorEmail: email,
    action: "magic_link_request",
    entityKind: "admin_login",
  });

  redirect(`/admin/login/sent`);
}
