import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Label,
} from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import { eraseClinicDataAction } from "./actions";

export const metadata = { title: "DSGVO" };

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * DSGVO-Werkzeuge für eine einzelne Praxis. Export wird als Datei per GET
 * ausgeliefert (siehe /api/admin/clinics/[id]/dsgvo/export). Erasure ist
 * nur per Formular und expliziter Slug-Bestätigung möglich.
 */
export default async function ClinicDsgvoPage({ params }: PageProps) {
  await requireAdmin();
  const { id } = await params;

  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, id))
    .limit(1);
  if (!clinic) notFound();

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <div className="text-xs text-fg-secondary">
          <Link
            href={`/admin/clinics/${clinic.id}`}
            className="hover:text-accent"
          >
            {clinic.displayName}
          </Link>
          <span className="mx-1">/</span>
          <span className="font-mono">DSGVO</span>
        </div>
        <h1 className="text-3xl font-semibold md:text-4xl">DSGVO-Werkzeuge</h1>
        <p className="text-lg text-fg-primary">
          Auskunft (Art. 15) und Löschung (Art. 17). Beide Aktionen werden im
          Audit-Log protokolliert.
        </p>
      </header>

      {/* ----- Export -------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Datenauskunft herunterladen</CardTitle>
          <CardDescription>
            JSON-Datei mit allen praxisbezogenen Datensätzen.
            Cryptographische Geheimnisse (OAuth-Tokens, Passwort-Hashes)
            werden herausgefiltert.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a
              href={`/api/admin/clinics/${clinic.id}/dsgvo/export`}
              download={`dsgvo-export-${clinic.slug}.json`}
            >
              Export herunterladen
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* ----- Erasure ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Unwiderrufliche Löschung</CardTitle>
          <CardDescription>
            Entfernt alle praxisbezogenen Daten unwiderruflich aus der
            Datenbank. Das Audit-Log bleibt erhalten, damit die Löschung
            nachweisbar ist. Zur Bestätigung geben Sie den Praxis-Slug{" "}
            <code className="rounded bg-bg-secondary px-1">
              {clinic.slug}
            </code>{" "}
            ein.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={eraseClinicDataAction} className="space-y-3">
            <input type="hidden" name="id" value={clinic.id} />
            <div>
              <Label htmlFor="confirmSlug">Slug zur Bestätigung</Label>
              <Input
                id="confirmSlug"
                name="confirmSlug"
                placeholder={clinic.slug}
                required
                autoComplete="off"
              />
            </div>
            <Button type="submit" variant="danger">
              Daten endgültig löschen
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
