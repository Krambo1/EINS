// Generate the agent-local mirror of the canonical schema sets from the
// single source of truth (apps/bridge/src/canonical/schema-source.ts).
//
// Why generated + committed, not imported: the agent ships as a single binary
// with zero monorepo runtime deps (its tsconfig has rootDir "src"), so it
// cannot `import` apps/bridge/src/* at runtime. Instead this script emits a
// committed mirror into the agent tree, and `prebuild` re-runs it at build
// time (where the monorepo exists). A staleness test
// (agent/src/db-adapters/generated-canonical.test.ts) imports generate() from
// here and byte-compares the committed file, so a stale mirror fails CI.
//
// Node ESM, plain `node` (no tsx): the source is parsed as text, not imported,
// because Node cannot import a .ts file. The arrays in schema-source.ts are
// simple string literals, so a small regex extraction is sufficient and the
// staleness test guards correctness.
//
// Pattern mirrors apps/bridge/agent/scripts/*.mjs (copy-assets, bundle).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // apps/bridge/scripts
const repoRoot = join(here, "..", "..", ".."); // for nice log/banner paths
const SOURCE_PATH = join(here, "..", "src", "canonical", "schema-source.ts");
const OUTPUT_PATH = join(
  here,
  "..",
  "agent",
  "src",
  "db-adapters",
  "generated-canonical.ts"
);

const REGEN_COMMAND = "node apps/bridge/scripts/gen-canonical.mjs";

/**
 * Extract a `export const NAME = ["a", "b", ...] as const;` string array from
 * the source text. Throws if the array is missing or empty so a malformed
 * source fails loudly rather than emitting a silently-empty mirror.
 */
function extractArray(sourceText, name) {
  const re = new RegExp(
    `export const ${name}\\s*=\\s*\\[([^\\]]*)\\]\\s*as const`,
    "m"
  );
  const m = re.exec(sourceText);
  if (!m) {
    throw new Error(
      `gen-canonical: could not find \`export const ${name} = [...] as const\` in schema-source.ts`
    );
  }
  const items = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  if (items.length === 0) {
    throw new Error(`gen-canonical: ${name} resolved to an empty array`);
  }
  return items;
}

function renderConstBlock(constName, typeName, items) {
  const lines = items.map((v) => `  ${JSON.stringify(v)},`).join("\n");
  return [
    `export const ${constName} = [`,
    lines,
    `] as const;`,
    `export type ${typeName} = (typeof ${constName})[number];`,
  ].join("\n");
}

export function renderGenerated({ bridgeSources, eventKinds, currencies }) {
  const sourceRel = relative(repoRoot, SOURCE_PATH).split("\\").join("/");
  const banner = [
    "// GENERATED - DO NOT EDIT.",
    `// Source: ${sourceRel}`,
    `// Regenerate: ${REGEN_COMMAND}`,
    "//",
    "// Agent-local mirror of the canonical schema sets. The agent ships as a",
    "// single binary with zero monorepo runtime deps, so the shared definition",
    "// in the source above is generated into the agent tree and committed. Edit",
    "// the source, then regenerate; never edit this file by hand (a staleness",
    "// test byte-compares it against a fresh generation).",
    "",
    renderConstBlock("BRIDGE_SOURCES", "BridgeSource", bridgeSources),
    "",
    renderConstBlock("EVENT_KINDS", "CanonicalEventKind", eventKinds),
    "",
    renderConstBlock("CURRENCIES", "Currency", currencies),
    "",
  ];
  return banner.join("\n");
}

/**
 * Read the source, parse the three arrays, render the mirror. Returns the
 * intended content + paths without writing, so the staleness test can compare
 * in-memory.
 */
export function generate() {
  const sourceText = readFileSync(SOURCE_PATH, "utf8");
  const content = renderGenerated({
    bridgeSources: extractArray(sourceText, "BRIDGE_SOURCES"),
    eventKinds: extractArray(sourceText, "EVENT_KINDS"),
    currencies: extractArray(sourceText, "CURRENCIES"),
  });
  return { sourcePath: SOURCE_PATH, outputPath: OUTPUT_PATH, content, regenCommand: REGEN_COMMAND };
}

// CLI entry: write the file when invoked directly (`node gen-canonical.mjs`).
// `--print` writes the would-be content to stdout instead (used by the agent
// staleness test, which spawns this with `node` so there is no bundler in the
// loop and no cross-package import). Skipped when imported as a module.
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const { outputPath, content } = generate();
  if (process.argv.includes("--print")) {
    process.stdout.write(content);
  } else {
    writeFileSync(outputPath, content, "utf8");
    const outRel = relative(repoRoot, outputPath).split("\\").join("/");
    process.stdout.write(`gen-canonical: wrote ${outRel}\n`);
  }
}
