"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { ArrowRight } from "lucide-react";
import { cn } from "../lib/cn";

export interface PrimaryActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  /** Show the arrow suffix. Default true. */
  showArrow?: boolean;
}

/**
 * PrimaryAction — the ONE dicke Mint-Teal button per Opa-proof screen.
 *
 * Design rules (plan §3.1 #6):
 *  • Genau eine Hauptaktion pro Screen.
 *  • min-height 56px tap-target.
 *  • High contrast, hohe Kontrastkante.
 *
 * Use <Button> for everything else.
 */
export const PrimaryAction = React.forwardRef<
  HTMLButtonElement,
  PrimaryActionProps
>(({ asChild, children, className, showArrow = true, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn("opa-primary-action opa-focus-ring", className)}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          <span>{children}</span>
          {showArrow && <ArrowRight className="h-5 w-5" aria-hidden="true" />}
        </>
      )}
    </Comp>
  );
});
PrimaryAction.displayName = "PrimaryAction";
