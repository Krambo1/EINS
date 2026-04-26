import "server-only";

/**
 * Light-weight timing helpers. All emit structured JSON log lines so a
 * downstream aggregator can filter on `kind`. No external APM dependency.
 *
 *   - timePage("dashboard", () => <Page/>)   → kind:"page"
 *   - timeAction("addNote", async () => …)   → kind:"action"
 *
 * Override the slow threshold with PERF_SLOW_MS (default 200).
 */
const SLOW_MS = Number(process.env.PERF_SLOW_MS ?? 200);

function emit(kind: "page" | "action", name: string, ms: number, ok: boolean) {
  const level = !ok ? "error" : ms > SLOW_MS ? "warn" : "info";
  console.log(
    JSON.stringify({
      kind,
      level,
      name,
      ms: Math.round(ms * 10) / 10,
      ok,
    })
  );
}

export async function timePage<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  let ok = true;
  try {
    return await fn();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    emit("page", name, performance.now() - startedAt, ok);
  }
}

export async function timeAction<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  let ok = true;
  try {
    return await fn();
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    emit("action", name, performance.now() - startedAt, ok);
  }
}
