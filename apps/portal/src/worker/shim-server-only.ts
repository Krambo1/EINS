/**
 * Neutralize the `server-only` package for worker processes.
 *
 * `server-only` is a Next.js convention: the package's body is `throw new
 * Error(...)`, and Next replaces it with an empty module during bundling.
 * The worker (`pnpm worker`, `pnpm cron`) runs as plain Node via tsx, so
 * any transitive import of a file annotated with `import "server-only"`
 * trips that throw at startup.
 *
 * We pre-populate the CJS require cache with an empty exports object,
 * so subsequent `require("server-only")` calls short-circuit before the
 * package body executes. This file MUST be imported first in worker entry
 * points, before any module that imports `server-only` (directly or
 * transitively).
 */
import { createRequire } from "node:module";

const localRequire = createRequire(import.meta.url);
const filename = localRequire.resolve("server-only");

if (!localRequire.cache[filename]) {
  localRequire.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports: {},
    children: [],
    paths: [],
    parent: null,
  } as unknown as NodeJS.Module;
}
