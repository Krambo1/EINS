import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
} from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { AdminPageHeader } from "../../_components/AdminPageHeader";
import { PendingSubmitButton } from "../../_components/PendingSubmitButton";
import { createClinicAction } from "../actions";

export const metadata = { title: "Neue Praxis" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminNewClinicPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const error = typeof sp.fehler === "string" ? sp.fehler : null;

  return (
    <div className="space-y-8">
      <div className="text-xs text-fg-secondary">
        <Link href="/admin/clinics" className="hover:text-accent">
          Praxen
        </Link>
        <span className="mx-1">/</span>
        <span>Neu</span>
      </div>

      <AdminPageHeader
        title="Neue Praxis anlegen"
        subtitle="Legt die Praxis und den Zugang der Inhaberin oder des Inhabers an und schickt die Einladung per E-Mail."
      />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] px-4 py-3 text-base text-tone-bad"
        >
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Praxis und Inhaber</CardTitle>
          <CardDescription>
            Die Einladung enthält einen Link zum Festlegen des Passworts. Der
            Link ist 15 Minuten gültig; danach können Sie ihn im Team-Tab neu
            senden. Der Standard-Fortschritt wird automatisch eingesetzt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createClinicAction} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-1">
              <Label htmlFor="displayName">Anzeigename</Label>
              <Input
                id="displayName"
                name="displayName"
                placeholder="Praxis Dr. Muster"
                required
                minLength={2}
                maxLength={200}
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="legalName">Rechtsname (optional)</Label>
              <Input
                id="legalName"
                name="legalName"
                placeholder="Leer = wie Anzeigename"
                maxLength={200}
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="slug">Kurzname für Adressen (optional)</Label>
              <Input
                id="slug"
                name="slug"
                placeholder="Leer = aus dem Anzeigenamen"
                maxLength={80}
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="signedOn">Unterschrieben am (optional)</Label>
              <Input id="signedOn" name="signedOn" type="date" />
              <p className="mt-1 text-xs text-fg-secondary">
                Startet die Garantie-Uhr. Lässt sich später unter Garantie setzen.
              </p>
            </div>

            <Separator className="md:col-span-2" />

            <div className="md:col-span-1">
              <Label htmlFor="ownerName">Name Inhaberin oder Inhaber</Label>
              <Input
                id="ownerName"
                name="ownerName"
                placeholder="Dr. Anna Muster"
                required
                minLength={2}
                maxLength={200}
              />
            </div>
            <div className="md:col-span-1">
              <Label htmlFor="ownerEmail">E-Mail Inhaberin oder Inhaber</Label>
              <Input
                id="ownerEmail"
                name="ownerEmail"
                type="email"
                required
                maxLength={200}
              />
            </div>

            <div className="flex justify-end md:col-span-2">
              <PendingSubmitButton pendingLabel="Wird angelegt …">
                Praxis anlegen und einladen
              </PendingSubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
