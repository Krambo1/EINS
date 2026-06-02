"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  cn,
} from "@eins/ui";

/**
 * URL-param-driven admin filter controls. Every change navigates (soft push) so
 * the filter state lives entirely in the query string — server components read
 * it via `searchParams`, exactly like the clinic-side `TimeRangeToggle`. Shared
 * across the clinics / leads / users / integrations pages.
 */

const TRIGGER_CLASS =
  "flex h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-bg-primary px-3 text-sm text-fg-primary transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      params.delete("page"); // any filter change resets pagination
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams]
  );
}

export function AdminSearchInput({
  param = "search",
  placeholder,
  className,
}: {
  param?: string;
  placeholder?: string;
  className?: string;
}) {
  const searchParams = useSearchParams();
  const setParam = useSetParam();
  const current = searchParams.get(param) ?? "";
  const [value, setValue] = React.useState(current);

  // Debounced navigate. Skips when `value` already matches the URL (mount + the
  // moment right after our own navigation lands), so it never loops.
  React.useEffect(() => {
    if (value === current) return;
    const t = setTimeout(() => {
      setParam((p) => {
        if (value) p.set(param, value);
        else p.delete(param);
      });
    }, 350);
    return () => clearTimeout(t);
  }, [value, current, param, setParam]);

  return (
    <div className={cn("relative", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="h-10 pl-9"
        aria-label={placeholder ?? "Suche"}
      />
    </div>
  );
}

export interface AdminFilterOption {
  value: string;
  label: string;
}

export function AdminUrlSelect({
  param,
  value,
  options,
  placeholder,
  className,
}: {
  param: string;
  value: string;
  options: AdminFilterOption[];
  placeholder?: string;
  className?: string;
}) {
  const setParam = useSetParam();
  return (
    <Select
      value={value}
      onValueChange={(v) =>
        setParam((p) => {
          if (!v) p.delete(param);
          else p.set(param, v);
        })
      }
    >
      <SelectTrigger className={cn("h-10 px-3 text-sm", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AdminUrlMultiSelect({
  param,
  selected,
  options,
  label,
  className,
}: {
  param: string;
  selected: string[];
  options: AdminFilterOption[];
  label: string;
  className?: string;
}) {
  const setParam = useSetParam();
  const toggle = (val: string, checked: boolean) =>
    setParam((p) => {
      const next = p.getAll(param).filter((x) => x !== val);
      if (checked) next.push(val);
      p.delete(param);
      for (const v of next) p.append(param, v);
    });
  const count = selected.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(TRIGGER_CLASS, className)}>
          <span className="truncate">
            {label}
            {count > 0 ? ` · ${count}` : ""}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuCheckboxItem
            key={o.value}
            checked={selected.includes(o.value)}
            onCheckedChange={(c) => toggle(o.value, Boolean(c))}
            onSelect={(e) => e.preventDefault()}
          >
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AdminUrlToggle({
  param,
  checked,
  label,
}: {
  param: string;
  checked: boolean;
  label: string;
}) {
  const setParam = useSetParam();
  return (
    <label className="flex h-10 cursor-pointer select-none items-center gap-2 rounded-md border border-border bg-bg-primary px-3 text-sm text-fg-secondary transition-colors hover:border-accent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) =>
          setParam((p) => {
            if (e.target.checked) p.set(param, "1");
            else p.delete(param);
          })
        }
        className="h-4 w-4 accent-accent"
      />
      {label}
    </label>
  );
}
