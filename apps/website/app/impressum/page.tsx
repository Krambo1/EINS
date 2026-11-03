import { LegalDocument } from "@/components/legal-document";
import { imprintMarkdown } from "@/lib/legal/document";

export const metadata = {
  title: "Impressum · EINS",
  alternates: { canonical: "/impressum" },
};

export default function Impressum() {
  return <LegalDocument markdown={imprintMarkdown} />;
}
