"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@eins/ui";
import { authFieldClass } from "./auth-ui";

/**
 * Password field with a show/hide toggle (NIST 800-63B recommends offering
 * one, typos are the main cause of failed logins).
 *
 * Security details:
 * - spellCheck/autoCorrect/autoCapitalize are off for the whole life of the
 *   field. Browser "enhanced spellcheck" sends the text of visible text
 *   fields to a cloud service, which would include a shown password.
 * - The field flips back to type="password" synchronously in the form's own
 *   submit listener, before React's root handler reads the form. Password
 *   managers then still see a password field, and the browser never files
 *   the value as plain text in its autofill history.
 * - The toggle is type="button", so it can never submit the form.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<"input">, "type"> & { toggleLabel?: string }
>(function PasswordInput({ className, toggleLabel = "Passwort", ...props }, ref) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const hide = () => {
      if (inputRef.current) inputRef.current.type = "password";
      setVisible(false);
    };
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  return (
    <div className="relative">
      <input
        {...props}
        ref={inputRef}
        type={visible ? "text" : "password"}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        className={cn(authFieldClass, "pr-12", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `${toggleLabel} verbergen` : `${toggleLabel} anzeigen`}
        aria-pressed={visible}
        aria-controls={props.id}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-[14px] text-fg-secondary transition-colors hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgba(88,186,181,0.5)]"
      >
        {visible ? (
          <EyeOff aria-hidden className="h-4 w-4" />
        ) : (
          <Eye aria-hidden className="h-4 w-4" />
        )}
      </button>
    </div>
  );
});
