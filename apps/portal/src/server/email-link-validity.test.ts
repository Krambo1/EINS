import { describe, expect, it, vi } from "vitest";
import { INVITE_LINK_TTL_SECONDS, MAGIC_LINK_TTL_SECONDS } from "@/lib/constants";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

const { linkValidityLabel, sendMagicLinkEmail } = await import("./email");

describe("linkValidityLabel", () => {
  it("labels the portal link lifetimes in German", () => {
    expect(linkValidityLabel(MAGIC_LINK_TTL_SECONDS)).toBe("15 Minuten");
    expect(linkValidityLabel(INVITE_LINK_TTL_SECONDS)).toBe("7 Tage");
    expect(linkValidityLabel(86_400)).toBe("1 Tag");
    expect(linkValidityLabel(3 * 3_600)).toBe("3 Stunden");
    expect(linkValidityLabel(60)).toBe("1 Minute");
  });
});

describe("sendMagicLinkEmail validity text", () => {
  it("states 7 days for an invite and 15 minutes for a login", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(" "));
    });
    const email = await import("./email");
    const sender = email.getEmailSender();
    const spy = vi.spyOn(sender, "send").mockImplementation(async (m) => {
      send(m);
      return undefined as never;
    });

    await sendMagicLinkEmail({ to: "a@example.test", url: "https://x.test/l", intent: "invite" });
    await sendMagicLinkEmail({ to: "a@example.test", url: "https://x.test/l", intent: "login" });

    const [invite, login] = send.mock.calls.map((c) => c[0] as { text: string; html: string });
    expect(invite!.text).toContain("7 Tage gültig");
    expect(invite!.html).toContain("Link 7 Tage gültig");
    expect(invite!.text).not.toContain("15 Minuten");
    expect(login!.text).toContain("15 Minuten gültig");
    spy.mockRestore();
  });
});
