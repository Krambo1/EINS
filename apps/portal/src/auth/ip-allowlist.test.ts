import { describe, expect, it } from "vitest";
import { buildIpAllowlist, ipInAllowlist, normalizeIp } from "./ip-allowlist";

describe("normalizeIp", () => {
  it("maps IPv4-mapped IPv6 to IPv4", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toEqual({ address: "203.0.113.7", family: "ipv4" });
    expect(normalizeIp("::FFFF:203.0.113.7")).toEqual({ address: "203.0.113.7", family: "ipv4" });
  });
  it("strips brackets and zone ids, lowercases IPv6", () => {
    expect(normalizeIp("[2001:DB8::1]")).toEqual({ address: "2001:db8::1", family: "ipv6" });
    expect(normalizeIp("fe80::1%eth0")).toEqual({ address: "fe80::1", family: "ipv6" });
  });
  it("rejects garbage", () => {
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("[::1")).toBeNull();
  });
});

describe("buildIpAllowlist / ipInAllowlist", () => {
  it("matches exact IPv4 addresses, including the IPv4-mapped form", () => {
    const list = buildIpAllowlist(["203.0.113.7"]);
    expect(ipInAllowlist(list, "203.0.113.7")).toBe(true);
    expect(ipInAllowlist(list, "::ffff:203.0.113.7")).toBe(true);
    expect(ipInAllowlist(list, "203.0.113.8")).toBe(false);
  });

  it("matches IPv4 CIDR ranges", () => {
    const list = buildIpAllowlist(["198.51.100.0/24"]);
    expect(ipInAllowlist(list, "198.51.100.1")).toBe(true);
    expect(ipInAllowlist(list, "198.51.100.255")).toBe(true);
    expect(ipInAllowlist(list, "198.51.101.1")).toBe(false);
  });

  it("matches IPv6 addresses regardless of notation", () => {
    const list = buildIpAllowlist(["2001:db8:0:0:0:0:0:1", "2001:db8:abcd::/48"]);
    expect(ipInAllowlist(list, "2001:DB8::1")).toBe(true);
    expect(ipInAllowlist(list, "2001:db8:abcd:12::5")).toBe(true);
    expect(ipInAllowlist(list, "2001:db8:abce::5")).toBe(false);
  });

  it("converts an IPv4-mapped CIDR prefix to the IPv4 prefix", () => {
    const list = buildIpAllowlist(["::ffff:192.0.2.0/120"]);
    expect(list.invalid).toEqual([]);
    expect(ipInAllowlist(list, "192.0.2.200")).toBe(true);
    expect(ipInAllowlist(list, "192.0.3.1")).toBe(false);
  });

  it("ignores invalid entries and fails closed", () => {
    const list = buildIpAllowlist(["nonsense", "10.0.0.0/33", "10.0.0.0/x", "1.2.3.4/8/9", " "]);
    expect(list.size).toBe(0);
    expect(list.invalid).toEqual(["nonsense", "10.0.0.0/33", "10.0.0.0/x", "1.2.3.4/8/9"]);
    expect(ipInAllowlist(list, "10.0.0.1")).toBe(false);
    expect(ipInAllowlist(list, "1.2.3.4")).toBe(false);
  });

  it("never matches a missing or malformed request IP", () => {
    const list = buildIpAllowlist(["0.0.0.0/0"]);
    expect(ipInAllowlist(list, null)).toBe(false);
    expect(ipInAllowlist(list, undefined)).toBe(false);
    expect(ipInAllowlist(list, "unknown")).toBe(false);
    expect(ipInAllowlist(list, "1.2.3.4, 5.6.7.8")).toBe(false);
  });

  it("does not let an IPv4 range match IPv6 addresses", () => {
    const list = buildIpAllowlist(["0.0.0.0/0"]);
    expect(ipInAllowlist(list, "2001:db8::1")).toBe(false);
  });
});
