import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * B-1 / decision a: GET on an emailed link never consumes the token (mail
 * scanners prefetch with GET); only the POST from the /login/link button
 * does, and a cross-site POST is refused (login CSRF).
 */
const mocks = vi.hoisted(() => ({
  consumeMagicLink: vi.fn(),
  consumeMagicLinkForPasswordSetup: vi.fn(),
  issuePasswordSetupCookie: vi.fn(),
  writeAudit: vi.fn(),
  selectLimit: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/auth/magic-link", () => ({
  consumeMagicLink: mocks.consumeMagicLink,
  consumeMagicLinkForPasswordSetup: mocks.consumeMagicLinkForPasswordSetup,
}));
vi.mock("@/auth/password-setup-cookie", () => ({
  issuePasswordSetupCookie: mocks.issuePasswordSetupCookie,
}));
vi.mock("@/server/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/auth/session", () => ({ getSession: mocks.getSession }));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.selectLimit }) }) }) },
  schema: {
    clinicUsers: { role: {}, id: {} },
    magicLinks: { userId: {}, intent: {}, consumedAt: {}, tokenHash: {} },
  },
}));

import { GET, POST } from "./route";

const ORIGIN = "http://localhost:3007";
const TOKEN = "T".repeat(43);

function post(token: string | null, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  const body = new URLSearchParams();
  if (token !== null) body.set("token", token);
  return new NextRequest(`${ORIGIN}/api/auth/callback`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: body.toString(),
  });
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.consumeMagicLinkForPasswordSetup.mockResolvedValue({ ok: false, reason: "invalid" });
  mocks.selectLimit.mockResolvedValue([{ role: "inhaber" }]);
});

describe("GET /api/auth/callback", () => {
  it("forwards to the read-only landing page and consumes nothing", async () => {
    const res = await GET(new NextRequest(`${ORIGIN}/api/auth/callback?token=${TOKEN}`));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login/link");
    expect(loc.searchParams.get("token")).toBe(TOKEN);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
    expect(mocks.consumeMagicLinkForPasswordSetup).not.toHaveBeenCalled();
  });

  it("sends a link without token to /login", async () => {
    const res = await GET(new NextRequest(`${ORIGIN}/api/auth/callback`));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=missing_token`);
  });
});

describe("POST /api/auth/callback", () => {
  it("consumes a login token once and lands on the role page", async () => {
    mocks.consumeMagicLink.mockResolvedValueOnce({
      ok: true,
      userId: "u1",
      clinicId: "c1",
      intent: "login",
    });
    const res = await POST(post(TOKEN));
    expect(res.status).toBe(303);
    expect(mocks.consumeMagicLink).toHaveBeenCalledTimes(1);
    expect(mocks.consumeMagicLink).toHaveBeenCalledWith(TOKEN);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "login", impersonatedByAdminId: null })
    );
  });

  it("reports an already used token", async () => {
    mocks.consumeMagicLink.mockResolvedValueOnce({ ok: false, reason: "consumed" });
    const res = await POST(post(TOKEN));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=consumed`);
  });

  // J-6: second tap on "Jetzt anmelden" after the first already logged in.
  const session = { userId: "u1", role: "inhaber", impersonatedByAdminId: null };
  it("sends a double submit with a fresh session of the same user to the landing page", async () => {
    mocks.consumeMagicLink.mockResolvedValueOnce({ ok: false, reason: "consumed" });
    mocks.getSession.mockResolvedValueOnce(session);
    mocks.selectLimit.mockResolvedValueOnce([
      { userId: "u1", intent: "login", consumedAt: new Date(Date.now() - 5_000) },
    ]);
    const res = await POST(post(TOKEN));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it("keeps the error for another user, an old consume or no session", async () => {
    const cases: Array<[unknown, unknown[]]> = [
      [null, [{ userId: "u1", intent: "login", consumedAt: new Date() }]],
      [session, [{ userId: "u9", intent: "login", consumedAt: new Date() }]],
      [session, [{ userId: "u1", intent: "login", consumedAt: new Date(Date.now() - 10 * 60_000) }]],
      [{ ...session, impersonatedByAdminId: "a1" }, [{ userId: "u1", intent: "login", consumedAt: new Date() }]],
    ];
    for (const [s, rows] of cases) {
      mocks.consumeMagicLink.mockResolvedValueOnce({ ok: false, reason: "consumed" });
      mocks.getSession.mockResolvedValueOnce(s);
      mocks.selectLimit.mockReset();
      mocks.selectLimit.mockResolvedValue(rows);
      const res = await POST(post(TOKEN));
      expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=consumed`);
    }
  });

  it("routes invite / reset tokens to /set-password without a session", async () => {
    mocks.consumeMagicLinkForPasswordSetup.mockResolvedValueOnce({
      ok: true,
      userId: "u2",
      clinicId: "c1",
      intent: "invite",
    });
    const res = await POST(post(TOKEN));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/set-password");
    expect(mocks.issuePasswordSetupCookie).toHaveBeenCalledWith("clinic", "u2", "set_password");
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
  });

  it("refuses a cross-site POST without touching the token (login CSRF)", async () => {
    const res = await POST(post(TOKEN, { "sec-fetch-site": "cross-site" }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=invalid`);
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
    expect(mocks.consumeMagicLinkForPasswordSetup).not.toHaveBeenCalled();
  });

  it("needs the token in the form body", async () => {
    const res = await POST(post(null));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/login?error=missing_token`);
    expect(mocks.consumeMagicLink).not.toHaveBeenCalled();
  });
});
