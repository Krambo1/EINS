import { LegalDocument } from "@/components/legal-document";
import { privacyMarkdown, privacyIsDraft } from "@/lib/legal/document";

export const metadata = {
  title: "Datenschutz · EINS",
  alternates: { canonical: "/datenschutz" },
  robots: privacyIsDraft ? { index: false, follow: false } : undefined,
};

export default function Datenschutz() {
  return <LegalDocument markdown={privacyMarkdown} draft={privacyIsDraft} />;
}
