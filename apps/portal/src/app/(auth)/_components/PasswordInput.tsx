"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
} from "react";
import { ArrowBigUpDash, Eye, EyeOff } from "lucide-react";
import { cn } from "@eins/ui";
import { AUTH_FOCUS, authFieldClass } from "./auth-ui";

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
>(function PasswordInput({ className, toggleLabel = "Passwort", onKeyDown, onKeyUp, onBlur, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  // Caps Lock is a common cause of a "wrong" password. Shown inside the
  // field, beside the eye, so nothing under it moves.
  const [capsLock, setCapsLock] = useState(false);
  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === "function") setCapsLock(e.getModifierState("CapsLock"));
  };
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
        onKeyDown={(e) => {
          readCaps(e);
          onKeyDown?.(e);
        }}
        onKeyUp={(e) => {
          readCaps(e);
          onKeyUp?.(e);
        }}
        onBlur={(e) => {
          setCapsLock(false);
          onBlur?.(e);
        }}
        className={cn(authFieldClass, capsLock ? "pr-[4.5rem]" : "pr-11", className)}
      />
      {capsLock && (
        <span
          title="Feststelltaste ist an"
          className="pointer-events-none absolute inset-y-0 right-11 flex w-7 items-center justify-center text-tone-warn"
        >
          <ArrowBigUpDash aria-hidden className="h-4 w-4" />
        </span>
      )}
      <span role="status" className="sr-only">
        {capsLock ? "Feststelltaste ist an" : ""}
      </span>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `${toggleLabel} verbergen` : `${toggleLabel} anzeigen`}
        aria-pressed={visible}
        aria-controls={props.id}
        className={cn(
          "absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[var(--r-control)] text-fg-secondary transition-colors hover:text-fg-primary",
          AUTH_FOCUS,
          "focus-visible:ring-inset"
        )}
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
