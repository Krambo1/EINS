-- Tomedo hook: fires when a Behandlung (treatment) is recorded against a
-- termin.
--
-- Bind to "Behandlung abgeschlossen" workflow trigger. Receives the
-- behandlung row (with termin_id present per Tomedo's data model).

local emitter = dofile(debug.getinfo(1, "S").source:gsub("^@", "")
  :gsub("hooks/[^/]+$", "eins-canonical-emitter.lua"))

local function pick(t, ...)
  for _, key in ipairs({...}) do
    if t[key] ~= nil and t[key] ~= "" then return t[key] end
  end
  return nil
end

local row = behandlung or (...) or {}

local enc_id    = tostring(pick(row, "id", "behandlungId") or "")
local patient_id = tostring(pick(row, "patientId", "patient_id") or "")
local appt_id   = tostring(pick(row, "terminId", "termin_id") or "")
local completed = pick(row, "behandlungZeit", "behandlung_zeit", "completedAt")

-- pvs-status-derive.ts on the portal silently drops EncounterCompleted
-- without a pvsAppointmentId. If termin_id is empty we skip the emit
-- rather than send a useless event.
if enc_id == "" or patient_id == "" or appt_id == "" or not completed then
  io.stderr:write("[eins-hook:encounter_completed] missing required fields"
    .. " (appt='" .. appt_id .. "'); skipping\n")
  return
end

emitter.emit({
  kind               = "EncounterCompleted",
  bridgeSource       = "tomedo",
  pvsExternalEventId = "tomedo-lua:encounter:" .. enc_id,
  occurredAt         = tostring(completed),
  pvsPatientId       = patient_id,
  pvsEncounterId     = enc_id,
  pvsAppointmentId   = appt_id,
  completedAt        = tostring(completed),
  treatmentCode      = pick(row, "behandlungCode", "behandlung_code"),
  treatmentLabel     = pick(row, "behandlungName", "behandlung_name"),
  practitionerLabel  = pick(row, "behandlerName", "behandler_name"),
})
