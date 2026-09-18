import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { Effect, Exit, Layer, Option, Schedule, Scope, Stream, SubscriptionRef } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";
import { WS_METHODS } from "@t3tools/contracts";
import { resolveRemoteWebSocketConnectionUrl } from "@t3tools/client-runtime/authorization";
import { deriveWsBaseUrl } from "@t3tools/client-runtime/environment";
import { makeWsRpcProtocolClient, remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import {
  applyTerminalAttachStreamEvent,
  nextTerminalAttachSeedState,
} from "@t3tools/client-runtime/state/terminal";

import { startBootstrapChild } from "../dist/backend/bootstrapChild.js";
import { buildTuiLaunchOptions } from "../dist/cli/options.js";
import {
  connectAuthenticatedTuiEnvironment,
  waitForTuiEnvironmentReady,
} from "../dist/connection/authenticatedEnvironment.js";

export async function availablePort() {
  const server = NodeNet.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string") throw new Error("No test port allocated");
  return address.port;
}

export const makeTerminalEnvironmentFixture = Effect.fn("tui.testing.terminalEnvironment")(
  function* (options = {}) {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "tui-terminal-rpc-"))),
      (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
    );
    const fixtureEnv = options.prepare ? yield* Effect.promise(() => options.prepare(root)) : {};
    const port = yield* Effect.promise(availablePort);
    const launch = buildTuiLaunchOptions(
      { stateDir: NodePath.join(root, "state"), cwd: root, port },
      {
        executable: process.execPath,
        serverEntryPath:
          options.serverEntryPath ??
          NodeURL.fileURLToPath(new URL("../../server/src/bin.ts", import.meta.url)),
        env: {
          HOME: root,
          XDG_CONFIG_HOME: NodePath.join(root, "config"),
          XDG_DATA_HOME: NodePath.join(root, "data"),
          XDG_CACHE_HOME: NodePath.join(root, "cache"),
          PATH: `${NodePath.dirname(process.execPath)}:/usr/bin:/bin`,
          SHELL: "/bin/sh",
          PS1: "",
          PS2: "",
          ENV: "",
          LANG: "en_US.UTF-8",
          ...fixtureEnv,
        },
      },
    );
    const child = yield* Effect.acquireRelease(startBootstrapChild(launch.start), (child) =>
      Effect.gen(function* () {
        child.clearBootstrapSecret();
        child.terminate();
        yield* child.waitForExit().pipe(
          Effect.timeout("10 seconds"),
          Effect.catch(() =>
            Effect.sync(() => child.terminate("SIGKILL")).pipe(Effect.andThen(child.waitForExit())),
          ),
        );
      }),
    );
    child.stdout.resume();
    child.stderr.resume();
    const readiness = yield* waitForTuiEnvironmentReady({
      httpBaseUrl: launch.httpBaseUrl,
      maxAttempts: 100,
    });
    const environment = yield* Effect.acquireRelease(
      connectAuthenticatedTuiEnvironment({ child, readiness }),
      (environment) => Effect.sync(() => environment.bearer.clear()),
    );
    return { root, environment, readiness, origin: launch.httpBaseUrl };
  },
);

export const openTerminalFixtureConnection = Effect.fn("tui.testing.terminalConnection")(
  function* (fixture) {
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const socketUrl = yield* fixture.environment.bearer
      .use((bearerToken) =>
        resolveRemoteWebSocketConnectionUrl({
          httpBaseUrl: fixture.origin,
          wsBaseUrl: deriveWsBaseUrl(fixture.origin),
          bearerToken,
        }),
      )
      .pipe(Effect.provide(remoteHttpClientLayer(globalThis.fetch)));
    const socketLayer = Socket.layerWebSocket(socketUrl, { openTimeout: "10 seconds" }).pipe(
      Layer.provide(
        Layer.succeed(Socket.WebSocketConstructor, (url) => new globalThis.WebSocket(url)),
      ),
    );
    const protocol = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
      }),
    ).pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
    const context = yield* Layer.build(protocol).pipe(Scope.provide(scope));
    const client = yield* makeWsRpcProtocolClient.pipe(
      Effect.provide(context),
      Scope.provide(scope),
    );
    const config = yield* client[WS_METHODS.serverGetConfig]({});
    if (config.environment.environmentId !== fixture.environment.config.environment.environmentId) {
      return yield* Effect.die("Terminal test connected to the wrong environment");
    }
    return { client, scope, disconnect: Scope.close(scope, Exit.void) };
  },
);

export const attachTerminalFixture = Effect.fn("tui.testing.terminalAttach")(
  function* (connection, input) {
    const state = yield* SubscriptionRef.make(nextTerminalAttachSeedState());
    const snapshot = yield* SubscriptionRef.make(null);
    yield* connection.client[WS_METHODS.terminalAttach](input).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (event.type === "snapshot") yield* SubscriptionRef.set(snapshot, event.snapshot);
          yield* SubscriptionRef.update(state, (current) =>
            applyTerminalAttachStreamEvent(current, event),
          );
        }),
      ),
      Effect.forkIn(connection.scope),
    );
    const waitFor = (predicate) =>
      SubscriptionRef.changes(state).pipe(
        Stream.filter(predicate),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
        Effect.timeout("10 seconds"),
      );
    return { state, snapshot, waitFor };
  },
);

export function makeTerminalFixtureCallbacks(getClient, target) {
  const writes = [];
  const errors = [];
  let resizeTail = Promise.resolve();
  return {
    writes,
    errors,
    onWrite(data, source) {
      writes.push({ data, source });
      return Effect.runPromise(getClient()[WS_METHODS.terminalWrite]({ ...target, data }));
    },
    onResize(size) {
      resizeTail = resizeTail.then(() =>
        Effect.runPromise(getClient()[WS_METHODS.terminalResize]({ ...target, ...size })),
      );
      return resizeTail;
    },
    onError(error) {
      errors.push(error);
    },
    drainResize() {
      return resizeTail;
    },
  };
}
