import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import {
  isSafeVendorId,
  parseTrustedKeys,
  verifyBundle,
  type VendorConfigBundle,
} from "./pvs-config-signature";

/**
 * Vendor-config distribution: what an agent is allowed to receive, and how a
 * new config gets into the table in the first place.
 *
 * ROLLOUT MODEL
 *   off   nobody. Every upload starts here, so publishing is never the same
 *         action as deploying.
 *   pilot only the Praxen pinned in pvs_vendor_config_target.
 *   all   every Praxis running that vendor, unless it is pinned elsewhere.
 *
 * A pin wins over the mode in both directions: it is how a pilot reaches its
 * first Praxis, and how one Praxis is held on a known-good version while a
 * newer one goes wide. Exactly one config per (clinic, vendor) can be pinned,
 * which the primary key enforces.
 */

export const ROLLOUT_MODES = ["off", "pilot", "all"] as const;
export type RolloutMode = (typeof ROLLOUT_MODES)[number];

export interface ManifestEntry {
  vendor: string;
  version: number;
  sha256: string;
}

function trustedKeys() {
  return parseTrustedKeys(env.PVS_CONFIG_PUBLIC_KEYS);
}

/** Whether this environment can accept config uploads at all. */
export function configSigningConfigured(): boolean {
  return trustedKeys().length > 0;
}

/**
 * The configs this clinic should be running, as (vendor, version, digest).
 *
 * Deliberately NOT filtered by which vendors the clinic actually runs. The
 * portal's picture of that comes from heartbeats, so filtering would leave a
 * freshly enabled adapter one heartbeat behind on its very first tick. The
 * agent ignores manifest entries for vendors it does not have, and the list is
 * at most one row per vendor.
 */
export async function resolveManifest(clinicId: string): Promise<ManifestEntry[]> {
  const rows = await db.execute<{
    vendor: string;
    version: number;
    sha256: string;
  }>(sql`
    WITH pinned AS (
      SELECT t.vendor, c.version, c.sha256
        FROM pvs_vendor_config_target t
        JOIN pvs_vendor_config c ON c.id = t.config_id
       WHERE t.clinic_id = ${clinicId}
         AND c.status = 'active'
    ),
    wide AS (
      SELECT DISTINCT ON (vendor) vendor, version, sha256
        FROM pvs_vendor_config
       WHERE status = 'active' AND rollout_mode = 'all'
       ORDER BY vendor, version DESC
    )
    SELECT vendor, version, sha256 FROM pinned
    UNION ALL
    SELECT w.vendor, w.version, w.sha256
      FROM wide w
     WHERE NOT EXISTS (SELECT 1 FROM pinned p WHERE p.vendor = w.vendor)
  `);
  return (rows as unknown as ManifestEntry[]).map((r) => ({
    vendor: r.vendor,
    version: Number(r.version),
    sha256: r.sha256,
  }));
}

/**
 * The full signed bundles for `vendors`, restricted to what this clinic is
 * actually entitled to.
 *
 * Resolution runs through the same query as the manifest rather than a plain
 * id lookup, so an agent that asks for a vendor it was never targeted with
 * gets nothing back. The bundle is returned verbatim from the `bundle` column:
 * re-assembling it from the individual columns could change field order or
 * whitespace and invalidate the offline signature.
 */
export async function resolveBundles(
  clinicId: string,
  vendors: string[]
): Promise<unknown[]> {
  const wanted = vendors.filter(isSafeVendorId);
  if (wanted.length === 0) return [];
  const manifest = await resolveManifest(clinicId);
  const eligible = manifest.filter((m) => wanted.includes(m.vendor));
  if (eligible.length === 0) return [];

  const rows = await db.execute<{ vendor: string; version: number; bundle: unknown }>(sql`
    SELECT vendor, version, bundle
      FROM pvs_vendor_config
     WHERE status = 'active'
       AND (vendor, version) IN (
         ${sql.join(
           eligible.map((e) => sql`(${e.vendor}, ${e.version})`),
           sql`, `
         )}
       )
  `);
  return (rows as unknown as Array<{ bundle: unknown }>).map((r) => r.bundle);
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

export type PublishResult =
  | { ok: true; vendor: string; version: number; id: string }
  | { ok: false; reason: string };

/**
 * Verify an uploaded bundle and store it. It reaches no Praxis until someone
 * sets a rollout: `rollout_mode` starts at 'off'.
 *
 * The version rule is the load-bearing one. Agents refuse anything at or below
 * the version they run, so a number that has already been used, or one below
 * the current top, would produce a config that publishes cleanly here and is
 * silently rejected on every machine. We refuse it at upload instead, with the
 * number to use next.
 */
export async function publishBundle(
  raw: unknown,
  uploadedByEmail: string | null
): Promise<PublishResult> {
  let input = raw;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      return { ok: false, reason: "Die Datei ist kein gültiges JSON." };
    }
  }

  const verified = verifyBundle(input, trustedKeys());
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const bundle: VendorConfigBundle = verified.bundle;

  if (!isSafeVendorId(bundle.vendor)) {
    return { ok: false, reason: `'${bundle.vendor}' ist keine gültige Vendor-Kennung.` };
  }

  const [top] = await db
    .select({ version: schema.pvsVendorConfig.version })
    .from(schema.pvsVendorConfig)
    .where(eq(schema.pvsVendorConfig.vendor, bundle.vendor))
    .orderBy(desc(schema.pvsVendorConfig.version))
    .limit(1);

  if (top && bundle.version <= top.version) {
    return {
      ok: false,
      reason:
        `Für ${bundle.vendor} ist bereits Version ${top.version} hinterlegt. ` +
        `Versionen dürfen nur steigen: signieren Sie die Datei erneut als Version ${top.version + 1}. ` +
        `Ein Zurücksetzen auf eine ältere Konfiguration geschieht ebenfalls als neue, höhere Version.`,
    };
  }

  const [row] = await db
    .insert(schema.pvsVendorConfig)
    .values({
      vendor: bundle.vendor,
      version: bundle.version,
      bridgeSource: bundle.bridgeSource,
      driver: bundle.driver,
      streams: bundle.streams as unknown as Record<string, unknown>,
      minAgentVersion: bundle.minAgentVersion,
      notes: bundle.notes,
      yaml: bundle.yaml,
      sha256: bundle.sha256,
      keyId: bundle.keyId,
      signature: bundle.signature,
      signedAt: new Date(bundle.signedAt),
      bundle: input as Record<string, unknown>,
      rolloutMode: "off",
      status: "active",
      uploadedByEmail,
    })
    .returning({ id: schema.pvsVendorConfig.id });

  return {
    ok: true,
    vendor: bundle.vendor,
    version: bundle.version,
    id: row!.id,
  };
}

export async function setRolloutMode(
  configId: string,
  mode: RolloutMode
): Promise<void> {
  await db
    .update(schema.pvsVendorConfig)
    .set({ rolloutMode: mode })
    .where(eq(schema.pvsVendorConfig.id, configId));
}

/**
 * Take a config out of circulation.
 *
 * This stops the portal ADVERTISING it; it does not reach into the Praxen that
 * already applied it. Those keep running it until a higher version replaces it,
 * which is the honest behaviour: nothing here can reach a machine that is
 * offline, and pretending otherwise would be worse than saying so in the UI.
 */
export async function revokeConfig(configId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.pvsVendorConfig)
      .set({ status: "revoked", rolloutMode: "off", revokedAt: new Date() })
      .where(eq(schema.pvsVendorConfig.id, configId));
    // Pins to a revoked config would otherwise hold those Praxen on nothing:
    // resolveManifest filters revoked rows out, so the pin would silently stop
    // delivering anything at all rather than falling back to the wide rollout.
    await tx
      .delete(schema.pvsVendorConfigTarget)
      .where(eq(schema.pvsVendorConfigTarget.configId, configId));
  });
}

export async function pinClinic(
  clinicId: string,
  configId: string,
  createdByEmail: string | null
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const [cfg] = await db
    .select({
      vendor: schema.pvsVendorConfig.vendor,
      status: schema.pvsVendorConfig.status,
    })
    .from(schema.pvsVendorConfig)
    .where(eq(schema.pvsVendorConfig.id, configId))
    .limit(1);
  if (!cfg) return { ok: false, reason: "Konfiguration nicht gefunden." };
  if (cfg.status !== "active") {
    return { ok: false, reason: "Diese Konfiguration ist zurückgezogen." };
  }

  await db
    .insert(schema.pvsVendorConfigTarget)
    .values({
      clinicId,
      vendor: cfg.vendor,
      configId,
      createdByEmail,
    })
    .onConflictDoUpdate({
      target: [
        schema.pvsVendorConfigTarget.clinicId,
        schema.pvsVendorConfigTarget.vendor,
      ],
      set: { configId, createdByEmail, createdAt: new Date() },
    });
  return { ok: true };
}

export async function unpinClinic(
  clinicId: string,
  vendor: string
): Promise<void> {
  await db
    .delete(schema.pvsVendorConfigTarget)
    .where(
      and(
        eq(schema.pvsVendorConfigTarget.clinicId, clinicId),
        eq(schema.pvsVendorConfigTarget.vendor, vendor)
      )
    );
}

// ---------------------------------------------------------------------------
// Read models for the admin UI
// ---------------------------------------------------------------------------

export interface VendorConfigRow {
  id: string;
  vendor: string;
  version: number;
  bridgeSource: string;
  driver: string;
  streams: string[];
  minAgentVersion: string;
  notes: string | null;
  sha256: string;
  keyId: string;
  signedAt: Date;
  rolloutMode: RolloutMode;
  status: string;
  uploadedByEmail: string | null;
  createdAt: Date;
  /** Praxen pinned to exactly this version. */
  pinnedClinics: number;
  /** Praxen whose last heartbeat reported this version in force. */
  runningClinics: number;
}

export async function listVendorConfigs(): Promise<VendorConfigRow[]> {
  const rows = await db.execute<{
    id: string;
    vendor: string;
    version: number;
    bridge_source: string;
    driver: string;
    streams: unknown;
    min_agent_version: string;
    notes: string | null;
    sha256: string;
    key_id: string;
    signed_at: Date;
    rollout_mode: string;
    status: string;
    uploaded_by_email: string | null;
    created_at: Date;
    pinned_clinics: number;
    running_clinics: number;
  }>(sql`
    SELECT
      c.id, c.vendor, c.version, c.bridge_source, c.driver, c.streams,
      c.min_agent_version, c.notes, c.sha256, c.key_id, c.signed_at,
      c.rollout_mode, c.status, c.uploaded_by_email, c.created_at,
      (SELECT COUNT(*) FROM pvs_vendor_config_target t WHERE t.config_id = c.id)
        AS pinned_clinics,
      (SELECT COUNT(*) FROM pvs_agent_status a
        WHERE a.vendor_configs @> jsonb_build_array(
                jsonb_build_object('vendor', c.vendor, 'version', c.version)))
        AS running_clinics
    FROM pvs_vendor_config c
    ORDER BY c.vendor ASC, c.version DESC
  `);

  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    vendor: r.vendor as string,
    version: Number(r.version),
    bridgeSource: r.bridge_source as string,
    driver: r.driver as string,
    streams: Array.isArray(r.streams) ? (r.streams as string[]) : [],
    minAgentVersion: r.min_agent_version as string,
    notes: (r.notes as string | null) ?? null,
    sha256: r.sha256 as string,
    keyId: r.key_id as string,
    signedAt: new Date(r.signed_at as string),
    rolloutMode: r.rollout_mode as RolloutMode,
    status: r.status as string,
    uploadedByEmail: (r.uploaded_by_email as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    pinnedClinics: Number(r.pinned_clinics ?? 0),
    runningClinics: Number(r.running_clinics ?? 0),
  }));
}

export interface AgentConfigStateRow {
  clinicId: string;
  clinicName: string;
  lastHeartbeatAt: Date | null;
  agentVersion: string | null;
  /** What the machine reports it is running, per vendor. */
  running: Array<{ vendor: string; version: number; appliedAt: number }>;
  /** What the portal would deliver to it right now. */
  target: ManifestEntry[];
  /** Vendors this Praxis is pinned on, with the pinned version. */
  pinned: Array<{ vendor: string; version: number; configId: string }>;
  configSyncError: string | null;
  rollbacks: Array<{
    vendor: string;
    rejectedVersion: number;
    revertedTo: number | null;
    reason: string;
    at: number;
  }>;
}

/**
 * Per-Praxis rollout state: running vs. target, plus anything the machine
 * refused. This is the view that answers "did the push actually land", which
 * a list of published versions on its own cannot.
 */
export async function listAgentConfigState(): Promise<AgentConfigStateRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT
      a.clinic_id,
      cl.name                AS clinic_name,
      a.last_heartbeat_at,
      a.agent_version,
      a.vendor_configs,
      a.config_sync_error,
      a.config_rollbacks,
      (SELECT COALESCE(
                jsonb_agg(jsonb_build_object(
                  'vendor', t.vendor, 'version', c.version, 'configId', c.id)),
                '[]'::jsonb)
         FROM pvs_vendor_config_target t
         JOIN pvs_vendor_config c ON c.id = t.config_id
        WHERE t.clinic_id = a.clinic_id) AS pinned
    FROM pvs_agent_status a
    JOIN clinics cl ON cl.id = a.clinic_id
    ORDER BY cl.name ASC
  `);

  const out: AgentConfigStateRow[] = [];
  for (const r of rows as unknown as Array<Record<string, unknown>>) {
    const clinicId = r.clinic_id as string;
    out.push({
      clinicId,
      clinicName: (r.clinic_name as string) ?? "Unbekannte Praxis",
      lastHeartbeatAt: r.last_heartbeat_at
        ? new Date(r.last_heartbeat_at as string)
        : null,
      agentVersion: (r.agent_version as string | null) ?? null,
      running: Array.isArray(r.vendor_configs)
        ? (r.vendor_configs as AgentConfigStateRow["running"])
        : [],
      target: await resolveManifest(clinicId),
      pinned: Array.isArray(r.pinned)
        ? (r.pinned as AgentConfigStateRow["pinned"])
        : [],
      configSyncError: (r.config_sync_error as string | null) ?? null,
      rollbacks: Array.isArray(r.config_rollbacks)
        ? (r.config_rollbacks as AgentConfigStateRow["rollbacks"])
        : [],
    });
  }
  return out;
}
