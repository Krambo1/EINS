import { redirect } from "next/navigation";
import { getAdminSession } from "@/auth/admin";
import { hasGoogleLogin } from "@/lib/env";
import { LoginForm } from "./_components/LoginForm";

export const metadata = { title: "Admin-Anmeldung" };

interface PageProps {
  searchParams: Promise<{ error?: string; password?: string }>;
}

/**
 * Nur Callback-Fehler werden hier aus dem ?error= query param gerendert.
 * Form-Submission-Fehler (invalid_input, invalid_credentials, rate_limited,
 * invalid_email) zeigt die LoginForm inline aus dem useActionState, weil
 * Server-Action-Redirects auf /admin/* unter admin.*-Subdomain-Rewrite den
 * Next.js #65893-Bug triggern (not-found.tsx bis Hard-Reload).
 */
const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  missing: "Der Link enthielt kein Token. Bitte fordern Sie einen neuen an.",
  invalid_or_expired:
    "Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordern Sie einen neuen an.",
  google_denied:
    "Diese Google-Adresse ist nicht für den Admin-Bereich freigeschaltet.",
  google_unverified:
    "Diese Google-Adresse ist nicht bestätigt. Bitte melden Sie sich per E-Mail an.",
  google_error:
    "Die Google-Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
  google_unavailable: "Die Google-Anmeldung ist derzeit nicht verfügbar.",
};

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const session = await getAdminSession();
  if (session) redirect("/admin");

  const params = await searchParams;
  // Own keys only: a crafted `?error=constructor` must not resolve to an
  // Object.prototype member (that crashed the page with a 500).
  const callbackError =
    typeof params.error === "string" &&
    Object.hasOwn(CALLBACK_ERROR_MESSAGES, params.error)
      ? CALLBACK_ERROR_MESSAGES[params.error]
      : undefined;

  // The frame (logo, "Admin" badge, card) comes from admin/layout.tsx.
  return (
    <LoginForm
      initialError={callbackError}
      initialNotice={
        params.password === "set"
          ? "Passwort gesetzt. Bitte melden Sie sich jetzt an."
          : undefined
      }
      googleEnabled={hasGoogleLogin()}
    />
  );
}
