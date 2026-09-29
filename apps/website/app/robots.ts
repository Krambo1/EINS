import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // /v/<slug> are personal video pages for single Praxen, never for search.
    rules: { userAgent: "*", allow: "/", disallow: "/v/" },
    sitemap: "https://eins.ag/sitemap.xml",
    host: "https://eins.ag",
  };
}
