import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from "@eins/ui";
import {
  CheckCircle2,
  Circle,
  Download,
  Link2,
  Lock,
  ShieldCheck,
} from "lucide-react";
import {
  BLOCKER_CHECKLIST_IDS,
  CHECKLIST_BLOCKS,
  REQUIRED_CHECKLIST_IDS,
  isClosed,
  isDelivered,
  type ChecklistAnswer,
  type ChecklistItem,
  type ChecklistStatus,
} from "@/app/(portal)/onboarding/checkliste/content";
import { setChecklistItemVerifiedAction } from "../actions";

export interface ChecklisteTabItemState {
  status: ChecklistStatus;
  answer: ChecklistAnswer;
  files: { id: string; name: string; sizeBytes: number; url: string }[];
  deliveredAt: Date | null;
  verifiedAt: Date | null;
  verifiedBy: string | null;
}

export interface ChecklisteTabData {
  clinicId: string;
  states: Record<string, ChecklisteTabItemState>;
}

/**
 * Admin view of the clinic's Asset-Liefer-Checkliste. Read-only recap of every
 * item plus the second-stage confirmation: EINS marks a delivered item
 * 'geprueft' (or takes the confirmation back). Blockers (Block A) are
 * highlighted because they gate the Leistungsstart.
 */
export function ChecklisteTab({ data }: { data: ChecklisteTabData }) {
  const { states, clinicId } = data;

  const requiredDelivered = REQUIRED_CHECKLIST_IDS.filter((id) =>
    isDelivered(states[id]?.status)
  ).length;
  const requiredTotal = REQUIRED_CHECKLIST_IDS.length;
  const blockerClosed = BLOCKER_CHECKLIST_IDS.filter((id) =>
    isClosed(states[id]?.status)
  ).length;
  const blockerTotal = BLOCKER_CHECKLIST_IDS.length;
  const anyTouched = Object.values(states).some((s) => s.status !== "offen");

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
          <Metric
            label="Pflichtpunkte geliefert"
            value={`${requiredDelivered} / ${requiredTotal}`}
          />
          <Metric
            label="Blocker erledigt (geprüft)"
            value={`${blockerClosed} / ${blockerTotal}`}
            tone={blockerClosed === blockerTotal ? "good" : "warn"}
          />
          {!anyTouched && (
            <span className="text-sm text-fg-secondary">
              Die Praxis hat noch nichts geliefert.
            </span>
          )}
        </CardContent>
      </Card>

      {CHECKLIST_BLOCKS.map((block) => (
        <Card key={block.key}>
          <CardHeader>
            <CardTitle>
              Block {block.key}: {block.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {block.items.map((item) => (
                <AdminItemRow
                  key={item.id}
                  item={item}
                  clinicId={clinicId}
                  state={
                    states[item.id] ?? {
                      status: "offen",
                      answer: {},
                      files: [],
                      deliveredAt: null,
                      verifiedAt: null,
                      verifiedBy: null,
                    }
                  }
                />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AdminItemRow({
  item,
  state,
  clinicId,
}: {
  item: ChecklistItem;
  state: ChecklisteTabItemState;
  clinicId: string;
}) {
  const delivered = state.status === "geliefert" || state.status === "geprueft";
  const verified = state.status === "geprueft";
  const entfaellt = state.status === "entfaellt";

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        item.blocker ? "border-[var(--tone-bad-border)]" : "border-border"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {verified ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-tone-good" />
          ) : delivered ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          ) : (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-fg-tertiary" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-xs text-fg-tertiary">
                {item.id}
              </span>
              <span className="text-sm font-medium text-fg-primary">
                {item.title}
              </span>
              {item.blocker && <Badge tone="bad">Blocker</Badge>}
              {!item.required && (
                <span className="text-xs text-fg-tertiary">
                  {item.recommended ? "empfohlen" : "optional"}
                </span>
              )}
              {item.role === "inhaber" && (
                <span className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
                  <Lock className="h-3 w-3" /> Inhaber
                </span>
              )}
            </div>
          </div>
        </div>
        <StatusBadge status={state.status} required={item.required} />
      </div>

      {/* Delivered content */}
      <div className="mt-2 space-y-2 pl-6">
        {state.status === "offen" && (
          <p className="text-sm text-fg-tertiary">Noch nicht geliefert.</p>
        )}
        {entfaellt && (
          <p className="text-sm text-fg-secondary">
            Als nicht vorhanden gemeldet, wird gemeinsam angelegt.
          </p>
        )}

        {delivered && (
          <>
            <Answers item={item} answer={state.answer} />

            {state.files.length > 0 && (
              <ul className="space-y-1">
                {state.files.map((f) => (
                  <li key={f.id}>
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-fg-primary hover:text-accent"
                    >
                      <Download className="h-4 w-4" />
                      {f.name}
                      <span className="text-fg-tertiary">
                        ({formatBytes(f.sizeBytes)})
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {verified ? (
                <>
                  <span className="text-xs text-tone-good">
                    Geprüft
                    {state.verifiedAt
                      ? ` am ${formatDate(state.verifiedAt)}`
                      : ""}
                    {state.verifiedBy ? ` von ${state.verifiedBy}` : ""}
                  </span>
                  <form action={setChecklistItemVerifiedAction}>
                    <input type="hidden" name="clinicId" value={clinicId} />
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="verified" value="0" />
                    <Button type="submit" variant="outline" size="sm">
                      Prüfung zurücknehmen
                    </Button>
                  </form>
                </>
              ) : (
                <form action={setChecklistItemVerifiedAction}>
                  <input type="hidden" name="clinicId" value={clinicId} />
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="verified" value="1" />
                  <Button type="submit" size="sm">
                    <ShieldCheck className="h-4 w-4" />
                    Als geprüft bestätigen
                  </Button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Answers({
  item,
  answer,
}: {
  item: ChecklistItem;
  answer: ChecklistAnswer;
}) {
  const rows: { label: string; value: string }[] = [];
  if (answer.keineVorhanden === true) {
    rows.push({ label: "Angabe", value: "Keine vorhanden" });
  }
  for (const field of item.fields ?? []) {
    const v = answer[field.key];
    if (typeof v === "string" && v.trim()) {
      rows.push({ label: field.label, value: v });
    }
  }
  const link = typeof answer.link === "string" ? answer.link : "";

  if (rows.length === 0 && !link) return null;

  return (
    <dl className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="text-sm">
          <dt className="text-fg-secondary">{r.label}</dt>
          <dd className="whitespace-pre-wrap text-fg-primary">{r.value}</dd>
        </div>
      ))}
      {link && (
        <div className="text-sm">
          <dt className="text-fg-secondary">Link</dt>
          <dd>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-fg-primary hover:text-accent"
            >
              <Link2 className="h-4 w-4" />
              <span className="break-all">{link}</span>
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}

function StatusBadge({
  status,
  required,
}: {
  status: ChecklistStatus;
  required: boolean;
}) {
  if (status === "geprueft") return <Badge tone="good">Geprüft</Badge>;
  if (status === "geliefert") return <Badge tone="accent">Geliefert</Badge>;
  if (status === "entfaellt") return <Badge>Entfällt</Badge>;
  if (required) return <Badge tone="warn">Offen</Badge>;
  return <Badge>Offen</Badge>;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "warn";
}) {
  return (
    <div>
      <div className="text-xs text-fg-secondary">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "good"
            ? "text-tone-good"
            : tone === "warn"
              ? "text-tone-warn"
              : "text-fg-primary"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
