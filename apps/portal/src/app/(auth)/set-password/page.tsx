import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { AuthHeader } from "../_components/auth-ui";
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

const HEADINGS: Record<Mode, { title: string; subtitle: string }> = {
  set_password: {
    title: "Wählen Sie Ihr Passwort.",
    subtitle:
      "Ab jetzt melden Sie sich mit E-Mail und Passwort an. Sie richten es nur einmal ein.",
  },
  reset_password: {
    title: "Neues Passwort wählen.",
    subtitle:
      "Wählen Sie ein neues Passwort für Ihr Konto. Danach sind Sie direkt angemeldet.",
  },
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

  const headings = HEADINGS[setup.intent];
  return (
    <div>
      <AuthHeader title={headings.title}>
        <p>{headings.subtitle}</p>
        <p className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-sm text-fg-primary">
          <UserRound aria-hidden className="h-4 w-4 shrink-0 text-fg-secondary" />
          <span className="truncate">{user.email}</span>
        </p>
      </AuthHeader>
      <SetPasswordForm mode={setup.intent} email={user.email} />
    </div>
  );
}
