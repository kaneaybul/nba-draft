import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireFromFrontend = createRequire(path.join(root, "frontend", "package.json"));
const { build } = requireFromFrontend("esbuild");
const entry = path.join(root, "frontend", "src", "offseasonViewModels.regression.ts");
const outfile = path.join(os.tmpdir(), `offseason-view-model-regression-${Date.now()}.mjs`);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "silent"
});

const mod = await import(pathToFileURL(outfile).href);
const rows = mod.runOffseasonViewModelRegressionTests();
rows.forEach((row) => console.log(`ok - ${row}`));
await fs.rm(outfile, { force: true });
