import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { BootstrapChildStartError } from "../backend/bootstrapChild.ts";
import {
  reattachAuthenticatedTuiEnvironment,
  startAndConnectAuthenticatedTuiEnvironment,
  type ReattachAuthenticatedTuiEnvironmentOptions,
  type ReattachedAuthenticatedTuiEnvironment,
  type StartAndConnectAuthenticatedTuiEnvironmentOptions,
  type StartedAuthenticatedTuiEnvironment,
  type TuiEnvironmentConnectionError,
  type TuiEnvironmentReattachError,
} from "./authenticatedEnvironment.ts";
import type { TuiCredentialStore } from "./credentialStore.ts";

export type TuiLocalEnvironmentOwnership = "external" | "foreground";

export type TuiLocalEnvironmentReleasePolicy = "keep-alive" | "terminate-owned";

export type TuiLocalEnvironmentSupervisorFailure =
  | "credential-missing"
  | "credential-rejected"
  | "credential-unsafe"
  | "start-failed";

interface TuiLocalEnvironmentStateMetadata {
  readonly environmentId: EnvironmentId;
  readonly httpOrigin: string;
}

export type TuiLocalEnvironmentSupervisorState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Reattaching" }
  | { readonly _tag: "Starting" }
  | ({ readonly _tag: "Ready"; readonly ownership: "external" } & TuiLocalEnvironmentStateMetadata)
  | ({
      readonly _tag: "Ready";
      readonly ownership: "foreground";
      readonly pid: number;
    } & TuiLocalEnvironmentStateMetadata)
  | {
      readonly _tag: "Failed";
      readonly failure: TuiLocalEnvironmentSupervisorFailure;
    }
  | { readonly _tag: "Releasing"; readonly ownership: "external" }
  | {
      readonly _tag: "Releasing";
      readonly ownership: "foreground";
      readonly pid: number;
    };

export interface AttachedTuiLocalEnvironment {
  readonly ownership: "external";
  readonly environment: ReattachedAuthenticatedTuiEnvironment;
}

export interface ForegroundTuiLocalEnvironment {
  readonly ownership: "foreground";
  readonly environment: StartedAuthenticatedTuiEnvironment;
}

export type TuiLocalEnvironmentLease = AttachedTuiLocalEnvironment | ForegroundTuiLocalEnvironment;

export type TuiLocalEnvironmentSupervisorConnectError =
  | BootstrapChildStartError
  | TuiEnvironmentConnectionError
  | TuiEnvironmentReattachError;

export interface TuiLocalEnvironmentSupervisorOperations {
  readonly reattach: () => Effect.Effect<
    ReattachedAuthenticatedTuiEnvironment,
    TuiEnvironmentReattachError
  >;
  readonly start?: () => Effect.Effect<
    StartedAuthenticatedTuiEnvironment,
    BootstrapChildStartError | TuiEnvironmentConnectionError
  >;
}

export interface TuiLocalEnvironmentSupervisor {
  readonly state: SubscriptionRef.SubscriptionRef<TuiLocalEnvironmentSupervisorState>;
  readonly connect: Effect.Effect<
    TuiLocalEnvironmentLease,
    TuiLocalEnvironmentSupervisorConnectError
  >;
  readonly release: (policy: TuiLocalEnvironmentReleasePolicy) => Effect.Effect<void>;
}

export interface MakeTuiLocalEnvironmentSupervisorOptions {
  readonly credentialStore: TuiCredentialStore;
  readonly reattach?: Omit<ReattachAuthenticatedTuiEnvironmentOptions, "credentialStore">;
  readonly start?: Omit<StartAndConnectAuthenticatedTuiEnvironmentOptions, "credentialStore">;
}

const IDLE_STATE: TuiLocalEnvironmentSupervisorState = Object.freeze({ _tag: "Idle" });

function readyState(lease: TuiLocalEnvironmentLease): TuiLocalEnvironmentSupervisorState {
  const metadata = {
    environmentId: lease.environment.readiness.descriptor.environmentId,
    httpOrigin: lease.environment.readiness.httpBaseUrl,
  };
  return lease.ownership === "external"
    ? { _tag: "Ready", ownership: "external", ...metadata }
    : {
        _tag: "Ready",
        ownership: "foreground",
        pid: lease.environment.child.pid,
        ...metadata,
      };
}

function releasingState(lease: TuiLocalEnvironmentLease): TuiLocalEnvironmentSupervisorState {
  return lease.ownership === "external"
    ? { _tag: "Releasing", ownership: "external" }
    : {
        _tag: "Releasing",
        ownership: "foreground",
        pid: lease.environment.child.pid,
      };
}

function reattachFailureState(
  error: TuiEnvironmentReattachError,
): TuiLocalEnvironmentSupervisorState {
  return {
    _tag: "Failed",
    failure:
      error.failure === "missing"
        ? "credential-missing"
        : error.failure === "unsafe"
          ? "credential-unsafe"
          : "credential-rejected",
  };
}

/**
 * Serializes discovery, startup, and release for one local state directory.
 * The returned state deliberately excludes bearer and bootstrap credentials.
 */
export const makeTuiLocalEnvironmentSupervisorWithOperations = Effect.fn(
  "tui.connection.makeTuiLocalEnvironmentSupervisorWithOperations",
)(function* (
  operations: TuiLocalEnvironmentSupervisorOperations,
): Effect.fn.Return<TuiLocalEnvironmentSupervisor> {
  const mutex = yield* Semaphore.make(1);
  const state = yield* SubscriptionRef.make<TuiLocalEnvironmentSupervisorState>(IDLE_STATE);
  let active: TuiLocalEnvironmentLease | undefined;

  const activate = (lease: TuiLocalEnvironmentLease) =>
    Effect.uninterruptible(
      Effect.sync(() => {
        active = lease;
      }).pipe(Effect.andThen(SubscriptionRef.set(state, readyState(lease)))),
    );

  const connectUnlocked = Effect.suspend(() => {
    if (active !== undefined) return Effect.succeed(active);

    return Effect.gen(function* () {
      yield* SubscriptionRef.set(state, { _tag: "Reattaching" });
      const reattached = yield* operations.reattach().pipe(Effect.result);
      if (Result.isSuccess(reattached)) {
        const lease: AttachedTuiLocalEnvironment = {
          ownership: "external",
          environment: reattached.success,
        };
        yield* activate(lease);
        return lease;
      }

      if (reattached.failure.failure !== "missing" || operations.start === undefined) {
        yield* SubscriptionRef.set(state, reattachFailureState(reattached.failure));
        return yield* reattached.failure;
      }

      yield* SubscriptionRef.set(state, { _tag: "Starting" });
      const started = yield* operations
        .start()
        .pipe(
          Effect.onError(() =>
            SubscriptionRef.set(state, { _tag: "Failed", failure: "start-failed" }),
          ),
        );
      const lease: ForegroundTuiLocalEnvironment = {
        ownership: "foreground",
        environment: started,
      };
      yield* activate(lease);
      return lease;
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.suspend(() =>
          active === undefined ? SubscriptionRef.set(state, IDLE_STATE) : Effect.void,
        ),
      ),
    );
  });

  const connect = mutex.withPermits(1)(connectUnlocked);

  const release = (policy: TuiLocalEnvironmentReleasePolicy) =>
    mutex.withPermits(1)(
      Effect.suspend(() => {
        const lease = active;
        if (lease === undefined) return SubscriptionRef.set(state, IDLE_STATE);

        return Effect.uninterruptible(
          Effect.gen(function* () {
            yield* SubscriptionRef.set(state, releasingState(lease));
            if (policy === "terminate-owned" && lease.ownership === "foreground") {
              yield* Effect.sync(() => {
                void lease.environment.child.terminate();
              });
            }
            yield* Effect.sync(() => {
              lease.environment.bearer.clear();
              active = undefined;
            });
            yield* SubscriptionRef.set(state, IDLE_STATE);
          }),
        );
      }),
    );

  return { state, connect, release };
});

export const makeTuiLocalEnvironmentSupervisor = Effect.fn(
  "tui.connection.makeTuiLocalEnvironmentSupervisor",
)(function* (
  options: MakeTuiLocalEnvironmentSupervisorOptions,
): Effect.fn.Return<TuiLocalEnvironmentSupervisor> {
  const start = options.start;
  return yield* makeTuiLocalEnvironmentSupervisorWithOperations({
    reattach: () =>
      reattachAuthenticatedTuiEnvironment({
        ...options.reattach,
        credentialStore: options.credentialStore,
      }),
    ...(start
      ? {
          start: () =>
            startAndConnectAuthenticatedTuiEnvironment({
              ...start,
              credentialStore: options.credentialStore,
            }),
        }
      : {}),
  });
});
