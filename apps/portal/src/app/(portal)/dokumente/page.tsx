import { redirect } from "next/navigation";

/**
 * Dokumente and "Dateien an EINS" are one page now, Dateien (Karam,
 * 2026-10-29): what EINS gives the Praxis is its card "Von EINS". The address
 * stays for old links, bookmarks and the Monats-Auswertung e-mails sent
 * before; an Art filter (`?kind=`) carries over.
 */
export default async function DokumentePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  redirect(kind ? `/dateien?kind=${encodeURIComponent(kind)}` : "/dateien");
}
