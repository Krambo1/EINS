import type { ReactNode } from "react";
import { cn } from "@eins/ui";
import {
  PASSWORD_MIN_CLASSES,
  PASSWORD_MIN_LENGTH,
  countCharacterClasses,
} from "@/auth/password-rules";
import { RULE_ROW } from "../_lib/sizes";

type RuleState = "met" | "open" | "failed";

// A dot plus plain text (DESIGN.md section 5, the Status dot of the
// Einstellungen); the state is read out after the text.
const RULE_DOT = {
  met: { className: "bg-tone-good", sr: ", erfüllt" },
  open: { className: "bg-[var(--border-hover)]", sr: ", noch offen" },
  failed: { className: "bg-tone-bad", sr: ", nicht erfüllt" },
} as const;

function Rule({ state, children }: { state: RuleState; children: ReactNode }) {
  const { className, sr } = RULE_DOT[state];
  return (
    <li className={RULE_ROW}>
      <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", className)} />
      <span className="text-sm leading-5 text-fg-primary">
        {children}
        <span className="sr-only">{sr}</span>
      </span>
    </li>
  );
}

/**
 * Live checklist under a new-password pair (clinic and admin). Only a hint
 * from @/auth/password-rules; the server checks the same rules again.
 */
export function PasswordRules({ id, pw, pw2 }: { id: string; pw: string; pw2: string }) {
  const mismatch = pw.length > 0 && pw2.length > 0 && pw !== pw2;
  const same: RuleState = pw.length > 0 && pw === pw2 ? "met" : mismatch ? "failed" : "open";
  return (
    <ul id={id} className="space-y-1.5">
      <Rule state={pw.length >= PASSWORD_MIN_LENGTH ? "met" : "open"}>
        Mindestens {PASSWORD_MIN_LENGTH} Zeichen
      </Rule>
      <Rule state={countCharacterClasses(pw) >= PASSWORD_MIN_CLASSES ? "met" : "open"}>
        {PASSWORD_MIN_CLASSES} von 4: Großbuchstabe, Kleinbuchstabe, Ziffer,
        Sonderzeichen
      </Rule>
      <Rule state={same}>Beide Eingaben stimmen überein</Rule>
    </ul>
  );
}
