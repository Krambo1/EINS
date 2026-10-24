import Link from "next/link";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import {
  configSigningConfigured,
  listAgentConfigState,
  listVendorConfigs,
  type VendorConfigRow,
} from "@/server/pvs-vendor-config";
import { AdminPageHeader } from "../../_components/AdminPageHeader";
import { DangerSubmitButton } from "../../_components/DangerSubmitButton";
import { ConfigUploadForm } from "./_components/ConfigUploadForm";
import {
  pinClinicAction,
  revokeConfigAction,
  setRolloutAction,
  unpinClinicAction,
} from "./actions";

export const metadata = { title: "PVS-Konfigurationen · Admin" };

const ROLLOUT_LABEL: Record<string, string> = {
  off: "Aus",
  pilot: "Pilot",
  all: "Alle",
};

const SELECT_CLASS =
  "rounded-md border border-border bg-bg-secondary px-2 py-1 text-sm text-fg-primary";

export default async function AdminPvsConfigsPage() {
  await requireAdmin();

  const [configs, agents, signingConfigured] = await Promise.all([
    listVendorConfigs(),
    listAgentConfigState(),
    Promise.resolve(configSigningConfigured()),
  ]);

  const byVendor = new Map<string, VendorConfigRow[]>();
  for (const cfg of configs) {
    const list = byVendor.get(cfg.vendor) ?? [];
    list.push(cfg);
    byVendor.set(cfg.vendor, list);
  }

  const activeByVendor = new Map<string, VendorConfigRow[]>();
  for (const [vendor, list] of byVendor) {
    activeByVendor.set(
      vendor,
      list.filter((c) => c.status === "active")
    );
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="PVS-Konfigurationen"
        subtitle="Neue Abfrage-Konfigurationen an die Agenten in den Praxen ausliefern, ohne dass jemand vor Ort neu installieren muss."
        actions={
          <Button asChild variant="secondary">
            <Link href="/admin/pvs-bridge">Zur PVS-Bridge</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>So läuft eine Änderung</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-fg-secondary">
          <p>
            Wenn ein Update der Praxis-Software eine Spalte umbenennt, stoppt der
            Agent den betroffenen Datenstrom und meldet das hier. Bisher hieß die
            Reparatur: neue Agent-Version bauen und auf jedem Rechner neu
            installieren. Ab jetzt genügt eine neue Konfiguration.
          </p>
          <ol className="ml-5 list-decimal space-y-1">
            <li>
              YAML anpassen unter{" "}
              <code>apps/bridge/agent/src/db-adapters/configs/</code>.
            </li>
            <li>
              Lokal signieren:{" "}
              <code>
                pnpm --filter eins-agent config:sign -- --vendor &lt;id&gt;
                --version &lt;n&gt; --key &lt;pfad&gt;
              </code>
              . Das Skript prüft die Konfiguration und signiert nur, wenn sie gültig ist.
            </li>
            <li>Die erzeugte Datei hier hochladen.</li>
            <li>
              Verteilung erst auf <strong>Pilot</strong> (eine Praxis), nach der
              Kontrolle auf <strong>Alle</strong>.
            </li>
          </ol>
          <p>
            Der private Schlüssel liegt bewusst nicht in diesem System. Wer damit
            signieren kann, kann jeder angebundenen Praxis beliebige Abfragen auf
            die Patientendatenbank schicken. Das Portal kann nur prüfen und
            verteilen, nicht selbst erzeugen.
          </p>
          <p>
            Jede Praxis beobachtet eine frisch eingespielte Konfiguration
            15 Minuten lang. Bricht dabei ein Datenstrom weg, der vorher lief,
            setzt der Agent sie von selbst zurück und meldet das unten unter
            „Selbst zurückgesetzt“.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Konfiguration hinterlegen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!signingConfigured && (
            <p className="rounded-lg border border-tone-warn p-3 text-sm text-tone-warn">
              In dieser Umgebung ist kein Signaturschlüssel hinterlegt
              (<code>PVS_CONFIG_PUBLIC_KEYS</code>). Solange das so ist, wird jedes
              Paket abgelehnt. Schlüssel erzeugen mit{" "}
              <code>pnpm --filter eins-agent config:keygen</code>.
            </p>
          )}
          <ConfigUploadForm signingConfigured={signingConfigured} />
        </CardContent>
      </Card>

      {byVendor.size === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-fg-secondary">
            Es ist noch keine Konfiguration hinterlegt. Alle Praxen laufen auf den
            Konfigurationen, die mit ihrer Agent-Version ausgeliefert wurden.
          </CardContent>
        </Card>
      ) : (
        [...byVendor.entries()].map(([vendor, versions]) => (
          <Card key={vendor}>
            <CardHeader>
              <CardTitle className="font-mono text-base">{vendor}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {versions.map((cfg) => (
                <div
                  key={cfg.id}
                  className="rounded-xl border border-border p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-base font-semibold tabular-nums">
                      Version {cfg.version}
                    </span>
                    {cfg.status === "revoked" ? (
                      <Badge tone="neutral">Zurückgezogen</Badge>
                    ) : (
                      <Badge
                        tone={
                          cfg.rolloutMode === "all"
                            ? "good"
                            : cfg.rolloutMode === "pilot"
                              ? "accent"
                              : "neutral"
                        }
                      >
                        Verteilung: {ROLLOUT_LABEL[cfg.rolloutMode]}
                      </Badge>
                    )}
                    <span className="text-sm text-fg-secondary">
                      läuft in{" "}
                      <span className="tabular-nums text-fg-primary">
                        {cfg.runningClinics}
                      </span>{" "}
                      {cfg.runningClinics === 1 ? "Praxis" : "Praxen"}
                      {cfg.pinnedClinics > 0 && (
                        <>
                          , festgelegt für{" "}
                          <span className="tabular-nums text-fg-primary">
                            {cfg.pinnedClinics}
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  {cfg.notes && (
                    <p className="mt-2 text-sm text-fg-primary">{cfg.notes}</p>
                  )}

                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm text-fg-secondary sm:grid-cols-2">
                    <div>
                      <dt className="inline">Datenströme: </dt>
                      <dd className="inline text-fg-primary">
                        {cfg.streams.join(", ") || "keine"}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Treiber: </dt>
                      <dd className="inline text-fg-primary">
                        {cfg.driver} ({cfg.bridgeSource})
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Mindest-Agent: </dt>
                      <dd className="inline text-fg-primary">
                        {cfg.minAgentVersion}
                      </dd>
                    </div>
                    <div>
                      <dt className="inline">Signiert: </dt>
                      <dd className="inline text-fg-primary">
                        {formatDateTime(cfg.signedAt)} mit {cfg.keyId}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline">Prüfsumme: </dt>
                      <dd className="inline font-mono text-xs text-fg-primary">
                        {cfg.sha256}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="inline">Hochgeladen: </dt>
                      <dd className="inline text-fg-primary">
                        {formatDateTime(cfg.createdAt)}
                        {cfg.uploadedByEmail ? ` von ${cfg.uploadedByEmail}` : ""}
                      </dd>
                    </div>
                  </dl>

                  {cfg.status === "active" && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <form action={setRolloutAction} className="flex items-center gap-2">
                        <input type="hidden" name="configId" value={cfg.id} />
                        <label
                          htmlFor={`mode-${cfg.id}`}
                          className="text-sm text-fg-secondary"
                        >
                          Verteilung
                        </label>
                        <select
                          id={`mode-${cfg.id}`}
                          name="mode"
                          defaultValue={cfg.rolloutMode}
                          className={SELECT_CLASS}
                        >
                          <option value="off">Aus</option>
                          <option value="pilot">Pilot (nur festgelegte Praxen)</option>
                          <option value="all">Alle Praxen mit diesem PVS</option>
                        </select>
                        <Button type="submit" size="sm" variant="secondary">
                          Übernehmen
                        </Button>
                      </form>

                      <form action={revokeConfigAction}>
                        <input type="hidden" name="configId" value={cfg.id} />
                        <DangerSubmitButton
                          size="sm"
                          confirm={`Version ${cfg.version} zurückziehen? Sie wird an keine Praxis mehr verteilt, festgelegte Praxen werden gelöst. Das lässt sich nicht rückgängig machen.`}
                          pendingLabel="Wird zurückgezogen …"
                        >
                          Zurückziehen
                        </DangerSubmitButton>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stand je Praxis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-fg-secondary">
            „Läuft“ ist das, was der Agent zuletzt gemeldet hat. „Soll“ ist das,
            was das Portal ihm gerade ausliefern würde. Weichen beide länger als
            ein paar Minuten voneinander ab, ist die Auslieferung hängen geblieben.
          </p>

          {agents.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Es hat sich noch kein Agent gemeldet.
            </p>
          ) : (
            agents.map((agent) => {
              const running = new Map(
                agent.running.map((r) => [r.vendor, r.version])
              );
              const pinned = new Map(agent.pinned.map((p) => [p.vendor, p]));
              const vendors = [
                ...new Set([
                  ...agent.target.map((t) => t.vendor),
                  ...agent.running.map((r) => r.vendor),
                ]),
              ].sort();

              return (
                <div
                  key={agent.clinicId}
                  className="rounded-xl border border-border p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-fg-primary">
                      {agent.clinicName}
                    </span>
                    <span className="text-sm text-fg-secondary">
                      Agent {agent.agentVersion ?? "unbekannt"}
                      {agent.lastHeartbeatAt
                        ? `, zuletzt gemeldet ${formatRelative(agent.lastHeartbeatAt)}`
                        : ", noch keine Meldung"}
                    </span>
                  </div>

                  {agent.configSyncError && (
                    <p className="mt-2 rounded-lg border border-tone-bad p-2 text-sm text-tone-bad">
                      Abgleich fehlgeschlagen: {agent.configSyncError}
                    </p>
                  )}

                  {agent.rollbacks.length > 0 && (
                    <div className="mt-2 rounded-lg border border-tone-warn p-2 text-sm text-tone-warn">
                      <p className="font-medium">Selbst zurückgesetzt</p>
                      <ul className="ml-5 list-disc">
                        {agent.rollbacks.map((rb) => (
                          <li key={`${rb.vendor}-${rb.rejectedVersion}-${rb.at}`}>
                            {rb.vendor}: Version {rb.rejectedVersion} zurück auf{" "}
                            {rb.revertedTo === null
                              ? "die mitgelieferte Konfiguration"
                              : `Version ${rb.revertedTo}`}
                            . {rb.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {vendors.length === 0 ? (
                    <p className="mt-2 text-sm text-fg-secondary">
                      Diese Praxis nutzt keine SQL-Anbindung.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {vendors.map((vendor) => {
                        const target = agent.target.find(
                          (t) => t.vendor === vendor
                        );
                        const live = running.get(vendor);
                        const pin = pinned.get(vendor);
                        const inSync =
                          target === undefined
                            ? live === undefined
                            : live === target.version;
                        const options = activeByVendor.get(vendor) ?? [];

                        return (
                          <div
                            key={vendor}
                            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-3 text-sm"
                          >
                            <span className="font-mono">{vendor}</span>
                            <span className="text-fg-secondary">
                              Läuft:{" "}
                              <span className="tabular-nums text-fg-primary">
                                {live === undefined
                                  ? "mitgeliefert"
                                  : `Version ${live}`}
                              </span>
                            </span>
                            <span className="text-fg-secondary">
                              Soll:{" "}
                              <span className="tabular-nums text-fg-primary">
                                {target === undefined
                                  ? "mitgeliefert"
                                  : `Version ${target.version}`}
                              </span>
                            </span>
                            {inSync ? (
                              <Badge tone="good">Aktuell</Badge>
                            ) : (
                              <Badge tone="warn">Ausstehend</Badge>
                            )}
                            {pin && <Badge tone="accent">Festgelegt</Badge>}

                            {options.length > 0 && (
                              <form
                                action={pinClinicAction}
                                className="flex items-center gap-2"
                              >
                                <input
                                  type="hidden"
                                  name="clinicId"
                                  value={agent.clinicId}
                                />
                                <select
                                  name="configId"
                                  defaultValue={pin?.configId ?? options[0]!.id}
                                  aria-label={`Version für ${vendor} festlegen`}
                                  className={SELECT_CLASS}
                                >
                                  {options.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      Version {o.version}
                                    </option>
                                  ))}
                                </select>
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="secondary"
                                >
                                  Festlegen
                                </Button>
                              </form>
                            )}

                            {pin && (
                              <form action={unpinClinicAction}>
                                <input
                                  type="hidden"
                                  name="clinicId"
                                  value={agent.clinicId}
                                />
                                <input
                                  type="hidden"
                                  name="vendor"
                                  value={vendor}
                                />
                                <Button type="submit" size="sm" variant="ghost">
                                  Festlegung lösen
                                </Button>
                              </form>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
