import Database from "better-sqlite3";
import { _setStateDbForTesting } from "./framework.js";

/** Shared DDL + helpers for the review-fix regression tests. */
export const STATE_DDL = `
  CREATE TABLE db_adapter_state (
    vendor_id TEXT NOT NULL,
    stream_kind TEXT NOT NULL,
    cursor TEXT NOT NULL DEFAULT '',
    cursor_tiebreak TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'idle',
    last_run_at INTEGER,
    last_error TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    next_run_at INTEGER NOT NULL DEFAULT 0,
    column_snapshot TEXT,
    PRIMARY KEY (vendor_id, stream_kind)
  );
  CREATE TABLE db_adapter_drift (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id TEXT NOT NULL,
    stream_kind TEXT NOT NULL,
    expected TEXT NOT NULL,
    observed TEXT NOT NULL,
    missing TEXT NOT NULL,
    added TEXT NOT NULL,
    detected_at INTEGER NOT NULL,
    reported_to_portal INTEGER NOT NULL DEFAULT 0,
    report_kind TEXT NOT NULL DEFAULT 'schema_drift',
    detail TEXT
  );
`;

export function freshStateDb(): void {
  const h = new Database(":memory:");
  h.exec(STATE_DDL);
  _setStateDbForTesting(h);
}
