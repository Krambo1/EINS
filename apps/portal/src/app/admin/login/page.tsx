import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { EinsLogo } from "@/app/_components/EinsLogo";
import { getAdminSession } from "@/auth/admin";
import { LoginForm } from "./_components/LoginForm";

export const metadata = { title: "Admin-Anmeldung" };

interface PageProps {
  searchParams: Promise<{ error?: string }>;
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
};

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const session = await getAdminSession();
  if (session) redirect("/admin");

  const params = await searchParams;
  const callbackError = params.error
    ? CALLBACK_ERROR_MESSAGES[params.error]
    : undefined;

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col items-center gap-3">
        <EinsLogo width={160} height={64} className="h-9 w-auto" />
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
          Admin
        </span>
      </div>
      <Card className="!bg-bg-secondary">
        <CardHeader>
          <CardTitle>Anmelden</CardTitle>
        </CardHeader>
        <CardContent>
          {callbackError && (
            <div className="mb-4 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
              {callbackError}
            </div>
          )}
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
