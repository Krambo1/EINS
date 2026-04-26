import type { ReactNode } from "react";

/**
 * Auth-flow layout: centered card on a subtle gradient background, no nav.
 * Applied to /login and /login/*.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-bg-primary">
      {/* Subtle accent wash — identical feel to the marketing site hero. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 50% at 20% 0%, rgba(88,186,181,0.12), transparent 70%), radial-gradient(50% 40% at 100% 100%, rgba(88,186,181,0.08), transparent 70%)",
        }}
      />
      <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-6 py-16">
        {children}
      </main>
      <footer className="px-6 pb-8 text-center text-sm text-fg-secondary">
        © EINS Visuals · Kundenportal
      </footer>
    </div>
  );
}
