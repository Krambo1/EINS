-- Tomedo hook: fires when an appointment's status changes.
--
-- Bind to "Termin-Status geaendert" workflow trigger. Receives the updated
-- termin row.

local emitter = dofile(debug.getinfo(1, "S").source:gsub("^@", "")
  :gsub("hooks/[^/]+$", "eins-canonical-emitter.lua"))

local function pick(t, ...)
  for _, key in ipairs({...}) do
    if t[key] ~= nil and t[key] ~= "" then return t[key] end
  end
  return nil
end

local row = termin or (...) or {}

local appt_id   = tostring(pick(row, "id", "terminId", "TerminID") or "")
local patient_id = tostring(pick(row, "patientId", "patient_id", "PatientID") or "")
local raw_status = pick(row, "status", "Status")
local newStatus = emitter.normalise_appointment_status(raw_status)

if appt_id == "" or patient_id == "" or not newStatus then
  io.stderr:write("[eins-hook:appointment_status_changed] missing required fields"
    .. " (status='" .. tostring(raw_status) .. "'); skipping\n")
  return
end

local now = emitter.iso_utc()

emitter.emit({
  kind               = "AppointmentStatusChanged",
  bridgeSource       = "tomedo",
  pvsExternalEventId = "tomedo-lua:appointment-status:" .. appt_id .. ":" .. newStatus .. ":" .. now,
  occurredAt         = now,
  pvsPatientId       = patient_id,
  pvsAppointmentId   = appt_id,
  newStatus          = newStatus,
  changedAt          = now,
})
