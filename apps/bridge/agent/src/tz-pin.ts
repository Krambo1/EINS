/**
 * H7: pin the agent process timezone to UTC.
 *
 * This module has ONE job and MUST stay the very first import of the agent
 * entrypoint (index.ts). ES module imports execute in source order, so an
 * `import "./tz-pin.js"` on the first line runs this assignment before any
 * other imported module initialises, i.e. before any DB client library
 * (node-firebird, oracledb, mssql, mysql2, pg) is loaded and before the
 * first Date is constructed.
 *
 * Why it must be UTC. Two of the four server engines the SQL-introspection
 * runner can talk to (Oracle TIMESTAMP, Firebird TIMESTAMP) have no
 * per-connection UTC switch: their client libraries convert a
 * `TIMESTAMP WITHOUT TIME ZONE` through the Node process timezone. The
 * cursor round-trip stores a timestamp as ISO and binds it back as a Date
 * on the next poll; for the boundary-equality check to hold, read and bind
 * must be exact inverses. Under a non-UTC process offset (production agents
 * run under Europe/Berlin, but every test pins TZ=UTC) the bound value
 * shifts by that offset and the runner either re-emits every row or, worse,
 * silently skips rows. Forcing UTC collapses every engine's read/bind path
 * to one timezone so the inverse is exact. See
 * apps/bridge/agent/src/db-adapters/it-support.ts for the same rationale on
 * the integration harness side.
 *
 * OPEN QUESTION (anchor for the Berlin-TZ integration-test leg): this pin
 * proves cursor correctness for a UTC-configured DB read through a
 * UTC-pinned process. It does NOT yet prove per-driver bind/read symmetry
 * when the DATABASE itself is configured for a non-UTC session timezone
 * (e.g. an Oracle instance with a Europe/Berlin SESSIONTIMEZONE, or a
 * Firebird server on local time). That leg needs a dedicated integration
 * test that boots the engine under a non-UTC session tz and asserts the
 * same round-trip holds. Until then, keep the process pinned to UTC.
 *
 * Node honours a runtime assignment to process.env.TZ for subsequent Date
 * operations, so setting it here (rather than only via the environment) is
 * sufficient and removes the dependency on the operator's shell exporting
 * TZ=UTC before launching the service.
 */
process.env.TZ = "UTC";
