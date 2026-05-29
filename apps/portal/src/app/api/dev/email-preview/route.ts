import "server-only";
import { NextResponse } from "next/server";
import { renderEmailLayout, escapeHtml } from "@/server/email";
import { env } from "@/lib/env";

/**
 * Dev-only email previewer. Visit
 *   /api/dev/email-preview?intent=reset_password
 * to inspect the rendered HTML of any sendMagicLinkEmail variant in the
 * browser. Intentionally not gated by auth so any dev / designer can poke
 * at the layout without first burning a magic-link round trip.
 *
 * Hard-locked off in production — same idea as a Storybook page, just
 * lighter weight than wiring email Storybook stories for a single-file
 * template.
 *
 * Query params (all optional):
 *   intent          = login | invite | set_password | reset_password (default: reset_password)
 *   name            = recipient full name (default: "Dr. Jan Berger")
 *   email           = audit-grid Konto value     (default: "j.berger@praxis-berger.de")
 *   clinic          = clinic name for invite     (default: "Praxis Berger")
 */
export const dynamic = "force-dynamic";

type Intent = "login" | "invite" | "set_password" | "reset_password";

export async function GET(request: Request) {
  if (env.NODE_ENV === "production") {
    return new NextResponse("Not available in production.", { status: 404 });
  }

  const url = new URL(request.url);
  const intentParam = (url.searchParams.get("intent") ?? "reset_password") as Intent;
  const allowed: Intent[] = ["login", "invite", "set_password", "reset_password"];
  const intent: Intent = allowed.includes(intentParam) ? intentParam : "reset_password";
  const name = url.searchParams.get("name") ?? "Dr. Jan Berger";
  const email = url.searchParams.get("email") ?? "j.berger@praxis-berger.de";
  const clinic = url.searchParams.get("clinic") ?? "Praxis Berger";

  // Mirror the copy table from sendMagicLinkEmail. Kept inline here so the
  // preview stays self-contained and we don't need to export the copy switch
  // from the production path.
  const copyByIntent: Record<Intent, { heading: string; intro: string; ctaLabel: string; reassurance: string }> = {
    invite: {
      heading: `Willkommen im EINS Portal für ${clinic}`,
      intro:
        "Klicken Sie auf den Button, um Ihren Zugang einzurichten und ein Passwort festzulegen.",
      ctaLabel: "Zugang einrichten",
      reassurance:
        "Sie kennen diese Einladung nicht? Ignorieren Sie diese E-Mail einfach. Es passiert nichts weiter.",
    },
    set_password: {
      heading: "Richten Sie Ihr Passwort ein",
      intro:
        "Ab jetzt loggen Sie sich mit E-Mail und Passwort ein. Klicken Sie auf den Button, um ein Passwort festzulegen.",
      ctaLabel: "Passwort festlegen",
      reassurance:
        "Sie haben kein Passwort angefordert? Ignorieren Sie diese E-Mail. Ihr Konto bleibt unverändert.",
    },
    reset_password: {
      heading: "Setzen Sie ein neues Passwort",
      intro:
        "Klicken Sie auf den Button, um ein neues Passwort für Ihr EINS-Konto zu vergeben.",
      ctaLabel: "Neues Passwort wählen",
      reassurance:
        "Sie haben kein neues Passwort angefordert? Ignorieren Sie diese E-Mail. Ihr aktuelles Passwort bleibt unverändert.",
    },
    login: {
      heading: "Melden Sie sich beim EINS Portal an",
      intro: "Klicken Sie auf den Button, um sich ohne Passwort anzumelden.",
      ctaLabel: "Jetzt anmelden",
      reassurance:
        "Sie haben sich nicht beim EINS Portal angemeldet? Ignorieren Sie diese E-Mail. Es passiert nichts weiter.",
    },
  };
  const copy = copyByIntent[intent];

  const fakeUrl = `${env.APP_ORIGIN}/api/auth/callback?token=fSlDJOI_5ioW4ElRercgsQNPHS9EwKAqs-OXjqDjDCA`;
  // The invite path doesn't carry a personalized salutation (no name on the
  // recipient yet), matching the production logic.
  const salutation = intent !== "invite" && name.trim() ? `Guten Tag, ${name.trim()}. ` : "";
  const introText = `${salutation}${copy.intro}`;

  const html = renderEmailLayout({
    preheader: `${introText} Der Link ist 15 Minuten gültig.`,
    heading: copy.heading,
    introHtml: `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 28px 0; letter-spacing:0.012em;">${escapeHtml(introText)}</p>`,
    cta: { label: copy.ctaLabel, url: fakeUrl },
    metaItems: [
      { icon: "clock", text: "Link 15 Minuten gültig" },
      { icon: "shield", text: "Nur einmal verwendbar" },
    ],
    auditRows: [
      { label: "Angefordert", value: "27.05.2026, 21:19" },
      { label: "Konto", value: email },
    ],
    fallbackUrl: fakeUrl,
    reassuranceHtml: `<p style="font-size:13px; line-height:1.55; color:#6a6a74; margin:0; letter-spacing:0.012em;">${escapeHtml(copy.reassurance)}</p>`,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
