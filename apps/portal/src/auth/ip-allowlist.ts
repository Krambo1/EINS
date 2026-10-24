import { BlockList, isIP } from "node:net";

/**
 * Admin IP allowlist matching (B-13). Pure apart from `node:net`, so it is
 * unit-testable.
 *
 * Before: `list.includes(ip)`, an exact string compare. A single address
 * written differently (IPv4-mapped IPv6 `::ffff:1.2.3.4`, upper-case IPv6,
 * zero-compressed vs. expanded) or any provider range locked the admin out.
 *
 * Now each entry may be a single address or a CIDR range (`203.0.113.0/24`,
 * `2001:db8::/48`). Addresses are normalised before matching: brackets and
 * IPv6 zone ids are stripped, IPv4-mapped IPv6 becomes plain IPv4. Invalid
 * entries match nothing (fail closed) and are reported to the caller.
 */

type Family = "ipv4" | "ipv6";

export function normalizeIp(raw: string): { address: string; family: Family } | null {
  let v = raw.trim();
  if (v.startsWith("[")) {
    const end = v.indexOf("]");
    if (end <= 0) return null;
    v = v.slice(1, end);
  }
  const zone = v.indexOf("%");
  if (zone >= 0) v = v.slice(0, zone);
  v = v.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (mapped) v = mapped[1]!;
  const family = isIP(v);
  if (family === 4) return { address: v, family: "ipv4" };
  if (family === 6) return { address: v, family: "ipv6" };
  return null;
}

export interface IpAllowlist {
  list: BlockList;
  /** Entries that could not be parsed; they match nothing. */
  invalid: string[];
  size: number;
}

export function buildIpAllowlist(entries: readonly string[]): IpAllowlist {
  const list = new BlockList();
  const invalid: string[] = [];
  let size = 0;
  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const parts = entry.split("/");
    if (parts.length > 2) {
      invalid.push(entry);
      continue;
    }
    const addressPart = parts[0] ?? "";
    const prefixPart = parts[1];
    const wasMapped = /^\[?::ffff:\d/i.test(addressPart);
    const normalized = normalizeIp(addressPart);
    if (!normalized) {
      invalid.push(entry);
      continue;
    }
    if (prefixPart === undefined) {
      list.addAddress(normalized.address, normalized.family);
      size++;
      continue;
    }
    if (!/^\d{1,3}$/.test(prefixPart)) {
      invalid.push(entry);
      continue;
    }
    let prefix = Number(prefixPart);
    // "::ffff:203.0.113.0/120" was written as IPv6; the address is now IPv4.
    if (wasMapped && normalized.family === "ipv4") prefix -= 96;
    const max = normalized.family === "ipv4" ? 32 : 128;
    if (prefix < 0 || prefix > max) {
      invalid.push(entry);
      continue;
    }
    list.addSubnet(normalized.address, prefix, normalized.family);
    size++;
  }
  return { list, invalid, size };
}

export function ipInAllowlist(allowlist: IpAllowlist, ip: string | null | undefined): boolean {
  if (!ip) return false;
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  return allowlist.list.check(normalized.address, normalized.family);
}
