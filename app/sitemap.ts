import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://einsvisuals.com";
  const now = new Date();
  return [
    { url: `${base}/`,            lastModified: now, changeFrequency: "monthly", priority: 1.0 },
    { url: `${base}/kontakt`,     lastModified: now, changeFrequency: "yearly",  priority: 0.8 },
    { url: `${base}/impressum`,   lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${base}/datenschutz`, lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
  ];
}
