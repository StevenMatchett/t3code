/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics preferSchemaOverJson:off

import {
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthStandardClientScopes,
  AuthTokenExchangeGrantType,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ServerConfig,
  type ServerConfig as ServerConfigType,
  WS_METHODS,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Socket from "effect/unstable/socket/Socket";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { BootstrapSecretClearedError, startBootstrapChild } from "../backend/bootstrapChild.ts";
import {
  connectAuthenticatedTuiEnvironment,
  startAndConnectAuthenticatedTuiEnvironment,
  type ConnectAuthenticatedTuiEnvironmentOptions,
  type StartAndConnectAuthenticatedTuiEnvironmentOptions,
  TuiBearerSessionClearedError,
  TuiEnvironmentConnectionError,
  waitForTuiEnvironmentReady,
} from "./authenticatedEnvironment.ts";
import { makePosixFileTuiCredentialStore } from "./credentialStore.ts";

type CallerCanSupplyWebSocketBase = "wsBaseUrl" extends
  | keyof ConnectAuthenticatedTuiEnvironmentOptions
  | keyof StartAndConnectAuthenticatedTuiEnvironmentOptions
  ? true
  : false;
const CALLER_CAN_SUPPLY_WEBSOCKET_BASE: CallerCanSupplyWebSocketBase = false;

const bootstrap = {
  mode: "desktop",
  noBrowser: true,
  port: 43_220,
  t3Home: "/tmp/t3-tui-auth-test",
  host: "127.0.0.1",
  tailscaleServeEnabled: false,
  tailscaleServePort: 443,
} as const;

const mockChildSource = String.raw`
import fs from "node:fs";
const fdFlag = process.argv.indexOf("--bootstrap-fd");
const fd = Number(process.argv[fdFlag + 1]);
fs.readFileSync(fd, "utf8");
setInterval(() => undefined, 1_000);
`;

const startMockChild = () =>
  startBootstrapChild({
    executable: process.execPath,
    args: ["--input-type=module", "--eval", mockChildSource, "--"],
    delivery: "fd3",
    bootstrap,
  });

const SERVER_CONFIG = {
  environment: {
    environmentId: EnvironmentId.make("tui-auth-test"),
    label: "TUI auth test",
    platform: {
      os: "darwin",
      arch: "arm64",
    },
    serverVersion: "0.0.0-test",
    capabilities: {
      repositoryIdentity: true,
      connectionProbe: true,
    },
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
  readonly contentType: string | null;
  readonly body: string;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function makeEnvironmentFetch(
  requests: RecordedRequest[],
  sessionState: unknown = {
    authenticated: true,
    auth: SERVER_CONFIG.auth,
    scopes: AuthStandardClientScopes,
    sessionMethod: "bearer-access-token",
    expiresAt: "2026-09-16T00:00:00.000Z",
  },
): typeof globalThis.fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const body = await request.clone().text();
    requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get("authorization"),
      contentType: request.headers.get("content-type"),
      body,
    });

    switch (new URL(request.url).pathname) {
      case "/.well-known/t3/environment":
        return jsonResponse(SERVER_CONFIG.environment);
      case "/oauth/token":
        return jsonResponse({
          access_token: "bearer-test-token",
          issued_token_type: AuthAccessTokenType,
          token_type: "Bearer",
          expires_in: 3_600,
          scope: AuthStandardClientScopes.join(" "),
        });
      case "/api/auth/session":
        return jsonResponse(sessionState);
      case "/api/auth/websocket-ticket":
        return jsonResponse({
          ticket: "websocket-test-ticket",
          expiresAt: "2026-09-16T00:00:00.000Z",
        });
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
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<SocketEventType, Set<SocketListener>>();

  constructor(url: string) {
    this.url = url;
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
    this.sent.push(data);
    const message = JSON.parse(data) as {
      readonly _tag?: string;
      readonly id?: string | number;
      readonly tag?: string;
    };
    if (message._tag !== "Request" || message.tag !== WS_METHODS.serverGetConfig) return;
    const encodedConfig = encodeServerConfig(SERVER_CONFIG);
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
  ) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const makeTestWebSocketConstructor = (sockets: TestWebSocket[]) =>
  ((url: string) => {
    const socket = new TestWebSocket(url);
    sockets.push(socket);
    return socket as unknown as globalThis.WebSocket;
  }) satisfies Socket.WebSocketConstructor["Service"];

describe("authenticated TUI environment connection", () => {
  it.effect("binds the ticketed WebSocket to the readiness-proven HTTP origin", () =>
    Effect.gen(function* () {
      const child = yield* startMockChild();
      yield* Effect.addFinalizer(() => Effect.sync(() => void child.terminate("SIGKILL")));
      const bootstrapToken = yield* child.useBootstrapToken(Effect.succeed);
      const stateDirectory = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-tui-auth-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.promise(() => NodeFSP.rm(stateDirectory, { recursive: true, force: true })),
      );
      const credentialStore = makePosixFileTuiCredentialStore({ stateDirectory });
      const requests: RecordedRequest[] = [];
      const sockets: TestWebSocket[] = [];
      const fetch = makeEnvironmentFetch(requests);
      const readiness = yield* waitForTuiEnvironmentReady({
        httpBaseUrl: "http://127.0.0.1:43220",
        fetch,
      });

      const connected = yield* connectAuthenticatedTuiEnvironment({
        child,
        readiness,
        credentialStore,
        fetch,
        webSocketConstructor: makeTestWebSocketConstructor(sockets),
      });

      assert.deepEqual(connected.config, SERVER_CONFIG);
      assert.isTrue(connected.session.authenticated);
      assert.equal(connected.session.sessionMethod, "bearer-access-token");
      assert.isTrue(child.isBootstrapSecretCleared());
      assert.instanceOf(
        yield* Effect.flip(child.useBootstrapToken(Effect.succeed)),
        BootstrapSecretClearedError,
      );

      assert.equal(requests[0]?.authorization, null);
      assert.equal(new URL(requests[0]?.url ?? "").pathname, "/.well-known/t3/environment");
      const tokenRequest = requests[1];
      assert.isDefined(tokenRequest);
      const tokenPayload = new URLSearchParams(tokenRequest.body);
      assert.equal(tokenRequest.method, "POST");
      assert.include(tokenRequest.contentType ?? "", "application/x-www-form-urlencoded");
      assert.equal(tokenPayload.get("grant_type"), AuthTokenExchangeGrantType);
      assert.equal(tokenPayload.get("subject_token"), bootstrapToken);
      assert.equal(tokenPayload.get("subject_token_type"), AuthEnvironmentBootstrapTokenType);
      assert.equal(tokenPayload.get("requested_token_type"), AuthAccessTokenType);
      assert.equal(tokenPayload.get("scope"), AuthStandardClientScopes.join(" "));
      assert.equal(tokenPayload.get("client_label"), "T3 Code TUI");

      assert.equal(requests[2]?.authorization, "Bearer bearer-test-token");
      assert.equal(requests[3]?.authorization, "Bearer bearer-test-token");
      assert.equal(sockets.length, 1);
      const socketUrl = new URL(sockets[0]?.url ?? "");
      assert.equal(socketUrl.pathname, "/ws");
      assert.equal(socketUrl.origin, "ws://127.0.0.1:43220");
      assert.equal(socketUrl.host, new URL(requests[0]?.url ?? "").host);
      assert.equal(socketUrl.host, new URL(requests[3]?.url ?? "").host);
      assert.isFalse(CALLER_CAN_SUPPLY_WEBSOCKET_BASE);
      assert.equal(socketUrl.searchParams.get("wsTicket"), "websocket-test-ticket");
      assert.equal(socketUrl.searchParams.get("clientSurface"), "cli");
      assert.equal(socketUrl.searchParams.get("connectionMethod"), "direct");

      assert.deepEqual(JSON.parse(JSON.stringify(connected.bearer)), {
        authenticated: true,
        cleared: false,
      });
      assert.notInclude(JSON.stringify(connected), bootstrapToken);
      assert.notInclude(JSON.stringify(connected), "bearer-test-token");
      const persistedCredential = yield* Effect.promise(() =>
        NodeFSP.readFile(credentialStore.credentialPath, "utf8"),
      );
      assert.notInclude(persistedCredential, bootstrapToken);
      assert.include(persistedCredential, "bearer-test-token");
      assert.equal(
        (JSON.parse(persistedCredential) as { readonly httpOrigin: string }).httpOrigin,
        "http://127.0.0.1:43220",
      );
      assert.equal(yield* connected.bearer.use(Effect.succeed), "bearer-test-token");
      connected.bearer.clear();
      assert.instanceOf(
        yield* Effect.flip(connected.bearer.use(Effect.succeed)),
        TuiBearerSessionClearedError,
      );
    }),
  );

  it.effect("clears the bootstrap secret and redacts a failed exchange", () =>
    Effect.gen(function* () {
      const child = yield* startMockChild();
      yield* Effect.addFinalizer(() => Effect.sync(() => void child.terminate("SIGKILL")));
      const bootstrapToken = yield* child.useBootstrapToken(Effect.succeed);
      const fetchFailure: typeof globalThis.fetch = async (input) => {
        if (new URL(new Request(input).url).pathname === "/.well-known/t3/environment") {
          return jsonResponse(SERVER_CONFIG.environment);
        }
        throw new Error(`fixture rejected ${bootstrapToken}`);
      };
      const readiness = yield* waitForTuiEnvironmentReady({
        httpBaseUrl: "http://127.0.0.1:43220",
        fetch: fetchFailure,
      });

      const error = yield* Effect.flip(
        connectAuthenticatedTuiEnvironment({
          child,
          readiness,
          fetch: fetchFailure,
        }),
      );

      assert.instanceOf(error, TuiEnvironmentConnectionError);
      assert.equal(error.phase, "bearer-exchange");
      assert.isTrue(child.isBootstrapSecretCleared());
      assert.notInclude(String(error), bootstrapToken);
      assert.notInclude(JSON.stringify(error), bootstrapToken);
    }),
  );

  it.effect("rejects an unauthenticated environment before ticket issuance", () =>
    Effect.gen(function* () {
      const child = yield* startMockChild();
      yield* Effect.addFinalizer(() => Effect.sync(() => void child.terminate("SIGKILL")));
      const requests: RecordedRequest[] = [];
      const sockets: TestWebSocket[] = [];
      const fetch = makeEnvironmentFetch(requests, {
        authenticated: false,
        auth: {
          ...SERVER_CONFIG.auth,
          policy: "unsafe-no-auth",
          sessionMethods: [],
        },
      });
      const readiness = yield* waitForTuiEnvironmentReady({
        httpBaseUrl: "http://127.0.0.1:43220",
        fetch,
      });
      const error = yield* Effect.flip(
        connectAuthenticatedTuiEnvironment({
          child,
          readiness,
          fetch,
          webSocketConstructor: makeTestWebSocketConstructor(sockets),
        }),
      );

      assert.instanceOf(error, TuiEnvironmentConnectionError);
      assert.equal(error.phase, "session-validation");
      assert.isTrue(child.isBootstrapSecretCleared());
      assert.deepEqual(
        requests.map((request) => new URL(request.url).pathname),
        ["/.well-known/t3/environment", "/oauth/token", "/api/auth/session"],
      );
      assert.equal(sockets.length, 0);
    }),
  );

  it.effect("leaves the child bootstrap token untouched when readiness fails", () =>
    Effect.gen(function* () {
      const child = yield* startMockChild();
      yield* Effect.addFinalizer(() => Effect.sync(() => void child.terminate("SIGKILL")));
      const bootstrapToken = yield* child.useBootstrapToken(Effect.succeed);
      const readinessError = yield* Effect.flip(
        waitForTuiEnvironmentReady({
          httpBaseUrl: "http://127.0.0.1:43220",
          fetch: async () => {
            throw new Error("not ready");
          },
          maxAttempts: 1,
        }),
      );

      assert.instanceOf(readinessError, TuiEnvironmentConnectionError);
      assert.equal(readinessError.phase, "readiness");
      assert.isFalse(child.isBootstrapSecretCleared());
      assert.equal(yield* child.useBootstrapToken(Effect.succeed), bootstrapToken);
    }),
  );

  it.effect("starts the owned child and waits for readiness before authentication", () =>
    Effect.gen(function* () {
      let markDescriptorRequested: () => void = () => undefined;
      let releaseDescriptor: (response: Response) => void = () => undefined;
      const descriptorRequested = new Promise<void>((resolve) => {
        markDescriptorRequested = resolve;
      });
      const descriptorResponse = new Promise<Response>((resolve) => {
        releaseDescriptor = resolve;
      });
      const requests: RecordedRequest[] = [];
      const sockets: TestWebSocket[] = [];
      const readyFetch = makeEnvironmentFetch(requests);
      const gatedFetch: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname !== "/.well-known/t3/environment") {
          return readyFetch(input, init);
        }
        requests.push({
          url: request.url,
          method: request.method,
          authorization: request.headers.get("authorization"),
          contentType: request.headers.get("content-type"),
          body: "",
        });
        markDescriptorRequested();
        return descriptorResponse;
      };

      const connectionFiber = yield* startAndConnectAuthenticatedTuiEnvironment({
        start: {
          executable: process.execPath,
          args: ["--input-type=module", "--eval", mockChildSource, "--"],
          delivery: "fd3",
          bootstrap,
        },
        httpBaseUrl: "http://127.0.0.1:43220",
        fetch: gatedFetch,
        webSocketConstructor: makeTestWebSocketConstructor(sockets),
      }).pipe(Effect.forkChild);

      yield* Effect.promise(() => descriptorRequested);
      assert.deepEqual(
        requests.map((request) => new URL(request.url).pathname),
        ["/.well-known/t3/environment"],
      );
      assert.equal(requests[0]?.authorization, null);

      releaseDescriptor(jsonResponse(SERVER_CONFIG.environment));
      const connected = yield* Fiber.join(connectionFiber);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => void connected.child.terminate("SIGKILL")),
      );

      assert.isTrue(connected.child.isOwnedPid(connected.child.pid));
      assert.equal(
        connected.readiness.descriptor.environmentId,
        SERVER_CONFIG.environment.environmentId,
      );
      assert.deepEqual(
        requests.map((request) => new URL(request.url).pathname),
        [
          "/.well-known/t3/environment",
          "/oauth/token",
          "/api/auth/session",
          "/api/auth/websocket-ticket",
        ],
      );
      connected.bearer.clear();
    }),
  );
});
