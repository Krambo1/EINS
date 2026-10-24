import type { Instrumentation } from "next";
import { describeErrorForLog } from "./lib/error-log";

/**
 * Next.js instrumentation hook. `onRequestError` fires for every uncaught
 * error in a server component, route handler, server action or middleware,
 * in production and dev. We write one JSON line per error so Vercel logs can
 * be filtered by `kind:"error"` and joined with the "Fehlernummer" the user
 * sees on the error page (`digest`).
 *
 * Patient-data rules: route pattern + path WITHOUT query string (search terms
 * can be patient names), no headers, no cookies, error text via
 * `describeErrorForLog` (DB errors by SQLSTATE only, other messages scrubbed).
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  try {
    const digest =
      err && typeof err === "object" && "digest" in err
        ? String((err as { digest?: unknown }).digest ?? "")
        : "";
    console.error(
      JSON.stringify({
        kind: "error",
        level: "error",
        digest: digest || undefined,
        method: request.method,
        path: request.path.split("?")[0],
        route: context.routePath,
        routeType: context.routeType,
        routerKind: context.routerKind,
        error: describeErrorForLog(err),
      })
    );
  } catch {
    // Logging must never throw out of the hook.
  }
};
