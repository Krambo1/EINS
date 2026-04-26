import { Card, CardContent, CardHeader, CardTitle, Input, Label, Button } from "@eins/ui";
import { requestAdminMagicLinkAction } from "./actions";

export const metadata = { title: "Admin-Anmeldung" };

interface PageProps {
  searchParams: { error?: string };
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_email: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
  rate_limited: "Zu viele Anmelde-Versuche. Bitte einen Moment warten.",
  missing: "Der Link enthielt kein Token. Bitte fordern Sie einen neuen an.",
  invalid_or_expired:
    "Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordern Sie einen neuen an.",
};

export default function AdminLoginPage({ searchParams }: PageProps) {
  const error = searchParams.error
    ? ERROR_MESSAGES[searchParams.error]
    : undefined;

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col items-center gap-3">
        <img
          src="/eins-logo.svg"
          alt="EINS Visuals"
          width={160}
          height={64}
          className="h-9 w-auto"
        />
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
          Admin
        </span>
      </div>
      <Card className="card-glow !bg-bg-secondary/60 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Anmelden</CardTitle>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
              {error}
            </div>
          )}
          <form action={requestAdminMagicLinkAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-Mail</Label>
              <Input id="email" name="email" type="email" required autoFocus />
            </div>
            <Button type="submit" className="w-full">
              Anmeldelink senden
            </Button>
            <p className="text-xs text-fg-secondary">
              Nur in der Allowlist hinterlegte Admin-Adressen erhalten einen Link.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
