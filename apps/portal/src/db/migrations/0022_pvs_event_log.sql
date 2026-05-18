-- PVS Bridge — canonical event log, partitioned by month on occurred_at.
--
-- Every adapter (Tomedo, HealthHub, RED, GDT-Agent, CSV upload, n8n)
-- produces canonical events that land here. The status-derive worker
-- replays this log per patient to compute requests.status + revenue.
--
-- Why partitioning from day 1: a clinic with ~50k events/month × 50 clinics
-- × 12 months ≈ 30M rows in year 1. Late partition migration on live data is
-- painful; cheaper to start partitioned. The partition rotation cron job
-- (V3, see worker/cron.ts) creates next month's partition 2 weeks in advance.
--
-- Idempotency: the (clinic_id, bridge_source, pvs_external_event_id,
-- occurred_at) UNIQUE constraint dedupes replays. Partition column must be
-- part of UNIQUE — occurred_at satisfies that.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS pvs_event_log (
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  clinic_id                uuid NOT NULL,
  bridge_source            text NOT NULL,
  pvs_external_event_id    text NOT NULL,
  kind                     text NOT NULL,
  occurred_at              timestamptz NOT NULL,
  payload                  jsonb NOT NULL,
  received_at              timestamptz NOT NULL DEFAULT now(),
  ingested_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT pvs_event_log_bridge_source_check CHECK (
    bridge_source IN ('tomedo','healthhub','red','gdt_agent','csv_upload','n8n_custom')
  ),
  CONSTRAINT pvs_event_log_kind_check CHECK (
    kind IN (
      'PatientUpserted',
      'AppointmentCreated',
      'AppointmentStatusChanged',
      'AppointmentCancelled',
      'EncounterCompleted',
      'InvoicePaid',
      'RecallScheduled',
      'PatientMerged'
    )
  )
) PARTITION BY RANGE (occurred_at);

-- Unique dedup key (partition-column-inclusive).
CREATE UNIQUE INDEX IF NOT EXISTS pvs_event_log_dedup_idx
  ON pvs_event_log (clinic_id, bridge_source, pvs_external_event_id, occurred_at);

-- Hot-path index: replay-by-patient ordered by time.
CREATE INDEX IF NOT EXISTS pvs_event_log_patient_idx
  ON pvs_event_log (clinic_id, (payload->>'pvsPatientId'), occurred_at);

-- Hot-path index: filter by appointment.
CREATE INDEX IF NOT EXISTS pvs_event_log_appointment_idx
  ON pvs_event_log (clinic_id, (payload->>'pvsAppointmentId'))
  WHERE payload ? 'pvsAppointmentId';

-- Bootstrap partitions: previous month, current month, next month.
-- The cron rotation job extends this rolling 3-month window forward.
DO $$
DECLARE
  current_month_start date := date_trunc('month', CURRENT_DATE);
  prev_start          date := current_month_start - interval '1 month';
  next_start          date := current_month_start + interval '1 month';
  next_next_start     date := current_month_start + interval '2 month';
  prev_name           text;
  cur_name            text;
  next_name           text;
BEGIN
  prev_name := 'pvs_event_log_' || to_char(prev_start, 'YYYY_MM');
  cur_name  := 'pvs_event_log_' || to_char(current_month_start, 'YYYY_MM');
  next_name := 'pvs_event_log_' || to_char(next_start, 'YYYY_MM');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF pvs_event_log FOR VALUES FROM (%L) TO (%L)',
    prev_name, prev_start, current_month_start
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF pvs_event_log FOR VALUES FROM (%L) TO (%L)',
    cur_name, current_month_start, next_start
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF pvs_event_log FOR VALUES FROM (%L) TO (%L)',
    next_name, next_start, next_next_start
  );
END
$$;
