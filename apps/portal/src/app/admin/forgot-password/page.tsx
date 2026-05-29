import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@eins/ui";
import { EinsLogo } from "@/app/_components/EinsLogo";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Admin-Passwort vergessen" };

export default function AdminForgotPasswordPage() {
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
          <CardTitle>Passwort vergessen</CardTitle>
          <CardDescription>
            Wir schicken Ihnen einen Link, mit dem Sie ein neues Passwort
            wählen können.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
