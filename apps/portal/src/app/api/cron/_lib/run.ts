import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { MIN_CRON_SECRET_LENGTH, cronSecretProblem } from "@/lib/env";

/**
 * Shared plumbing for the Vercel cron routes (/api/cron/daily, /api/cron/morning).
 *
 * Production runs without the pg-boss worker (Fly scaled to 0), so these
 * routes call the same processor functions directly. Every processor used
 * here is idempotent (upserts, atomic claims, email_send_log ledger), so the
 * worker can be switched on later without double work or double mails.
 */

/** Auth: `Authorization: Bearer ${CRON_SECRET}` (Vercel sends it itself). */
export function checkCronAuth(request: NextRequest): NextResponse | null {
  const problem = cronSecretProblem(process.env.CRON_SECRET, process.env.NODE_ENV);
  if (problem) {
    // V4 Neben 4: too short in production counts as not configured.
    const error =
      problem === "missing"
        ? "CRON_SECRET not set"
        : `CRON_SECRET shorter than ${MIN_CRON_SECRET_LENGTH} characters`;
    console.error(JSON.stringify({ cron: "auth", ok: false, error }));
    return NextResponse.json({ error: { code: "not_configured" } }, { status: 503 });
  }
  const secret = process.env.CRON_SECRET!.trim();
  const header = request.headers.get("authorization") ?? "";
  // Hash both sides so the compare is constant-time and length-independent.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  if (!timingSafeEqual(a, b)) {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  return null;
}

export interface StepResult {
  step: string;
  ok: boolean;
  ms: number;
  detail?: unknown;
  error?: string;
  clinicsFailed?: number;
  clinicsTotal?: number;
}

export class CronRun {
  readonly results: StepResult[] = [];
  private readonly started = Date.now();

  /** Stop starting new steps after this many ms (route maxDuration is 300 s). */
  constructor(
    readonly name: string,
    private readonly budgetMs = 250_000
  ) {}

  /** ms left of the run budget (0 when spent); lets a step bound itself. */
  remainingMs(): number {
    return Math.max(0, this.budgetMs - (Date.now() - this.started));
  }

  private outOfTime(step: string): boolean {
    if (Date.now() - this.started < this.budgetMs) return false;
    const r: StepResult = { step, ok: false, ms: 0, error: "skipped: time budget exhausted" };
    this.results.push(r);
    this.log(r);
    return true;
  }

  private log(r: StepResult): void {
    console.log(JSON.stringify({ cron: this.name, ...r }));
  }

  /** One platform-wide step in its own try/catch. */
  async step(name: string, fn: () => Promise<unknown>): Promise<void> {
    if (this.outOfTime(name)) return;
    const t0 = Date.now();
    try {
      const detail = await fn();
      const r: StepResult = { step: name, ok: true, ms: Date.now() - t0 };
      if (detail !== undefined) r.detail = detail;
      this.results.push(r);
      this.log(r);
    } catch (err) {
      const r: StepResult = { step: name, ok: false, ms: Date.now() - t0, error: errMsg(err) };
      this.results.push(r);
      this.log(r);
    }
  }

  /**
   * One step run per clinic; a failing clinic is logged and the rest
   * continue. Logs one line per failing clinic plus one summary line.
   */
  async perClinic(
    name: string,
    clinicIds: readonly string[],
    fn: (clinicId: string) => Promise<unknown>
  ): Promise<void> {
    if (this.outOfTime(name)) return;
    const t0 = Date.now();
    let failed = 0;
    for (const clinicId of clinicIds) {
      if (Date.now() - this.started >= this.budgetMs) {
        failed += 1;
        console.log(JSON.stringify({ cron: this.name, step: name, clinicId, ok: false, error: "skipped: time budget exhausted" }));
        continue;
      }
      try {
        await fn(clinicId);
      } catch (err) {
        failed++;
        console.log(JSON.stringify({ cron: this.name, step: name, clinicId, ok: false, error: errMsg(err) }));
      }
    }
    const r: StepResult = {
      step: name,
      ok: failed === 0,
      ms: Date.now() - t0,
      clinicsTotal: clinicIds.length,
      clinicsFailed: failed,
    };
    this.results.push(r);
    this.log(r);
  }

  response(): NextResponse {
    const ok = this.results.every((r) => r.ok);
    return NextResponse.json(
      { ok, cron: this.name, ms: Date.now() - this.started, steps: this.results },
      { status: 200 }
    );
  }
}

/** All non-archived clinics. */
export async function activeClinicIds(): Promise<string[]> {
  const rows = await db
    .select({ id: schema.clinics.id })
    .from(schema.clinics)
    .where(isNull(schema.clinics.archivedAt));
  return rows.map((r) => r.id);
}

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}
