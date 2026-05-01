import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Input,
  Label,
  Button,
} from "@eins/ui";
import { getAdminSession } from "@/auth/admin";
import { requireAdmin } from "@/auth/admin-guards";
import { adminEnrollmentOffer } from "@/auth/admin-totp";
import {
  finalizeAdminMfaEnrollAction,
  verifyAdminMfaAction,
} from "./actions";

export const metadata = { title: "Zwei-Faktor-Anmeldung" };

interface PageProps {
  searchParams: { error?: string };
}

/**
 * MFA gate. If the admin is not yet enrolled: show QR + secret + first code
 * field. If already enrolled: show a single 6-digit input for step-up
 * verification. The /admin/login/mfa route is only reachable once the
 * cookie session exists (magic link consumed).
 */
export default async function AdminMfaPage({ searchParams }: PageProps) {
  const session = await requireAdmin({ skipMfa: true });
  if (session.mfaEnrolled && session.mfaVerified) {
    redirect("/admin");
  }

  const isEnrollment = !session.mfaEnrolled;
  const offer = isEnrollment
    ? await adminEnrollmentOffer(session.email)
    : null;

  const errorMsg =
    searchParams.error === "invalid_code"
      ? "Der Code war nicht gültig. Bitte versuchen Sie es erneut."
      : null;

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
          <CardTitle>
            {isEnrollment
              ? "Zwei-Faktor einrichten"
              : "Zwei-Faktor bestätigen"}
          </CardTitle>
          <CardDescription>
            {isEnrollment
              ? "Scannen Sie den QR-Code mit einer Authenticator-App (z.B. 1Password, Authy) und geben Sie den angezeigten 6-stelligen Code ein."
              : "Geben Sie den aktuellen Code aus Ihrer Authenticator-App ein."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMsg && (
            <div className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
              {errorMsg}
            </div>
          )}

          {isEnrollment && offer ? (
            <form
              action={finalizeAdminMfaEnrollAction}
              className="space-y-4"
            >
              <div className="flex flex-col items-center gap-2">
                <img
                  src={offer.qrDataUrl}
                  alt="TOTP QR-Code"
                  className="h-48 w-48 rounded-md border border-border"
                />
                <code className="rounded bg-bg-secondary px-2 py-1 text-xs">
                  {offer.secret}
                </code>
                <p className="text-center text-xs text-fg-secondary">
                  Alternativ diesen Schlüssel manuell eingeben.
                </p>
              </div>

              <input type="hidden" name="secret" value={offer.secret} />
              <div>
                <Label htmlFor="code">6-stelliger Code</Label>
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full">
                Einrichtung abschließen
              </Button>
            </form>
          ) : (
            <form action={verifyAdminMfaAction} className="space-y-4">
              <div>
                <Label htmlFor="code">6-stelliger Code</Label>
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full">
                Anmelden
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
