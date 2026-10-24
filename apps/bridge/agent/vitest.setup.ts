import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

/**
 * Test isolation for the machine-wide data directory.
 *
 * On Windows configDir() resolves to %ProgramData%\EINS-Agent. Before that
 * change a test that redirected only %APPDATA% was enough to stay off the real
 * config; now such a test would read and write the real ProgramData (and
 * collide with a developer's installed agent). Pointing ProgramData at a
 * throwaway directory for every test file makes that mistake harmless. Tests
 * that exercise the resolution itself set ProgramData / EINS_AGENT_DATA_DIR
 * explicitly and are unaffected.
 *
 * Other platforms do not read ProgramData; this is a no-op for them.
 */
const sandbox = mkdtempSync(join(tmpdir(), "eins-agent-vitest-"));
const savedProgramData = process.env.ProgramData;
process.env.ProgramData = sandbox;

afterAll(() => {
  if (savedProgramData === undefined) delete process.env.ProgramData;
  else process.env.ProgramData = savedProgramData;
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch {
    // best effort: a still-open file handle on Windows must not fail the run
  }
});
