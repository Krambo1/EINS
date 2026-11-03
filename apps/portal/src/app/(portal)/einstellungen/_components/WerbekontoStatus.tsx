import { cn } from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { formatRelative } from "@/lib/formatting";

/**
 * Where one ad account stands. "page": Meta is connected, but no Facebook
 * page is chosen, so no Anfragen arrive from Meta forms. "unavailable": the
 * platform is not set up in this environment.
 */
export type WerbekontoState = "missing" | "unavailable" | "ok" | "page" | "error";

const STATUS_DOT: Record<WerbekontoState, string> = {
  ok: "bg-tone-good",
  missing: "bg-[var(--border-hover)]",
  unavailable: "bg-[var(--border-hover)]",
  page: "bg-tone-warn",
  error: "bg-tone-bad",
};

/**
 * The status line of a row in the Werbekonten card: a dot plus plain text
 * (DESIGN.md §5, no badges), one line; the details wait in the explainer.
 * It came from the Werbebudget page's Plattformen rows when that page was
 * retired (Karam, 2026-10-30: the accounts and their status live here, not
 * on the Übersicht).
 */
export function WerbekontoStatus({
  state,
  lastSyncedAt,
  accountId,
  pageId,
  error,
}: {
  state: WerbekontoState;
  lastSyncedAt: Date | null;
  accountId: string | null;
  /** Meta only: the bound Facebook page. */
  pageId?: string | null;
  /** last_sync_error, shown for "error". */
  error: string | null;
}) {
  const text =
    state === "ok"
      ? lastSyncedAt
        ? `Verbunden, Abgleich ${formatRelative(lastSyncedAt)}`
        : "Verbunden, noch kein Abgleich"
      : state === "missing"
        ? "Nicht verbunden"
        : state === "unavailable"
          ? "Nicht eingerichtet"
          : state === "page"
            ? "Facebook-Seite fehlt"
            : "Synchronisierung fehlgeschlagen";
  return (
    <div className="mt-1 flex min-h-6 items-center gap-1.5 text-sm text-fg-primary">
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[state])} />
      <span>{text}</span>
      {state === "ok" && accountId && (
        <ExplainerPopover term="Werbekonto">
          <p>Verbunden ist das Werbekonto mit der ID {accountId}.</p>
          {pageId && (
            <p>
              Anfragen aus Meta-Formularen kommen über die Facebook-Seite mit
              der ID {pageId}.
            </p>
          )}
        </ExplainerPopover>
      )}
      {state === "unavailable" && (
        <ExplainerPopover term="Nicht eingerichtet">
          <p>
            Diese Verbindung ist in Ihrer Umgebung noch nicht eingerichtet.
            Bitte wenden Sie sich an EINS.
          </p>
        </ExplainerPopover>
      )}
      {state === "page" && (
        <ExplainerPopover term="Facebook-Seite">
          <p>
            Ohne gewählte Facebook-Seite kommen keine Anfragen aus
            Meta-Formularen in Ihr Portal. Verwaltet Ihr Facebook-Konto mehrere
            Seiten, wählen Sie die Seite Ihrer Praxis.
          </p>
        </ExplainerPopover>
      )}
      {state === "error" && error && (
        <ExplainerPopover term="Synchronisierung">
          <p>{error}</p>
        </ExplainerPopover>
      )}
    </div>
  );
}
