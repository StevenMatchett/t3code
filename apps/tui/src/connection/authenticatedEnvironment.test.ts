/// <reference types="node" />

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
import * as Schema from "effect/Schema";
import * as Socket from "effect/unstable/socket/Socket";

import { BootstrapSecretClearedError, startBootstrapChild } from "../backend/bootstrapChild.ts";
import {
  connectAuthenticatedTuiEnvironment,
  TuiBearerSessionClearedError,
  TuiEnvironmentConnectionError,
} from "./authenticatedEnvironment.ts";

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
    const encodedConfig = Schema.encodeSync(ServerConfig)(SERVER_CONFIG);
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
  it.effect("exchanges the child credential and reads config over a ticketed WebSocket", () =>
    Effect.gen(function* () {
      const child = yield* startMockChild();
      yield* Effect.addFinalizer(() => Effect.sync(() => void child.terminate("SIGKILL")));
      const bootstrapToken = yield* child.useBootstrapToken(Effect.succeed);
      const requests: RecordedRequest[] = [];
      const sockets: TestWebSocket[] = [];

      const connected = yield* connectAuthenticatedTuiEnvironment({
        child,
        httpBaseUrl: "http://127.0.0.1:43220",
        wsBaseUrl: "ws://127.0.0.1:43220",
        fetch: makeEnvironmentFetch(requests),
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

      const tokenRequest = requests[0];
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

      assert.equal(requests[1]?.authorization, "Bearer bearer-test-token");
      assert.equal(requests[2]?.authorization, "Bearer bearer-test-token");
      assert.equal(sockets.length, 1);
      const socketUrl = new URL(sockets[0]?.url ?? "");
      assert.equal(socketUrl.pathname, "/ws");
      assert.equal(socketUrl.searchParams.get("wsTicket"), "websocket-test-ticket");
      assert.equal(socketUrl.searchParams.get("clientSurface"), "cli");
      assert.equal(socketUrl.searchParams.get("connectionMethod"), "direct");

      assert.deepEqual(JSON.parse(JSON.stringify(connected.bearer)), {
        authenticated: true,
        cleared: false,
      });
      assert.notInclude(JSON.stringify(connected), bootstrapToken);
      assert.notInclude(JSON.stringify(connected), "bearer-test-token");
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
      const fetchFailure: typeof globalThis.fetch = async () => {
        throw new Error(`fixture rejected ${bootstrapToken}`);
      };

      const error = yield* Effect.flip(
        connectAuthenticatedTuiEnvironment({
          child,
          httpBaseUrl: "http://127.0.0.1:43220",
          wsBaseUrl: "ws://127.0.0.1:43220",
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
      const error = yield* Effect.flip(
        connectAuthenticatedTuiEnvironment({
          child,
          httpBaseUrl: "http://127.0.0.1:43220",
          wsBaseUrl: "ws://127.0.0.1:43220",
          fetch: makeEnvironmentFetch(requests, {
            authenticated: false,
            auth: {
              ...SERVER_CONFIG.auth,
              policy: "unsafe-no-auth",
              sessionMethods: [],
            },
          }),
          webSocketConstructor: makeTestWebSocketConstructor(sockets),
        }),
      );

      assert.instanceOf(error, TuiEnvironmentConnectionError);
      assert.equal(error.phase, "session-validation");
      assert.isTrue(child.isBootstrapSecretCleared());
      assert.deepEqual(
        requests.map((request) => new URL(request.url).pathname),
        ["/oauth/token", "/api/auth/session"],
      );
      assert.equal(sockets.length, 0);
    }),
  );
});
