"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@eins/ui";
import { DOCUMENT_KIND_LABELS, type DocumentKind } from "@/lib/constants";

const KIND_KEYS = Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[];
// Radix Select items can't carry an empty value, so the "show everything"
// option uses a sentinel that maps back to the clean /dokumente URL.
const ALL = "alle";

/**
 * Mobile-only Dokumentart-Filter. On small screens the desktop pill row wraps
 * into a messy block, so we collapse it into a single dropdown. Each change
 * navigates via the `?kind=` query param, exactly like the pill links, so the
 * server component stays the single source of truth.
 */
export function KindFilterSelect({ kind }: { kind?: DocumentKind }) {
  const router = useRouter();
  return (
    <Select
      value={kind ?? ALL}
      onValueChange={(v) =>
        router.push(v === ALL ? "/dokumente" : `/dokumente?kind=${v}`)
      }
    >
      {/* Render the label from the URL-derived prop rather than Radix's
          SelectValue: Radix only resolves an item's text after the dropdown
          content has mounted once, so a fresh load of ?kind=… would otherwise
          show an empty trigger. */}
      <SelectTrigger className="h-11" aria-label="Nach Dokumentart filtern">
        <span className="truncate">
          {kind ? DOCUMENT_KIND_LABELS[kind] : "Alle"}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Alle</SelectItem>
        {KIND_KEYS.map((k) => (
          <SelectItem key={k} value={k}>
            {DOCUMENT_KIND_LABELS[k]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
