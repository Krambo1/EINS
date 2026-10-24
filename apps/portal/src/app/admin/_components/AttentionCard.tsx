import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import type { AdminAttention } from "@/server/queries/admin";

/**
 * G-12: what needs attention today, at the top of the admin home. Only lines
 * with something open are shown; each links to the page that resolves it.
 */
export function AttentionCard({ data }: { data: AdminAttention | null }) {
  if (!data) return null;
  const lines: Array<{ href: string; text: string; urgent?: boolean }> = [];
  if (data.garantieCandidates > 0) {
    lines.push({
      href: "/admin/garantie",
      text: `${data.garantieCandidates} ${data.garantieCandidates === 1 ? "Praxis hat" : "Praxen haben"} eine Anfrage zu prüfen (erste qualifizierte Anfrage)`,
      urgent: true,
    });
  }
  if (data.invoicesUnsent > 0) {
    lines.push({
      href: "/admin/garantie",
      text: `${data.invoicesUnsent} erste ${data.invoicesUnsent === 1 ? "Rechnung ist" : "Rechnungen sind"} fällig und noch nicht als gesendet vermerkt`,
      urgent: true,
    });
  }
  if (data.garantieEndingSoon > 0) {
    lines.push({
      href: "/admin/garantie",
      text: `${data.garantieEndingSoon} ${data.garantieEndingSoon === 1 ? "Praxis ist" : "Praxen sind"} höchstens 14 Tage vor Fristende`,
    });
  }
  // K-9: without a signing date no 90-day clock runs for that Praxis.
  if (data.garantieWithoutSignedOn > 0) {
    lines.push({
      href: "/admin/garantie",
      text: `${data.garantieWithoutSignedOn} ${data.garantieWithoutSignedOn === 1 ? "Praxis ohne" : "Praxen ohne"} Unterschriftsdatum, keine Uhr läuft`,
    });
  }
  if (data.unnotifiedDelays > 0) {
    lines.push({
      href: "/admin/garantie",
      text: `${data.unnotifiedDelays} ${data.unnotifiedDelays === 1 ? "Praxis hat" : "Praxen haben"} Verzug, der noch nicht mitgeteilt ist`,
    });
  }
  if (data.rueckruf > 0) {
    lines.push({
      href: "/admin/rueckruf",
      text: `${data.rueckruf} ${data.rueckruf === 1 ? "Praxis braucht" : "Praxen brauchen"} einen Schritt in der Rückruf-Lage`,
      urgent: true,
    });
  }
  lines.push({
    href: "/admin/leads",
    text:
      data.newRequestsSinceYesterday === 1
        ? "1 neue Anfrage seit gestern"
        : `${data.newRequestsSinceYesterday} neue Anfragen seit gestern`,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Heute wichtig</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {lines.map((l) => (
            <li key={l.text}>
              <Link
                href={l.href}
                className={`text-base hover:underline ${l.urgent ? "font-semibold text-tone-bad" : "text-fg-primary"}`}
              >
                {l.text}
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
