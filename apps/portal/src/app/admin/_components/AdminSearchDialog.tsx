"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Search,
  ArrowRight,
  Hash,
  Compass,
  Clock,
  Sparkles,
  Pin,
  GripVertical,
  X,
} from "lucide-react";
import { cn } from "@eins/ui";
import { ADMIN_INDEX } from "@/lib/search/adminIndex";
import { scoreMatch } from "@/lib/search/match";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Distinct keys from the clinic palette so admin and clinic sessions on the
// same browser don't cross-pollinate each other's recents/pins.
const RECENT_KEY = "eins-admin-search-recent";
const RECENT_MAX = 5;
const PINNED_KEY = "eins-admin-search-pinned";
const PINNED_MAX = 10;

interface StoredItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

type RecentItem = StoredItem;
type PinnedItem = StoredItem;

function readStored(key: string, max: number): StoredItem[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, max) : [];
  } catch {
    return [];
  }
}

function writeStored(key: string, items: StoredItem[], max: number) {
  try {
    window.localStorage.setItem(key, JSON.stringify(items.slice(0, max)));
  } catch {
    // localStorage can be unavailable (private mode, quota) — silently skip.
  }
}

function readRecent(): RecentItem[] {
  return readStored(RECENT_KEY, RECENT_MAX);
}

function pushRecent(item: RecentItem) {
  const current = readRecent().filter((i) => i.id !== item.id);
  writeStored(RECENT_KEY, [item, ...current], RECENT_MAX);
}

function readPinned(): PinnedItem[] {
  return readStored(PINNED_KEY, PINNED_MAX);
}

function writePinned(items: PinnedItem[]) {
  writeStored(PINNED_KEY, items, PINNED_MAX);
}

/**
 * Admin command palette — the clinic GlobalSearchDialog copied for the admin
 * boundary and stripped of every clinic-session concern (no role/permission
 * gating, no async lead search). Searches the static ADMIN_INDEX; keeps
 * recents, pinned quick access with drag-to-reorder, and the umlaut-folding
 * scorer.
 */
export function AdminSearchDialog({ open, onOpenChange }: DialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [pinned, setPinned] = useState<PinnedItem[]>([]);

  // Refresh "recent" + "pinned" each time the dialog opens so changes from
  // other tabs show up.
  useEffect(() => {
    if (open) {
      setRecent(readRecent());
      setPinned(readPinned());
      setQuery("");
    }
  }, [open]);

  const pinnedIds = useMemo(() => new Set(pinned.map((p) => p.id)), [pinned]);

  const handleSelect = (item: StoredItem) => {
    pushRecent(item);
    onOpenChange(false);
    router.push(item.href);
  };

  const togglePin = (item: PinnedItem) => {
    setPinned((current) => {
      const exists = current.some((p) => p.id === item.id);
      const next = exists
        ? current.filter((p) => p.id !== item.id)
        : [...current, item].slice(0, PINNED_MAX);
      writePinned(next);
      return next;
    });
  };

  // Drag-to-reorder for pinned items. The id ref is the source of truth for
  // handler logic; the matching state values only drive the dragging /
  // drop-target visuals. Mouse-only by design.
  const dragIdRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDragStart = (id: string) => (e: ReactDragEvent<HTMLDivElement>) => {
    dragIdRef.current = id;
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    // Firefox refuses to start a drag unless dataTransfer has data set.
    e.dataTransfer.setData("text/plain", id);
  };
  const handleDragOver = (id: string) => (e: ReactDragEvent<HTMLDivElement>) => {
    if (!dragIdRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverId !== id) setDragOverId(id);
  };
  const handleDragEnd = () => {
    dragIdRef.current = null;
    setDragId(null);
    setDragOverId(null);
  };
  const handleDrop = (targetId: string) => (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const sourceId = dragIdRef.current;
    handleDragEnd();
    if (!sourceId || sourceId === targetId) return;
    setPinned((current) => {
      const fromIdx = current.findIndex((p) => p.id === sourceId);
      const toIdx = current.findIndex((p) => p.id === targetId);
      if (fromIdx === -1 || toIdx === -1) return current;
      const next = [...current];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      writePinned(next);
      return next;
    });
  };

  // cmdk's built-in filter doesn't fold umlauts. Override with the fold-aware
  // scorer that operates on the item value + its declared keywords.
  const filter = (value: string, search: string, keywords?: string[]) => {
    const haystack = [value, ...(keywords ?? [])].join(" ");
    return scoreMatch(haystack, search);
  };

  const hasQuery = query.trim().length > 0;
  const navEntries = hasQuery
    ? ADMIN_INDEX
    : ADMIN_INDEX.filter((e) => !pinnedIds.has(e.id));

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Globale Suche"
      filter={filter}
      shouldFilter
      overlayClassName={cn(
        "fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm",
        "data-[state=open]:animate-[opa-fade-in_140ms_ease-out]",
        "data-[state=closed]:animate-[opa-fade-out_120ms_ease-in]"
      )}
      contentClassName={cn(
        // Centering uses left:0 / right:0 / mx-auto rather than the usual
        // -translate-x-1/2 so the open animation's transform doesn't fight
        // the centering transform.
        "fixed inset-x-0 top-[10vh] z-[101] mx-auto w-[min(92vw,640px)]",
        "overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-2xl",
        "will-change-transform",
        "data-[state=open]:animate-[opa-dialog-drop-in_160ms_cubic-bezier(0.16,1,0.3,1)]",
        "data-[state=closed]:animate-[opa-dialog-drop-out_120ms_ease-in]"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border pl-4 pr-2 md:pr-4">
        <Search className="h-4 w-4 shrink-0 text-fg-secondary" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Suchen: Praxen, Anfragen, Operations, Umsatz…"
          className={cn(
            "flex h-12 w-full bg-transparent text-base text-fg-primary",
            "placeholder:text-fg-tertiary focus:outline-none"
          )}
        />
        <kbd className="hidden items-center rounded border border-border bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary md:inline-flex">
          Esc
        </kbd>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Suche schließen"
          className={cn(
            "-mr-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-fg-secondary transition-colors",
            "hover:bg-bg-secondary hover:text-fg-primary",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-fg-primary",
            "md:hidden"
          )}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-4 py-6 text-center text-sm text-fg-secondary">
          Keine Treffer. Versuchen Sie ein anderes Stichwort.
        </Command.Empty>

        {/* Pinned — only when no query. Drag handle + filled pin icon. */}
        {!hasQuery && pinned.length > 0 && (
          <Command.Group
            heading={<GroupHeading icon={Pin} label="Schnellzugriff" />}
          >
            {pinned.map((item) => (
              <ResultItem
                key={`pin-${item.id}`}
                value={`pin-${item.id}`}
                title={item.title}
                subtitle={item.subtitle}
                keywords={[item.title, item.subtitle]}
                onSelect={() => handleSelect(item)}
                isPinned
                onTogglePin={() => togglePin(item)}
                draggable
                isDragging={dragId === item.id}
                isDragOver={dragOverId === item.id && dragId !== null && dragId !== item.id}
                onDragStart={handleDragStart(item.id)}
                onDragOver={handleDragOver(item.id)}
                onDragEnd={handleDragEnd}
                onDrop={handleDrop(item.id)}
              />
            ))}
          </Command.Group>
        )}

        {/* No query → recent, with pinned entries de-duped */}
        {!hasQuery && recent.filter((i) => !pinnedIds.has(i.id)).length > 0 && (
          <Command.Group
            heading={<GroupHeading icon={Clock} label="Zuletzt besucht" />}
          >
            {recent
              .filter((i) => !pinnedIds.has(i.id))
              .map((item) => (
                <ResultItem
                  key={`recent-${item.id}`}
                  value={`recent-${item.id}`}
                  title={item.title}
                  subtitle={item.subtitle}
                  keywords={[item.title, item.subtitle]}
                  onSelect={() => handleSelect(item)}
                  isPinned={false}
                  onTogglePin={() => togglePin(item)}
                />
              ))}
          </Command.Group>
        )}

        {!hasQuery && (
          <Command.Group
            heading={<GroupHeading icon={Sparkles} label="Schnellaktionen" />}
          >
            {!pinnedIds.has("quick-praxen") && (
              <ResultItem
                value="quick-praxen"
                title="Praxen öffnen"
                subtitle="/admin/clinics"
                keywords={["praxen", "clinics", "kunden"]}
                onSelect={() =>
                  handleSelect({
                    id: "quick-praxen",
                    title: "Praxen öffnen",
                    subtitle: "/admin/clinics",
                    href: "/admin/clinics",
                  })
                }
                isPinned={false}
                onTogglePin={() =>
                  togglePin({
                    id: "quick-praxen",
                    title: "Praxen öffnen",
                    subtitle: "/admin/clinics",
                    href: "/admin/clinics",
                  })
                }
              />
            )}
            {!pinnedIds.has("quick-operations") && (
              <ResultItem
                value="quick-operations"
                title="Operations öffnen"
                subtitle="/admin/operations"
                keywords={["operations", "sla", "queue"]}
                onSelect={() =>
                  handleSelect({
                    id: "quick-operations",
                    title: "Operations öffnen",
                    subtitle: "/admin/operations",
                    href: "/admin/operations",
                  })
                }
                isPinned={false}
                onTogglePin={() =>
                  togglePin({
                    id: "quick-operations",
                    title: "Operations öffnen",
                    subtitle: "/admin/operations",
                    href: "/admin/operations",
                  })
                }
              />
            )}
          </Command.Group>
        )}

        {/* Static admin destinations. When idle (no query), hide entries that
            already appear in Schnellzugriff to avoid showing them twice. */}
        {navEntries.length > 0 && (
          <Command.Group
            heading={<GroupHeading icon={Compass} label="Navigation" />}
          >
            {navEntries.map((entry) => {
              const pinItem: PinnedItem = {
                id: entry.id,
                title: entry.title,
                subtitle: entry.subtitle ?? "",
                href: entry.href,
              };
              return (
                <ResultItem
                  key={entry.id}
                  value={entry.id}
                  title={entry.title}
                  subtitle={entry.subtitle}
                  keywords={[entry.title, ...(entry.subtitle ? [entry.subtitle] : []), ...entry.keywords]}
                  onSelect={() => handleSelect(pinItem)}
                  isPinned={pinnedIds.has(entry.id)}
                  onTogglePin={() => togglePin(pinItem)}
                />
              );
            })}
          </Command.Group>
        )}
      </Command.List>

      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-fg-tertiary">
        <span>
          <kbd className="rounded border border-border bg-bg-secondary px-1 py-0.5 font-mono">↑↓</kbd>{" "}
          navigieren
        </span>
        <span>
          <kbd className="rounded border border-border bg-bg-secondary px-1 py-0.5 font-mono">↵</kbd>{" "}
          öffnen
        </span>
        <span>
          <kbd className="rounded border border-border bg-bg-secondary px-1 py-0.5 font-mono">esc</kbd>{" "}
          schliessen
        </span>
      </div>
    </Command.Dialog>
  );
}

function GroupHeading({
  icon: Icon,
  label,
}: {
  icon: typeof Hash;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-normal text-fg-tertiary">
      <Icon className="h-3 w-3" />
      <span>{label}</span>
    </div>
  );
}

interface ResultItemProps {
  value: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  onSelect: () => void;
  /** When true, render a filled pin icon and surface the unpin tooltip. */
  isPinned?: boolean;
  /** Toggle pin state. When omitted, the pin button is hidden. */
  onTogglePin?: () => void;
  /** When true, the row is a drag source and shows the GripVertical handle. */
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onDrop?: (e: ReactDragEvent<HTMLDivElement>) => void;
}

function ResultItem({
  value,
  title,
  subtitle,
  keywords,
  onSelect,
  isPinned,
  onTogglePin,
  draggable,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: ResultItemProps) {
  return (
    <Command.Item
      value={value}
      keywords={keywords}
      onSelect={onSelect}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm",
        "text-fg-primary aria-selected:bg-bg-secondary",
        "data-[selected=true]:bg-bg-secondary",
        draggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        isDragOver && "border-t-2 border-fg-primary"
      )}
    >
      {draggable ? (
        <GripVertical
          className="h-4 w-4 shrink-0 text-fg-tertiary group-aria-selected:text-fg-primary"
          aria-hidden
        />
      ) : (
        <Hash className="h-4 w-4 shrink-0 text-fg-tertiary group-aria-selected:text-fg-primary" />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        {subtitle && (
          <div className="truncate text-xs text-fg-secondary">{subtitle}</div>
        )}
      </div>
      {onTogglePin && (
        <button
          type="button"
          // Stop propagation across the events cmdk listens to so clicking
          // the pin button doesn't also trigger the row's onSelect.
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTogglePin();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          // Pin button is not itself a drag source — let users click it
          // freely inside a draggable row.
          draggable={false}
          aria-label={isPinned ? "Aus Schnellzugriff entfernen" : "An Schnellzugriff anheften"}
          title={isPinned ? "Aus Schnellzugriff entfernen" : "An Schnellzugriff anheften"}
          className={cn(
            "shrink-0 rounded p-1 transition-colors",
            isPinned
              ? "text-fg-primary hover:text-fg-secondary"
              : "text-fg-tertiary opacity-0 hover:text-fg-primary group-aria-selected:opacity-100 group-hover:opacity-100"
          )}
        >
          <Pin
            className="h-3.5 w-3.5"
            fill={isPinned ? "currentColor" : "none"}
            aria-hidden
          />
        </button>
      )}
      <ArrowRight className="h-4 w-4 shrink-0 text-fg-tertiary opacity-0 transition-opacity group-aria-selected:opacity-100" />
    </Command.Item>
  );
}
