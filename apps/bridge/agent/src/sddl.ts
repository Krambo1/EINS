/**
 * Minimal, pure SDDL (security descriptor string) reader for the two ACL
 * questions the agent asks of Windows:
 *
 *   1. data-dir.ts: after locking the data dir down, does the DACL really
 *      contain nobody but SYSTEM and Administrators?
 *   2. service-windows.ts: before registering a SYSTEM scheduled task that runs
 *      `node.exe <script>`, can an ordinary (non-admin) user modify node.exe,
 *      the script, or the directories they live in? If so, the task would hand
 *      them SYSTEM code execution.
 *
 * Why SDDL and not parsing `icacls <path>` output: that output is localized
 * ("Benutzer", "Users", ...) and prints resolved account names. `icacls <path>
 * /save <file>` writes the DACL in SDDL with well-known aliases and raw SIDs,
 * which is locale independent.
 *
 * This is not a general SDDL implementation. It reads ACEs of the DACL, maps
 * the access mask, and classifies trustees. Anything it cannot interpret is
 * reported conservatively (unknown rights count as "write capable").
 */

export interface Ace {
  /** "A" allow, "D" deny, "OA"/"OD" object variants, "AU"/"AL" other. */
  type: string;
  flags: string;
  /** The rights field exactly as written (hex "0x1301bf" or tokens "FA"). */
  rights: string;
  /** Trustee normalised to a SID string where an alias is known. */
  trustee: string;
  /** Access mask; 0 when `unknownRights` is true. */
  mask: number;
  /** The rights field held a token this reader does not know. */
  unknownRights: boolean;
}

export const SID_SYSTEM = "S-1-5-18";
export const SID_ADMINS = "S-1-5-32-544";

const ALIAS_TO_SID: Record<string, string> = {
  SY: "S-1-5-18",
  BA: "S-1-5-32-544",
  WD: "S-1-1-0", // Everyone
  BU: "S-1-5-32-545", // BUILTIN\Users
  BG: "S-1-5-32-546", // BUILTIN\Guests
  PU: "S-1-5-32-547", // BUILTIN\Power Users
  AU: "S-1-5-11", // Authenticated Users
  IU: "S-1-5-4", // INTERACTIVE
  NU: "S-1-5-2", // NETWORK
  AN: "S-1-5-7", // ANONYMOUS LOGON
  LS: "S-1-5-19", // LOCAL SERVICE
  NS: "S-1-5-20", // NETWORK SERVICE
  CO: "S-1-3-0", // CREATOR OWNER
  CG: "S-1-3-1", // CREATOR GROUP
  LA: "S-1-5-21-LOCALADMIN-500", // local Administrator (RID 500), not broad
  LG: "S-1-5-21-LOCALGUEST-501", // local Guest
};

/** Trustees any ordinary logged-on user belongs to. */
const BROAD_SIDS = new Set<string>([
  "S-1-1-0", // Everyone
  "S-1-5-11", // Authenticated Users
  "S-1-5-4", // Interactive
  "S-1-5-2", // Network
  "S-1-5-7", // Anonymous
  "S-1-5-32-545", // Users
  "S-1-5-32-546", // Guests
  "S-1-5-32-547", // Power Users
  "S-1-5-32-555", // Remote Desktop Users
  "S-1-5-21-LOCALGUEST-501",
]);

/** Domain Users (-513), Domain Guests (-514) and the "DU"/"DG" aliases. */
function isBroadDomainSid(sid: string): boolean {
  return /^S-1-5-21-\d+-\d+-\d+-(513|514)$/.test(sid);
}

export function normalizeTrustee(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (t === "DU") return "S-1-5-21-DOMAIN-513";
  if (t === "DG") return "S-1-5-21-DOMAIN-514";
  return ALIAS_TO_SID[t] ?? t;
}

export function isBroadTrustee(trustee: string): boolean {
  const t = normalizeTrustee(trustee);
  return (
    BROAD_SIDS.has(t) ||
    isBroadDomainSid(t) ||
    t === "S-1-5-21-DOMAIN-513" ||
    t === "S-1-5-21-DOMAIN-514"
  );
}

/** Mask bits that let a principal change what a SYSTEM task will execute. */
const FILE_WRITE_DATA = 0x2; // also ADD_FILE on a directory
const FILE_APPEND_DATA = 0x4; // also ADD_SUBDIRECTORY
const FILE_DELETE_CHILD = 0x40;
const DELETE = 0x10000;
const WRITE_DAC = 0x40000;
const WRITE_OWNER = 0x80000;
const GENERIC_ALL = 0x10000000;
const GENERIC_WRITE = 0x40000000;
const WRITE_LIKE_BITS =
  FILE_WRITE_DATA |
  FILE_APPEND_DATA |
  FILE_DELETE_CHILD |
  DELETE |
  WRITE_DAC |
  WRITE_OWNER |
  GENERIC_ALL |
  GENERIC_WRITE;

const RIGHT_TOKENS: Record<string, number> = {
  GA: 0x10000000,
  GR: 0x80000000,
  GW: 0x40000000,
  GX: 0x20000000,
  RC: 0x00020000,
  SD: 0x00010000,
  WD: 0x00040000,
  WO: 0x00080000,
  // File-object combinations.
  FA: 0x001f01ff,
  FR: 0x00120089,
  FW: 0x00120116,
  FX: 0x001200a0,
  // Directory-service tokens (CC, DC, RP, WP, ...) are deliberately absent:
  // their meaning on a file object is ambiguous, so they fall into the
  // "unknown rights" bucket, which is treated as write capable.
};

export function rightsToMask(rights: string): { mask: number; unknown: boolean } {
  const r = rights.trim();
  if (r === "") return { mask: 0, unknown: false };
  if (/^0x[0-9a-f]+$/i.test(r)) return { mask: Number.parseInt(r, 16), unknown: false };
  if (/^\d+$/.test(r)) return { mask: Number.parseInt(r, 10), unknown: false };
  let mask = 0;
  let unknown = false;
  for (let i = 0; i < r.length; i += 2) {
    const token = r.slice(i, i + 2).toUpperCase();
    const bits = RIGHT_TOKENS[token];
    if (bits === undefined) {
      unknown = true;
    } else {
      mask |= bits;
    }
  }
  return { mask, unknown };
}

/**
 * The DACL's ACEs. Accepts the SDDL line `icacls /save` writes ("D:PAI(...)"),
 * with or without an `O:`/`G:` prefix or an `S:` SACL suffix.
 */
export function parseAces(sddl: string): Ace[] {
  const dIdx = sddl.indexOf("D:");
  if (dIdx < 0) return [];
  let dacl = sddl.slice(dIdx + 2);
  const sIdx = dacl.indexOf("S:");
  if (sIdx >= 0) dacl = dacl.slice(0, sIdx);
  const aces: Ace[] = [];
  const re = /\(([^()]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(dacl)) !== null) {
    const fields = m[1]!.split(";");
    if (fields.length < 6) continue;
    const { mask, unknown } = rightsToMask(fields[2] ?? "");
    aces.push({
      type: (fields[0] ?? "").toUpperCase(),
      flags: (fields[1] ?? "").toUpperCase(),
      rights: fields[2] ?? "",
      trustee: normalizeTrustee(fields[5] ?? ""),
      mask,
      unknownRights: unknown,
    });
  }
  return aces;
}

function isAllow(ace: Ace): boolean {
  return ace.type === "A" || ace.type === "OA";
}

/** True when this ACE lets its trustee write to / replace the object. */
export function aceCanWrite(ace: Ace): boolean {
  return ace.unknownRights || (ace.mask & WRITE_LIKE_BITS) !== 0;
}

/**
 * Allow-ACEs that give a broad, non-administrative group the ability to
 * modify the object. Inherit-only ACEs (flag IO) are included on purpose:
 * they apply to the children that actually get executed.
 */
export function broadWriteAces(aces: Ace[]): Ace[] {
  return aces.filter(
    (a) => isAllow(a) && isBroadTrustee(a.trustee) && aceCanWrite(a)
  );
}

/**
 * Trustees of allow-ACEs that are NOT in `allowedSids` (SYSTEM and
 * Administrators for the locked-down data dir). Returns the distinct
 * offending trustees; empty means the DACL is as tight as intended.
 */
export function unexpectedTrustees(
  aces: Ace[],
  allowedSids: string[]
): string[] {
  const allowed = new Set(allowedSids.map(normalizeTrustee));
  const extra = new Set<string>();
  for (const ace of aces) {
    if (!isAllow(ace)) continue;
    if (!allowed.has(ace.trustee)) extra.add(ace.trustee);
  }
  return [...extra];
}

/**
 * Decode the file `icacls <path> /save <file>` writes. It is UTF-16LE, with or
 * without a BOM depending on the Windows build. Format per object:
 *
 *   <name relative to the path>
 *   D:AI(A;...;...;;;SY)(...)
 *   <blank line>
 */
export function decodeIcaclsSave(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le");
  }
  return buf.toString("utf16le");
}

/** All `{ name, sddl }` records of a decoded /save file. */
export function parseIcaclsSave(text: string): Array<{ name: string; sddl: string }> {
  const out: Array<{ name: string; sddl: string }> = [];
  const lines = text.split(/\r?\n/);
  let name: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^[OGDS]:/.test(line)) {
      out.push({ name: name ?? "", sddl: line });
      name = null;
    } else {
      name = line;
    }
  }
  return out;
}
