import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireFromFrontend = createRequire(path.join(root, "frontend", "package.json"));
const esbuild = requireFromFrontend("esbuild");
const sourceDir = path.join(root, "frontend", "src");
const tempDir = path.join(os.tmpdir(), `trade-suggestions-regression-${Date.now()}`);
const output = path.join(tempDir, "tradeSuggestions.regression.mjs");

await fs.mkdir(tempDir, { recursive: true });

try {
  await esbuild.build({
    entryPoints: [path.join(sourceDir, "tradeSuggestions.regression.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2020",
    logLevel: "silent"
  });

  const mod = await import(pathToFileURL(output).href);
  const rows = mod.runTradeSuggestionRegressionTests();
  rows.forEach((row) => console.log(`ok - ${row}`));
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
