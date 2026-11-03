import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CookieSettingsButton } from "@/components/cookie-consent";

/** The approved source uses headings, paragraphs and one table. React escapes all text. */
export function LegalDocument({ markdown, draft = false }: { markdown: string; draft?: boolean }) {
  return (
    <main className="container py-20 md:py-24">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="mb-10 inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Link>
        {draft && (
          <p role="status" className="mb-8 rounded-lg border border-amber-400 bg-amber-50 p-4 text-base text-amber-950">
            Entwurf. Die markierten Anbieterangaben müssen vor der Veröffentlichung ergänzt werden.
          </p>
        )}
        <article className="break-words text-base leading-relaxed text-fg-primary md:text-lg">
          {markdown.split(/\n\n+/).map((block, i) => {
            if (block.startsWith("# ")) return <h1 key={i} className="display-m mb-6 hyphens-auto">{block.slice(2)}</h1>;
            if (block.startsWith("## ")) return <h2 key={i} className="mb-4 mt-12 text-2xl font-semibold md:text-3xl">{block.slice(3)}</h2>;
            if (block.startsWith("|")) {
              const rows = block.split("\n").map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
              return (
                <div key={i} className="my-6 overflow-x-auto" tabIndex={0} role="region" aria-label="Freiwillige Dienste">
                  <table className="w-full min-w-[40rem] border-collapse text-left text-base">
                    <thead><tr>{rows[0].map((cell, n) => <th key={n} scope="col" className="border border-border p-3 align-top">{inline(cell)}</th>)}</tr></thead>
                    <tbody>{rows.slice(2).map((row, n) => <tr key={n}>{row.map((cell, j) => <td key={j} className="border border-border p-3 align-top">{inline(cell)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              );
            }
            return <p key={i} className="my-4">{inline(block)}</p>;
          })}
        </article>
        <nav aria-label="Rechtliche Informationen" className="mt-12 flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-6 text-base">
          <Link href="/impressum" className="underline underline-offset-4">Impressum</Link>
          <Link href="/datenschutz" className="underline underline-offset-4">Datenschutz</Link>
          <CookieSettingsButton className="underline underline-offset-4" />
        </nav>
      </div>
    </main>
  );
}

function inline(text: string) {
  return text.split(/(\[[^\]]+\]|team@eins\.ag|ldi\.nrw\.de|\+49 162 8456643)/g).map((part, i) => {
    if (part.startsWith("[") && part.endsWith("]")) return <mark key={i} className="bg-amber-100 text-amber-950">{part}</mark>;
    const href = part === "team@eins.ag" ? "mailto:team@eins.ag"
      : part === "ldi.nrw.de" ? "https://www.ldi.nrw.de/"
      : part === "+49 162 8456643" ? "tel:+491628456643" : null;
    return href ? <a key={i} href={href} className="underline underline-offset-4">{part}</a> : part;
  });
}
