import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { EinsLogo } from "@/app/_components/EinsLogo";

export const metadata = { title: "Link gesendet" };

export default function AdminLoginSentPage() {
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center gap-6 py-12">
      <div className="flex flex-col items-center gap-3">
        <EinsLogo width={160} height={64} className="h-9 w-auto" />
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
          Admin
        </span>
      </div>
      <Card className="!bg-bg-secondary/60">
        <CardHeader>
          <CardTitle>Posteingang prüfen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-base">
          <p className="text-fg-primary">
            Wenn die Adresse in der Admin-Allowlist hinterlegt ist, liegt jetzt ein
            Anmeldelink im Posteingang. Der Link ist 15 Minuten gültig.
          </p>
          <p className="text-sm text-fg-secondary">
            Ist keine Nachricht angekommen, prüfen Sie den Spam-Ordner oder fordern Sie
            einen neuen Link an.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
