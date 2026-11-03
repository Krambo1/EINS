import { redirect } from "next/navigation";
import { AuthShell } from "../_components/AuthShell";
import { AuthBody, AuthHeader, AuthValue } from "../_components/auth-ui";
import { readPasswordSetupCookie } from "@/auth/password-setup-cookie";
import { getSession } from "@/auth/session";
import { findActiveClinicUserById } from "@/auth/user-lookup";
import { defaultLandingPath } from "@/lib/roles";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Passwort setzen" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ mode?: string }>;
}

type Mode = "set_password" | "reset_password";

const TITLES: Record<Mode, string> = {
  set_password: "Passwort wählen",
  reset_password: "Neues Passwort wählen",
};

export default async function SetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Token wurde im POST /api/auth/callback bereits konsumiert und durch eine
  // httpOnly-Cookie (10 min TTL) ersetzt. Das gilt jetzt auch für
  // Einladungen (B-8): es gibt keine Session mehr, mit der man ohne Nachweis
  // ein Passwort setzen kann.
  const setup = await readPasswordSetupCookie("clinic");
  if (!setup) {
    // Alte Lesezeichen auf /set-password?mode=invite: wer schon angemeldet
    // ist, landet auf seiner Startseite statt auf einer Fehlermeldung.
    if (params.mode === "invite") {
      const session = await getSession();
      if (session) redirect(defaultLandingPath(session.role));
    }
    redirect("/login?error=expired");
  }

  // Aktiver User in aktiver Praxis (G-05).
  const user = await findActiveClinicUserById(setup.userId);
  if (!user) {
    redirect("/login?error=no_user");
  }

  return (
    <AuthShell>
      <AuthHeader title={TITLES[setup.intent]} />
      <AuthBody>
        <AuthValue label="E-Mail">{user.email}</AuthValue>
        <SetPasswordForm email={user.email} />
      </AuthBody>
    </AuthShell>
  );
}
