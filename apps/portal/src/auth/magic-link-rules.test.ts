import { describe, expect, it } from "vitest";
import {
  classifyLinkRow,
  isPlausibleLinkToken,
  magicLinkTtlSeconds,
  suppressionBlocksAuthMail,
} from "./magic-link-rules";
import { generateToken } from "../lib/crypto";

const now = new Date("2026-10-07T10:00:00Z");
const future = new Date("2026-10-07T10:15:00Z");

describe("isPlausibleLinkToken", () => {
  it("accepts real tokens", () => {
    expect(isPlausibleLinkToken(generateToken(32))).toBe(true);
  });
  it("rejects junk before any DB lookup", () => {
    for (const bad of [undefined, null, 42, "", "short", "a".repeat(129), `${"a".repeat(40)}'--`, `${"a".repeat(40)} `]) {
      expect(isPlausibleLinkToken(bad), String(bad)).toBe(false);
    }
  });
});

describe("magicLinkTtlSeconds", () => {
  const ttl = { login: 900, invite: 7 * 86400 };
  it("gives invitations 7 days and every other link the short TTL", () => {
    expect(magicLinkTtlSeconds("invite", ttl)).toBe(ttl.invite);
    expect(magicLinkTtlSeconds("login", ttl)).toBe(ttl.login);
    expect(magicLinkTtlSeconds("reset_password", ttl)).toBe(ttl.login);
    expect(magicLinkTtlSeconds("set_password", ttl)).toBe(ttl.login);
  });
});

describe("suppressionBlocksAuthMail (B-10)", () => {
  it("never blocks without a suppression", () => {
    expect(suppressionBlocksAuthMail("login", null)).toBe(false);
    expect(suppressionBlocksAuthMail("invite", null)).toBe(false);
  });
  it("blocks every suppressed invitation", () => {
    for (const r of ["bounced", "manual", "complained", "unsubscribed"]) {
      expect(suppressionBlocksAuthMail("invite", r)).toBe(true);
    }
  });
  it("still sends self-requested links after a spam complaint, not after a bounce or manual block", () => {
    expect(suppressionBlocksAuthMail("login", "complained")).toBe(false);
    expect(suppressionBlocksAuthMail("reset_password", "complained")).toBe(false);
    expect(suppressionBlocksAuthMail("login", "bounced")).toBe(true);
    expect(suppressionBlocksAuthMail("reset_password", "manual")).toBe(true);
  });
});

describe("classifyLinkRow (B-1 landing page)", () => {
  it("accepts a fresh link of an active user", () => {
    expect(classifyLinkRow({ consumedAt: null, expiresAt: future, userActive: true }, now)).toBeNull();
  });
  it("names why a link cannot be used", () => {
    expect(classifyLinkRow(null, now)).toBe("invalid");
    expect(classifyLinkRow(undefined, now)).toBe("invalid");
    expect(classifyLinkRow({ consumedAt: now, expiresAt: future, userActive: true }, now)).toBe("consumed");
    expect(classifyLinkRow({ consumedAt: null, expiresAt: now, userActive: true }, now)).toBe("expired");
    // archived user or archived Praxis (decision b)
    expect(classifyLinkRow({ consumedAt: null, expiresAt: future, userActive: false }, now)).toBe("no_user");
  });
});
