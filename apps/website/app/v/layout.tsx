import type { Metadata } from "next";

// Personal video pages, including their "no longer available" state, are
// never for search engines. Overrides the site-wide `index, follow`.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function VideoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
