import { describe, expect, it } from "vitest";
import {
  SID_ADMINS,
  SID_SYSTEM,
  aceCanWrite,
  broadWriteAces,
  decodeIcaclsSave,
  isBroadTrustee,
  normalizeTrustee,
  parseAces,
  parseIcaclsSave,
  rightsToMask,
  unexpectedTrustees,
} from "./sddl.js";

describe("rightsToMask", () => {
  it("reads hex and decimal masks", () => {
    expect(rightsToMask("0x1301bf")).toEqual({ mask: 0x1301bf, unknown: false });
    expect(rightsToMask("0X1200A9")).toEqual({ mask: 0x1200a9, unknown: false });
    expect(rightsToMask("1179817")).toEqual({ mask: 1179817, unknown: false });
  });

  it("reads token pairs and ORs them", () => {
    expect(rightsToMask("FA")).toEqual({ mask: 0x001f01ff, unknown: false });
    expect(rightsToMask("FRFX")).toEqual({ mask: 0x00120089 | 0x001200a0, unknown: false });
  });

  it("flags unknown tokens instead of guessing", () => {
    expect(rightsToMask("CCDC").unknown).toBe(true);
    expect(rightsToMask("FAZZ").unknown).toBe(true);
  });

  it("empty rights is mask 0, known", () => {
    expect(rightsToMask("")).toEqual({ mask: 0, unknown: false });
  });
});

describe("normalizeTrustee / isBroadTrustee", () => {
  it("maps aliases to SIDs", () => {
    expect(normalizeTrustee("SY")).toBe(SID_SYSTEM);
    expect(normalizeTrustee("ba")).toBe(SID_ADMINS);
    expect(normalizeTrustee("BU")).toBe("S-1-5-32-545");
    expect(normalizeTrustee("S-1-5-18")).toBe(SID_SYSTEM);
  });

  it("SYSTEM and Administrators are not broad", () => {
    expect(isBroadTrustee("SY")).toBe(false);
    expect(isBroadTrustee("BA")).toBe(false);
    expect(isBroadTrustee("S-1-5-32-544")).toBe(false);
    // The built-in local Administrator account (RID 500) is not a broad group.
    expect(isBroadTrustee("LA")).toBe(false);
  });

  it("Everyone, Users, Authenticated Users, Interactive, Domain Users are broad", () => {
    for (const t of ["WD", "BU", "AU", "IU", "NU", "AN", "S-1-1-0", "S-1-5-32-545", "S-1-5-11", "DU"]) {
      expect(isBroadTrustee(t), t).toBe(true);
    }
    expect(isBroadTrustee("S-1-5-21-111-222-333-513")).toBe(true);
    expect(isBroadTrustee("S-1-5-21-111-222-333-514")).toBe(true);
  });

  it("a specific user SID or an installer-created account is not 'broad'", () => {
    expect(isBroadTrustee("S-1-5-21-111-222-333-1001")).toBe(false);
  });
});

describe("parseAces", () => {
  it("parses the line icacls /save writes", () => {
    const aces = parseAces("D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)");
    expect(aces).toHaveLength(3);
    expect(aces[0]).toMatchObject({ type: "A", flags: "OICI", trustee: SID_SYSTEM, unknownRights: false });
    expect(aces[2]).toMatchObject({ trustee: "S-1-5-32-545", mask: 0x1200a9 });
  });

  it("ignores an owner/group prefix and an S: suffix", () => {
    const aces = parseAces("O:BAG:SYD:AI(A;;FA;;;SY)S:(AU;SA;FA;;;WD)");
    expect(aces).toHaveLength(1);
    expect(aces[0]!.trustee).toBe(SID_SYSTEM);
  });

  it("skips malformed ACEs and a string without a DACL", () => {
    expect(parseAces("")).toEqual([]);
    expect(parseAces("O:BAG:SY")).toEqual([]);
    expect(parseAces("D:(A;;FA)")).toEqual([]);
  });

  it("reads deny ACEs and raw SIDs", () => {
    const aces = parseAces("D:(D;;FA;;;S-1-5-21-1-2-3-1001)(A;;FA;;;S-1-5-32-544)");
    expect(aces[0]).toMatchObject({ type: "D", trustee: "S-1-5-21-1-2-3-1001" });
    expect(aces[1]!.trustee).toBe(SID_ADMINS);
  });
});

describe("aceCanWrite / broadWriteAces", () => {
  it("read+execute is not write", () => {
    const [ace] = parseAces("D:(A;OICI;0x1200a9;;;BU)");
    expect(aceCanWrite(ace!)).toBe(false);
  });

  it("modify, full control, append, delete-child, write-dac, write-owner, generic write ARE write", () => {
    const masks = ["0x1301bf", "0x1f01ff", "0x4", "0x2", "0x40", "0x10000", "0x40000", "0x80000", "0x40000000", "0x10000000"];
    for (const m of masks) {
      const [ace] = parseAces(`D:(A;;${m};;;BU)`);
      expect(aceCanWrite(ace!), m).toBe(true);
    }
  });

  it("unknown rights tokens are treated as write capable (conservative)", () => {
    const [ace] = parseAces("D:(A;;CCDC;;;BU)");
    expect(ace!.unknownRights).toBe(true);
    expect(aceCanWrite(ace!)).toBe(true);
  });

  it("broadWriteAces: only allow ACEs of broad groups with write; inherit-only ACEs count", () => {
    const aces = parseAces(
      "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)(A;OICIIO;0x1301bf;;;AU)(D;;0x1301bf;;;WD)"
    );
    const bad = broadWriteAces(aces);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ trustee: "S-1-5-11", flags: "OICIIO" });
  });

  it("an admin-only DACL has no broad write ACE", () => {
    expect(broadWriteAces(parseAces("D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)"))).toEqual([]);
  });
});

describe("unexpectedTrustees", () => {
  it("empty for SYSTEM + Administrators only", () => {
    const aces = parseAces("D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)");
    expect(unexpectedTrustees(aces, [SID_SYSTEM, SID_ADMINS])).toEqual([]);
  });

  it("lists every other allowed trustee once; deny ACEs do not count", () => {
    const aces = parseAces(
      "D:(A;;FA;;;SY)(A;;FA;;;BU)(A;;FR;;;BU)(A;;FR;;;S-1-5-21-1-2-3-1001)(D;;FA;;;WD)"
    );
    expect(unexpectedTrustees(aces, [SID_SYSTEM, SID_ADMINS]).sort()).toEqual(
      ["S-1-5-21-1-2-3-1001", "S-1-5-32-545"].sort()
    );
  });

  it("accepts aliases in the allowed list", () => {
    const aces = parseAces("D:(A;;FA;;;SY)(A;;FA;;;BA)");
    expect(unexpectedTrustees(aces, ["SY", "BA"])).toEqual([]);
  });
});

describe("decodeIcaclsSave / parseIcaclsSave", () => {
  const body = "EINS-Agent\r\nD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)\r\n\r\nconfig.json\r\nD:AI(A;;FA;;;SY)\r\n\r\n";

  it("decodes UTF-16LE with a BOM", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, "utf16le")]);
    expect(decodeIcaclsSave(buf)).toBe(body);
  });

  it("decodes UTF-16LE without a BOM (what Windows 11 writes)", () => {
    expect(decodeIcaclsSave(Buffer.from(body, "utf16le"))).toBe(body);
  });

  it("parses name + SDDL records", () => {
    const records = parseIcaclsSave(body);
    expect(records).toEqual([
      { name: "EINS-Agent", sddl: "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)" },
      { name: "config.json", sddl: "D:AI(A;;FA;;;SY)" },
    ]);
  });

  it("no records for empty text", () => {
    expect(parseIcaclsSave("")).toEqual([]);
    expect(parseIcaclsSave("\r\n\r\n")).toEqual([]);
  });
});
