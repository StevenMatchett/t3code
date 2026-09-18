/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off

import {
  AuthAccessTokenType,
  AuthStandardClientScopes,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ServerConfig,
  type ServerConfig as ServerConfigType,
  WS_METHODS,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Socket from "effect/unstable/socket/Socket";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  type ReattachAuthenticatedTuiEnvironmentOptions,
  reattachAuthenticatedTuiEnvironment,
  pairExistingTuiEnvironment,
  TuiEnvironmentReattachError,
} from "./authenticatedEnvironment.ts";
import { makePosixFileTuiCredentialStore } from "./credentialStore.ts";

type ReattachCanStartChild = "start" extends keyof ReattachAuthenticatedTuiEnvironmentOptions
  ? true
  : false;
const REATTACH_CAN_START_CHILD: ReattachCanStartChild = false;

const ENVIRONMENT_ID = EnvironmentId.make("tui-reattach-test");
const OTHER_ENVIRONMENT_ID = EnvironmentId.make("other-tui-environment");
const HTTP_ORIGIN = "http://127.0.0.1:43220";
const BEARER = "reattach-bearer-fixture";

const SERVER_CONFIG = {
  environment: {
    environmentId: ENVIRONMENT_ID,
    label: "TUI reattach test",
    platform: { os: "darwin", arch: "arm64" },
    serverVersion: "0.0.0-test",
    capabilities: { repositoryIdentity: true, connectionProbe: true },
  },
  auth: {
    policy: "desktop-managed-local",
    bootstrapMethods: ["desktop-bootstrap"],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "t3_session",
  },
  cwd: "/tmp/workspace",
  keybindingsConfigPath: "/tmp/workspace/keybindings.json",
  keybindings: [],
  issues: [],
  providers: [],
  availableEditors: [],
  observability: {
    logsDirectoryPath: "/tmp/logs",
    localTracingEnabled: false,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
} satisfies ServerConfigType;
const encodeServerConfig = Schema.encodeSync(ServerConfig);

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function makeReattachFetch(options: {
  readonly requests: RecordedRequest[];
  readonly descriptorEnvironmentId?: EnvironmentId;
  readonly authenticated?: boolean;
}): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    options.requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
    });
    switch (new URL(request.url).pathname) {
      case "/.well-known/t3/environment":
        return jsonResponse({
          ...SERVER_CONFIG.environment,
          environmentId: options.descriptorEnvironmentId ?? ENVIRONMENT_ID,
        });
      case "/api/auth/session":
        return options.authenticated === false
          ? jsonResponse({ authenticated: false, auth: SERVER_CONFIG.auth })
          : jsonResponse({
              authenticated: true,
              auth: SERVER_CONFIG.auth,
              scopes: AuthStandardClientScopes,
              sessionMethod: "bearer-access-token",
              expiresAt: "2030-01-01T00:00:00.000Z",
            });
      case "/api/auth/websocket-ticket":
        return jsonResponse({
          ticket: "reattach-websocket-ticket",
          expiresAt: "2030-01-01T00:00:00.000Z",
        });
      case "/oauth/token":
        throw new Error("Reattachment must not exchange a bootstrap credential.");
      default:
        return jsonResponse({ message: "not found" }, 404);
    }
  };
}

type SocketEventType = "open" | "message" | "close" | "error";
type SocketListener = (event: { readonly type: SocketEventType; readonly data?: string }) => void;

class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = TestWebSocket.CONNECTING;
  readonly url: string;
  private readonly config: ServerConfigType;
  private readonly listeners = new Map<SocketEventType, Set<SocketListener>>();

  constructor(url: string, config: ServerConfigType) {
    this.url = url;
    this.config = config;
    queueMicrotask(() => {
      this.readyState = TestWebSocket.OPEN;
      this.emit("open", { type: "open" });
    });
  }

  addEventListener(type: SocketEventType, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: SocketEventType, listener: SocketListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    const message = JSON.parse(data) as {
      readonly _tag?: string;
      readonly id?: string | number;
      readonly tag?: string;
    };
    if (message._tag !== "Request" || message.tag !== WS_METHODS.serverGetConfig) return;
    const encodedConfig = encodeServerConfig(this.config);
    queueMicrotask(() =>
      this.emit("message", {
        type: "message",
        data: JSON.stringify({
          _tag: "Exit",
          requestId: message.id,
          exit: { _tag: "Success", value: encodedConfig },
        }),
      }),
    );
  }

  close(): void {
    if (this.readyState === TestWebSocket.CLOSED) return;
    this.readyState = TestWebSocket.CLOSED;
    this.emit("close", { type: "close" });
  }

  private emit(
    type: SocketEventType,
    event: { readonly type: SocketEventType; readonly data?: string },
  ): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const makeTestWebSocketConstructor = (
  sockets: TestWebSocket[],
  config: ServerConfigType = SERVER_CONFIG,
) =>
  ((url: string) => {
    const socket = new TestWebSocket(url, config);
    sockets.push(socket);
    return socket as unknown as globalThis.WebSocket;
  }) satisfies Socket.WebSocketConstructor["Service"];

const withTemporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-reattach-"))),
  (directory) => Effect.promise(() => NodeFSP.rm(directory, { recursive: true, force: true })),
);

const prepareStore = Effect.fn(function* () {
  const root = yield* withTemporaryDirectory;
  const store = makePosixFileTuiCredentialStore({ stateDirectory: NodePath.join(root, "state") });
  yield* store.write({
    version: 1,
    httpOrigin: HTTP_ORIGIN,
    environmentId: ENVIRONMENT_ID,
    bearerToken: BEARER,
    expiresAtEpochMs: 8_000_000_000_000_000,
  });
  return store;
});

describe("authenticated TUI environment reattachment", () => {
  it.effect(
    "pairs to the existing environment and reattaches with only its derived credential",
    () =>
      Effect.gen(function* () {
        const root = yield* withTemporaryDirectory;
        const store = makePosixFileTuiCredentialStore({
          stateDirectory: NodePath.join(root, "state"),
        });
        const credential = new TextEncoder().encode("one-use-pairing-fixture");
        const requests: RecordedRequest[] = [];
        const sockets: TestWebSocket[] = [];
        const baseFetch = makeReattachFetch({ requests });
        let exchanges = 0;
        const fetch: typeof globalThis.fetch = async (input, init) => {
          assert.equal(init?.redirect, "error");
          const request = new Request(input, init);
          if (new URL(request.url).pathname === "/oauth/token") {
            exchanges += 1;
            assert.equal(
              new URLSearchParams(await request.text()).get("subject_token"),
              "one-use-pairing-fixture",
            );
            return jsonResponse({
              access_token: BEARER,
              issued_token_type: AuthAccessTokenType,
              token_type: "Bearer",
              expires_in: 3_600,
              scope: AuthStandardClientScopes.join(" "),
            });
          }
          return baseFetch(input, init);
        };
        const paired = yield* pairExistingTuiEnvironment({
          httpBaseUrl: HTTP_ORIGIN,
          credential,
          credentialStore: store,
          fetch,
          webSocketConstructor: makeTestWebSocketConstructor(sockets),
        });
        assert.deepEqual([...credential], Array(credential.length).fill(0));
        assert.isFalse("child" in paired);
        assert.deepEqual(paired.config, SERVER_CONFIG);
        paired.bearer.clear();
        const stored = yield* store.read();
        assert.equal(stored.bearerToken, BEARER);
        assert.equal(stored.environmentId, ENVIRONMENT_ID);
        assert.equal(stored.httpOrigin, HTTP_ORIGIN);
        const reattached = yield* reattachAuthenticatedTuiEnvironment({
          credentialStore: store,
          fetch,
          webSocketConstructor: makeTestWebSocketConstructor(sockets),
        });
        assert.equal(
          reattached.config.environment.environmentId,
          paired.config.environment.environmentId,
        );
        assert.equal(exchanges, 1);
        reattached.bearer.clear();
      }).pipe(Effect.scoped),
  );

  it.effect("rejects redirects during pairing and clears the supplied credential", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const store = makePosixFileTuiCredentialStore({
        stateDirectory: NodePath.join(root, "state"),
      });
      const credential = new TextEncoder().encode("one-use-pairing-fixture");
      const error = yield* pairExistingTuiEnvironment({
        httpBaseUrl: HTTP_ORIGIN,
        credential,
        credentialStore: store,
        fetch: async (_input, init) => {
          assert.equal(init?.redirect, "error");
          return new Response(null, {
            status: 307,
            headers: { location: "https://other.example.test/" },
          });
        },
      }).pipe(Effect.flip);
      assert.equal(error.phase, "readiness");
      assert.isFalse(String(error).includes("one-use-pairing-fixture"));
      assert.deepEqual([...credential], Array(credential.length).fill(0));
      assert.equal((yield* store.read().pipe(Effect.flip)).failure, "missing");
    }).pipe(Effect.scoped),
  );

  it.effect("reattaches with the saved bearer and never calls the OAuth exchange", () =>
    Effect.gen(function* () {
      const store = yield* prepareStore();
      const requests: RecordedRequest[] = [];
      const sockets: TestWebSocket[] = [];

      const connected = yield* reattachAuthenticatedTuiEnvironment({
        credentialStore: store,
        expectedHttpBaseUrl: `${HTTP_ORIGIN}/ignored-path?ignored=yes`,
        expectedEnvironmentId: ENVIRONMENT_ID,
        fetch: makeReattachFetch({ requests }),
        webSocketConstructor: makeTestWebSocketConstructor(sockets),
      });

      assert.isFalse(REATTACH_CAN_START_CHILD);
      assert.equal(connected.readiness.httpBaseUrl, HTTP_ORIGIN);
      assert.equal(connected.readiness.descriptor.environmentId, ENVIRONMENT_ID);
      assert.deepEqual(connected.config, SERVER_CONFIG);
      assert.deepEqual(
        requests.map((request) => new URL(request.url).pathname),
        ["/.well-known/t3/environment", "/api/auth/session", "/api/auth/websocket-ticket"],
      );
      assert.isFalse(requests.some((request) => request.url.includes("/oauth/token")));
      assert.equal(requests[0]?.authorization, null);
      assert.equal(requests[1]?.authorization, `Bearer ${BEARER}`);
      assert.equal(requests[2]?.authorization, `Bearer ${BEARER}`);
      assert.equal(sockets.length, 1);
      const socketUrl = new URL(sockets[0]?.url ?? "");
      assert.equal(socketUrl.origin, "ws://127.0.0.1:43220");
      assert.equal(socketUrl.host, new URL(requests[0]?.url ?? "").host);
      assert.equal(socketUrl.host, new URL(requests[2]?.url ?? "").host);
      assert.equal(socketUrl.searchParams.get("wsTicket"), "reattach-websocket-ticket");
      assert.notInclude(JSON.stringify(connected), BEARER);
      connected.bearer.clear();
    }),
  );

  it.effect("rejects a caller endpoint mismatch before making a request", () =>
    Effect.gen(function* () {
      const store = yield* prepareStore();
      const requests: RecordedRequest[] = [];
      const error = yield* Effect.flip(
        reattachAuthenticatedTuiEnvironment({
          credentialStore: store,
          expectedHttpBaseUrl: "http://127.0.0.1:49999",
          fetch: makeReattachFetch({ requests }),
        }),
      );

      assert.instanceOf(error, TuiEnvironmentReattachError);
      assert.equal(error.failure, "rejected");
      assert.include(error.message, "No server was started or stopped");
      assert.deepEqual(requests, []);
    }),
  );

  it.effect("rejects an expired bearer before making a request", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const store = makePosixFileTuiCredentialStore({
        stateDirectory: NodePath.join(root, "state"),
      });
      yield* store.write({
        version: 1,
        httpOrigin: HTTP_ORIGIN,
        environmentId: ENVIRONMENT_ID,
        bearerToken: BEARER,
        expiresAtEpochMs: 0,
      });
      const requests: RecordedRequest[] = [];
      const error = yield* Effect.flip(
        reattachAuthenticatedTuiEnvironment({
          credentialStore: store,
          fetch: makeReattachFetch({ requests }),
        }),
      );

      assert.equal(error.failure, "rejected");
      assert.deepEqual(requests, []);
    }),
  );

  it.effect("rejects an environment descriptor mismatch before using the bearer", () =>
    Effect.gen(function* () {
      const store = yield* prepareStore();
      const requests: RecordedRequest[] = [];
      const error = yield* Effect.flip(
        reattachAuthenticatedTuiEnvironment({
          credentialStore: store,
          fetch: makeReattachFetch({
            requests,
            descriptorEnvironmentId: OTHER_ENVIRONMENT_ID,
          }),
        }),
      );

      assert.equal(error.failure, "rejected");
      assert.deepEqual(
        requests.map((request) => new URL(request.url).pathname),
        ["/.well-known/t3/environment"],
      );
      assert.isTrue(requests.every((request) => request.authorization === null));
    }),
  );

  it.effect("rejects an invalid bearer session before ticket issuance", () =>
    Effect.gen(function* () {
      const store = yield* prepareStore();
      const requests: RecordedRequest[] = [];
      const sockets: TestWebSocket[] = [];
      const error = yield* Effect.flip(
        reattachAuthenticatedTuiEnvironment({
          credentialStore: store,
          fetch: makeReattachFetch({ requests, authenticated: false }),
          webSocketConstructor: makeTestWebSocketConstructor(sockets),
        }),
      );

      assert.equal(error.failure, "rejected");
      assert.deepEqual(
        requests.map((request) => new URL(request.url).pathname),
        ["/.well-known/t3/environment", "/api/auth/session"],
      );
      assert.equal(sockets.length, 0);
    }),
  );

  it.effect("rejects a WebSocket config from another environment", () =>
    Effect.gen(function* () {
      const store = yield* prepareStore();
      const requests: RecordedRequest[] = [];
      const sockets: TestWebSocket[] = [];
      const mismatchedConfig = {
        ...SERVER_CONFIG,
        environment: { ...SERVER_CONFIG.environment, environmentId: OTHER_ENVIRONMENT_ID },
      } satisfies ServerConfigType;
      const error = yield* Effect.flip(
        reattachAuthenticatedTuiEnvironment({
          credentialStore: store,
          fetch: makeReattachFetch({ requests }),
          webSocketConstructor: makeTestWebSocketConstructor(sockets, mismatchedConfig),
        }),
      );

      assert.equal(error.failure, "rejected");
      assert.equal(sockets.length, 1);
    }),
  );

  it.effect("returns repairable missing and unsafe store errors", () =>
    Effect.gen(function* () {
      const root = yield* withTemporaryDirectory;
      const store = makePosixFileTuiCredentialStore({
        stateDirectory: NodePath.join(root, "state"),
      });
      const missing = yield* Effect.flip(
        reattachAuthenticatedTuiEnvironment({ credentialStore: store }),
      );
      assert.equal(missing.failure, "missing");
      assert.include(missing.message, "Pair with your existing T3 environment");

      yield* store.write({
        version: 1,
        httpOrigin: HTTP_ORIGIN,
        environmentId: ENVIRONMENT_ID,
        bearerToken: BEARER,
        expiresAtEpochMs: 8_000_000_000_000_000,
      });
      yield* Effect.promise(() => NodeFSP.chmod(store.credentialPath, 0o644));
      const unsafe = yield* Effect.flip(
        reattachAuthenticatedTuiEnvironment({ credentialStore: store }),
      );
      assert.equal(unsafe.failure, "unsafe");
      assert.include(unsafe.message, "permissions");
    }),
  );
});
