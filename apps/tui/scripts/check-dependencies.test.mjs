import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";

NodeTest.test(
  "reports missing dependencies after a pull and accepts an installed checkout",
  async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-dependencies-"));
    try {
      await NodeFSP.mkdir(NodePath.join(root, "scripts"));
      const script = NodePath.join(root, "scripts", "check-dependencies.mjs");
      await NodeFSP.copyFile(new URL("./check-dependencies.mjs", import.meta.url), script);
      await NodeFSP.writeFile(
        NodePath.join(root, "package.json"),
        JSON.stringify({ dependencies: { marked: "17.0.1" } }),
      );
      const run = () =>
        NodeChildProcess.spawnSync(process.execPath, [script], {
          encoding: "utf8",
          timeout: 10_000,
        });
      const missing = run();
      NodeAssert.ifError(missing.error);
      NodeAssert.equal(missing.status, 1);
      NodeAssert.match(missing.stderr, /dependencies are missing: marked, typescript/);
      NodeAssert.match(missing.stderr, /pnpm run install:tui/);
      NodeAssert.doesNotMatch(missing.stderr, /ERR_MODULE_NOT_FOUND|Cannot find package/);

      const dependency = NodePath.join(root, "node_modules", "marked");
      await NodeFSP.mkdir(dependency, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(dependency, "package.json"),
        JSON.stringify({ name: "marked", exports: "./index.js" }),
      );
      // Checking availability must not execute package code or initialize the renderer.
      await NodeFSP.writeFile(
        NodePath.join(dependency, "index.js"),
        "throw new Error('Do not load packages during preflight');",
      );
      const compiler = NodePath.join(root, "node_modules", "typescript", "bin");
      await NodeFSP.mkdir(compiler, { recursive: true });
      await NodeFSP.writeFile(NodePath.join(compiler, "tsc"), "");
      const installed = run();
      NodeAssert.ifError(installed.error);
      NodeAssert.equal(installed.status, 0, installed.stderr);
      NodeAssert.equal(installed.stderr, "");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  },
);
