import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { EinsLogo } from "@/app/_components/EinsLogo";
import { LoginForm } from "./_components/LoginForm";

export const metadata = { title: "Admin-Anmeldung" };

interface PageProps {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  rate_limited: "Zu viele Anmelde-Versuche. Bitte einen Moment warten.",
  missing: "Der Link enthielt kein Token. Bitte fordern Sie einen neuen an.",
  invalid_or_expired:
    "Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordern Sie einen neuen an.",
};

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const error = params.error ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col items-center gap-3">
        <EinsLogo width={160} height={64} className="h-9 w-auto" />
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
          Admin
        </span>
      </div>
      <Card className="!bg-bg-secondary/60">
        <CardHeader>
          <CardTitle>Anmelden</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
              {error}
            </div>
          )}
          <LoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
