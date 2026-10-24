import type { ReactNode } from "react";
import { Check, Circle, X } from "lucide-react";
import { cn } from "@eins/ui";
import {
  PASSWORD_MIN_CLASSES,
  PASSWORD_MIN_LENGTH,
  countCharacterClasses,
} from "@/auth/password-rules";

type RuleState = "met" | "open" | "failed";

const RULE_ICON = {
  met: { icon: Check, className: "text-tone-good", sr: ", erfüllt" },
  open: { icon: Circle, className: "scale-[0.8] text-fg-tertiary", sr: ", noch offen" },
  failed: { icon: X, className: "text-tone-bad", sr: ", nicht erfüllt" },
} as const;

function Rule({ state, children }: { state: RuleState; children: ReactNode }) {
  const { icon: Icon, className, sr } = RULE_ICON[state];
  return (
    <li className="flex items-start gap-2.5">
      <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", className)} />
      <span className="text-fg-primary">
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
    <ul id={id} className="space-y-2 text-sm">
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
