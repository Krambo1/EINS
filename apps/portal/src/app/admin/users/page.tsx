import Link from "next/link";
import { Card, CardContent, Badge, MetricTile } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatNumber, formatRelative, formatDate } from "@/lib/formatting";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import {
  adminAllUsers,
  type AdminUserFilters,
  type AdminUserRow,
  type AdminUserStatus,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AdminTable, type AdminColumn } from "../_components/AdminTable";
import {
  AdminSearchInput,
  AdminUrlSelect,
  AdminUrlToggle,
} from "../_components/AdminFilters";

export const metadata = { title: "Nutzer · Admin" };

interface PageProps {
  searchParams: Promise<{
    role?: string;
    status?: string;
    search?: string;
    nie?: string;
  }>;
}

const ROLE_OPTIONS = [
  { value: "alle", label: "Rolle: alle" },
  { value: "inhaber", label: "Inhaber" },
  { value: "marketing", label: "Marketing-Verantwortlicher" },
  { value: "frontdesk", label: "Frontdesk" },
];
const STATUS_OPTIONS = [
  { value: "alle", label: "Status: alle" },
  { value: "active", label: "Aktiv" },
  { value: "invited", label: "Eingeladen" },
  { value: "archived", label: "Archiviert" },
];

const STATUS_LABEL: Record<AdminUserStatus, string> = {
  active: "Aktiv",
  invited: "Eingeladen",
  archived: "Archiviert",
};
const STATUS_TONE: Record<AdminUserStatus, "good" | "warn" | "neutral"> = {
  active: "good",
  invited: "warn",
  archived: "neutral",
};

function isStatus(v: string | undefined): v is AdminUserStatus {
  return v === "active" || v === "invited" || v === "archived";
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;

  const filters: AdminUserFilters = {
    role: params.role && params.role !== "alle" ? params.role : undefined,
    status: isStatus(params.status) ? params.status : undefined,
    search: params.search || undefined,
    neverLoggedIn: params.nie === "1",
  };

  const users = await adminAllUsers(filters);

  const total = users.length;
  const active = users.filter((u) => u.status === "active").length;
  const inhaber = users.filter((u) => u.role === "inhaber").length;
  const team = users.filter((u) => u.role !== "inhaber").length;
  const neverIn = users.filter(
    (u) => u.lastLoginAt == null && u.status !== "archived"
  ).length;

  const columns: AdminColumn<AdminUserRow>[] = [
    {
      key: "user",
      header: "Nutzer",
      render: (u) => (
        <>
          <div className="font-medium text-fg-primary">{u.fullName ?? "–"}</div>
          <div className="font-mono text-xs text-fg-secondary">{u.email}</div>
        </>
      ),
    },
    {
      key: "clinic",
      header: "Praxis",
      render: (u) => (
        <Link
          href={`/admin/clinics/${u.clinicId}`}
          className="text-fg-primary hover:text-accent"
        >
          {u.clinicName}
        </Link>
      ),
    },
    {
      key: "role",
      header: "Rolle",
      render: (u) => (
        <Badge tone={u.role === "inhaber" ? "good" : "neutral"}>
          {ROLE_LABELS[u.role as Role] ?? u.role}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => <Badge tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</Badge>,
    },
    {
      key: "lastLogin",
      align: "right",
      header: "Letzter Login",
      render: (u) => (
        <span className={u.lastLoginAt ? "text-fg-secondary" : "text-tone-warn"}>
          {u.lastLoginAt ? formatRelative(u.lastLoginAt) : "nie"}
        </span>
      ),
    },
    {
      key: "created",
      secondary: true,
      detailLabel: "Erstellt",
      header: "Erstellt",
      render: (u) => formatDate(u.createdAt),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Nutzer-Verwaltung"
        subtitle="Alle Benutzerkonten aller Praxen in einer Ansicht. Lesemodus; Verwaltung erfolgt durch den Inhaber im jeweiligen Portal."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricTile label="Nutzer gesamt" value={formatNumber(total)} sublabel="im aktuellen Filter" />
        <MetricTile label="Aktiv" value={formatNumber(active)} sublabel="mind. einmal eingeloggt" tone="accent" />
        <MetricTile
          label="Inhaber / Team"
          value={`${formatNumber(inhaber)} / ${formatNumber(team)}`}
          sublabel="Rollenverteilung"
        />
        <MetricTile
          label="Nie eingeloggt"
          value={formatNumber(neverIn)}
          sublabel="ohne ersten Login"
          tone={neverIn > 0 ? "warn" : "neutral"}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
            <AdminSearchInput placeholder="Name, E-Mail oder Praxis" />
            <AdminUrlSelect param="role" value={params.role ?? "alle"} options={ROLE_OPTIONS} />
            <AdminUrlSelect param="status" value={params.status ?? "alle"} options={STATUS_OPTIONS} />
            <AdminUrlToggle param="nie" checked={params.nie === "1"} label="Nie eingeloggt" />
          </div>
        </CardContent>
      </Card>

      <Card className="!p-0 overflow-hidden">
        <CardContent className="p-0">
          <AdminTable
            columns={columns}
            rows={users}
            getRowKey={(u) => u.id}
            empty="Keine Nutzer passen zu den aktuellen Filtern."
          />
        </CardContent>
      </Card>
    </div>
  );
}
