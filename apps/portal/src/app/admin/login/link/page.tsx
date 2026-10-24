import Link from "next/link";
import { AuthHeader, authCtaClass } from "@/app/(auth)/_components/auth-ui";
import { LinkSubmitForm } from "@/app/(auth)/login/link/LinkSubmitForm";
import { peekAdminToken } from "@/auth/admin-magic-link";

/**
 * Landing page for admin mail links (Anmelde-Link, Passwort zurücksetzen).
 *
 * B-1: mail scanners open links with GET before the person does. This page
 * only LOOKS at the token (peekAdminToken, read-only) and shows a button: a
 * plain HTML form POST to /admin/login/callback (no auto-submit script),
 * which consumes the token, sent at most once (J-6, see LinkSubmitForm).
 * Auth page: no requireAdmin (see the B-27 test). The frame comes from
 * admin/layout.tsx.
 */

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Admin-Link bestätigen",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

const READY_COPY = {
  login: {
    title: "Anmelden.",
    text: "Klicken Sie auf „Jetzt anmelden“. Der Link gilt nur einmal.",
    button: "Jetzt anmelden",
  },
  password_reset: {
    title: "Neues Passwort wählen.",
    text: "Im nächsten Schritt wählen Sie Ihr neues Passwort.",
    button: "Weiter zum Passwort",
  },
} as const;

export default async function AdminLinkLandingPage({ searchParams }: PageProps) {
  const { token } = await searchParams;
  const peek = token
    ? await peekAdminToken(token)
    : ({ ok: false, reason: "invalid_or_expired" } as const);

  if (!peek.ok) {
    return (
      <div>
        <AuthHeader title="Link nicht mehr gültig.">
          Der Link ist abgelaufen oder wurde bereits verwendet. Bitte fordern
          Sie einen neuen an.
        </AuthHeader>
        <Link href="/admin/login" className={authCtaClass}>
          Zur Anmeldung
        </Link>
      </div>
    );
  }

  const copy = READY_COPY[peek.purpose];
  return (
    <div>
      <AuthHeader title={copy.title}>{copy.text}</AuthHeader>
      <LinkSubmitForm
        token={token ?? ""}
        label={copy.button}
        action="/admin/login/callback"
      />
    </div>
  );
}
