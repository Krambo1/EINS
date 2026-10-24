import { describe, expect, it } from "vitest";
import { buildWindowsCommandLine, quoteWindowsArg } from "./win-context.js";

/** Reference CommandLineToArgvW for the argument parts used here (no argv[0] special case). */
function parseArgv(cmd: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (cmd[i] === " " || cmd[i] === "\t") i++;
    if (i >= cmd.length) break;
    let arg = "";
    let inQuotes = false;
    while (i < cmd.length) {
      let bs = 0;
      while (cmd[i] === "\\") {
        bs++;
        i++;
      }
      if (cmd[i] === '"') {
        arg += "\\".repeat(Math.floor(bs / 2));
        if (bs % 2 === 1) {
          arg += '"';
        } else {
          inQuotes = !inQuotes;
        }
        i++;
        continue;
      }
      arg += "\\".repeat(bs);
      if (i >= cmd.length) break;
      if (!inQuotes && (cmd[i] === " " || cmd[i] === "\t")) break;
      arg += cmd[i];
      i++;
    }
    out.push(arg);
  }
  return out;
}

describe("quoteWindowsArg (CommandLineToArgvW rules)", () => {
  it("leaves a plain argument alone unless forced", () => {
    expect(quoteWindowsArg("--supervise")).toBe("--supervise");
    expect(quoteWindowsArg("C:\a\b.js")).toBe("C:\a\b.js");
    expect(quoteWindowsArg("C:\a\b.js", true)).toBe('"C:\a\b.js"');
  });

  it("quotes an empty argument", () => {
    expect(quoteWindowsArg("")).toBe('""');
  });

  it("doubles the backslashes before the closing quote (trailing backslash)", () => {
    expect(quoteWindowsArg("C:\Pfad\\", true)).toBe('"C:\Pfad\\\\"');
    expect(quoteWindowsArg("C:\Mein Pfad\\")).toBe('"C:\Mein Pfad\\\\"');
  });

  it("escapes embedded quotes and the backslashes in front of them", () => {
    expect(quoteWindowsArg('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteWindowsArg('a\\"b c')).toBe('"a\\\\\\"b c"');
  });

  it("keeps UNC paths and spaces intact", () => {
    expect(quoteWindowsArg("\\server\Freigabe Name\gdt")).toBe('"\\server\Freigabe Name\gdt"');
    expect(quoteWindowsArg("\\server\share\\", true)).toBe('"\\server\share\\\\"');
  });

  it("round-trips through a CommandLineToArgvW parser", () => {
    const samples = [
      "C:\Pfad\\",
      "C:\Mein Pfad\\",
      "C:\Program Files\EINS-Agent\dist\index.js",
      "\\server\Freigabe Name\gdt\\",
      'quote " inside',
      'trailing\\\\"',
      "\\\\\\",
      "",
      "tab\there",
      "plain",
    ];
    for (const s of samples) {
      expect(parseArgv(quoteWindowsArg(s)), JSON.stringify(s)).toEqual([s]);
      expect(parseArgv(quoteWindowsArg(s, true)), JSON.stringify(s)).toEqual([s]);
    }
    const line = buildWindowsCommandLine(samples);
    expect(parseArgv(line)).toEqual(samples);
  });
});
