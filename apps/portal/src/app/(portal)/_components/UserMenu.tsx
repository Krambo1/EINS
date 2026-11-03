"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronsUpDown,
  LogOut,
  Settings,
} from "lucide-react";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  cn,
} from "@eins/ui";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { clearSearchStorage } from "./search-storage";

interface UserMenuProps {
  user: {
    email: string;
    fullName: string | null;
    role: Role;
  };
  /** The Praxis, under the e-mail at the top of the menu. */
  clinicName: string;
  className?: string;
}

// A two-line row across the sidebar's width (at least 48 px, control
// radius), quiet until hovered or open, like the nav entries above it. A
// long role ("Marketing-Verantwortlicher") wraps to a third line and the row
// grows with it: a fixed height let it spill 2 px out of the sidebar, which
// then scrolled.
const TRIGGER_CLASSES = cn(
  "group flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-[var(--r-control)] px-2 py-1 text-left transition-colors",
  "hover:bg-[var(--hover-wash)] focus:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary",
  "data-[state=open]:bg-[var(--hover-wash)]"
);

/**
 * The account at the foot of the sidebar, as in Claude, ChatGPT and Vercel:
 * the person who is signed in (avatar, name, role), and a tap opens the menu
 * upward with Einstellungen and Abmelden. A person reads as "my account"; a
 * logo with the Praxis name at the top did not (Karam, 2026-10-29).
 *
 * Hydration: Radix's DropdownMenu generates `useId` values for aria linkage,
 * and under React 19 the SSR-produced id and the post-hydration id diverge
 * (React's "won't be patched up" warning, fires every paint). We render a
 * static trigger on the server with the identical layout/styling, then mount
 * the real DropdownMenu only after the client has hydrated. The result is
 * no layout shift and no warning.
 */
export function UserMenu({ user, clinicName, className }: UserMenuProps) {
  const displayName = user.fullName ?? user.email;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const logoutFormRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    setMounted(true);
  }, []);

  const triggerInner = (
    <>
      <Avatar name={displayName} size="md" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold leading-5 text-fg-primary">
          {displayName}
        </span>
        <span className="block text-[13px] leading-4 text-fg-secondary">{ROLE_LABELS[user.role]}</span>
      </span>
      <ChevronsUpDown aria-hidden className="h-4 w-4 shrink-0 text-fg-secondary" />
    </>
  );

  if (!mounted) {
    return (
      <button
        type="button"
        className={cn(TRIGGER_CLASSES, className)}
        aria-label="Konto-Menü öffnen"
        aria-haspopup="menu"
        aria-expanded={false}
      >
        {triggerInner}
      </button>
    );
  }

  return (
    <>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(TRIGGER_CLASSES, className)}
        aria-label="Konto-Menü öffnen"
      >
        {triggerInner}
      </DropdownMenuTrigger>

      {/* Opens upward from the foot of the sidebar. A panel that hugs its
          entries 4 px apart: panel radius outside, control radius inside
          (DESIGN.md section 5, "Radius by size"). */}
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[15rem] max-w-[calc(100vw-2rem)] rounded-[var(--r-panel)] elev-popover [&_[role^=menuitem]]:rounded-[var(--r-control)]"
      >
        <div className="px-3 pb-2 pt-2 text-sm leading-5">
          <p className="break-all text-fg-primary">{user.email}</p>
          <p className="break-words text-fg-secondary">{clinicName}</p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/einstellungen" className="cursor-pointer">
            <Settings className="h-4 w-4 text-fg-secondary" aria-hidden />
            <span>Einstellungen</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            // L-1: palette history (patient names) does not outlive the login.
            clearSearchStorage();
            logoutFormRef.current?.requestSubmit();
          }}
          className="cursor-pointer"
        >
          <LogOut className="h-4 w-4 text-fg-secondary" aria-hidden />
          <span>Abmelden</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {/* Logout is a POST (B-15), so a foreign link cannot log anyone out. The
        form lives outside the portaled menu content, which unmounts on close;
        the item keeps the menu open and submits it. */}
    <form ref={logoutFormRef} method="post" action="/api/auth/logout" hidden />
    </>
  );
}
