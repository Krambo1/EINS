import Link from "next/link";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata = { title: "Passwort vergessen" };

export default function ForgotPasswordPage() {
  return (
    <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 shadow-[var(--shadow-card-sm)]">
      <h1 className="text-2xl font-semibold">Passwort vergessen.</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Geben Sie Ihre E-Mail an. Wir schicken Ihnen einen Link, mit dem Sie
        ein neues Passwort wählen können.
      </p>
      <div className="mt-8">
        <ForgotPasswordForm />
      </div>
      <p className="mt-6 text-sm text-fg-secondary">
        <Link
          href="/login"
          className="underline-offset-2 hover:underline"
        >
          ← Zurück zur Anmeldung
        </Link>
      </p>
    </div>
  );
}
