-- Tomedo hook: fires when a Recall / Wiedervorlage is scheduled.
--
-- Bind to "Recall erstellt" workflow trigger. Receives the recall row.

local emitter = dofile(debug.getinfo(1, "S").source:gsub("^@", "")
  :gsub("hooks/[^/]+$", "eins-canonical-emitter.lua"))

local function pick(t, ...)
  for _, key in ipairs({...}) do
    if t[key] ~= nil and t[key] ~= "" then return t[key] end
  end
  return nil
end

local row = recall or (...) or {}

local recall_id = tostring(pick(row, "id", "recallId") or "")
local patient_id = tostring(pick(row, "patientId", "patient_id") or "")
local recall_at = pick(row, "recallZeit", "recall_zeit", "recallAt")

if recall_id == "" or patient_id == "" or not recall_at then
  io.stderr:write("[eins-hook:recall_scheduled] missing required fields; skipping\n")
  return
end

emitter.emit({
  kind               = "RecallScheduled",
  bridgeSource       = "tomedo",
  pvsExternalEventId = "tomedo-lua:recall:" .. recall_id,
  occurredAt         = tostring(recall_at),
  pvsPatientId       = patient_id,
  pvsRecallId        = recall_id,
  recallAt           = tostring(recall_at),
  treatmentCode      = pick(row, "behandlungCode", "behandlung_code"),
  treatmentLabel     = pick(row, "behandlungName", "behandlung_name"),
})
