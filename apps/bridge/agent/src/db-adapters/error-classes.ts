/**
 * Error classification shared by the framework (poll errors), the runner
 * (connect errors) and config-sync (probation). Everything here is
 * conservative: an unknown error is NOT an auth error, NOT a schema error and
 * NOT environmental, so the caller falls through to its generic retry path.
 */

interface ErrLike {
  code?: unknown;
  errno?: unknown;
  number?: unknown;
  errorNum?: unknown;
  message?: unknown;
}

function asErr(err: unknown): ErrLike {
  return err && typeof err === "object" ? (err as ErrLike) : {};
}

export function errorMessage(err: unknown): string {
  const m = asErr(err).message;
  return typeof m === "string" ? m : String(err);
}

/**
 * Did the database reject the CREDENTIAL (as opposed to being unreachable)?
 * Retrying these can lock the account out, so the runner stops on them.
 */
export function isAuthError(err: unknown): boolean {
  const e = asErr(err);
  const code = typeof e.code === "string" ? e.code : "";
  const msg = errorMessage(err);
  // PostgreSQL: 28P01 invalid_password, 28000 invalid_authorization_specification.
  if (code === "28P01" || code === "28000") return true;
  // MySQL / MariaDB: ER_ACCESS_DENIED_ERROR (1045).
  if (
    code === "ER_ACCESS_DENIED_ERROR" ||
    code === "ER_ACCESS_DENIED_NO_PASSWORD_ERROR" ||
    e.errno === 1045
  ) {
    return true;
  }
  // MS SQL Server: 18456 login failed; tedious reports code ELOGIN for EVERY
  // login-phase error, including 4060 (database unavailable / recovering).
  // These count as auth errors for visibility, but isAmbiguousAuthError()
  // says they must not latch forever (see runner.ts).
  if (isAmbiguousAuthError(err)) return true;
  // Oracle: ORA-01017 invalid username/password, ORA-28000 account locked,
  // ORA-28001 password expired.
  if (e.errorNum === 1017 || e.errorNum === 28000 || e.errorNum === 28001) return true;
  return (
    /password authentication failed/i.test(msg) ||
    /ORA-01017|ORA-28000|ORA-28001/i.test(msg) ||
    /Login failed for user/i.test(msg) ||
    /Access denied for user/i.test(msg) ||
    /Your user name and password are not defined/i.test(msg) ||
    /Unable to connect with plugin|Unknow auth plugin|Missing security context/i.test(msg) ||
    /authentication (?:failed|error)/i.test(msg) ||
    /invalid (?:username|user name)\/password/i.test(msg)
  );
}

/**
 * A login-phase error that does NOT prove the credential is wrong. SQL Server
 * answers "Login failed" (tedious: ELOGIN) both for a bad password and for a
 * database that is merely offline / recovering after a boot (4060, 18456 with
 * a state code that points at the database, not the password). The runner keeps
 * such a vendor visible as auth_failed but retries one attempt every 6 h
 * instead of latching until the credential changes. Unambiguous codes
 * (pg 28P01, MySQL 1045, Oracle ORA-01017/28000/28001, Firebird "user name and
 * password are not defined") are NOT ambiguous and keep the hard latch.
 */
export function isAmbiguousAuthError(err: unknown): boolean {
  const e = asErr(err);
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "ELOGIN" || e.number === 18456 || e.number === 4060) return true;
  // A bare message without any code: only the SQL Server wording is ambiguous.
  if (code === "" && e.number === undefined && e.errno === undefined && e.errorNum === undefined) {
    return /Login failed for user/i.test(errorMessage(err));
  }
  return false;
}

export const FIREBIRD_AUTH_HINT =
  "Firebird 4 Srp256: bitte Legacy_Auth/Srp in firebird.conf AuthServer aktivieren (der Agent unterstützt Srp256 nicht), oder das Passwort prüfen.";

/** Actionable text for an auth-class error, engine-aware. */
export function describeAuthError(engine: string, err: unknown): string {
  const base = errorMessage(err).split("\n")[0].slice(0, 200);
  if (engine === "firebird") return `${base} | ${FIREBIRD_AUTH_HINT}`;
  if (engine === "oracle") {
    return `${base} | Zugangsdaten abgelehnt; weitere Versuche gestoppt (Konto-Sperre vermeiden). Passwort mit --rotate-db-credential erneuern.`;
  }
  return `${base} | Zugangsdaten abgelehnt; weitere Versuche gestoppt. Passwort mit --rotate-db-credential erneuern.`;
}

/** Text for an ambiguous (SQL Server) login failure: one retry every 6 h. */
export function describeSuspectAuthError(err: unknown): string {
  const base = errorMessage(err).split("\n")[0].slice(0, 200);
  return `${base} | SQL Server meldet Login-Fehler auch, wenn die Datenbank nur nicht verfügbar ist (z. B. nach dem Start). Nächster Versuch in 6 h; bei falschem Passwort mit --rotate-db-credential erneuern.`;
}

/**
 * An error caused by the environment (network, host, credential, lock) rather
 * than by a config. Probation must never roll a config back for these.
 */
export function isEnvironmentError(err: unknown): boolean {
  if (isAuthError(err)) return true;
  const e = asErr(err);
  const code = typeof e.code === "string" ? e.code : "";
  if (
    /^(ECONN|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EPIPE|EAI_AGAIN|ESOCKET|ETIMEOUT)/.test(code)
  ) {
    return true;
  }
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|connection (?:lost|refused|terminated|closed)|socket|network|timeout|timed out|deadline|too many connections|cannot connect|unable to connect|no connection|credential|password|login|locked|not connected/i.test(
    errorMessage(err)
  );
}

/** A query error that says the TABLE (not just a column) does not exist. */
export function isTableMissingError(err: unknown): boolean {
  const e = asErr(err);
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "42P01" || code === "ER_NO_SUCH_TABLE" || e.errno === 1146) return true;
  if (e.number === 208 || e.errorNum === 942) return true;
  const msg = errorMessage(err);
  return (
    /no such table/i.test(msg) ||
    /table unknown/i.test(msg) ||
    /relation\b.*does not exist/i.test(msg) ||
    /Invalid object name/i.test(msg) ||
    /ORA-00942/i.test(msg) ||
    /Table '[^']+' doesn't exist/i.test(msg)
  );
}

/** Best-effort table name out of a table-missing error message. */
export function extractMissingTable(err: unknown): string | null {
  const msg = errorMessage(err);
  const patterns = [
    /relation "([^"]+)" does not exist/i, // postgres
    /Table '([^']+)' doesn't exist/i, // mysql
    /no such table:\s*([A-Za-z0-9_."]+)/i, // sqlite
    /Invalid object name '([^']+)'/i, // mssql
    /Table unknown\s*[\r\n]+\s*([A-Za-z0-9_$]+)/i, // firebird
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m?.[1]) return m[1].replace(/^"|"$/g, "");
  }
  return null;
}
