/**
 * `better-sqlite3-multiple-ciphers` is an API-compatible fork of
 * `better-sqlite3` with SQLCipher / multiple-ciphers built in. It ships
 * without its own .d.ts, so we re-use the upstream typings (which
 * @types/better-sqlite3 already provides under the original module name).
 *
 * Without this alias the agent's `import Database from
 * "better-sqlite3-multiple-ciphers"` would compile as `any`, hiding type
 * errors at the call sites. With it, the editor sees the full API surface
 * (Database / Statement / Transaction / pragma) without us forking the
 * upstream types.
 */
declare module "better-sqlite3-multiple-ciphers" {
  import Database from "better-sqlite3";
  export = Database;
}
