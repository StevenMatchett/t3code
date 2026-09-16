import {
  AuthOrchestrationReadScope,
  AuthStandardClientScopes,
  type AuthSessionState,
  type EnvironmentId,
  type ExecutionEnvironmentDescriptor,
  type ServerConfig,
  WS_METHODS,
} from "@t3tools/contracts";
import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  resolveRemoteWebSocketConnectionUrl,
} from "@t3tools/client-runtime/authorization";
import {
  deriveWsBaseUrl,
  fetchRemoteEnvironmentDescriptor,
} from "@t3tools/client-runtime/environment";
import { makeWsRpcProtocolClient, remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

import {
  startBootstrapChild,
  type BootstrapChildStartError,
  type OwnedBootstrapChild,
  type StartBootstrapChildOptions,
} from "../backend/bootstrapChild.ts";
import { type TuiCredentialStore, type TuiCredentialStoreError } from "./credentialStore.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_READINESS_ATTEMPTS = 60;
const DEFAULT_READINESS_INTERVAL_MS = 100;
const DEFAULT_READINESS_PROBE_TIMEOUT_MS = 1_000;
const SOCKET_OPEN_TIMEOUT = "15 seconds";

export const TuiEnvironmentConnectionPhase = Schema.Literals([
  "readiness",
  "bearer-exchange",
  "session-validation",
  "websocket-ticket",
  "config-read",
  "identity-validation",
  "credential-persist",
]);
export type TuiEnvironmentConnectionPhase = typeof TuiEnvironmentConnectionPhase.Type;

export class TuiEnvironmentConnectionError extends Schema.TaggedError<TuiEnvironmentConnectionError>()(
  "TuiEnvironmentConnectionError",
  { phase: TuiEnvironmentConnectionPhase },
) {
  override get message(): string {
    switch (this.phase) {
      case "readiness":
        return "The local environment did not become ready.";
      case "bearer-exchange":
        return "Failed to exchange the local bootstrap credential.";
      case "session-validation":
        return "The local environment did not grant an authenticated bearer session.";
      case "websocket-ticket":
        return "Failed to authorize the local environment WebSocket.";
      case "config-read":
        return "Failed to read the local environment configuration.";
      case "identity-validation":
        return "The local environment identity changed during authentication.";
      case "credential-persist":
        return "Failed to save the authenticated local environment credential.";
    }
  }
}

export class TuiBearerSessionClearedError extends Schema.TaggedError<TuiBearerSessionClearedError>()(
  "TuiBearerSessionClearedError",
  {},
) {
  override get message(): string {
    return "The local environment bearer session has been cleared.";
  }
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** Keeps the reusable bearer out of JSON, logs, and ordinary object inspection. */
export class TuiBearerSession {
  readonly expiresInSeconds: number;
  readonly #bytes: Uint8Array;
  #cleared = false;

  constructor(token: string, expiresInSeconds: number) {
    this.#bytes = encoder.encode(token);
    this.expiresInSeconds = expiresInSeconds;
  }

  use<A, E, R>(
    f: (token: string) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | TuiBearerSessionClearedError, R> {
    return Effect.suspend((): Effect.Effect<A, E | TuiBearerSessionClearedError, R> =>
      this.#cleared
        ? Effect.fail(new TuiBearerSessionClearedError())
        : f(decoder.decode(this.#bytes)),
    );
  }

  clear(): void {
    this.#bytes.fill(0);
    this.#cleared = true;
  }

  get cleared(): boolean {
    return this.#cleared;
  }

  toJSON(): { readonly authenticated: true; readonly cleared: boolean } {
    return { authenticated: true, cleared: this.#cleared };
  }
}

export interface AuthenticatedTuiEnvironment {
  readonly bearer: TuiBearerSession;
  readonly session: AuthSessionState;
  readonly config: ServerConfig;
}

type WebSocketConstructor = Socket.WebSocketConstructor["Service"];

const readinessProof: unique symbol = Symbol("tui-environment-readiness");

export interface TuiEnvironmentReadiness {
  readonly descriptor: ExecutionEnvironmentDescriptor;
  readonly httpBaseUrl: string;
  readonly [readinessProof]: true;
}

export interface WaitForTuiEnvironmentReadyOptions {
  readonly httpBaseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxAttempts?: number;
  readonly intervalMs?: number;
  readonly probeTimeoutMs?: number;
}

export interface ConnectAuthenticatedTuiEnvironmentOptions {
  readonly child: OwnedBootstrapChild;
  readonly readiness: TuiEnvironmentReadiness;
  readonly credentialStore?: TuiCredentialStore;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocketConstructor?: WebSocketConstructor;
  readonly timeoutMs?: number;
}

export interface StartAndConnectAuthenticatedTuiEnvironmentOptions {
  readonly start: StartBootstrapChildOptions;
  readonly httpBaseUrl: string;
  readonly credentialStore?: TuiCredentialStore;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocketConstructor?: WebSocketConstructor;
  readonly requestTimeoutMs?: number;
  readonly readinessMaxAttempts?: number;
  readonly readinessIntervalMs?: number;
  readonly readinessProbeTimeoutMs?: number;
}

export interface StartedAuthenticatedTuiEnvironment extends AuthenticatedTuiEnvironment {
  readonly child: OwnedBootstrapChild;
  readonly readiness: TuiEnvironmentReadiness;
}

export const TuiEnvironmentReattachFailure = Schema.Literals(["missing", "rejected", "unsafe"]);
export type TuiEnvironmentReattachFailure = typeof TuiEnvironmentReattachFailure.Type;

export class TuiEnvironmentReattachError extends Schema.TaggedError<TuiEnvironmentReattachError>()(
  "TuiEnvironmentReattachError",
  { failure: TuiEnvironmentReattachFailure },
) {
  override get message(): string {
    switch (this.failure) {
      case "missing":
        return "No saved local environment session exists. Start a new TUI-owned environment to create one.";
      case "rejected":
        return "The saved local environment session was rejected. Start a new TUI-owned environment to replace it.";
      case "unsafe":
        return "The saved local environment session is not safe to read. Fix its ownership and permissions, or remove it and start a new TUI-owned environment.";
    }
  }
}

export interface ReattachAuthenticatedTuiEnvironmentOptions {
  readonly credentialStore: TuiCredentialStore;
  readonly expectedHttpBaseUrl?: string;
  readonly expectedEnvironmentId?: EnvironmentId;
  readonly fetch?: typeof globalThis.fetch;
  readonly webSocketConstructor?: WebSocketConstructor;
  readonly timeoutMs?: number;
}

export interface ReattachedAuthenticatedTuiEnvironment extends AuthenticatedTuiEnvironment {
  readonly readiness: TuiEnvironmentReadiness;
}

const nodeWebSocketConstructor: WebSocketConstructor = (url, protocols) =>
  (protocols === undefined
    ? new globalThis.WebSocket(url)
    : new globalThis.WebSocket(url, protocols)) as globalThis.WebSocket;

export function normalizeTuiHttpOrigin(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("The TUI environment endpoint must use HTTP or HTTPS.");
  }
  return url.origin;
}

export const waitForTuiEnvironmentReady = Effect.fn("tui.connection.waitForTuiEnvironmentReady")(
  function* (
    options: WaitForTuiEnvironmentReadyOptions,
  ): Effect.fn.Return<TuiEnvironmentReadiness, TuiEnvironmentConnectionError> {
    const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? DEFAULT_READINESS_ATTEMPTS));
    const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_READINESS_INTERVAL_MS);
    const probeTimeoutMs = Math.max(
      1,
      options.probeTimeoutMs ?? DEFAULT_READINESS_PROBE_TIMEOUT_MS,
    );
    const httpBaseUrl = yield* Effect.try({
      try: () => normalizeTuiHttpOrigin(options.httpBaseUrl),
      catch: () => new TuiEnvironmentConnectionError({ phase: "readiness" }),
    });
    const httpClientLayer = remoteHttpClientLayer(options.fetch ?? globalThis.fetch);
    const probe = fetchRemoteEnvironmentDescriptor({
      httpBaseUrl,
      timeoutMs: probeTimeoutMs,
    }).pipe(Effect.mapError(() => new TuiEnvironmentConnectionError({ phase: "readiness" })));
    const descriptor = yield* probe.pipe(
      Effect.retry({
        times: maxAttempts - 1,
        schedule: Schedule.spaced(Duration.millis(intervalMs)),
      }),
      Effect.provide(httpClientLayer),
    );
    return {
      descriptor,
      httpBaseUrl,
      [readinessProof]: true,
    };
  },
);

const readServerConfig = Effect.fn("tui.connection.readServerConfig")(function* (input: {
  readonly socketUrl: string;
  readonly webSocketConstructor: WebSocketConstructor;
}) {
  const socketLayer = Socket.layerWebSocket(input.socketUrl, {
    openTimeout: SOCKET_OPEN_TIMEOUT,
  }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, input.webSocketConstructor)));
  const protocolLayer = Layer.effect(
    RpcClient.Protocol,
    RpcClient.makeProtocolSocket({
      retryTransientErrors: false,
      retryPolicy: Schedule.recurs(0),
    }),
  ).pipe(Layer.provide(Layer.mergeAll(socketLayer, RpcSerialization.layerJson)));
  const protocolContext = yield* Layer.build(protocolLayer);
  const client = yield* makeWsRpcProtocolClient.pipe(Effect.provide(protocolContext));
  return yield* client[WS_METHODS.serverGetConfig]({});
});

const validateBearerSession = (
  session: AuthSessionState,
): Effect.Effect<AuthSessionState, TuiEnvironmentConnectionError> =>
  session.authenticated &&
  session.sessionMethod === "bearer-access-token" &&
  session.scopes?.includes(AuthOrchestrationReadScope) === true
    ? Effect.succeed(session)
    : Effect.fail(new TuiEnvironmentConnectionError({ phase: "session-validation" }));

const validateEnvironmentIdentity = (
  actual: EnvironmentId,
  expected: EnvironmentId,
): Effect.Effect<void, TuiEnvironmentConnectionError> =>
  actual === expected
    ? Effect.void
    : Effect.fail(new TuiEnvironmentConnectionError({ phase: "identity-validation" }));

const connectTuiEnvironmentWithBearer = Effect.fn("tui.connection.connectTuiEnvironmentWithBearer")(
  function* (options: {
    readonly bearer: TuiBearerSession;
    readonly httpBaseUrl: string;
    readonly expectedEnvironmentId: EnvironmentId;
    readonly fetch: typeof globalThis.fetch;
    readonly webSocketConstructor: WebSocketConstructor;
    readonly timeoutMs: number;
  }): Effect.fn.Return<AuthenticatedTuiEnvironment, TuiEnvironmentConnectionError> {
    const httpClientLayer = remoteHttpClientLayer(options.fetch);
    return yield* Effect.gen(function* () {
      const session = yield* options.bearer
        .use((token) =>
          fetchRemoteSessionState({
            httpBaseUrl: options.httpBaseUrl,
            bearerToken: token,
            timeoutMs: options.timeoutMs,
          }),
        )
        .pipe(
          Effect.mapError(() => new TuiEnvironmentConnectionError({ phase: "session-validation" })),
          Effect.flatMap(validateBearerSession),
        );
      const socketUrl = yield* options.bearer
        .use((token) =>
          resolveRemoteWebSocketConnectionUrl({
            httpBaseUrl: options.httpBaseUrl,
            wsBaseUrl: deriveWsBaseUrl(options.httpBaseUrl),
            bearerToken: token,
            clientMetadata: {
              label: "T3 Code TUI",
              deviceType: "bot",
              surface: "cli",
            },
            connectionMethod: "direct",
            timeoutMs: options.timeoutMs,
          }),
        )
        .pipe(
          Effect.mapError(() => new TuiEnvironmentConnectionError({ phase: "websocket-ticket" })),
        );
      const config = yield* readServerConfig({
        socketUrl,
        webSocketConstructor: options.webSocketConstructor,
      }).pipe(
        Effect.scoped,
        Effect.mapError(() => new TuiEnvironmentConnectionError({ phase: "config-read" })),
      );
      yield* validateEnvironmentIdentity(
        config.environment.environmentId,
        options.expectedEnvironmentId,
      );
      return { bearer: options.bearer, session, config };
    }).pipe(
      Effect.provide(httpClientLayer),
      Effect.tapError(() => Effect.sync(() => options.bearer.clear())),
    );
  },
);

function mapCredentialStoreToReattachError(
  error: TuiCredentialStoreError,
): TuiEnvironmentReattachError {
  return new TuiEnvironmentReattachError({
    failure:
      error.failure === "missing" ? "missing" : error.failure === "unsafe" ? "unsafe" : "rejected",
  });
}

export const connectAuthenticatedTuiEnvironment = Effect.fn(
  "tui.connection.connectAuthenticatedTuiEnvironment",
)(function* (
  options: ConnectAuthenticatedTuiEnvironmentOptions,
): Effect.fn.Return<AuthenticatedTuiEnvironment, TuiEnvironmentConnectionError> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const httpBaseUrl = options.readiness.httpBaseUrl;
  const fetch = options.fetch ?? globalThis.fetch;

  return yield* Effect.gen(function* () {
    const accessToken = yield* options.child
      .useBootstrapToken((credential) =>
        bootstrapRemoteBearerSession({
          httpBaseUrl,
          credential,
          scopes: AuthStandardClientScopes,
          clientMetadata: {
            label: "T3 Code TUI",
            deviceType: "bot",
            surface: "cli",
          },
          timeoutMs,
        }),
      )
      .pipe(
        Effect.mapError(() => new TuiEnvironmentConnectionError({ phase: "bearer-exchange" })),
        Effect.ensuring(Effect.sync(() => options.child.clearBootstrapSecret())),
      );
    const issuedAtEpochMs = yield* Clock.currentTimeMillis;
    const bearer = new TuiBearerSession(accessToken.access_token, accessToken.expires_in);

    const connected = yield* connectTuiEnvironmentWithBearer({
      bearer,
      httpBaseUrl,
      expectedEnvironmentId: options.readiness.descriptor.environmentId,
      fetch,
      webSocketConstructor: options.webSocketConstructor ?? nodeWebSocketConstructor,
      timeoutMs,
    });
    const credentialStore = options.credentialStore;
    if (credentialStore !== undefined) {
      const accessTokenExpiry =
        issuedAtEpochMs + Math.max(0, Math.trunc(accessToken.expires_in * 1_000));
      const expiresAtEpochMs = Math.min(
        accessTokenExpiry,
        connected.session.expiresAt?.epochMilliseconds ?? accessTokenExpiry,
      );
      yield* bearer
        .use((bearerToken) =>
          credentialStore.write({
            version: 1,
            httpOrigin: httpBaseUrl,
            environmentId: options.readiness.descriptor.environmentId,
            bearerToken,
            expiresAtEpochMs,
          }),
        )
        .pipe(
          Effect.mapError(() => new TuiEnvironmentConnectionError({ phase: "credential-persist" })),
          Effect.tapError(() => Effect.sync(() => bearer.clear())),
        );
    }
    return connected;
  }).pipe(Effect.provide(remoteHttpClientLayer(fetch)));
});

export const reattachAuthenticatedTuiEnvironment = Effect.fn(
  "tui.connection.reattachAuthenticatedTuiEnvironment",
)(function* (
  options: ReattachAuthenticatedTuiEnvironmentOptions,
): Effect.fn.Return<ReattachedAuthenticatedTuiEnvironment, TuiEnvironmentReattachError> {
  const stored = yield* options.credentialStore
    .read()
    .pipe(Effect.mapError(mapCredentialStoreToReattachError));
  const origins = yield* Effect.try({
    try: () => ({
      stored: normalizeTuiHttpOrigin(stored.httpOrigin),
      expected:
        options.expectedHttpBaseUrl === undefined
          ? stored.httpOrigin
          : normalizeTuiHttpOrigin(options.expectedHttpBaseUrl),
    }),
    catch: () => new TuiEnvironmentReattachError({ failure: "rejected" }),
  });
  if (stored.httpOrigin !== origins.stored || origins.stored !== origins.expected) {
    return yield* new TuiEnvironmentReattachError({ failure: "rejected" });
  }
  if (
    options.expectedEnvironmentId !== undefined &&
    stored.environmentId !== options.expectedEnvironmentId
  ) {
    return yield* new TuiEnvironmentReattachError({ failure: "rejected" });
  }
  const now = yield* Clock.currentTimeMillis;
  if (stored.expiresAtEpochMs <= now) {
    return yield* new TuiEnvironmentReattachError({ failure: "rejected" });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const fetch = options.fetch ?? globalThis.fetch;
  const descriptor = yield* fetchRemoteEnvironmentDescriptor({
    httpBaseUrl: stored.httpOrigin,
    timeoutMs,
  }).pipe(
    Effect.provide(remoteHttpClientLayer(fetch)),
    Effect.mapError(() => new TuiEnvironmentReattachError({ failure: "rejected" })),
  );
  if (descriptor.environmentId !== stored.environmentId) {
    return yield* new TuiEnvironmentReattachError({ failure: "rejected" });
  }

  const bearer = new TuiBearerSession(
    stored.bearerToken,
    Math.max(1, Math.ceil((stored.expiresAtEpochMs - now) / 1_000)),
  );
  const connected = yield* connectTuiEnvironmentWithBearer({
    bearer,
    httpBaseUrl: stored.httpOrigin,
    expectedEnvironmentId: stored.environmentId,
    fetch,
    webSocketConstructor: options.webSocketConstructor ?? nodeWebSocketConstructor,
    timeoutMs,
  }).pipe(Effect.mapError(() => new TuiEnvironmentReattachError({ failure: "rejected" })));
  return {
    ...connected,
    readiness: {
      descriptor,
      httpBaseUrl: stored.httpOrigin,
      [readinessProof]: true,
    },
  };
});

export const startAndConnectAuthenticatedTuiEnvironment = Effect.fn(
  "tui.connection.startAndConnectAuthenticatedTuiEnvironment",
)(function* (
  options: StartAndConnectAuthenticatedTuiEnvironmentOptions,
): Effect.fn.Return<
  StartedAuthenticatedTuiEnvironment,
  BootstrapChildStartError | TuiEnvironmentConnectionError
> {
  const child = yield* startBootstrapChild(options.start);
  return yield* Effect.gen(function* () {
    const readiness = yield* waitForTuiEnvironmentReady({
      httpBaseUrl: options.httpBaseUrl,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.readinessMaxAttempts === undefined
        ? {}
        : { maxAttempts: options.readinessMaxAttempts }),
      ...(options.readinessIntervalMs === undefined
        ? {}
        : { intervalMs: options.readinessIntervalMs }),
      ...(options.readinessProbeTimeoutMs === undefined
        ? {}
        : { probeTimeoutMs: options.readinessProbeTimeoutMs }),
    });
    const connected = yield* connectAuthenticatedTuiEnvironment({
      child,
      readiness,
      ...(options.credentialStore === undefined
        ? {}
        : { credentialStore: options.credentialStore }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.webSocketConstructor === undefined
        ? {}
        : { webSocketConstructor: options.webSocketConstructor }),
      ...(options.requestTimeoutMs === undefined ? {} : { timeoutMs: options.requestTimeoutMs }),
    });
    return { ...connected, child, readiness };
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit) ? Effect.sync(() => void child.terminate()) : Effect.void,
    ),
  );
});
