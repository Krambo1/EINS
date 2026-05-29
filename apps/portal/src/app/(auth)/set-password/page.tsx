import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { readPasswordSetupCookie } from "@/auth/password-setup-cookie";
import { getSession } from "@/auth/session";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Passwort setzen" };
export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ mode?: string }>;
}

type Mode = "set_password" | "reset_password" | "invite";

const HEADINGS: Record<Mode, { title: string; subtitle: string }> = {
  set_password: {
    title: "Willkommen. Wählen Sie ein Passwort.",
    subtitle:
      "Ab jetzt loggen Sie sich mit E-Mail und Passwort ein. Nur einmal einrichten.",
  },
  reset_password: {
    title: "Neues Passwort wählen.",
    subtitle: "Vergessene Passwörter sind kein Drama. Hier weiterbewegen.",
  },
  invite: {
    title: "Konto einrichten.",
    subtitle:
      "Setzen Sie ein Passwort für künftige Anmeldungen. Dauert 10 Sekunden.",
  },
};

export default async function SetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Invite-Modus: User hat schon eine Session (klassischer Invite-Magic-Link),
  // und soll jetzt ein Passwort wählen, bevor er ins Dashboard kommt.
  if (params.mode === "invite") {
    const session = await getSession();
    if (!session) redirect("/login");
    const headings = HEADINGS.invite;
    return (
      <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 shadow-[var(--shadow-card-sm)]">
        <h1 className="text-2xl font-semibold">{headings.title}</h1>
        <p className="mt-2 text-base text-fg-secondary">{headings.subtitle}</p>
        <p className="mt-2 text-sm text-fg-secondary">
          Eingeloggt als{" "}
          <span className="font-mono text-fg-primary">{session.email}</span>.
        </p>
        <div className="mt-8">
          <SetPasswordForm mode="invite" />
        </div>
      </div>
    );
  }

  // Set-/Reset-Modus: Token wurde im /api/auth/callback bereits konsumiert
  // und durch eine httpOnly-Cookie (10 min TTL) ersetzt. Wir lesen sie und
  // resolven den User aus der DB, um die Mail im UI anzeigen zu können.
  const setup = await readPasswordSetupCookie("clinic");
  if (!setup) {
    redirect("/login?error=expired");
  }

  const [user] = await db
    .select({
      id: schema.clinicUsers.id,
      email: schema.clinicUsers.email,
      archivedAt: schema.clinicUsers.archivedAt,
    })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, setup.userId))
    .limit(1);

  if (!user || user.archivedAt) {
    redirect("/login?error=no_user");
  }

  const headings = HEADINGS[setup.intent];
  return (
    <div className="w-full rounded-2xl border border-border bg-bg-primary p-8 shadow-[var(--shadow-card-sm)]">
      <h1 className="text-2xl font-semibold">{headings.title}</h1>
      <p className="mt-2 text-base text-fg-secondary">{headings.subtitle}</p>
      <p className="mt-2 text-sm text-fg-secondary">
        Für{" "}
        <span className="font-mono text-fg-primary">{user.email}</span>.
      </p>
      <div className="mt-8">
        <SetPasswordForm mode={setup.intent} />
      </div>
    </div>
  );
}
