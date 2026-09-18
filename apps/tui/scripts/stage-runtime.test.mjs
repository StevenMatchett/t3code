import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeTest from "node:test";
import { matchesRuntimeTarget, stageRuntimePackages } from "./stage-runtime.mjs";

const target = { platform: "darwin", arch: "arm64" };

async function fixture(run) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-stage-test-"));
  try {
    const output = NodePath.join(root, "artifact");
    await NodeFSP.mkdir(output);
    const pkg = async (parent, name, manifest = {}, source = "module.exports = 'ok';") => {
      const directory = NodePath.join(parent, "node_modules", name);
      await NodeFSP.mkdir(directory, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(directory, "package.json"),
        JSON.stringify({ name, version: "1.0.0", main: "index.js", license: "MIT", ...manifest }),
      );
      await NodeFSP.writeFile(NodePath.join(directory, "index.js"), source);
      return directory;
    };
    await run({ root, output, pkg });
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
}

NodeTest.test("stages exact dependency versions and shared peers without checkout symlinks", () =>
  fixture(async ({ root, output, pkg }) => {
    const a = await pkg(
      root,
      "a",
      { dependencies: { leaf: "1.0.0" }, peerDependencies: { shared: "1" } },
      "module.exports = [require('leaf'), require('shared')];",
    );
    const b = await pkg(
      root,
      "b",
      { dependencies: { leaf: "2.0.0" }, peerDependencies: { shared: "1" } },
      "module.exports = [require('leaf'), require('shared')];",
    );
    await pkg(a, "leaf", {}, "module.exports = 'one';");
    await pkg(b, "leaf", { version: "2.0.0" }, "module.exports = 'two';");
    await pkg(root, "shared", {}, "module.exports = {};");
    const result = await stageRuntimePackages({
      roots: [
        { name: "a", fromDirectory: root },
        { name: "b", fromDirectory: root },
        { name: "leaf", fromDirectory: b },
      ],
      destination: NodePath.join(output, "node_modules"),
      target,
    });
    const requireArtifact = NodeModule.createRequire(NodePath.join(output, "package.json"));
    const first = requireArtifact("a");
    const second = requireArtifact("b");
    NodeAssert.equal(first[0], "one");
    NodeAssert.equal(second[0], "two");
    NodeAssert.equal(first[1], second[1]);
    NodeAssert.equal(result.packages.length, 5);
    NodeAssert.equal(
      result.packages.some((entry) => JSON.stringify(entry).includes(root)),
      false,
    );
  }),
);

NodeTest.test(
  "handles cyclic dependencies and skips absent optional or incompatible packages",
  () =>
    fixture(async ({ root, output, pkg }) => {
      await pkg(root, "a", {
        dependencies: { b: "1" },
        optionalDependencies: { missing: "1", foreign: "1" },
      });
      await pkg(root, "b", { dependencies: { a: "1" } });
      await pkg(root, "foreign", { os: ["win32"] });
      const result = await stageRuntimePackages({
        roots: [{ name: "a", fromDirectory: root }],
        destination: NodePath.join(output, "node_modules"),
        target,
      });
      NodeAssert.equal(result.packages.length, 2);
      NodeAssert.deepEqual(result.skippedOptionalPackages, ["foreign", "missing"]);
    }),
);

NodeTest.test("rejects package traversal and private configuration", () =>
  fixture(async ({ root, output, pkg }) => {
    await NodeAssert.rejects(
      stageRuntimePackages({
        roots: [{ name: "../outside", fromDirectory: root }],
        destination: NodePath.join(output, "node_modules"),
        target,
      }),
      /Invalid runtime package name/,
    );
    const a = await pkg(root, "a");
    await NodeFSP.writeFile(NodePath.join(a, ".env"), "test-private-value");
    await NodeAssert.rejects(
      stageRuntimePackages({
        roots: [{ name: "a", fromDirectory: root }],
        destination: NodePath.join(output, "node_modules"),
        target,
      }),
      /Private configuration/,
    );
  }),
);

NodeTest.test(
  "rejects symlinks outside a runtime package",
  { skip: NodeProcess.platform === "win32" },
  () =>
    fixture(async ({ root, output, pkg }) => {
      const directory = await pkg(root, "a");
      const privateFile = NodePath.join(root, "private-fixture");
      await NodeFSP.writeFile(privateFile, "must not ship");
      await NodeFSP.symlink(privateFile, NodePath.join(directory, "leak.txt"));
      await NodeAssert.rejects(
        stageRuntimePackages({
          roots: [{ name: "a", fromDirectory: root }],
          destination: NodePath.join(output, "node_modules"),
          target,
        }),
        /escaping symlink/,
      );
      await NodeAssert.rejects(NodeFSP.access(NodePath.join(output, "node_modules/a/leak.txt")));
    }),
);

NodeTest.test("matches positive and negative native target constraints", () => {
  NodeAssert.equal(matchesRuntimeTarget({ os: ["!win32"], cpu: ["arm64"] }, target), true);
  NodeAssert.equal(matchesRuntimeTarget({ os: ["darwin"], cpu: ["x64"] }, target), false);
  NodeAssert.equal(
    matchesRuntimeTarget(
      { os: ["linux"], libc: ["musl"] },
      { platform: "linux", arch: "x64", libc: "glibc" },
    ),
    false,
  );
});
