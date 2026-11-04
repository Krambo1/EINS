import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AppEffects } from "./_components/AppEffects";
import { ScrollCues } from "./_components/ScrollCues";

const display = localFont({
  src: [
    { path: "../../public/fonts/NeueHaasDisplay-Light.woff2", weight: "300", style: "normal" },
    { path: "../../public/fonts/NeueHaasDisplay-Roman.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/NeueHaasDisplay-Mediu.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/NeueHaasDisplay-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "EINS Portal",
    template: "%s - EINS Portal",
  },
  description:
    "Kundenportal für Praxen für ästhetische Medizin: Anfragen, Werbebudget, Medien und Auswertungen an einem Ort.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Watches the page for a skeleton (an `.animate-pulse` part, or anything
 * marked `data-skeleton`) leaving the DOM. The nodes added in the same batch
 * are the content that replaced it: they get `data-no-entrance` for a second,
 * which plays their entrance animations in zero time. Lifting the mark later
 * does not restart them, because only the timing changes, never the name.
 */
const SKELETON_HANDOFF =
  "try{(function(){var S='.animate-pulse,[data-skeleton]',A='data-no-entrance';new MutationObserver(function(rs){var gone=false,added=[];for(var i=0;i<rs.length;i++){var r=rs[i],j,n;for(j=0;j<r.removedNodes.length;j++){n=r.removedNodes[j];if(n.nodeType===1&&(n.matches(S)||n.querySelector(S)))gone=true;}for(j=0;j<r.addedNodes.length;j++){n=r.addedNodes[j];if(n.nodeType===1)added.push(n);}}if(!gone||!added.length)return;added.forEach(function(n){n.setAttribute(A,'');});setTimeout(function(){added.forEach(function(n){n.removeAttribute(A);});},1000);}).observe(document.documentElement,{childList:true,subtree:true});})();}catch(e){}";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className={display.variable} suppressHydrationWarning>
      <head>
        {/* Set data-theme BEFORE first paint so CSS-variable surfaces don't
            flash white→dark on reload. Runs synchronously in <head>; the
            try/catch covers privacy modes where localStorage throws. Only
            the admin host (same test as middleware.ts) has a dark design;
            the Praxis side is always light, whatever an older visit saved. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('eins-portal-theme');if(t==='dark'&&/^admin\\./i.test(location.hostname))document.documentElement.setAttribute('data-theme','dark');}catch(e){}",
          }}
        />
        {/* Content that takes a skeleton's place appears at once, without
            its entrance (globals.css, "data-no-entrance"): a card that fades
            in from nothing after a skeleton read as the page vanishing and
            coming back. Runs from the first byte, so the streamed swap of a
            full page load is caught too, not only client navigations. */}
        <script dangerouslySetInnerHTML={{ __html: SKELETON_HANDOFF }} />
      </head>
      <body className="min-h-dvh bg-bg-primary text-fg-primary antialiased">
        <AppEffects />
        {children}
        <ScrollCues />
      </body>
    </html>
  );
}
