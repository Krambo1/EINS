-- EINS PVS Bridge: per-Praxis configuration for the Tomedo Lua emitter.
--
-- 1. Copy this file to `config.lua` (same directory).
-- 2. Fill in the three required values from the portal:
--    Einstellungen → Integrationen → PVS → "Tomedo Lua-Skripte" reveal
--    section. The portal also displays the URL to POST to.
-- 3. The Lua emitter (eins-canonical-emitter.lua) imports this file at boot.
--
-- DO NOT commit config.lua to source control: it contains the per-Praxis
-- HMAC secret. The file is referenced only by Tomedo's local Lua runtime.

return {
  -- The Praxis's clinicId in the EINS portal. UUID format.
  clinicId      = "00000000-0000-0000-0000-000000000000",

  -- The per-Praxis PVS HMAC secret. 64-character hex string minted at
  -- agent-enrollment time. The portal verifies signatures with this key.
  pvsSecret     = "REPLACE-WITH-PVS-SECRET",

  -- Where to POST events. Production: portal.eins.ag. Staging /
  -- self-host: replace with the appropriate origin.
  portalBaseUrl = "https://portal.eins.ag",

  -- Alternative endpoint for self-hosted bridge deployments. Leave at the
  -- default unless instructed otherwise by EINS support.
  bridgeBaseUrl = "https://bridge.eins.ag",
}
