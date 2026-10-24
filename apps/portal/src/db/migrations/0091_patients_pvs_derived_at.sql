-- 0091_patients_pvs_derived_at.sql
-- Pass 2 (PVS bridge review): a reliable "derive is behind" marker.
--
-- pvs-reconcile used to call a request stale when any event for its
-- appointment had an occurred_at newer than the request's last status_change
-- activity. occurred_at of an AppointmentCreated is the (future) appointment
-- time, so every request with a future booking looked stale on every run,
-- and with LIMIT 500 and no ORDER BY those rows starved the genuinely lost
-- derives. Derive now also writes an activity row only when something
-- changed, so the activity time stopped being a "derive ran" marker at all.
--
-- pvs-status-derive stamps pvs_derived_at (its own start time) on the
-- patient; reconcile re-derives a patient whose newest event was INGESTED
-- after that. No backfill on purpose: NULL means "never derived under pass 2",
-- so reconcile re-derives every PVS patient once (500 per run, every 4 h),
-- which also applies the pass-2 attribution to historical events.

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS pvs_derived_at timestamptz;
