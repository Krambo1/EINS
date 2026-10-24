import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ gateComplete: false, gateCalls: 0 }));

vi.mock("@/server/queries/onboardingGate", async () => {
  const paths = await import("@/app/(portal)/_components/onboarding-gate-paths");
  return {
    isGateAllowedPath: paths.isGateAllowedPath,
    getOnboardingGateStatus: vi.fn(async () => {
      h.gateCalls += 1;
      return { gateComplete: h.gateComplete };
    }),
  };
});

import { postLoginPath } from "./post-login-path";

const inhaber = { clinicId: "clinic-1", role: "inhaber" as const };

beforeEach(() => {
  h.gateComplete = false;
  h.gateCalls = 0;
});

describe("postLoginPath", () => {
  it("sends an Inhaber with an open gate straight to /onboarding", async () => {
    expect(await postLoginPath(inhaber, null)).toBe("/onboarding");
    expect(await postLoginPath(inhaber, "/anfragen")).toBe("/onboarding");
  });

  it("keeps the normal landing page once the gate is complete", async () => {
    h.gateComplete = true;
    expect(await postLoginPath(inhaber, null)).toBe("/dashboard");
    expect(await postLoginPath(inhaber, "/anfragen")).toBe("/anfragen");
  });

  it("keeps a `next` path the gate allows, without a gate lookup", async () => {
    expect(await postLoginPath(inhaber, "/einstellungen/sicherheit")).toBe(
      "/einstellungen/sicherheit"
    );
    expect(h.gateCalls).toBe(0);
  });

  it("never gates team roles", async () => {
    expect(await postLoginPath({ clinicId: "c", role: "frontdesk" }, null)).toBe("/anfragen");
    expect(await postLoginPath({ clinicId: "c", role: "marketing" }, null)).toBe("/dashboard");
    expect(h.gateCalls).toBe(0);
  });
});
