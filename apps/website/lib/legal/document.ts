import privacySource from "./privacy-source.json";
import imprintSource from "./imprint-source.json";
import privacyDetails from "./privacy-details.json";

const details: Record<string, string> = privacyDetails;

export const privacyMarkdown = privacySource.markdown.replace(
  /\[([^\]]+)\]/g,
  (token, key: string) => details[key]?.trim() || token,
);
export const privacyIsDraft = /\[[^\]]+\]/.test(privacyMarkdown);
export const imprintMarkdown = imprintSource.markdown;
