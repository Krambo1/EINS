import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { safeNextPath } from "@/auth/safe-next";
import { hasGoogleLogin } from "@/lib/env";
import { defaultLandingPath } from "@/lib/roles";
import { Accent, AuthHeader, CheckInbox } from "../_components/auth-ui";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Anmelden" };

interface LoginPageProps {
  searchParams: Promise<{
    error?: string;
    sent?: string;
    reset?: string;
    next?: string;
  }>;
}

// `?error=` codes come from link and token flows only (callback, Google,
// impersonation, requireSession). Wrong passwords are reported inline by the
// form action, so none of these may say "Passwort stimmt nicht" (B-9).
const ERROR_MESSAGES: Record<string, string> = {
  invalid:
    "Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.",
  consumed:
    "Der Link wurde bereits verwendet. Jeder Link gilt nur einmal. Bitte melden Sie sich an oder fordern Sie einen neuen an.",
  expired: "Der Link ist abgelaufen. Bitte fordern Sie einen neuen an.",
  no_user:
    "Zu diesem Link gibt es keinen aktiven Zugang. Bitte wenden Sie sich an Ihre Praxis oder an EINS.",
  missing_token:
    "Der Link ist unvollständig. Bitte öffnen Sie ihn direkt aus der E-Mail.",
  session_expired:
    "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
  impersonation_missing_token:
    "Die Kundenansicht konnte nicht geöffnet werden. Bitte starten Sie sie im Admin-Bereich erneut.",
  impersonation_invalid:
    "Die Kundenansicht konnte nicht geöffnet werden. Bitte starten Sie sie im Admin-Bereich erneut.",
  impersonation_expired:
    "Der Link für die Kundenansicht ist abgelaufen. Bitte starten Sie die Kundenansicht im Admin-Bereich erneut.",
  impersonation_consumed:
    "Der Link für die Kundenansicht wurde schon verwendet. Bitte starten Sie die Kundenansicht im Admin-Bereich erneut.",
  impersonation_no_user:
    "Dieser Zugang oder diese Praxis ist nicht mehr aktiv.",
  google_no_account:
    "Zu dieser Google-Adresse gibt es kein Konto. Bitte melden Sie sich mit Ihrer hinterlegten geschäftlichen E-Mail-Adresse an.",
  google_unverified:
    "Diese Google-Adresse ist nicht bestätigt. Bitte melden Sie sich per E-Mail an.",
  google_error:
    "Die Google-Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
  google_unavailable: "Die Google-Anmeldung ist derzeit nicht verfügbar.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next);

  const session = await getSession();
  if (session) {
    redirect(next ?? defaultLandingPath(session.role));
  }

  // Own keys only: a crafted `?error=constructor` must not resolve to an
  // Object.prototype member (that crashed the page with a 500).
  const error =
    typeof params.error === "string" && Object.hasOwn(ERROR_MESSAGES, params.error)
      ? ERROR_MESSAGES[params.error]
      : undefined;
  const sent = params.sent === "1";
  const reset = params.reset === "1";

  // After a link request. Same screen for known and unknown addresses
  // (enumeration defence), and the address is deliberately not echoed: it is
  // not in the URL and must not be put there.
  if (sent) {
    return (
      <CheckInbox>
        Wenn die Adresse bei uns hinterlegt ist, haben wir Ihnen einen
        Anmeldelink geschickt. Er gilt 15 Minuten lang und nur einmal.
      </CheckInbox>
    );
  }

  return (
    <div>
      <AuthHeader
        title={
          <>
            Willkommen <Accent>zurück.</Accent>
          </>
        }
      >
        Melden Sie sich in Ihrem EINS Portal an.
      </AuthHeader>
      <LoginForm
        initialError={error}
        initialNotice={
          reset ? "Passwort gesetzt. Bitte melden Sie sich jetzt an." : undefined
        }
        googleEnabled={hasGoogleLogin()}
        next={next}
      />
    </div>
  );
}
