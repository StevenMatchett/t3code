import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { startBootstrapChild } from "../dist/backend/bootstrapChild.js";
import { buildTuiLaunchOptions } from "../dist/cli/options.js";
import {
  connectAuthenticatedTuiEnvironment,
  reattachAuthenticatedTuiEnvironment,
  waitForTuiEnvironmentReady,
} from "../dist/connection/authenticatedEnvironment.js";
import { makePosixFileTuiCredentialStore } from "../dist/connection/credentialStore.js";
import { assertNoSecrets } from "../dist/testing/secrets.js";

async function availablePort() {
  const server = NodeNet.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  NodeAssert.ok(address && typeof address !== "string");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

const releaseChild = (child) =>
  Effect.gen(function* () {
    child.clearBootstrapSecret();
    child.terminate();
    yield* child.waitForExit().pipe(
      Effect.timeout("10 seconds"),
      Effect.catch(() =>
        Effect.sync(() => child.terminate("SIGKILL")).pipe(Effect.andThen(child.waitForExit())),
      ),
    );
  });

if (NodeProcess.platform === "win32") {
  it.skip("real-server smoke needs Windows protected credential storage", () => {});
} else {
  it.live(
    "real server bootstrap and second-client reattachment share one environment",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-backend-auth-")),
          ),
          (directory) =>
            Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
        );
        const port = yield* Effect.promise(availablePort);
        const stateDir = NodePath.join(root, "server");
        const store = makePosixFileTuiCredentialStore({
          stateDirectory: NodePath.join(root, "client"),
        });
        const launch = buildTuiLaunchOptions(
          { stateDir, cwd: root, port },
          {
            executable: process.execPath,
            serverEntryPath: NodeURL.fileURLToPath(
              new URL("../../server/src/bin.ts", import.meta.url),
            ),
            env: {
              HOME: root,
              XDG_CONFIG_HOME: NodePath.join(root, "config"),
              XDG_DATA_HOME: NodePath.join(root, "data"),
              XDG_CACHE_HOME: NodePath.join(root, "cache"),
              PATH: `${NodePath.dirname(process.execPath)}:/usr/bin:/bin`,
              T3CODE_TELEMETRY_ENABLED: "false",
            },
          },
        );
        const child = yield* Effect.acquireRelease(startBootstrapChild(launch.start), releaseChild);
        const bootstrap = yield* child.useBootstrapToken((token) => Effect.succeed(token));
        const childCommand = NodeChildProcess.execFileSync(
          "ps",
          ["eww", "-p", String(child.pid), "-o", "command="],
          { encoding: "utf8" },
        );
        assertNoSecrets({
          secrets: [{ name: "bootstrap", value: bootstrap }],
          sources: [{ name: "child argv and environment", content: childCommand }],
        });
        let output = "";
        const capture = (chunk) => {
          output = (output + chunk.toString()).slice(-1_000_000);
        };
        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        const readiness = yield* waitForTuiEnvironmentReady({
          httpBaseUrl: launch.httpBaseUrl,
          maxAttempts: 100,
        });
        const connected = yield* Effect.acquireRelease(
          connectAuthenticatedTuiEnvironment({ child, readiness, credentialStore: store }),
          (environment) => Effect.sync(() => environment.bearer.clear()),
        );
        NodeAssert.equal(child.isBootstrapSecretCleared(), true);
        connected.bearer.clear();
        const reattached = yield* Effect.acquireRelease(
          reattachAuthenticatedTuiEnvironment({
            credentialStore: store,
            expectedHttpBaseUrl: launch.httpBaseUrl,
            expectedEnvironmentId: connected.config.environment.environmentId,
          }),
          (environment) => Effect.sync(() => environment.bearer.clear()),
        );
        NodeAssert.equal(
          reattached.config.environment.environmentId,
          connected.config.environment.environmentId,
        );
        NodeAssert.equal(
          reattached.config.cwd,
          yield* Effect.promise(() => NodeFSP.realpath(root)),
        );
        const runtimeState = yield* Effect.promise(() =>
          NodeFSP.readFile(NodePath.join(stateDir, "userdata", "server-runtime.json"), "utf8"),
        );
        NodeAssert.equal(JSON.parse(runtimeState).pid, child.pid);
        const stored = yield* store.read();
        const credentialFile = yield* Effect.promise(() =>
          NodeFSP.readFile(store.credentialPath, "utf8"),
        );
        assertNoSecrets({
          secrets: [{ name: "bootstrap", value: bootstrap }],
          sources: [{ name: "credential file", content: credentialFile }],
        });
        assertNoSecrets({
          secrets: [
            { name: "bootstrap", value: bootstrap },
            { name: "bearer", value: stored.bearerToken },
          ],
          sources: [
            { name: "server output", content: output },
            { name: "runtime state", content: runtimeState },
          ],
        });
      }).pipe(Effect.scoped),
    45_000,
  );
}
