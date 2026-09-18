import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { WS_METHODS } from "@t3tools/contracts";

import { artifactChecksums, buildTuiArtifact } from "./build-artifact.mjs";
import {
  availablePort,
  makeTerminalEnvironmentFixture,
  openTerminalFixtureConnection,
} from "./terminal-fixture.mjs";
import { makePosixFileTuiCredentialStore } from "../dist/connection/credentialStore.js";

async function inspectFiles(directory) {
  const result = [];
  for (const entry of await NodeFSP.readdir(directory, { withFileTypes: true })) {
    NodeAssert.equal(entry.isSymbolicLink(), false, `artifact link: ${entry.name}`);
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await inspectFiles(path)));
    else result.push(path);
  }
  return result;
}

async function attachPackagedTui({ artifact, cwd, state, signal, newEnvironment = false }) {
  const requireArtifact = NodeModule.createRequire(NodePath.join(artifact, "package.json"));
  const pty = requireArtifact("node-pty");
  const args = [NodePath.join(artifact, "t3-tui.mjs"), "--state-dir", state];
  if (newEnvironment) args.push("--new-environment", "--port", String(await availablePort()));
  const child = pty.spawn(process.execPath, args, {
    cwd,
    cols: 80,
    rows: 24,
    name: "xterm-256color",
    env: {
      HOME: cwd,
      PATH: `${NodePath.dirname(process.execPath)}:/usr/bin:/bin`,
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      NODE_ENV: "production",
    },
  });
  let output = "";
  let ready = false;
  let exited = false;
  let timer;
  try {
    const exit = await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Packaged TUI timed out: ${JSON.stringify(output.slice(-1500))}`)),
        15_000,
      );
      child.onData((data) => {
        output += data;
        if (!ready && output.includes("No projects in this environment.")) {
          ready = true;
          if (signal) child.kill(signal);
          else child.write("\x03");
        }
      });
      child.onExit((value) => {
        exited = true;
        resolve(value);
      });
    });
    NodeAssert.equal(ready, true, JSON.stringify(output.slice(-1500)));
    NodeAssert.equal(exit.exitCode, signal ? 143 : 130, JSON.stringify(output.slice(-1500)));
    const modes = new Map();
    for (const chunk of output.split("\x1b")) {
      const sequence = /^\[\?([\d;]+)([hl])/.exec(chunk);
      if (sequence)
        for (const mode of sequence[1].split(";")) modes.set(Number(mode), sequence[2] === "h");
    }
    NodeAssert.equal(modes.get(1049), false);
    NodeAssert.equal(modes.get(25), true);
    for (const mode of [1000, 1002, 1003, 1006, 2004]) NodeAssert.notEqual(modes.get(mode), true);
  } finally {
    clearTimeout(timer);
    if (!exited) child.kill("SIGKILL");
  }
}

if (NodeProcess.platform === "win32") {
  it.skip("artifact PTY certification needs the Windows fixture", () => {});
} else {
  it.live(
    "runs the relocated artifact with no checkout dependency and leaves its shared server running",
    () =>
      Effect.gen(function* () {
        const parent = yield* Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-artifact-test-")),
          ),
          (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
        );
        const built = yield* Effect.promise(() =>
          buildTuiArtifact({ directory: NodePath.join(parent, "build") }),
        );
        const artifact = NodePath.join(parent, "relocated artifact");
        yield* Effect.promise(() => NodeFSP.rename(built.directory, artifact));
        const files = yield* Effect.promise(() => inspectFiles(artifact));
        NodeAssert.ok(files.length > 0);
        const checksums = JSON.parse(
          yield* Effect.promise(() =>
            NodeFSP.readFile(NodePath.join(artifact, "checksums.json"), "utf8"),
          ),
        );
        NodeAssert.deepEqual(
          checksums.files,
          yield* Effect.promise(() => artifactChecksums(artifact)),
        );
        const repeated = yield* Effect.promise(() =>
          buildTuiArtifact({ directory: NodePath.join(parent, "repeat") }),
        );
        NodeAssert.deepEqual(
          checksums.files,
          yield* Effect.promise(() => artifactChecksums(repeated.directory)),
        );
        yield* Effect.promise(() =>
          NodeAssert.rejects(buildTuiArtifact({ directory: parent }), { code: "EEXIST" }),
        );
        yield* Effect.promise(() => NodeFSP.access(NodePath.join(artifact, "t3-tui.mjs")));
        for (const forbidden of ["client", "apps", "packages", "src", "dist-electron"]) {
          NodeAssert.equal(
            files.some((path) =>
              NodePath.relative(artifact, path).startsWith(`${forbidden}${NodePath.sep}`),
            ),
            false,
            forbidden,
          );
        }
        NodeAssert.equal(
          built.metadata.packages.some((pkg) =>
            /^(electron|react-native|@t3tools\/web|@t3tools\/mobile|@t3tools\/desktop)$/.test(
              pkg.name,
            ),
          ),
          false,
        );
        const notices = JSON.parse(
          yield* Effect.promise(() =>
            NodeFSP.readFile(NodePath.join(artifact, "third-party-licenses.json"), "utf8"),
          ),
        );
        for (const pkg of built.metadata.packages) {
          NodeAssert.ok(
            notices.entries.some(
              (entry) =>
                entry.name === pkg.name &&
                entry.version === pkg.version &&
                entry.noticeText.length > 0,
            ),
            `missing license: ${pkg.name}@${pkg.version}`,
          );
        }
        const nativeRoot = NodePath.join(parent, "native-probe");
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(nativeRoot);
          await NodeFSP.writeFile(
            NodePath.join(nativeRoot, "fixture.txt"),
            "native artifact fixture",
          );
        });
        const native = NodeChildProcess.spawnSync(
          process.execPath,
          [
            "--experimental-ffi",
            "--input-type=module",
            "-e",
            `
      import * as assert from 'node:assert/strict';
      import * as fs from 'node:fs';
      import { createRequire } from 'node:module';
      import { getNodeAssets } from '@opentui/core/node-assets';
      import { FileFinder, closeLibrary } from '@ff-labs/fff-node';
      const require = createRequire(import.meta.url);
      assert.equal(typeof require('msgpackr-extract').extractStrings, 'function');
      for (const asset of getNodeAssets(${JSON.stringify(built.metadata.target)})) fs.accessSync(asset.source);
      const root = process.argv[1];
      const finder = FileFinder.create({ basePath: root, frecencyDbPath: root + '/frecency', historyDbPath: root + '/history' });
      assert.ok(finder.ok);
      try {
        const scanned = finder.value.waitForScanBlocking(5000);
        assert.ok(scanned.ok && scanned.value);
        const found = finder.value.fileSearch('fixture.txt');
        assert.ok(found.ok && found.value.items.some(item => item.relativePath === 'fixture.txt'));
      } finally { finder.value.destroy(); closeLibrary(); }
    `,
            nativeRoot,
          ],
          {
            cwd: artifact,
            env: { HOME: parent, PATH: NodePath.dirname(process.execPath) },
            encoding: "utf8",
            timeout: 10_000,
          },
        );
        NodeAssert.ifError(native.error);
        NodeAssert.equal(native.status, 0, native.stderr);
        const version = NodeChildProcess.spawnSync(
          process.execPath,
          [NodePath.join(artifact, "t3-tui.mjs"), "--version"],
          {
            cwd: parent,
            env: { HOME: parent, PATH: NodePath.dirname(process.execPath) },
            encoding: "utf8",
            timeout: 10_000,
          },
        );
        NodeAssert.ifError(version.error);
        NodeAssert.equal(version.status, 0, version.stderr);
        NodeAssert.equal(
          version.stdout,
          `t3-tui ${built.metadata.version}\nt3-server ${built.metadata.serverVersion} (${built.metadata.upstreamBase})\nopentui ${built.metadata.openTuiVersion}\n`,
        );
        yield* Effect.promise(() =>
          attachPackagedTui({
            artifact,
            cwd: parent,
            state: NodePath.join(parent, "owned-state"),
            newEnvironment: true,
          }),
        );
        const fixture = yield* makeTerminalEnvironmentFixture({
          serverEntryPath: NodePath.join(artifact, "server/bin.mjs"),
        });
        const state = NodePath.join(fixture.root, "tui-client");
        const store = makePosixFileTuiCredentialStore({ stateDirectory: state });
        yield* fixture.environment.bearer.use((bearerToken) =>
          store.write({
            version: 1,
            httpOrigin: fixture.origin,
            environmentId: fixture.environment.config.environment.environmentId,
            bearerToken,
            expiresAtEpochMs: Date.now() + 3_600_000,
          }),
        );
        for (const signal of [undefined, "SIGTERM"]) {
          yield* Effect.promise(() =>
            attachPackagedTui({ artifact, cwd: fixture.root, state, signal }),
          );
          const connection = yield* openTerminalFixtureConnection(fixture);
          const config = yield* connection.client[WS_METHODS.serverGetConfig]({});
          NodeAssert.equal(
            config.environment.environmentId,
            fixture.environment.config.environment.environmentId,
          );
        }
      }).pipe(Effect.scoped),
    120_000,
  );
}
