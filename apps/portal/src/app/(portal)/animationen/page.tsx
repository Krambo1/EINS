import { permanentRedirect } from "next/navigation";

// Title/robots set on the redirect itself so that the brief shell render
// before `permanentRedirect` resolves doesn't surface an empty <title>. The
// page is also marked noindex because the canonical URL is /medien.
export const metadata = {
  title: "Animationen",
  robots: { index: false, follow: false },
};

export default function AnimationenLegacyRedirect() {
  // 308 (permanent) preserves the request method and signals to crawlers
  // that the URL has moved for good — better SEO signal than a plain 307.
  permanentRedirect("/medien?kind=animationen");
}
