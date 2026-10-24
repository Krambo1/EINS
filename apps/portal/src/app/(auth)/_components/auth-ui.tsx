import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@eins/ui";
import styles from "./auth.module.css";

/**
 * Building blocks for the auth pages in the eins.ag look: white surfaces,
 * dark text, 48px controls, mint for focus and accents, and the website's
 * dark pill CTA (see auth.module.css). Plain components without hooks,
 * usable from server and client components alike.
 */

const MINT_FOCUS =
  "focus-visible:border-[#58BAB5] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(88,186,181,0.2)]";

export const authFieldClass = cn(
  "h-12 w-full rounded-[14px] border border-border bg-white px-4 text-base text-fg-primary transition duration-200 ease-out",
  "placeholder:text-fg-tertiary/70 hover:border-border-hover",
  MINT_FOCUS,
  "aria-[invalid=true]:border-tone-bad",
  "disabled:cursor-not-allowed disabled:opacity-70",
  // Browser autofill paints its own blue background; keep the field white.
  "[&:-webkit-autofill]:[-webkit-text-fill-color:#10101a] [&:-webkit-autofill]:[box-shadow:inset_0_0_0_1000px_#ffffff]"
);

/** Primary action: the eins.ag CTA (dark pill, mint sweep round the border). */
export const authCtaClass = cn(
  styles.cta,
  "inline-flex h-12 w-full select-none items-center justify-center gap-2 px-6 text-base font-medium"
);

/** Secondary action (Google, "Zurück zur Anmeldung"). */
export const authButtonClass = cn(
  "inline-flex h-12 w-full select-none items-center justify-center gap-2.5 rounded-full border border-border bg-white px-6 text-base font-medium text-fg-primary",
  "transition-colors duration-200 hover:border-border-hover hover:bg-bg-secondary",
  MINT_FOCUS,
  "disabled:pointer-events-none disabled:opacity-40"
);

/** Inline text action. Dark text, mint underline: mint text on white is too faint to read. */
export const authTextLinkClass =
  "rounded font-medium text-fg-primary underline decoration-[#58BAB5] decoration-2 underline-offset-4 transition-colors hover:decoration-[#3f938f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(88,186,181,0.4)] disabled:opacity-50";

/**
 * The website's card pattern (card-glow, light surface over the mint shapes).
 * No backdrop-blur: it would make the card the containing block for the
 * fixed toast inside it.
 */
export const authCardClass = cn(
  styles.card,
  "rounded-2xl border border-border bg-white/80 p-6 sm:p-10"
);

/** Wraps the mint part of a headline, like "Mehr Sicherheit." on eins.ag. */
export function Accent({ children }: { children: ReactNode }) {
  return <span className={styles.accent}>{children}</span>;
}

export function AuthLabel({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return (
    <label {...props} className={cn("block text-sm font-medium text-fg-primary", className)} />
  );
}

/** Bold headline in the website's style and an optional line under it. */
export function AuthHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-balance text-[32px] font-bold leading-[1.05] tracking-[-0.02em] text-fg-primary [word-spacing:normal] sm:text-[38px]">
        {title}
      </h1>
      {children && <div className="mt-3 text-base text-fg-primary sm:text-lg">{children}</div>}
    </div>
  );
}

export function AuthDivider({ children = "oder" }: { children?: ReactNode }) {
  return (
    <div className="my-6 flex items-center" role="separator">
      <span className="h-px flex-1 bg-border" />
      <span className="mx-4 text-sm text-fg-secondary">{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** Three pulsing dots in place of a button label while a request runs. */
export function PendingDots({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * "Sehen Sie in Ihr Postfach" screen after a link request. The same screen
 * for known and unknown addresses (enumeration defence), and it never echoes
 * the address. `onBack` (client callers only) returns to the form in place,
 * otherwise the button links to `backHref`.
 */
export function CheckInbox({
  children,
  backHref = "/login",
  onBack,
}: {
  children: ReactNode;
  backHref?: string;
  onBack?: () => void;
}) {
  return (
    <div>
      <AuthHeader title="Sehen Sie in Ihr Postfach.">
        <p role="status">{children}</p>
      </AuthHeader>
      {onBack ? (
        <button type="button" onClick={onBack} className={authButtonClass}>
          Zurück zur Anmeldung
        </button>
      ) : (
        <Link href={backHref} className={authButtonClass}>
          Zurück zur Anmeldung
        </Link>
      )}
      <p className="mt-6 text-sm text-fg-secondary">
        Keine E-Mail da? Sehen Sie auch im Spam-Ordner nach.
      </p>
    </div>
  );
}
