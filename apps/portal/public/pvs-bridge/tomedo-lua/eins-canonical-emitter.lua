-- EINS PVS Bridge: canonical-event emitter for Tomedo Lua.
--
-- Generic helper invoked by the per-event hook scripts (appointment_created,
-- appointment_status_changed, encounter_completed, invoice_paid,
-- recall_scheduled). Computes an HMAC-SHA256 signature with the per-Praxis
-- secret and POSTs the canonical JSON envelope to bridge.einsvisuals.de.
--
-- Why this exists alongside the DB-read path: it is a FALLBACK, not a
-- simultaneous redundant feed. A Tomedo software update could break the
-- Postgres schema; switch the Praxis to this Lua path and it keeps emitting
-- AppointmentCreated etc. so the portal never goes dark.
--
-- IMPORTANT: do NOT run this Lua path AND the DB-read path at the same time.
-- The portal dedups REPLAYS within one path on the
-- (clinicId, bridge_source, pvsExternalEventId, occurredAt) UNIQUE index, but
-- these hooks emit a "tomedo-lua:" pvsExternalEventId prefix while DB-read
-- emits "tomedo:" — so the two paths produce DIFFERENT keys for the same
-- event and the portal counts it twice (double revenue, double conversions).
-- Run exactly one path per Praxis. See apps/bridge/README.md.
--
-- Portability:
--   * Tomedo runs on macOS; both `curl` and `openssl` are present on every
--     supported macOS version (10.13+). We shell out via io.popen so the
--     script doesn't depend on a Tomedo Lua HTTP / HMAC binding (those
--     differ across Tomedo versions and aren't publicly documented).
--   * Network failures are best-effort: an error is logged to stderr (the
--     Tomedo Skript-Log) and the hook returns normally. The DB-read path
--     is the source of truth for backfill; Lua adds liveness, not durability.
--
-- Install: drop this file plus the hooks/ folder into Tomedo's Lua scripts
-- directory. Configure `config.lua` next to this file with the per-Praxis
-- secret. See README.md in this bundle for full install steps.

local cjson = require_or_dofile("config")

local M = {}

-- Resolve the config module via either `require` (when Tomedo's package path
-- includes the Lua scripts dir) or a sibling `config.lua` dofile. Falls back
-- to env vars so the file can be tested in isolation via Lua REPL.
function require_or_dofile(name)
  local ok, mod = pcall(require, name)
  if ok then return mod end
  local here = debug.getinfo(1, "S").source:gsub("^@", ""):gsub("[^/]+$", "")
  local candidate = here .. name .. ".lua"
  local fh = io.open(candidate, "r")
  if fh then
    fh:close()
    return dofile(candidate)
  end
  -- Last-resort: build a config table from env vars so this loads in CI.
  return {
    clinicId        = os.getenv("EINS_CLINIC_ID") or "",
    pvsSecret       = os.getenv("EINS_PVS_SECRET") or "",
    bridgeBaseUrl   = os.getenv("EINS_BRIDGE_URL") or "https://bridge.einsvisuals.de",
    portalBaseUrl   = os.getenv("EINS_PORTAL_URL") or "https://portal.einsvisuals.de",
  }
end

-- Minimal JSON encoder: deterministic key order, supports strings, numbers,
-- booleans, nested tables, and arrays. Designed for the canonical event
-- shape only; not a general JSON library.
local function json_encode_string(s)
  local escapes = {
    ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f",
    ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t",
  }
  return '"' .. (s:gsub('[%z\1-\31\\"]', function(c)
    return escapes[c] or string.format("\\u%04x", c:byte())
  end)) .. '"'
end

local function is_array(t)
  local n = 0
  for k in pairs(t) do
    n = n + 1
    if type(k) ~= "number" then return false end
  end
  for i = 1, n do
    if t[i] == nil then return false end
  end
  return true, n
end

local function json_encode(v)
  local tv = type(v)
  if tv == "nil" then return "null" end
  if tv == "boolean" then return v and "true" or "false" end
  if tv == "number" then return tostring(v) end
  if tv == "string" then return json_encode_string(v) end
  if tv == "table" then
    local arr, n = is_array(v)
    if arr then
      local parts = {}
      for i = 1, n do parts[i] = json_encode(v[i]) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    -- Sort keys so the signature input is byte-stable across re-emits.
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys)
    local parts = {}
    for _, k in ipairs(keys) do
      parts[#parts + 1] = json_encode_string(k) .. ":" .. json_encode(v[k])
    end
    return "{" .. table.concat(parts, ",") .. "}"
  end
  error("json_encode: unsupported type " .. tv)
end

M.json_encode = json_encode

-- Compute HMAC-SHA256 via the system openssl. Returns the hex digest.
local function hmac_sha256_hex(secret, message)
  -- Write the message to a temp file so newlines / control bytes survive
  -- shell quoting. openssl reads from stdin.
  local tmp = os.tmpname()
  local fh = assert(io.open(tmp, "wb"))
  fh:write(message)
  fh:close()
  local cmd = string.format(
    "/usr/bin/openssl dgst -sha256 -hmac %s < %s",
    shell_quote(secret), shell_quote(tmp)
  )
  local p = io.popen(cmd, "r")
  local out = p:read("*a") or ""
  p:close()
  os.remove(tmp)
  -- openssl 1.0 prints "(stdin)= <hex>"; openssl 3.x prints "SHA2-256(stdin)= <hex>".
  local hex = out:match("=%s*([0-9a-f]+)") or ""
  return hex
end

function shell_quote(s)
  return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

-- POST a canonical event. The hook scripts build the table; this function
-- canonicalises it (json_encode sorts keys), signs, and POSTs.
function M.emit(event)
  if type(event) ~= "table" then
    error("emit: expected event table")
  end
  -- Stamp clinicId from config so individual hooks don't need to repeat it.
  event.clinicId = event.clinicId or cjson.clinicId
  if event.clinicId == "" then
    io.stderr:write("[eins-emitter] missing clinicId in config; skipping emit\n")
    return false
  end
  local body = json_encode(event)
  local sig = "sha256=" .. hmac_sha256_hex(cjson.pvsSecret, body)
  if sig == "sha256=" then
    io.stderr:write("[eins-emitter] HMAC computation failed (openssl missing?)\n")
    return false
  end

  local tmp = os.tmpname()
  local fh = assert(io.open(tmp, "wb"))
  fh:write(body)
  fh:close()
  local url = (cjson.portalBaseUrl or cjson.bridgeBaseUrl)
                :gsub("/+$", "") .. "/api/pvs/events"
  local cmd = table.concat({
    "/usr/bin/curl",
    "--silent --show-error --fail-with-body",
    "--max-time 10",
    "-H 'content-type: application/json'",
    "-H " .. shell_quote("x-eins-signature: " .. sig),
    "--data @" .. shell_quote(tmp),
    shell_quote(url),
  }, " ")
  local p = io.popen(cmd .. " 2>&1", "r")
  local response = p:read("*a") or ""
  local ok = p:close()
  os.remove(tmp)
  if not ok then
    io.stderr:write("[eins-emitter] POST failed for "
      .. (event.kind or "?") .. ": " .. response .. "\n")
    return false
  end
  return true
end

-- ISO-8601 UTC timestamp helper. Tomedo Lua exposes os.time() in local TZ;
-- shift to UTC by reading TZ offset via `date +%z`.
function M.iso_utc(epoch_seconds)
  epoch_seconds = epoch_seconds or os.time()
  return os.date("!%Y-%m-%dT%H:%M:%S.000Z", epoch_seconds)
end

-- Translate a Tomedo appointment-status code to the canonical newStatus
-- vocabulary. The exact integer codes Tomedo emits differ across versions;
-- this map covers the common set documented on the Tomedo forum.
M.appointment_status_map = {
  ["geplant"]              = "scheduled",
  ["bestaetigt"]           = "scheduled",
  ["anwesend"]             = "checked_in",
  ["eingecheckt"]          = "checked_in",
  ["erschienen"]           = "checked_in",
  ["behandelt"]            = "completed",
  ["abgeschlossen"]        = "completed",
  ["fertig"]               = "completed",
  ["nicht_erschienen"]     = "no_show",
  ["ausgefallen"]          = "no_show",
  ["abgesagt"]             = "cancelled",
  ["storniert"]            = "cancelled",
}

function M.normalise_appointment_status(raw)
  if not raw then return nil end
  local k = tostring(raw):lower():gsub("%s+", "_"):gsub("-", "_")
  return M.appointment_status_map[k]
end

return M
