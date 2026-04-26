import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Anmelden" };

export default async function LoginPage() {
  // If already signed in (but not past MFA), bounce along the flow.
  const session = await getSession();
  if (session) {
    if (!session.mfaEnrolled) redirect("/login/enroll-mfa");
    if (!session.mfaVerified) redirect("/login/mfa");
    redirect("/dashboard");
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Willkommen zurück.</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Melden Sie sich mit Ihrer geschäftlichen E-Mail-Adresse an.
      </p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </div>
  );
}
