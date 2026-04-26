import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { MfaForm } from "./MfaForm";

export const metadata = { title: "Bestätigung" };

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mfaEnrolled) redirect("/login/enroll-mfa");
  if (session.mfaVerified) redirect("/dashboard");

  return (
    <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Zweite Bestätigung.</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Wir möchten kurz sicherstellen, dass Sie es sind.
      </p>
      <div className="mt-8">
        <MfaForm />
      </div>
    </div>
  );
}
