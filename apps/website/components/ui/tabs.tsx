"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

function findHorizontalScroller(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentElement;
  while (cur && cur !== document.body) {
    const overflowX = getComputedStyle(cur).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") return cur;
    cur = cur.parentElement;
  }
  return null;
}

function centerActiveTab(list: HTMLElement, smooth: boolean) {
  const scroller = findHorizontalScroller(list);
  if (!scroller) return;
  if (scroller.scrollWidth <= scroller.clientWidth) return;
  const active = list.querySelector<HTMLElement>('[data-state="active"]');
  if (!active) return;
  const sRect = scroller.getBoundingClientRect();
  const aRect = active.getBoundingClientRect();
  const offsetWithin = aRect.left - sRect.left + scroller.scrollLeft;
  const desired =
    offsetWithin - (scroller.clientWidth - active.clientWidth) / 2;
  const max = scroller.scrollWidth - scroller.clientWidth;
  const clamped = Math.max(0, Math.min(max, desired));
  if (Math.abs(clamped - scroller.scrollLeft) < 1) return;
  scroller.scrollTo({ left: clamped, behavior: smooth ? "smooth" : "auto" });
}

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  React.useImperativeHandle(
    ref,
    () => innerRef.current as React.ElementRef<typeof TabsPrimitive.List>,
    [],
  );

  React.useEffect(() => {
    const list = innerRef.current;
    if (!list) return;

    // Center on mount once layout is settled (covers deep-link / restored state).
    const raf = requestAnimationFrame(() => centerActiveTab(list, false));

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type !== "attributes" || m.attributeName !== "data-state") continue;
        const t = m.target as HTMLElement;
        if (t.getAttribute("data-state") === "active") {
          centerActiveTab(list, true);
          return;
        }
      }
    });
    observer.observe(list, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={innerRef}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-transparent p-1",
        className
      )}
      {...props}
    />
  );
});
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-fg-secondary transition-all duration-200 ease-expo hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:[text-shadow:0_1px_3px_rgba(0,0,0,0.25)]",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-8 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
