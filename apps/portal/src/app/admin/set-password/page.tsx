import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { UserRound } from "lucide-react";
import { db, schema } from "@/db/client";
import { readPasswordSetupCookie } from "@/auth/password-setup-cookie";
import { AuthHeader } from "@/app/(auth)/_components/auth-ui";
import { SetAdminPasswordForm } from "./SetAdminPasswordForm";

export const metadata = { title: "Admin-Passwort setzen" };
export const dynamic = "force-dynamic";

export default async function AdminSetPasswordPage() {
  // Cookie wurde im /admin/login/callback gesetzt, nachdem der Magic-Link
  // atomar konsumiert wurde. Fehlt sie hier → Link abgelaufen oder direkter
  // Zugriff auf die Page. Page-Component-Redirect (kein Server-Action-Redirect)
  // funktioniert auch unter dem Next.js #65893-Bug.
  const setup = await readPasswordSetupCookie("admin");
  if (!setup) {
    redirect("/admin/login?error=invalid_or_expired");
  }

  const [adminRow] = await db
    .select({ email: schema.adminUsers.email })
    .from(schema.adminUsers)
    .where(eq(schema.adminUsers.id, setup.userId))
    .limit(1);

  if (!adminRow) {
    redirect("/admin/login?error=invalid_or_expired");
  }

  // The frame (logo, "Admin" badge, card) comes from admin/layout.tsx.
  return (
    <div>
      <AuthHeader title="Passwort setzen.">
        <p>Ab jetzt melden Sie sich mit E-Mail und Passwort an.</p>
        <p className="mt-4 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-white px-3 py-1 text-sm text-fg-primary">
          <UserRound aria-hidden className="h-4 w-4 shrink-0 text-fg-secondary" />
          <span className="truncate">{adminRow.email}</span>
        </p>
      </AuthHeader>
      <SetAdminPasswordForm email={adminRow.email} />
    </div>
  );
}
