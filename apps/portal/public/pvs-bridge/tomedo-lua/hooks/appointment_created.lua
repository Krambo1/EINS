-- Tomedo hook: fires when an appointment is booked.
--
-- Bind this script to the Tomedo workflow event "Termin erstellt" via
-- Einstellungen → Skripte → Workflow-Trigger. The Tomedo runtime injects a
-- `termin` table representing the just-created appointment row.
--
-- Tomedo's exact field names differ slightly across versions. The fallbacks
-- below probe the documented names first, then the older Camelcase variants.

local emitter = dofile(debug.getinfo(1, "S").source:gsub("^@", "")
  :gsub("hooks/[^/]+$", "eins-canonical-emitter.lua"))

local function pick(t, ...)
  for _, key in ipairs({...}) do
    if t[key] ~= nil and t[key] ~= "" then return t[key] end
  end
  return nil
end

-- The Tomedo Skript-Engine binds the row under `termin` or as the global
-- table -- depending on the hook configuration. Support both.
local row = termin or (...) or {}

local appt_id   = tostring(pick(row, "id", "terminId", "TerminID") or "")
local patient_id = tostring(pick(row, "patientId", "patient_id", "PatientID") or "")
local scheduled = pick(row, "terminZeit", "termin_zeit", "ScheduledAt", "scheduledAt")

if appt_id == "" or patient_id == "" or not scheduled then
  io.stderr:write("[eins-hook:appointment_created] missing required fields; skipping\n")
  return
end

emitter.emit({
  kind               = "AppointmentCreated",
  bridgeSource       = "tomedo",
  pvsExternalEventId = "tomedo-lua:appointment:" .. appt_id,
  occurredAt         = emitter.iso_utc(),
  pvsPatientId       = patient_id,
  pvsAppointmentId   = appt_id,
  scheduledAt        = tostring(scheduled),
  treatmentCode      = pick(row, "behandlungCode", "behandlung_code"),
  treatmentLabel     = pick(row, "behandlungName", "behandlung_name"),
  locationCode       = pick(row, "raumId", "raum_id") and tostring(pick(row, "raumId", "raum_id")),
  locationLabel      = pick(row, "raumName", "raum_name"),
  bemerkung          = pick(row, "kommentar", "Kommentar"),
})
