import type { Permission } from "@/lib/roles";

export type SearchKind = "nav";

export interface SearchEntry {
  kind: SearchKind;
  /** Stable id — used as the cmdk value. Must be unique across the whole index. */
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** Search keywords (German + English). Folded for umlaut-insensitive match. */
  keywords: string[];
  /** RBAC gate — entry is hidden when the user lacks this permission. */
  permission?: Permission;
}
