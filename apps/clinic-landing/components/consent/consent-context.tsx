"use client";

import * as React from "react";
import {
  CONSENT_CHANGE_EVENT,
  DEFAULT_CONSENT,
  readConsent,
  type ConsentState,
} from "@/lib/consent";

const ConsentCtx = React.createContext<ConsentState>(DEFAULT_CONSENT);

export function useConsent(): ConsentState {
  return React.useContext(ConsentCtx);
}

/**
 * Subscribes to localStorage consent + same-tab events. Re-renders on change
 * so trackers / pixels mount/unmount in response to the user's choice.
 *
 * SSR-safe: starts with DEFAULT_CONSENT (everything off) and hydrates client-side.
 */
export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<ConsentState>(DEFAULT_CONSENT);

  React.useEffect(() => {
    setState(readConsent());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ConsentState>).detail;
      if (detail) setState(detail);
      else setState(readConsent());
    };
    const onStorage = () => setState(readConsent());
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return <ConsentCtx.Provider value={state}>{children}</ConsentCtx.Provider>;
}
