import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { hasGoogleLogin } from "@/lib/env";
import { defaultLandingPath } from "@/lib/roles";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Anmelden" };

interface LoginPageProps {
  searchParams: Promise<{ error?: string; sent?: string; reset?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid: "E-Mail oder Passwort stimmt nicht.",
  consumed: "Der Link wurde bereits verwendet. Bitte melden Sie sich neu an.",
  expired: "Der Link ist abgelaufen. Bitte fordern Sie einen neuen an.",
  no_user: "Kein Konto zu dieser Adresse gefunden.",
  missing_token: "Der Link enthielt kein Token.",
  session_expired:
    "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
  google_no_account:
    "Zu dieser Google-Adresse gibt es kein Konto. Bitte melden Sie sich mit Ihrer hinterlegten geschäftlichen E-Mail-Adresse an.",
  google_unverified:
    "Diese Google-Adresse ist nicht bestätigt. Bitte melden Sie sich per E-Mail an.",
  google_error:
    "Die Google-Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
  google_unavailable: "Die Google-Anmeldung ist derzeit nicht verfügbar.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getSession();
  if (session) {
    redirect(defaultLandingPath(session.role));
  }

  const params = await searchParams;
  const error = params.error ? ERROR_MESSAGES[params.error] : undefined;
  const sent = params.sent === "1";
  const reset = params.reset === "1";

  return (
    <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 shadow-[var(--shadow-card-sm)]">
      <h1 className="text-2xl font-semibold">Willkommen zurück.</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Melden Sie sich mit Ihrer geschäftlichen E-Mail-Adresse an.
      </p>
      {sent && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-tone-good/40 bg-tone-good/10 p-3 text-sm text-fg-primary"
        >
          Wenn die Adresse bei uns hinterlegt ist, haben wir Ihnen einen Link
          per E-Mail geschickt.
        </div>
      )}
      {reset && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-tone-good/40 bg-tone-good/10 p-3 text-sm text-fg-primary"
        >
          Passwort gesetzt. Bitte melden Sie sich jetzt an.
        </div>
      )}
      <div className="mt-8">
        <LoginForm initialError={error} googleEnabled={hasGoogleLogin()} />
      </div>
    </div>
  );
}
