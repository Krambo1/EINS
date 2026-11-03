import { readFileSync } from "node:fs";

const read = (name) => JSON.parse(readFileSync(new URL(`../lib/legal/${name}.json`, import.meta.url), "utf8"));
const source = read("privacy-source");
const details = read("privacy-details");
const rendered = source.markdown.replace(/\[([^\]]+)\]/g, (token, key) => details[key]?.trim() || token);
const missing = [...new Set(rendered.match(/\[[^\]]+\]/g) ?? [])];
// LEGAL_GATE=warn (set only by the GitHub CI build) reports the draft without
// failing, so CI still proves the site compiles. Every Vercel deploy blocks.
if (missing.length && process.env.LEGAL_GATE === "warn") {
  console.warn(`Final 06 is a draft: ${missing.length} provider fields remain incomplete in lib/legal/privacy-details.json. A deploy would be blocked.`);
} else if (missing.length) {
  console.error(`Final 06 is a draft: ${missing.length} provider fields remain incomplete in lib/legal/privacy-details.json. Publication blocked.`);
  process.exitCode = 1;
} else {
  console.log("Final 06 and 07: no unresolved placeholders.");
}
