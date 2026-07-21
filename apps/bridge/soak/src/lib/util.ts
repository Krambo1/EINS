import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export function ts(): string {
  return new Date().toISOString();
}

export function log(tag: string, msg: string): void {
  console.log(`${ts()} [${tag}] ${msg}`);
}

export function warn(tag: string, msg: string): void {
  console.warn(`${ts()} [${tag}] ${msg}`);
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function appendJsonl(file: string, obj: Record<string, unknown>): void {
  ensureDir(dirname(file));
  appendFileSync(file, JSON.stringify({ t: ts(), ...obj }) + "\n", "utf8");
}

export function readJsonl<T = Record<string, unknown>>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // A torn last line (process killed mid-append) is expected once per
      // hard kill; skip it rather than fail the whole read.
    }
  }
  return out;
}

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(file: string, value: unknown): void {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Weighted pick: entries as [weight, value]. */
export function pickWeighted<T>(entries: ReadonlyArray<readonly [number, T]>): T {
  const total = entries.reduce((s, [w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [w, v] of entries) {
    roll -= w;
    if (roll <= 0) return v;
  }
  return entries[entries.length - 1][1];
}

export function chance(p: number): boolean {
  return Math.random() < p;
}

/** Integer cents → "1234,56" (German decimal, no grouping). */
export function centsToDe(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const eur = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}${eur},${rest}`;
}

/** Integer cents → SQL numeric literal string "1234.56". */
export function centsToSql(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "1234.56" (pg numeric as string) → integer cents, exact. */
export function sqlNumericToCents(v: string): number {
  const m = String(v).trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`unparseable numeric from pg: ${JSON.stringify(v)}`);
  const sign = m[1] === "-" ? -1 : 1;
  const eur = Number(m[2]);
  const frac = (m[3] ?? "").padEnd(2, "0");
  return sign * (eur * 100 + Number(frac));
}

export function fmtEur(cents: number): string {
  return `${centsToDe(cents)} €`;
}

/** DDMMYYYY for GDT date fields. */
export function gdtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getUTCFullYear()}`;
}

/** DD.MM.YYYY for CSV date columns. */
export function csvDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
}
