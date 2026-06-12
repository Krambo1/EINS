import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * P0-5 — SQL injection regression suite for the PVS module.
 *
 * Two layers of defence are tested here:
 *
 *   1. **Parameterisation.** Drizzle's `sql` template tag turns every
 *      `${expr}` into a bound parameter, so a hostile `pvsPatientId` of
 *      the shape `'); DROP TABLE patients;--` lands in the params array,
 *      never in the SQL text. We reconstruct the exact `sql\`...\``
 *      templates used in production (resolveBothSides, findFuzzyCandidates,
 *      backfillLinkFromHistory) and prove the malicious payload is bound,
 *      not concatenated.
 *
 *   2. **Static grep on the source.** The above only proves the queries
 *      that exist TODAY are safe; a future refactor might swap the `sql`
 *      tag for raw string concat ("just add backticks") which would
 *      reintroduce the vulnerability. The second test block reads
 *      pvs-events.ts and pvs-linking.ts as text and rejects any
 *      `db.execute(\`...\`)` call where the argument is a plain template
 *      literal (no `sql` tag). The grep is intentionally crude — it errs
 *      toward false positives, which is the side you want for a
 *      security-critical regression gate.
 */

const dialect = new PgDialect();

function compile(query: ReturnType<typeof sql>) {
  return dialect.sqlToQuery(query);
}

// A small zoo of injection payloads. Each represents a real attack class.
const PAYLOADS: Record<string, string> = {
  classic_drop: `'); DROP TABLE patients;--`,
  always_true: `' OR 1=1 --`,
  union_select: `' UNION SELECT password FROM clinic_users--`,
  comment_terminator: `*/; DELETE FROM pvs_event_log; /*`,
  utf8_null_byte: "x\x00; TRUNCATE patients;",
  unicode_escape: "'1=1--", // '1=1--
  long_string: "A".repeat(10_000),
  json_breakout: `","portalPatientId":"00000000-0000-0000-0000-000000000000`,
};

describe("PVS · sql template parameterisation (P0-5)", () => {
  describe("resolveBothSides pattern (pvs-events.ts:575)", () => {
    // Production shape:
    //   sql`${schema.pvsPatientMap.pvsPatientId} IN (${from}, ${to})`
    it.each(Object.entries(PAYLOADS))(
      "payload=%s lands in params, not in SQL text",
      (_name, payload) => {
        const q = sql`pvs_patient_id IN (${payload}, ${payload})`;
        const { sql: text, params } = compile(q);
        expect(text).toBe("pvs_patient_id IN ($1, $2)");
        expect(params).toEqual([payload, payload]);
        // Defence-in-depth: the SQL text should not contain ANY substring of
        // the payload that's at least 5 chars long. The slicing rules out
        // benign coincidental matches (a 4-char prefix could collide with
        // an identifier; longer matches signal real concatenation).
        if (payload.length >= 5) {
          expect(text).not.toContain(payload.slice(0, 5));
        }
      }
    );
  });

  describe("findFuzzyCandidates pattern (pvs-linking.ts:309-362)", () => {
    // Production shape: a multi-param `sql\`...${a}::text...${b}::date...\``
    // We exercise the same param substitutions with hostile values.
    it.each(Object.entries(PAYLOADS))(
      "payload=%s parameterised across email/phone/name/dob/clinicId slots",
      (_name, payload) => {
        const dob = "1985-03-12"; // a real-shaped date; we attack the others
        const q = sql`
          WITH scored AS (
            SELECT id FROM patients p
            WHERE p.clinic_id = ${payload}::uuid
              AND lower(p.email::text) = ${payload}::text
              AND p.phone = ${payload}::text
              AND p.full_name = ${payload}::text
              AND p.dob = ${dob}::date
          )
          SELECT id FROM scored
        `;
        const { sql: text, params } = compile(q);
        // Every interpolation is one parameter. The compiled SQL has
        // exactly $1..$N for the five inputs.
        expect(params.length).toBe(5);
        expect(params).toEqual([payload, payload, payload, payload, dob]);
        // The actual malicious bytes are absent from the SQL string.
        if (payload.length >= 5) {
          expect(text).not.toContain(payload.slice(0, 5));
        }
      }
    );

    it("DOES NOT collapse a payload into the WHERE clause structure", () => {
      // Specifically guard against the "did someone use a template literal
      // outside the sql tag" failure mode. The compiled SQL must contain
      // the placeholder, not the value.
      const q = sql`SELECT id FROM x WHERE y = ${PAYLOADS.classic_drop}`;
      const { sql: text } = compile(q);
      expect(text).toBe("SELECT id FROM x WHERE y = $1");
      expect(text).not.toContain("DROP TABLE");
    });
  });

  describe("backfillLinkFromHistory pattern (pvs-linking.ts:462)", () => {
    // Production shape:
    //   sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ${pvsPatientId}::text`
    it.each(Object.entries(PAYLOADS))(
      "payload=%s as pvsPatientId is bound, JSON path is literal",
      (_name, payload) => {
        const q = sql`payload->>'pvsPatientId' = ${payload}::text`;
        const { sql: text, params } = compile(q);
        expect(text).toBe("payload->>'pvsPatientId' = $1::text");
        expect(params).toEqual([payload]);
      }
    );
  });

  describe("recordLinkingFailure / candidates JSON snapshot", () => {
    // Linker candidates can contain user-controlled strings (PVS bemerkung,
    // full names from the PVS). We serialize them into linking_failures.candidates
    // via Drizzle's typed columns; this isn't a `sql` template surface, but
    // we drive it through the dialect just to confirm jsonb encoding works.
    it("jsonb payload with hostile string is bound as parameter (not stringified into SQL)", () => {
      const hostileSnapshot = {
        fullName: `Maria '); DROP TABLE patients;--`,
        email: `test@example.com'; UPDATE patients SET email='`,
      };
      const q = sql`INSERT INTO linking_failures (pvs_patient_snapshot) VALUES (${JSON.stringify(hostileSnapshot)}::jsonb)`;
      const { sql: text, params } = compile(q);
      expect(text).toContain("$1::jsonb");
      expect(text).not.toContain("DROP TABLE");
      expect(params).toEqual([JSON.stringify(hostileSnapshot)]);
    });
  });
});

// ---- Static grep on source --------------------------------------------

/**
 * Repository-relative paths to the PVS modules the grep guards. The list is
 * intentionally short: every file here is on the hot path for ingest /
 * linking. If a new module joins this hot path, append it here AND audit it
 * for the patterns below.
 */
const GUARDED_FILES = [
  "src/server/pvs-events.ts",
  "src/server/pvs-linking.ts",
  "src/server/pvs-agent-enroll.ts",
] as const;

function readGuardedFile(rel: string): string {
  return readFileSync(join(__dirname, "../../", rel), "utf8");
}

describe("PVS · static grep against unsafe SQL patterns (P0-5)", () => {
  it.each(GUARDED_FILES)(
    "%s has no INTERPOLATING raw-template-literal db.execute / db.run",
    (relPath) => {
      const src = readGuardedFile(relPath);
      // The injection surface is specifically: `db.execute(\`... ${var} ...\`)`
      // — an untagged template literal containing a `${}` substitution.
      // Untagged literals with no interpolations are harmless (just a static
      // SQL string) and are common for DDL / DELETE-by-condition queries.
      //
      // We match `db.execute(` followed by an opening backtick, then any
      // characters that are NOT a backtick, then `${` — i.e. confirming
      // the interpolation occurs before the literal closes.
      const dangerous = src.match(
        /\b(db|tx)\s*\.\s*(execute|run)\s*\(\s*`[^`]*\$\{/g
      );
      expect(
        dangerous,
        `${relPath}: db.execute / db.run with an untagged INTERPOLATED template literal — refactor to db.execute(sql\`...\`) so the interpolations are bound as parameters`
      ).toBeNull();
    }
  );

  it.each(GUARDED_FILES)("%s has no string concat into sql\\`...\\` parameter slots", (relPath) => {
    const src = readGuardedFile(relPath);
    // Match `sql\`...\${var + …}\`` or `sql\`...\${\`literal\${var}\`}\``
    // — i.e. ANY expression inside an interpolation that performs string
    // concatenation. The point isn't that concatenation is always wrong
    // (e.g. `${prefix + "%"}` is a real LIKE-pattern construction), it's
    // that any such case must be reviewed individually. The grep catches
    // them so they don't slip in unnoticed.
    //
    // We allow the one known case in pvs-linking.ts (the LIKE-prefix
    // builder for findRequestByLeadPrefix). New occurrences should be
    // explicitly whitelisted by adding to ALLOW below or refactored to
    // pass the concatenation result as a single bound parameter.
    const ALLOW: Record<string, string[]> = {
      "src/server/pvs-linking.ts": [
        // LIKE-pattern construction is intentional and the input is the
        // 8-hex-char output of parseLeadTokenFromBemerkung, which is
        // already validated to /^[0-9a-f]{8}$/.
        "prefix + \"%\"",
      ],
    };
    const matches = src.match(/sql`[^`]*\${[^}]*\+[^}]*}[^`]*`/g) ?? [];
    const allowList = ALLOW[relPath] ?? [];
    const unauthorised = matches.filter(
      (m) => !allowList.some((allowed) => m.includes(allowed))
    );
    expect(
      unauthorised,
      `${relPath}: sql\`...\` with string concatenation inside an interpolation slot — review each match for parameter safety`
    ).toEqual([]);
  });

  it.each(GUARDED_FILES)("%s does not import or call sql.raw / sql.identifier with non-literal args", (relPath) => {
    const src = readGuardedFile(relPath);
    // sql.raw(s) bypasses parameterisation — every occurrence is a
    // security review surface. Same for sql.identifier(s) when `s` is
    // not a string literal. The grep flags both for human review.
    const rawCalls = src.match(/\bsql\s*\.\s*(raw|identifier)\s*\(/g);
    expect(
      rawCalls,
      `${relPath}: sql.raw / sql.identifier calls are not allowed in PVS hot-path code`
    ).toBeNull();
  });
});

// ---- sql.raw review gate for the non-hot-path PVS modules (L12) -------------

/**
 * The two PVS maintenance modules below legitimately need `sql.raw`: a DDL
 * partition name and partition bounds (not bindable), and a Postgres INTERVAL
 * literal (also not bindable). They are NOT on the ingest hot path, so they
 * are excluded from GUARDED_FILES' blanket "no sql.raw" ban — but pentest L12
 * flagged that they then sat outside ANY injection gate. This block closes
 * that: every `sql.raw` / `sql.identifier` in these files MUST carry an
 * `injection-reviewed` marker comment. A new raw call added without first
 * reasoning about (and annotating) its input safety fails the suite.
 */
const RAW_REVIEWED_FILES = [
  "src/worker/processors/pvs-partition-rotate.ts",
  "src/worker/processors/pvs-reconcile.ts",
] as const;

describe("PVS · sql.raw review-marker gate for maintenance modules (L12)", () => {
  it.each(RAW_REVIEWED_FILES)(
    "%s annotates every sql.raw / sql.identifier with an injection-reviewed marker",
    (relPath) => {
      const src = readGuardedFile(relPath);
      const rawCalls = src.match(/\bsql\s*\.\s*(raw|identifier)\s*\(/g) ?? [];
      const markers = src.match(/injection-reviewed/g) ?? [];
      expect(
        markers.length,
        `${relPath}: found ${rawCalls.length} sql.raw/sql.identifier call(s) but ` +
          `${markers.length} injection-reviewed marker(s) — every raw SQL call in a ` +
          `non-hot-path PVS module must be individually reviewed and annotated ` +
          `\`// injection-reviewed: <why the interpolation is not user-controlled>\``
      ).toBeGreaterThanOrEqual(rawCalls.length);
    }
  );
});
