import type { MetadataRoute } from "next";

// Static per-page lastmod dates. Update the relevant date when a page's content
// materially changes. (Do not use new Date(): it stamps every deploy with the
// build time, which makes lastmod meaningless and is discounted by Googlebot.)
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://eins.ag";
  return [
    { url: `${base}/`,            lastModified: "2026-06-02", changeFrequency: "monthly", priority: 1.0 },
    { url: `${base}/kontakt`,     lastModified: "2026-06-02", changeFrequency: "yearly",  priority: 0.8 },
    { url: `${base}/impressum`,   lastModified: "2026-06-02", changeFrequency: "yearly",  priority: 0.3 },
    { url: `${base}/datenschutz`, lastModified: "2026-06-02", changeFrequency: "yearly",  priority: 0.3 },
  ];
}
