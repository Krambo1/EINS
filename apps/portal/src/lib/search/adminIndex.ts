import type { SearchEntry } from "./types";

/**
 * Hand-curated index of every admin destination. Mirrors the NAV_GROUPS in
 * AdminShell plus a few deep links. No `permission` gates — everyone behind
 * the admin boundary sees everything (auth lives in admin/layout.tsx).
 *
 * Adding a new entry: pick a stable kebab-case id ("admin-nav-…") and include
 * German + English keywords so bilingual typing works.
 */
export const ADMIN_INDEX: SearchEntry[] = [
  // ─── Steuerung ──────────────────────────────────────────────────────────
  {
    kind: "nav",
    id: "admin-nav-uebersicht",
    title: "Übersicht",
    subtitle: "Steuerung · Plattform-Kennzahlen",
    href: "/admin",
    keywords: ["uebersicht", "dashboard", "overview", "home", "start", "kennzahlen", "metrics"],
  },
  {
    kind: "nav",
    id: "admin-nav-clinics",
    title: "Praxen",
    subtitle: "Steuerung · alle Kunden-Praxen",
    href: "/admin/clinics",
    keywords: ["praxen", "praxis", "clinics", "kunden", "customers", "accounts"],
  },

  // ─── Akquise ────────────────────────────────────────────────────────────
  {
    kind: "nav",
    id: "admin-nav-leads",
    title: "Leads",
    subtitle: "Akquise · Anfragen über alle Praxen",
    href: "/admin/leads",
    keywords: ["leads", "anfragen", "requests", "inbox", "pipeline"],
  },
  {
    kind: "nav",
    id: "admin-nav-leistung",
    title: "Leistung",
    subtitle: "Akquise · Kampagnen und Werbeertrag",
    href: "/admin/leistung",
    keywords: ["leistung", "performance", "kampagne", "campaign", "werbeertrag", "roas", "anzeigen", "ads", "budget"],
  },

  // ─── Betrieb ────────────────────────────────────────────────────────────
  {
    kind: "nav",
    id: "admin-nav-operations",
    title: "Operations",
    subtitle: "Betrieb · SLA, Animationen, Sync-Fehler",
    href: "/admin/operations",
    keywords: ["operations", "betrieb", "sla", "breach", "animationen", "sync", "fehler", "errors", "queue"],
  },
  {
    kind: "nav",
    id: "admin-nav-integrations",
    title: "Integrationen",
    subtitle: "Betrieb · Meta, Google, Verbindungen",
    href: "/admin/integrations",
    keywords: ["integrationen", "integrations", "meta", "google", "oauth", "verbindung", "connection", "health"],
  },
  {
    kind: "nav",
    id: "admin-nav-pvs-bridge",
    title: "PVS-Bridge",
    subtitle: "Betrieb · Praxis-Verwaltungssysteme",
    href: "/admin/pvs-bridge",
    keywords: ["pvs", "bridge", "charlytel", "tomedo", "dampsoft", "agent", "sync", "verwaltungssystem"],
  },

  // ─── Wachstum ───────────────────────────────────────────────────────────
  {
    kind: "nav",
    id: "admin-nav-revenue",
    title: "Umsatz",
    subtitle: "Wachstum · Umsatz über alle Praxen",
    href: "/admin/revenue",
    keywords: ["umsatz", "revenue", "einnahmen", "euro", "honorar", "geld"],
  },
  {
    kind: "nav",
    id: "admin-nav-onboarding",
    title: "Onboarding",
    subtitle: "Wachstum · Fragebogen und Checkliste",
    href: "/admin/onboarding",
    keywords: ["onboarding", "fragebogen", "checkliste", "checklist", "discovery", "start", "neukunde"],
  },
  {
    kind: "nav",
    id: "admin-nav-journey",
    title: "Standard-Journey",
    subtitle: "Wachstum · Fortschritts-Vorlage",
    href: "/admin/journey",
    keywords: ["journey", "standard", "vorlage", "template", "fortschritt", "meilenstein", "milestone", "plan"],
  },

  // ─── System ─────────────────────────────────────────────────────────────
  {
    kind: "nav",
    id: "admin-nav-users",
    title: "Nutzer",
    subtitle: "System · alle Portal-Nutzer",
    href: "/admin/users",
    keywords: ["nutzer", "users", "benutzer", "accounts", "team", "rollen", "roles"],
  },
  {
    kind: "nav",
    id: "admin-nav-audit",
    title: "Audit",
    subtitle: "System · Aktionen und Verlauf",
    href: "/admin/audit",
    keywords: ["audit", "log", "aktionen", "history", "verlauf", "protokoll"],
  },
];
