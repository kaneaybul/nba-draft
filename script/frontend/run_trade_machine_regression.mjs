import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const requireFromFrontend = createRequire(path.join(root, "frontend", "package.json"));
const ts = requireFromFrontend("typescript");
const sourceDir = path.join(root, "frontend", "src");
const tempDir = path.join(os.tmpdir(), `trade-machine-regression-${Date.now()}`);

await fs.mkdir(tempDir, { recursive: true });

try {
  await transpileToMjs(path.join(sourceDir, "assetValue.ts"), path.join(tempDir, "assetValue.mjs"));
  await transpileToMjs(path.join(sourceDir, "tradeMachine.ts"), path.join(tempDir, "tradeMachine.mjs"), {
    "./assetValue": "./assetValue.mjs"
  });
  await transpileToMjs(path.join(sourceDir, "tradeMachine.regression.ts"), path.join(tempDir, "tradeMachine.regression.mjs"), {
    "./tradeMachine": "./tradeMachine.mjs"
  });

  const mod = await import(pathToFileURL(path.join(tempDir, "tradeMachine.regression.mjs")).href);
  const rows = mod.runTradeMachineRegressionTests();
  rows.forEach((row) => console.log(`ok - ${row}`));
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

async function transpileToMjs(input, output, importRewrites = {}) {
  const source = await fs.readFile(input, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove
    },
    fileName: input
  }).outputText;
  const rewritten = Object.entries(importRewrites).reduce(
    (text, [from, to]) => text.replaceAll(`from "${from}"`, `from "${to}"`),
    compiled
  );
  await fs.writeFile(output, rewritten);
}
