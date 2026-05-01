import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";

/**
 * Root page: bounce to the dashboard if authenticated (incl. MFA), otherwise
 * to /login. Keep this dumb — all permission logic lives deeper.
 */
export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mfaEnrolled) redirect("/login/enroll-mfa");
  if (!session.mfaVerified) redirect("/login/mfa");
  redirect("/dashboard");
}
