import source from "./privacy-source.json";

const paragraph = source.markdown.split(/\n\n+/).find((block) => block.startsWith("[ ] Ich willige ausdrücklich ein, dass die Praxis"));
if (!paragraph) throw new Error("Final 14 health consent paragraph is missing");

/** Keep the actual checkbox wording identical to Final 14. */
export function healthConsentText(contact: string): string {
  return paragraph!.slice(4).replace("[Kontakt]", () => contact);
}
