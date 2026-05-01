import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { enrollmentOffer } from "@/auth/totp";
import { EnrollForm } from "./EnrollForm";

export const metadata = { title: "2FA einrichten" };
export const dynamic = "force-dynamic"; // generate a fresh secret every visit

export default async function EnrollMfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaEnrolled) redirect("/login/mfa");

  // IMPORTANT: we generate a NEW offer on every render but it's not committed
  // to the DB until the user submits a valid code. If they abandon the page,
  // nothing is stored.
  const offer = await enrollmentOffer(session.email);

  return (
    <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 shadow-sm">
      <h1 className="text-2xl font-semibold">Einmal einrichten, danach nie wieder.</h1>
      <p className="mt-2 text-base text-fg-secondary">
        Wir sichern Ihr Konto mit einem zweiten Faktor. Dauert ca. 2 Minuten.
      </p>
      <div className="mt-8">
        <EnrollForm secret={offer.secret} qrDataUrl={offer.qrDataUrl} />
      </div>
    </div>
  );
}
