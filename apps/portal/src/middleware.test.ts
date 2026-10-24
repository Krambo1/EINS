import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

/** Where the middleware sends a GET: the rewrite target path, or "next". */
function route(path: string, headers: Record<string, string>): string {
  const res = middleware(new NextRequest(`http://localhost:3007${path}`, { headers }));
  const rewrite = res.headers.get("x-middleware-rewrite");
  return rewrite ? new URL(rewrite).pathname : "next";
}

describe("middleware host routing", () => {
  it("hides /admin on the Praxis host", () => {
    expect(route("/admin/garantie", { host: "app.eins.ag" })).toBe("/404");
  });

  it("ignores a forged x-forwarded-host on the Praxis host (VF2)", () => {
    expect(
      route("/admin/garantie", { host: "app.eins.ag", "x-forwarded-host": "admin.eins.ag" })
    ).toBe("/404");
  });

  it("maps the admin host onto /admin", () => {
    expect(route("/garantie", { host: "admin.eins.ag" })).toBe("/admin/garantie");
    expect(route("/admin/garantie", { host: "admin.eins.ag" })).toBe("next");
  });

  it("keeps the admin host on Next's loopback re-fetch after an action redirect (V7 5.6)", () => {
    expect(
      route("/admin/garantie", { host: "localhost:3007", "x-forwarded-host": "admin.eins.ag" })
    ).toBe("next");
  });

  it("hides /admin on loopback without a forwarded admin host", () => {
    expect(route("/admin", { host: "localhost:3007" })).toBe("/404");
  });
});
