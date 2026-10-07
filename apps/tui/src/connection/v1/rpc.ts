import { makeV1CommonClient } from "./commonRpc.ts";
import { EnvironmentAuthorizationError } from "@t3tools/contracts";
import { EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  type WsRpcProtocolClient,
  EnvironmentRpcUnavailableError,
} from "@t3tools/client-runtime/rpc";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Rpc, RpcClient, RpcGroup } from "effect/rpc";
import * as V1 from "./contracts.ts";

const group = RpcGroup.make(
  Rpc.make("orchestration.dispatchCommand", {
    payload: V1.ClientOrchestrationCommand,
    success: V1.DispatchResult,
    error: Schema.Union([V1.OrchestrationDispatchCommandError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("orchestration.getTurnDiff", {
    payload: V1.OrchestrationGetTurnDiffInput,
    success: V1.OrchestrationGetTurnDiffResult,
    error: Schema.Union([V1.OrchestrationGetTurnDiffError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("orchestration.getFullThreadDiff", {
    payload: V1.OrchestrationGetFullThreadDiffInput,
    success: V1.OrchestrationGetFullThreadDiffResult,
    error: Schema.Union([V1.OrchestrationGetFullThreadDiffError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("orchestration.searchThreads", {
    payload: V1.OrchestrationSearchThreadsInput,
    success: V1.OrchestrationSearchThreadsResult,
    error: Schema.Union([V1.OrchestrationSearchThreadsError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("orchestration.getArchivedShellSnapshot", {
    payload: Schema.Struct({}),
    success: V1.OrchestrationShellSnapshot,
    error: Schema.Union([V1.OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("orchestration.subscribeShell", {
    payload: V1.OrchestrationSubscribeShellInput,
    success: V1.OrchestrationShellStreamItem,
    stream: true,
    error: Schema.Union([V1.OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  }),
  Rpc.make("orchestration.subscribeThread", {
    payload: V1.OrchestrationSubscribeThreadInput,
    success: V1.OrchestrationThreadStreamItem,
    stream: true,
    error: Schema.Union([V1.OrchestrationGetSnapshotError, EnvironmentAuthorizationError]),
  }),
);
export const makeLegacyRpcClient = RpcClient.make(group);
type Client = Effect.Success<typeof makeLegacyRpcClient>;
const clients = new WeakMap<WsRpcProtocolClient, Client>();
export const makeV1ProtocolClient = Effect.gen(function* () {
  const common = yield* makeV1CommonClient;
  const legacy = yield* makeLegacyRpcClient;
  clients.set(common, legacy);
  return common;
});

export const currentClient = Effect.gen(function* () {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const session = yield* SubscriptionRef.get(supervisor.session);
  const client = Option.isSome(session) ? clients.get(session.value.client) : undefined;
  if (!client)
    return yield* new EnvironmentRpcUnavailableError({
      environmentId: supervisor.target.environmentId,
      message: "The V1 server is not connected.",
    });
  return client;
});

// Switching sessions cancels the old subscription before accepting a fresh snapshot.
export function follow<A, E>(disconnected: A, subscribe: (client: Client) => Stream.Stream<A, E>) {
  return Stream.unwrap(
    Effect.gen(function* () {
      const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
      return SubscriptionRef.changes(supervisor.session).pipe(
        Stream.switchMap((session) => {
          const client = Option.isSome(session) ? clients.get(session.value.client) : undefined;
          return client
            ? Stream.concat(Stream.succeed(disconnected), subscribe(client))
            : Stream.succeed(disconnected);
        }),
      );
    }),
  );
}
