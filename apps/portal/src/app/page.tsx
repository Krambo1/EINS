import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { defaultLandingPath } from "@/lib/roles";

/**
 * Root page: bounce to the role's default landing if authenticated, otherwise
 * to /login. Frontdesk (MFA/Sekretariat) lands on /anfragen; Inhaber and
 * Marketing on /dashboard. Keep this dumb — all permission logic lives deeper.
 */
export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  redirect(defaultLandingPath(session.role));
}
