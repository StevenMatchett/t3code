import * as NodeFSP from "node:fs/promises";

const manifest = JSON.parse(
  await NodeFSP.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const missing = [];
for (const name of Object.keys(manifest.dependencies)) {
  try {
    await NodeFSP.access(new URL(`../node_modules/${name}/package.json`, import.meta.url));
  } catch {
    missing.push(name);
  }
}
try {
  await NodeFSP.access(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
} catch {
  missing.push("typescript");
}
if (missing.length) {
  process.stderr.write(
    `TUI dependencies are missing: ${missing.join(", ")}.\nRun pnpm run install:tui from the checkout root, then start the TUI again.\n`,
  );
  process.exitCode = 1;
}
