import {
  ALL_REQUEST_STATUSES,
  REQUEST_SORTS,
  type AnyRequestStatus,
  type RequestSort,
} from "@/lib/constants";
import { isUuid } from "@/lib/ids";
import { REPORTING_CHANNELS, type ReportingChannel } from "@/lib/sources";
import { RETREATMENT_LIST_FILTERS, type RetreatmentListFilter } from "@/lib/retreatment";

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
  /** `source`: the Quelle filter, as reporting channels (the Quellen card's buckets). */
  channel?: ReportingChannel[];
  treatmentId?: string[];
  search?: string;
  slaBreachedOnly: boolean;
  staleOnly: boolean;
  /** `wb`: Anfragen with a Wiederbehandlung (offen, ausgeblendet). */
  retreatment?: RetreatmentListFilter[];
  sort: RequestSort;
}
export const SEARCH_MAX_LENGTH = 200;

/** Keys that define the list (filters + sort). `page` is handled separately. */
export const LIST_PARAM_KEYS = [
  "status",
  "source",
  "treatment",
  "search",
  "slaBreached",
  "stale",
  "wb",
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
    channel: csv(first(params.source), inSet(REPORTING_CHANNELS)),
    treatmentId: csv(first(params.treatment), (s): s is string => isUuid(s)),
    search,
    slaBreachedOnly: first(params.slaBreached) === "1",
    staleOnly: first(params.stale) === "1",
    retreatment: csv(first(params.wb), inSet(RETREATMENT_LIST_FILTERS)),
    sort: inSet(REQUEST_SORTS)(sortRaw) ? sortRaw : "neueste",
  };
}

/** True when any filter (not the sort) narrows the list. */
export function hasListFilter(p: AnfragenListParams): boolean {
  return Boolean(
    p.status?.length ||
      p.channel?.length ||
      p.treatmentId?.length ||
      p.search ||
      p.slaBreachedOnly ||
      p.staleOnly ||
      p.retreatment?.length
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
