import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@eins/ui";
import { PAGE_TITLE } from "@/app/(portal)/_components/PageHeader";
import { CONTROL, RAISED_CONTROL } from "@/app/(portal)/dashboard/_components/dash-ui";
import { AUTH_BODY_GAP, AUTH_STACK, AUTH_TITLE_GAP, FIELD_LABEL_ROW } from "../_lib/sizes";

/**
 * Building blocks of the sign-in pages, from the portal's own parts
 * (DESIGN.md section 9, Anmeldung): CONTROL for every field and button, a
 * field pressed into the card, a dark main button, a raised secondary one,
 * one title size. Mint stays in the logo; focus is the portal's ring in the
 * text colour. Plain components without hooks, usable from server and
 * client components alike.
 */

/** The portal's focus ring, in the text colour. */
export const AUTH_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary";

/**
 * A field to type into, pressed into the card like the portal's (FIELD in
 * einstellungen/_lib/sizes.ts). Focus and the invalid mark are outlines, so
 * the autofill fix below (a box-shadow) cannot hide them; the invalid mark
 * wins while the field has focus, so it stays after a wrong password.
 */
export const authFieldClass = cn(
  CONTROL,
  "elev-inset w-full border-0 bg-[var(--well)] px-3.5 text-base text-fg-primary placeholder:text-fg-tertiary focus:bg-[var(--surface-tile)] sm:text-[15px]",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-fg-primary",
  "aria-[invalid=true]:outline aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-offset-0 aria-[invalid=true]:outline-tone-bad",
  "disabled:opacity-60",
  // Browser autofill paints its own blue; keep the field's own colour.
  "[&:-webkit-autofill]:[-webkit-text-fill-color:var(--fg-primary)] [&:-webkit-autofill]:[box-shadow:var(--elev-inset),inset_0_0_0_1000px_var(--well)]"
);

/**
 * The main action, one per card: dark, full width, CONTROL height. Pending
 * and blocked both grey it out at the same size; the label stays.
 */
export const authPrimaryClass = cn(
  CONTROL,
  "inline-flex w-full select-none items-center justify-center whitespace-nowrap bg-fg-primary px-4 text-sm font-medium text-bg-primary shadow-[0_1px_2px_rgba(16,16,26,0.08)] transition-colors hover:bg-[color-mix(in_srgb,var(--fg-primary)_86%,var(--bg-primary))]",
  AUTH_FOCUS,
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-tile)]",
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-fg-primary"
);

/** A second action beside the main one (Google, "Zurück zur Anmeldung"). */
export const authSecondaryClass = cn(
  RAISED_CONTROL,
  CONTROL,
  "inline-flex w-full select-none items-center justify-center gap-2.5 px-4 text-sm font-medium transition-colors",
  AUTH_FOCUS,
  "disabled:cursor-not-allowed disabled:opacity-50"
);

/**
 * A quiet text action under the form ("Anmeldelink per E-Mail senden", "Zur
 * Anmeldung"): CONTROL high, so it is easy to tap, no frame.
 */
export const authQuietClass = cn(
  CONTROL,
  "inline-flex w-full items-center justify-center px-3 text-sm font-medium text-fg-primary transition-colors hover:bg-[var(--hover-wash)]",
  AUTH_FOCUS,
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
);

/** A link inside a label row or a sentence ("Passwort vergessen?"). */
export const authTextLinkClass = cn(
  "rounded-[var(--r-small)] text-sm font-medium text-fg-primary underline decoration-[var(--border-hover)] underline-offset-4 transition-colors hover:decoration-fg-primary",
  AUTH_FOCUS
);

export function AuthLabel({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return (
    <label {...props} className={cn("block text-sm font-medium leading-5 text-fg-primary", className)} />
  );
}

/**
 * A label above its field, with an optional link at the row's right end
 * (einstellungen's Field: "Passwort vergessen?" beside "Passwort").
 */
export function AuthField({
  label,
  htmlFor,
  aside,
  children,
}: {
  label: string;
  htmlFor: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className={FIELD_LABEL_ROW}>
        <AuthLabel htmlFor={htmlFor}>{label}</AuthLabel>
        {aside}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/**
 * A value that cannot be typed here, under its label like a field's (the
 * address on Passwort setzen). Plain text that wraps, never cut off.
 */
export function AuthValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className={FIELD_LABEL_ROW}>
        <p className="text-sm font-medium leading-5 text-fg-primary">{label}</p>
      </div>
      <p className="mt-1.5 text-[15px] leading-6 text-fg-primary [overflow-wrap:anywhere]">{children}</p>
    </div>
  );
}

/**
 * The card's title, the portal's one title size, no trailing period, 24 px
 * under the logo. `children`: at most one sentence under it.
 */
export function AuthHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className={AUTH_TITLE_GAP}>
      <h1 className={cn(PAGE_TITLE, "text-balance")}>{title}</h1>
      {children && <div className="mt-2 text-[15px] leading-6 text-fg-secondary">{children}</div>}
    </div>
  );
}

/** What follows the title: a form or the actions. */
export function AuthBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(AUTH_BODY_GAP, AUTH_STACK, className)}>{children}</div>;
}

/** A hairline between the form and another way in (Google). */
export function AuthDivider() {
  return <div role="separator" className="h-px bg-border" />;
}

/**
 * The text a screen reader hears while a button is pending: the button
 * itself keeps its label and only greys out.
 */
export function PendingStatus({ pending, label }: { pending: boolean; label: string }) {
  return (
    <span role="status" className="sr-only">
      {pending ? label : ""}
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
      <AuthHeader title="Sehen Sie in Ihr Postfach">
        <p role="status">{children}</p>
      </AuthHeader>
      <AuthBody>
        <p className="text-sm leading-5 text-fg-secondary">
          Keine E-Mail da? Sehen Sie auch im Spam-Ordner nach.
        </p>
        {onBack ? (
          <button type="button" onClick={onBack} data-auth-primary className={authSecondaryClass}>
            Zurück zur Anmeldung
          </button>
        ) : (
          <Link href={backHref} data-auth-primary className={authSecondaryClass}>
            Zurück zur Anmeldung
          </Link>
        )}
      </AuthBody>
    </div>
  );
}
