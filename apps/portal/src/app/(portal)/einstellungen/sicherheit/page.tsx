import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "@eins/ui";
import { eq } from "drizzle-orm";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatRelative } from "@/lib/formatting";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { logoutAllDevicesAction } from "./actions";

export const metadata = { title: "Sicherheit" };
export const dynamic = "force-dynamic";

export default async function SicherheitPage() {
  const session = await requireSession();

  const [user] = await db
    .select({
      passwordSetAt: schema.clinicUsers.passwordSetAt,
    })
    .from(schema.clinicUsers)
    .where(eq(schema.clinicUsers.id, session.userId))
    .limit(1);

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Sicherheit.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Passwort und aktive Sitzungen.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Passwort</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {user?.passwordSetAt && (
            <p className="text-sm text-fg-secondary">
              Zuletzt geändert {formatRelative(user.passwordSetAt)}.
            </p>
          )}
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auf allen Geräten abmelden</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-secondary">
            Beendet alle aktiven Sitzungen. Beim nächsten Login müssen Sie
            sich wieder anmelden; auf diesem Browser werden Sie sofort
            ausgeloggt.
          </p>
          <form action={logoutAllDevicesAction}>
            <Button variant="outline" type="submit">
              Überall abmelden
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
