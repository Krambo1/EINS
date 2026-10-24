/**
 * A vendor-config bundle the AGENT'S signer really produced, plus the public
 * half of the throwaway key that signed it.
 *
 * Why this file exists: the signing code lives in the agent
 * (apps/bridge/agent/src/db-adapters/config-signature.ts) and the verifying
 * code lives in the portal (server/pvs-config-signature.ts), duplicated on
 * purpose because the agent ships as a single binary with no monorepo runtime
 * deps. Duplication invites drift, and drift here means the portal happily
 * accepts a bundle every agent rejects, or the reverse.
 *
 * This fixture pins the wire contract from the outside: whichever side changes
 * its canonicalisation, field order or domain separator, the test that verifies
 * this bundle fails.
 *
 * Regenerate (only when the format itself changes on purpose):
 *   pnpm --filter eins-agent config:keygen -- --key-id <id> --out <key>
 *   pnpm --filter eins-agent config:sign   -- --vendor fixture-db --version 7 \
 *        --key <key> --in <yaml> --out fixture.signed.json
 *
 * The private key is a throwaway generated for this fixture and was never kept;
 * only the public half is here, and it verifies exactly one document.
 */

export const FIXTURE_PUBLIC_KEY = {
  keyId: "test-key-1",
  publicKey: "DI7NZsKpmlmxjrjKq8lBsQszkkZQagQXCuydR20E1JI=",
} as const;

export const FIXTURE_SIGNED_BUNDLE = {
  schema: "eins-pvs-vendor-config/v1",
  vendor: "fixture-db",
  version: 7,
  bridgeSource: "gdt_agent",
  driver: "sqlite",
  streams: ["PatientUpserted"],
  minAgentVersion: "0.3.0",
  notes: "Fixture fuer den Portal-Vertragstest",
  signedAt: 1784739445077,
  sha256: "2a1cf60f36d9da2de0abd6a6aedf4f6c2d72b5c82ce01d3678a33e5bb2b68320",
  keyId: "test-key-1",
  yaml:
    "vendor: fixture-db\ndriver: sqlite\nbridgeSource: gdt_agent\nconnection:\n" +
    "  credentialId: fixture-cred\nstreams:\n  - kind: PatientUpserted\n" +
    "    cursorColumn: updated_at\n" +
    "    query: SELECT id, updated_at FROM patient WHERE updated_at > :cursor\n" +
    "    map:\n      pvsExternalEventId: id\n      occurredAt: updated_at\n" +
    "      pvsPatientId: id\n",
  signature:
    "c2UAI79+ah9HpTfKBYqQvtBLO2ZgJ9NF9HlDZPRZqhLr7dbVAR9fO6nrHO2LzzpVlmc6pCueIy/+/UzF16sxBA==",
} as const;
