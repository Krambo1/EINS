/**
 * Daily outbox maintenance (vacuum of sent rows, prune of old dead letters, the
 * failure-summary POST) must also run on PCs that are switched off every night.
 * A bare 24 h interval only fires after 24 h of CONTINUOUS uptime, which such a
 * PC never reaches: sent rows piled up for ever and dead letters never reached
 * the portal. So: one run shortly after start, then every 24 h.
 */

/** Let the watchers and the first heartbeat settle before the first run. */
export const MAINTENANCE_FIRST_RUN_MS = 60_000;
export const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface MaintenanceHandle {
  stop: () => void;
}

export function scheduleMaintenance(opts: {
  run: () => void | Promise<void>;
  onError?: (err: unknown) => void;
  firstRunMs?: number;
  intervalMs?: number;
}): MaintenanceHandle {
  const onError = opts.onError ?? (() => {});
  // A throw (disk full, database locked) must not escape a timer callback as an
  // uncaughtException and take the whole agent down with it.
  const tick = (): void => {
    try {
      const out = opts.run();
      if (out && typeof (out as Promise<void>).catch === "function") {
        (out as Promise<void>).catch(onError);
      }
    } catch (err) {
      onError(err);
    }
  };
  const first = setTimeout(tick, opts.firstRunMs ?? MAINTENANCE_FIRST_RUN_MS);
  const every = setInterval(tick, opts.intervalMs ?? MAINTENANCE_INTERVAL_MS);
  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
