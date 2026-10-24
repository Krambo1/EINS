/**
 * Single source of truth for the agent version.
 *
 * It is reported on every heartbeat AND compared against a signed config's
 * `minAgentVersion`, so the signing script and the running agent have to agree
 * on it. Keeping it in its own module lets both import the value instead of the
 * script re-deriving it from package.json and quietly drifting.
 *
 * Keep in step with apps/bridge/agent/package.json `version`.
 */
export const AGENT_VERSION = "0.3.0";
