import Link from "next/link";
import { Card, CardContent, Badge, MetricTile } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatNumber, formatRelative } from "@/lib/formatting";
import {
  adminOnboardingStatus,
  type AdminOnboardingRow,
  type OnboardingStage,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AdminTable, type AdminColumn } from "../_components/AdminTable";
import { FunnelBar } from "../_charts/FunnelBar";

export const metadata = { title: "Onboarding · Admin" };

const GLOW_CARD = "!bg-bg-secondary";

const STAGE_ORDER: OnboardingStage[] = [
  "registriert",
  "integration_verbunden",
  "erste_anfrage",
  "schulung_bestanden",
  "aktiv",
];
const STAGE_LABEL: Record<OnboardingStage, string> = {
  registriert: "Registriert",
  integration_verbunden: "Integration verbunden",
  erste_anfrage: "Erste Anfrage",
  schulung_bestanden: "Schulung bestanden",
  aktiv: "Aktiv",
};
const STAGE_TONE: Record<OnboardingStage, "neutral" | "accent" | "warn" | "good"> = {
  registriert: "neutral",
  integration_verbunden: "accent",
  erste_anfrage: "accent",
  schulung_bestanden: "warn",
  aktiv: "good",
};

export default async function AdminOnboardingPage() {
  await requireAdmin();

  const rows = await adminOnboardingStatus();

  const newClinics = rows.filter((r) => r.daysSinceSignup <= 30).length;
  const inOnboarding = rows.filter((r) => r.stage !== "aktiv").length;
  const trainingPending = rows.filter((r) => !r.quizPassed).length;
  const stuck = rows.filter((r) => r.stuck).length;

  // Exact-stage buckets — every clinic sits in one stage, so the segments sum
  // to the clinic count (FunnelBar's stacked-distribution model).
  const stageCounts = STAGE_ORDER.map((stage) => ({
    stage,
    count: rows.filter((r) => r.stage === stage).length,
  }));
  const funnelStages = stageCounts.map(({ stage, count }) => ({
    label: STAGE_LABEL[stage],
    count,
    tone: STAGE_TONE[stage],
  }));

  // Attention first: stuck, then earliest stage, then longest waiting.
  const sorted = [...rows].sort((a, b) => {
    if (a.stuck !== b.stuck) return a.stuck ? -1 : 1;
    const stageDiff = STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage);
    if (stageDiff !== 0) return stageDiff;
    return b.daysSinceSignup - a.daysSinceSignup;
  });

  const yesNo = (v: boolean) =>
    v ? <span className="text-tone-good">Ja</span> : <span className="text-fg-tertiary">Nein</span>;

  const columns: AdminColumn<AdminOnboardingRow>[] = [
    {
      key: "name",
      header: "Praxis",
      render: (c) => (
        <>
          <Link
            href={`/admin/clinics/${c.clinicId}`}
            className="font-medium text-fg-primary hover:text-accent"
          >
            {c.clinicName}
          </Link>
          <div className="font-mono text-xs text-fg-secondary">{c.slug}</div>
        </>
      ),
    },
    {
      key: "stage",
      header: "Phase",
      render: (c) => (
        <span className="inline-flex items-center gap-2">
          <Badge tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</Badge>
          {c.stuck && <Badge tone="bad">Stuck</Badge>}
        </span>
      ),
    },
    {
      key: "days",
      align: "right",
      header: "Tage seit Start",
      render: (c) => <span className="font-mono">{formatNumber(c.daysSinceSignup)}</span>,
    },
    {
      key: "activity",
      align: "right",
      header: "Letzte Aktivität",
      render: (c) => (
        <span className={c.stuck ? "text-tone-bad" : "text-fg-secondary"}>
          {c.lastActivityAt ? formatRelative(c.lastActivityAt) : "keine"}
        </span>
      ),
    },
    {
      key: "integration",
      secondary: true,
      detailLabel: "Integration verbunden",
      header: "Integration",
      render: (c) => yesNo(c.hasIntegration),
    },
    {
      key: "firstRequest",
      secondary: true,
      detailLabel: "Erste Anfrage",
      header: "Erste Anfrage",
      render: (c) => yesNo(c.hasFirstRequest),
    },
    {
      key: "training",
      secondary: true,
      detailLabel: "Schulung",
      header: "Schulung",
      render: (c) =>
        c.quizPassed ? (
          <span className="text-tone-good">
            bestanden
            {c.latestQuizScore != null && c.latestQuizTotal != null
              ? ` (${c.latestQuizScore}/${c.latestQuizTotal})`
              : ""}
          </span>
        ) : (
          <span className="text-fg-tertiary">offen</span>
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Onboarding-Pipeline"
        subtitle="Wo steht jede neue Praxis? Von der Registrierung über Integration und erste Anfrage bis zur bestandenen Schulung."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Neue Praxen (30 T)" value={formatNumber(newClinics)} sublabel="seit Registrierung" tone="accent" />
        <MetricTile label="In Onboarding" value={formatNumber(inOnboarding)} sublabel="noch nicht aktiv" />
        <MetricTile
          label="Schulung ausstehend"
          value={formatNumber(trainingPending)}
          sublabel="Leitfaden noch nicht bestanden"
          tone={trainingPending > 0 ? "warn" : "neutral"}
        />
        <MetricTile
          label="Stuck"
          value={formatNumber(stuck)}
          sublabel="> 14 Tage ohne Aktivität"
          tone={stuck > 0 ? "bad" : "good"}
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">Verteilung nach Phase</h2>
          <FunnelBar stages={funnelStages} />
        </CardContent>
      </Card>

      <Card className={`${GLOW_CARD} !p-0 overflow-hidden`}>
        <CardContent className="p-0">
          <AdminTable
            columns={columns}
            rows={sorted}
            getRowKey={(c) => c.clinicId}
            empty="Keine aktiven Praxen im Onboarding."
          />
        </CardContent>
      </Card>
    </div>
  );
}
