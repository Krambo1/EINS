import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@eins/ui";
import { db, schema } from "@/db/client";
import { readPasswordSetupCookie } from "@/auth/password-setup-cookie";
import { EinsLogo } from "@/app/_components/EinsLogo";
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

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col items-center gap-3">
        <EinsLogo width={160} height={64} className="h-9 w-auto" />
        <span className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
          Admin
        </span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Passwort setzen</CardTitle>
          <CardDescription>
            Für {adminRow.email}. Ab jetzt loggen Sie sich mit E-Mail und
            Passwort ein.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetAdminPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
