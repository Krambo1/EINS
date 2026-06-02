"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { useMounted } from "../hooks/use-mounted";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

const TRIGGER_CLASSES =
  "opa-focus-ring flex h-12 w-full items-center justify-between rounded-md border border-border bg-bg-primary px-4 text-base text-fg-primary disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1";

/**
 * Hydration-safe SelectTrigger. See DropdownMenuTrigger for rationale —
 * same React 19 + Next 14 + Radix useId divergence applies to every
 * Radix wrapper. CSV wizard, feedback form, and mapping rows all use
 * SelectTrigger; lifting the mount-guard here protects all of them.
 *
 * SSR renders a static <button> with combobox semantics so screen readers
 * announce the closed state correctly before hydration; the real Radix
 * trigger swaps in on mount with no visual change.
 */
export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const mounted = useMounted();
  if (!mounted) {
    return (
      <button
        type="button"
        ref={ref as React.Ref<HTMLButtonElement>}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={false}
        className={cn(TRIGGER_CLASSES, className)}
        // Strip Radix-only props that don't belong on a plain button.
        {...(stripRadixProps(props) as any)}
      >
        {children}
        <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
      </button>
    );
  }
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(TRIGGER_CLASSES, className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 opacity-60" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

/** Drop props that DOM buttons can't accept (e.g. Radix `asChild`). */
function stripRadixProps<T extends Record<string, unknown>>(props: T): T {
  const { asChild: _asChild, ...rest } = props as T & { asChild?: boolean };
  return rest as T;
}

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        "relative z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-bg-primary text-fg-primary shadow-xl data-[state=open]:animate-[opa-fade-in_150ms_ease-out]",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className
      )}
      {...props}
    >
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-8 pr-2 text-base outline-none focus:bg-bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;
