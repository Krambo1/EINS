import {
  AI_CATEGORIES,
  ALL_REQUEST_STATUSES,
  REQUEST_SORTS,
  REQUEST_SOURCES,
  type AiCategory,
  type AnyRequestStatus,
  type RequestSort,
} from "@/lib/constants";
import { isUuid } from "@/lib/ids";

/**
 * URL parameters of the Anfragen list (/anfragen and the CSV export). Values
 * come from hand-edited or old bookmarks too, so everything is validated
 * against the known sets: unknown values are dropped instead of reaching the
 * database (C-22).
 */
export type AnfragenSearchParams = Record<string, string | string[] | undefined>;

export interface AnfragenListParams {
  page: number;
  status?: AnyRequestStatus[];
  source?: string[];
  aiCategory?: AiCategory[];
  treatmentId?: string[];
  search?: string;
  slaBreachedOnly: boolean;
  staleOnly: boolean;
  sort: RequestSort;
}
export const SEARCH_MAX_LENGTH = 200;

/** Keys that define the list (filters + sort). `page` is handled separately. */
export const LIST_PARAM_KEYS = [
  "status",
  "source",
  "aiCategory",
  "treatment",
  "search",
  "slaBreached",
  "stale",
  "sort",
] as const;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function csv<T extends string>(
  raw: string | undefined,
  accept: (s: string) => s is T
): T[] | undefined {
  if (!raw) return undefined;
  const items = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(accept)
    ),
  ];
  return items.length > 0 ? items : undefined;
}

const inSet =
  <T extends string>(set: readonly T[]) =>
  (s: string): s is T =>
    (set as readonly string[]).includes(s);

export function parseAnfragenParams(params: AnfragenSearchParams): AnfragenListParams {
  const pageRaw = Number(first(params.page));
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const sortRaw = first(params.sort) ?? "";
  const search = first(params.search)?.trim().slice(0, SEARCH_MAX_LENGTH) || undefined;

  return {
    page,
    status: csv(first(params.status), inSet(ALL_REQUEST_STATUSES)),
    source: csv(first(params.source), inSet(REQUEST_SOURCES)),
    aiCategory: csv(first(params.aiCategory), inSet(AI_CATEGORIES)),
    treatmentId: csv(first(params.treatment), (s): s is string => isUuid(s)),
    search,
    slaBreachedOnly: first(params.slaBreached) === "1",
    staleOnly: first(params.stale) === "1",
    sort: inSet(REQUEST_SORTS)(sortRaw) ? sortRaw : "neueste",
  };
}

/** True when any filter (not the sort) narrows the list. */
export function hasListFilter(p: AnfragenListParams): boolean {
  return Boolean(
    p.status?.length ||
      p.source?.length ||
      p.aiCategory?.length ||
      p.treatmentId?.length ||
      p.search ||
      p.slaBreachedOnly ||
      p.staleOnly
  );
}

/**
 * Query string carrying every filter and the sort of the current URL, with
 * `page` set (or dropped for page 1). Keeps the list identical across
 * Zurück/Weiter (C-21).
 */
export function listQueryString(params: AnfragenSearchParams, page?: number): string {
  const qs = new URLSearchParams();
  for (const key of LIST_PARAM_KEYS) {
    const v = first(params[key]);
    if (v) qs.set(key, v);
  }
  if (page && page > 1) qs.set("page", String(page));
  return qs.toString();
}
