// Empty shim that replaces the `server-only` package during vitest runs.
// In production this package's body throws to prevent server-only modules
// from being bundled into the client. Tests don't have that constraint.
export {};
