"use client";

import { useEffect, useState } from "react";

/**
 * Returns false on first render (SSR + first client render), then true after
 * mount. Use to defer rendering of components that produce non-deterministic
 * IDs on the client (Radix uses React.useId which under React 19 + Next 14
 * occasionally diverges from the SSR id space).
 *
 * Pattern:
 *   const mounted = useMounted();
 *   if (!mounted) return <ssr-safe placeholder />;
 *   return <radix-component />;
 *
 * Centralised here so every Radix trigger wrapper in @eins/ui can use the
 * same defensive pattern. See HydrationSafeTrigger.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
