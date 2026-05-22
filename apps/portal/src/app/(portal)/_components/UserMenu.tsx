"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  ChevronDown,
  LogOut,
  Settings,
  MessageSquare,
  UserCog,
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
import { can } from "@/lib/roles";

interface UserMenuProps {
  user: {
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    role: Role;
  };
  impersonating: boolean;
}

const TRIGGER_CLASSES = cn(
  "group inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-bg-primary py-1.5 pl-1.5 pr-2 text-left transition",
  "hover:bg-bg-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary/40",
  "data-[state=open]:bg-bg-secondary"
);

/**
 * Top-right account menu. The trigger doubles as the user-info chip: clicking
 * the name/role expands a Radix dropdown with account actions. When an admin
 * is currently impersonating a praxis user, an additional "Zurück zum Admin"
 * item appears at the top — that's the in-place "switch profile" affordance.
 *
 * Hydration: Radix's DropdownMenu generates `useId` values for aria linkage,
 * and under React 19 the SSR-produced id and the post-hydration id diverge
 * (React's "won't be patched up" warning, fires every paint). We render a
 * static chip on the server with the identical layout/styling, then mount
 * the real DropdownMenu only after the client has hydrated. The result is
 * no layout shift and no warning.
 */
export function UserMenu({ user, impersonating }: UserMenuProps) {
  const displayName = user.fullName ?? user.email;
  const showSettings = can(user.role, "settings.team");
  const showFeedback = can(user.role, "feedback.submit");

  const [open, setOpen] = useState(false);
  const [endingImpersonation, startEnding] = useTransition();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const onEndImpersonation = () => {
    startEnding(async () => {
      try {
        const res = await fetch("/api/auth/end-impersonation", {
          method: "POST",
          headers: { Accept: "application/json" },
        });
        const data = (await res.json()) as { ok: boolean; redirectTo?: string };
        if (!data.ok || !data.redirectTo) return;
        window.close();
        setTimeout(() => {
          if (!window.closed) {
            window.location.href = data.redirectTo!;
          }
        }, 100);
      } catch {
        // No-op — banner remains visible and offers the same action.
      }
    });
  };

  const chipInner = (
    <>
      <Avatar
        src={user.avatarUrl}
        name={displayName}
        size="sm"
        className="rounded-lg"
      />
      <span className="hidden flex-col leading-tight md:flex">
        <span className="text-sm font-medium">{displayName}</span>
        <span className="text-xs text-fg-secondary">
          {ROLE_LABELS[user.role]}
        </span>
      </span>
      <ChevronDown
        aria-hidden
        className="h-4 w-4 shrink-0 text-fg-secondary transition-transform duration-200 group-data-[state=open]:rotate-180"
      />
    </>
  );

  if (!mounted) {
    return (
      <button
        type="button"
        className={TRIGGER_CLASSES}
        aria-label="Konto-Menü öffnen"
        aria-haspopup="menu"
        aria-expanded={false}
      >
        {chipInner}
      </button>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={TRIGGER_CLASSES}
        aria-label="Konto-Menü öffnen"
      >
        {chipInner}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[16rem]">
        <div className="flex items-center gap-3 px-3 py-2">
          <Avatar src={user.avatarUrl} name={displayName} size="lg" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg-primary">
              {displayName}
            </div>
            {user.fullName && (
              <div className="truncate text-xs text-fg-secondary">
                {user.email}
              </div>
            )}
            <div className="mt-1 inline-flex items-center rounded-md bg-bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-secondary">
              {ROLE_LABELS[user.role]}
            </div>
          </div>
        </div>

        <DropdownMenuSeparator />

        {showSettings && (
          <DropdownMenuItem asChild>
            <Link href="/einstellungen" className="cursor-pointer">
              <Settings className="h-4 w-4 text-fg-secondary" aria-hidden />
              <span>Einstellungen</span>
            </Link>
          </DropdownMenuItem>
        )}

        {showFeedback && (
          <DropdownMenuItem asChild>
            <Link href="/feedback" className="cursor-pointer">
              <MessageSquare className="h-4 w-4 text-fg-secondary" aria-hidden />
              <span>Feedback senden</span>
            </Link>
          </DropdownMenuItem>
        )}

        {impersonating && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onEndImpersonation();
              }}
              disabled={endingImpersonation}
              className="cursor-pointer"
            >
              <UserCog className="h-4 w-4 text-tone-warn" aria-hidden />
              <span>
                {endingImpersonation
                  ? "Beenden …"
                  : "Zurück zum Admin"}
              </span>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <a href="/api/auth/logout" className="cursor-pointer">
            <LogOut className="h-4 w-4 text-fg-secondary" aria-hidden />
            <span>Abmelden</span>
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
