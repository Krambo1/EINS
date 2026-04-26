"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { issueMagicLink } from "@/auth/magic-link";
import { rateLimit } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";

const LoginSchema = z.object({
  email: z.string().email("Bitte geben Sie eine gültige E-Mail-Adresse ein."),
});

export type LoginActionState =
  | { ok: false; error: string }
  | { ok: true }
  | undefined;

/**
 * Server action: validate email, rate-limit, issue magic link, redirect.
 *
 * We respond with a generic "inbox" redirect regardless of whether the email
 * matches an existing user. Prevents account enumeration.
 */
export async function requestMagicLinkAction(
  _prev: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = LoginSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." };
  }
  const email = parsed.data.email.toLowerCase();

  // Rate limits: per-email AND per-IP to blunt both targeted and broad abuse.
  const hdrs = await headers();
  const ip =
    (hdrs.get("x-forwarded-for") ?? hdrs.get("x-real-ip") ?? "")
      .split(",")[0]
      ?.trim() || "unknown";

  const perEmail = await rateLimit("login:email", email, {
    limit: 5,
    windowSeconds: 60 * 60,
  });
  const perIp = await rateLimit("login:ip", ip, {
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!perEmail.ok || !perIp.ok) {
    return {
      ok: false,
      error:
        "Zu viele Anmelde-Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
    };
  }

  await issueMagicLink({ email, intent: "login" });
  await writeAudit({
    actorEmail: email,
    action: "magic_link_request",
    entityKind: "login",
    diff: { email },
  });

  redirect(`/login/sent?email=${encodeURIComponent(email)}`);
}
