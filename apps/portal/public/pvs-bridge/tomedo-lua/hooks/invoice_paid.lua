-- Tomedo hook: fires when a Rechnung is marked paid.
--
-- Bind to "Rechnung bezahlt" workflow trigger. Receives the rechnung row.
-- The Honorar-Betrag is converted to integer cents before emission.

local emitter = dofile(debug.getinfo(1, "S").source:gsub("^@", "")
  :gsub("hooks/[^/]+$", "eins-canonical-emitter.lua"))

local function pick(t, ...)
  for _, key in ipairs({...}) do
    if t[key] ~= nil and t[key] ~= "" then return t[key] end
  end
  return nil
end

-- Convert a Tomedo amount (numeric EUR or string "125,50") to integer cents.
local function to_cents(raw)
  if raw == nil then return nil end
  if type(raw) == "number" then return math.floor(raw * 100 + 0.5) end
  local s = tostring(raw):gsub("EUR", ""):gsub("€", ""):gsub("%s", "")
  -- German: "1.250,50" -> drop ".", swap "," for "."; English: "1,250.50" -> drop ","
  local last_comma = s:find(",[^,]*$")
  local last_dot   = s:find("%.[^%.]*$")
  if last_comma and (not last_dot or last_comma > last_dot) then
    s = s:gsub("%.", ""):gsub(",", ".")
  else
    s = s:gsub(",", "")
  end
  local n = tonumber(s)
  if not n or n < 0 then return nil end
  return math.floor(n * 100 + 0.5)
end

local row = rechnung or (...) or {}

local inv_id    = tostring(pick(row, "id", "rechnungId", "RechnungID") or "")
local patient_id = tostring(pick(row, "patientId", "patient_id") or "")
local appt_id   = tostring(pick(row, "terminId", "termin_id") or "")
local enc_id    = pick(row, "behandlungId", "behandlung_id")
local amount    = pick(row, "betrag", "Betrag", "amount")
local paid_at   = pick(row, "bezahltAm", "bezahlt_am", "paidAt")

-- Worker contract: pvsAppointmentId is the link required for ROI
-- attribution. Without it, the invoice posts to patients.lifetime_revenue
-- but does NOT drive request.status=gewonnen. Skip and log so the Praxis
-- IT person can investigate.
if inv_id == "" or patient_id == "" or appt_id == "" then
  io.stderr:write("[eins-hook:invoice_paid] missing required ids (appt='"
    .. appt_id .. "'); skipping\n")
  return
end
local cents = to_cents(amount)
if not cents or cents <= 0 then
  io.stderr:write("[eins-hook:invoice_paid] invalid amount: '"
    .. tostring(amount) .. "'; skipping\n")
  return
end
local paid_iso = paid_at and tostring(paid_at) or emitter.iso_utc()

emitter.emit({
  kind               = "InvoicePaid",
  bridgeSource       = "tomedo",
  pvsExternalEventId = "tomedo-lua:invoice:" .. inv_id,
  occurredAt         = paid_iso,
  pvsPatientId       = patient_id,
  pvsInvoiceId       = inv_id,
  pvsAppointmentId   = appt_id,
  pvsEncounterId     = enc_id and tostring(enc_id) or nil,
  amountCents        = cents,
  currency           = "EUR",
  paidAt             = paid_iso,
})
