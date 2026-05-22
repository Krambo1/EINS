"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@eins/ui";
import { Loader2, RotateCw } from "lucide-react";

interface EventDetail {
  id: string;
  clinicId: string;
  clinicDisplayName: string | null;
  bridgeSource: string;
  kind: string;
  pvsExternalEventId: string;
  occurredAt: string;
  receivedAt: string;
  ingestedAt: string;
  payload: Record<string, unknown>;
  workerEffect: { kind: "unlinked"; reason: string };
}

interface Props {
  eventId: string | null;
  onClose: () => void;
}

interface ReplayResult {
  ok: boolean;
  message: string;
  newEventLogId?: string | null;
  replayedExternalEventId?: string;
}

const dtFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function EventDetailDialog({ eventId, onClose }: Props) {
  const router = useRouter();
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [replaying, startReplay] = useTransition();

  useEffect(() => {
    if (!eventId) {
      setDetail(null);
      setLoadError(null);
      setReplayResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setReplayResult(null);
    fetch(`/api/admin/pvs/events/${eventId}`, {
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { code?: string };
          };
          throw new Error(body.error?.code ?? `HTTP ${res.status}`);
        }
        return (await res.json()) as EventDetail;
      })
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const open = eventId !== null;

  const onReplay = () => {
    if (!eventId) return;
    setReplayResult(null);
    startReplay(async () => {
      try {
        const res = await fetch(
          `/api/admin/pvs/events/${eventId}/replay`,
          { method: "POST", headers: { accept: "application/json" } }
        );
        const body = (await res.json().catch(() => ({}))) as {
          status?: string;
          newEventLogId?: string | null;
          replayedExternalEventId?: string;
          error?: { code?: string };
        };
        if (!res.ok) {
          setReplayResult({
            ok: false,
            message: `Replay fehlgeschlagen: ${body.error?.code ?? `HTTP ${res.status}`}`,
          });
          return;
        }
        setReplayResult({
          ok: true,
          message:
            body.status === "ingested"
              ? "Replay erfolgreich: neuer Event-Log-Eintrag erzeugt."
              : "Replay deduped — derselbe Suffix existiert bereits.",
          newEventLogId: body.newEventLogId ?? null,
          replayedExternalEventId: body.replayedExternalEventId,
        });
        // Refresh the server-rendered table so the new row appears
        // (if it's within the current filter window).
        router.refresh();
      } catch (err: unknown) {
        setReplayResult({
          ok: false,
          message:
            "Replay-Request fehlgeschlagen: " +
            (err instanceof Error ? err.message : String(err)),
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Event-Detail</DialogTitle>
          <DialogDescription>
            {detail
              ? `${detail.kind} · ${detail.bridgeSource}`
              : "Wird geladen …"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-fg-tertiary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lade Event-Detail …
          </div>
        )}

        {loadError && !loading && (
          <div className="rounded-md border border-tone-bad/40 bg-tone-bad/10 p-3 text-sm text-fg-primary">
            Konnte Event nicht laden: <code>{loadError}</code>
          </div>
        )}

        {detail && !loading && (
          <div className="space-y-4 overflow-y-auto pr-1" style={{ maxHeight: "60vh" }}>
            <section className="grid grid-cols-2 gap-3 text-xs">
              <Field label="Praxis" value={detail.clinicDisplayName ?? detail.clinicId} />
              <Field label="Clinic-ID" value={<code>{detail.clinicId}</code>} />
              <Field label="Adapter" value={detail.bridgeSource} />
              <Field label="Kind" value={detail.kind} />
              <Field
                label="Occurred at"
                value={dtFormatter.format(new Date(detail.occurredAt))}
              />
              <Field
                label="Received at"
                value={dtFormatter.format(new Date(detail.receivedAt))}
              />
              <Field
                label="Ingested at"
                value={dtFormatter.format(new Date(detail.ingestedAt))}
              />
              <Field
                label="External Event-ID"
                value={<code className="break-all">{detail.pvsExternalEventId}</code>}
              />
            </section>

            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                Payload (JSONB)
              </h3>
              <pre className="max-h-72 overflow-auto rounded-md border border-border bg-bg-secondary/40 p-3 text-[11px] leading-snug">
                {JSON.stringify(detail.payload, null, 2)}
              </pre>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                Signatur
              </h3>
              <p className="text-xs text-fg-secondary">
                Der HMAC-Header wird nicht persistiert. Bei Replay wird die
                Signatur aus dem aktuellen <code>pvs</code>-Secret der Praxis
                neu berechnet (siehe <code>applyPvsEvent</code>).
              </p>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                Worker-Effekt
              </h3>
              <p className="text-xs text-fg-secondary">
                Noch nicht verknüpft: {detail.workerEffect.reason}
              </p>
            </section>

            {replayResult && (
              <div
                className={
                  "rounded-md border p-3 text-xs " +
                  (replayResult.ok
                    ? "border-tone-good/40 bg-tone-good/10"
                    : "border-tone-bad/40 bg-tone-bad/10")
                }
              >
                <p>{replayResult.message}</p>
                {replayResult.replayedExternalEventId && (
                  <p className="mt-1 font-mono text-fg-tertiary">
                    Neue External-ID:{" "}
                    <code>{replayResult.replayedExternalEventId}</code>
                  </p>
                )}
                {replayResult.newEventLogId && (
                  <p className="mt-1 font-mono text-fg-tertiary">
                    Neuer Event-Log-ID:{" "}
                    <code>{replayResult.newEventLogId}</code>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Schließen
          </Button>
          <Button
            type="button"
            onClick={onReplay}
            disabled={!detail || replaying || loading}
          >
            {replaying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="mr-2 h-4 w-4" />
            )}
            Replay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-fg-tertiary">
        {label}
      </span>
      <span className="text-fg-primary">{value}</span>
    </div>
  );
}
