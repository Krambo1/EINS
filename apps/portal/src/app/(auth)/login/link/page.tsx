import Link from "next/link";
import {
  peekMagicLink,
  type MagicLinkIntent,
  type MagicLinkPeekResult,
} from "@/auth/magic-link";
import { AuthShell } from "../../_components/AuthShell";
import { AuthBody, AuthHeader, authPrimaryClass, authQuietClass } from "../../_components/auth-ui";
import { LinkSubmitForm } from "./LinkSubmitForm";

/**
 * Landing page for every emailed clinic link (Anmelde-Link, Einladung,
 * Passwort einrichten / zurücksetzen).
 *
 * B-1: mail scanners (Outlook Safe Links, Defender, gateway scanners) open
 * links with GET before the person does. This page therefore only LOOKS at
 * the token (peekMagicLink, read-only) and shows a button. The button is a
 * plain HTML form POST to /api/auth/callback (no auto-submit script), which
 * consumes the token. A scanner that renders the page burns nothing.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Link bestätigen",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

// Only the invitation keeps a sentence: "Zugang einrichten" does not say
// that a password comes next, the other buttons do.
const READY_COPY: Record<
  MagicLinkIntent,
  { title: string; text?: string; button: string }
> = {
  login: {
    title: "Anmelden",
    button: "Jetzt anmelden",
  },
  invite: {
    title: "Zugang einrichten",
    text: "Im nächsten Schritt wählen Sie Ihr Passwort.",
    button: "Zugang einrichten",
  },
  set_password: {
    title: "Passwort einrichten",
    button: "Weiter zum Passwort",
  },
  reset_password: {
    title: "Neues Passwort wählen",
    button: "Weiter zum Passwort",
  },
};

function problemCopy(
  reason: "invalid" | "expired" | "consumed" | "no_user",
  intent: MagicLinkIntent | undefined
): { title: string; text: string } {
  switch (reason) {
    case "expired":
      return intent === "invite"
        ? {
            title: "Die Einladung ist abgelaufen",
            text: "Fordern Sie über „Passwort vergessen“ einen neuen Link an oder bitten Sie Ihre Praxis, die Einladung erneut zu senden.",
          }
        : {
            title: "Der Link ist abgelaufen",
            text: "Aus Sicherheitsgründen gilt der Link nur kurz. Fordern Sie einfach einen neuen an.",
          };
    case "consumed":
      return {
        title: "Dieser Link wurde schon verwendet",
        text: "Jeder Link funktioniert nur einmal. Melden Sie sich an oder fordern Sie einen neuen Link an.",
      };
    case "no_user":
      return {
        title: "Kein aktiver Zugang",
        text: "Zu diesem Link gibt es keinen aktiven Zugang mehr. Bitte wenden Sie sich an Ihre Praxis oder an EINS.",
      };
    case "invalid":
    default:
      return {
        title: "Dieser Link ist ungültig",
        text: "Bitte öffnen Sie den Link direkt aus der E-Mail oder fordern Sie einen neuen an.",
      };
  }
}

export default async function MagicLinkLandingPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const peek: MagicLinkPeekResult = token
    ? await peekMagicLink(token)
    : { ok: false, reason: "invalid" };

  if (!peek.ok) {
    const copy = problemCopy(peek.reason, peek.intent);
    const wantsPassword =
      peek.intent === "invite" ||
      peek.intent === "set_password" ||
      peek.intent === "reset_password";
    return (
      <AuthShell>
        <AuthHeader title={copy.title}>{copy.text}</AuthHeader>
        {/* A sign-in link's new link is requested on /login itself, so
            "Zur Anmeldung" only shows when it leads somewhere else. */}
        {peek.reason !== "no_user" && (
          <AuthBody>
            <Link
              href={wantsPassword ? "/forgot-password" : "/login"}
              data-auth-primary
              className={authPrimaryClass}
            >
              Neuen Link anfordern
            </Link>
            {wantsPassword && (
              <Link href="/login" className={authQuietClass}>
                Zur Anmeldung
              </Link>
            )}
          </AuthBody>
        )}
      </AuthShell>
    );
  }

  const copy = READY_COPY[peek.intent] ?? READY_COPY.login;
  return (
    <AuthShell>
      <AuthHeader title={copy.title}>{copy.text}</AuthHeader>
      <AuthBody>
        <LinkSubmitForm token={token ?? ""} label={copy.button} />
      </AuthBody>
    </AuthShell>
  );
}
