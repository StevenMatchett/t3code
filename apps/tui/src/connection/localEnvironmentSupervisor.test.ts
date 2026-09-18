/// <reference types="node" />
// @effect-diagnostics preferSchemaOverJson:off -- This test verifies the exact ordinary JSON representation of supervisor state and secret wrappers.

import { EnvironmentId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { OwnedBootstrapChild } from "../backend/bootstrapChild.ts";
import {
  type ReattachedAuthenticatedTuiEnvironment,
  type StartedAuthenticatedTuiEnvironment,
  TuiBearerSession,
  TuiEnvironmentReattachError,
} from "./authenticatedEnvironment.ts";
import {
  makeTuiLocalEnvironmentSupervisorWithOperations,
  type TuiLocalEnvironmentSupervisorOperations,
} from "./localEnvironmentSupervisor.ts";

const ENVIRONMENT_ID = EnvironmentId.make("tui-supervisor-test");
const HTTP_ORIGIN = "http://127.0.0.1:43220";
const BEARER_SECRET = "supervisor-bearer-secret-fixture";
const BOOTSTRAP_SECRET = "supervisor-bootstrap-secret-fixture";

function makeReattachedEnvironment(
  bearerToken = BEARER_SECRET,
): ReattachedAuthenticatedTuiEnvironment {
  return {
    bearer: new TuiBearerSession(bearerToken, 3_600),
    session: { authenticated: true },
    config: { environment: { environmentId: ENVIRONMENT_ID } },
    readiness: {
      descriptor: { environmentId: ENVIRONMENT_ID },
      httpBaseUrl: HTTP_ORIGIN,
    },
  } as unknown as ReattachedAuthenticatedTuiEnvironment;
}

function makeOwnedChild(onTerminate: () => void): OwnedBootstrapChild {
  return {
    pid: 4_321,
    bootstrapSecret: BOOTSTRAP_SECRET,
    terminate: () => {
      onTerminate();
      return true;
    },
    toJSON: () => ({ pid: 4_321, bootstrapFd: 3 }),
  } as unknown as OwnedBootstrapChild;
}

function makeStartedEnvironment(options?: {
  readonly onTerminate?: () => void;
}): StartedAuthenticatedTuiEnvironment {
  return {
    ...makeReattachedEnvironment(),
    child: makeOwnedChild(options?.onTerminate ?? (() => undefined)),
  } as unknown as StartedAuthenticatedTuiEnvironment;
}

const missingCredential = () =>
  new TuiEnvironmentReattachError({
    failure: "missing",
  });

describe("TuiLocalEnvironmentSupervisor", () => {
  it.effect("requires pairing instead of starting a separate server in attach-only mode", () =>
    Effect.gen(function* () {
      const supervisor = yield* makeTuiLocalEnvironmentSupervisorWithOperations({
        reattach: () => Effect.fail(missingCredential()),
      });
      const error = yield* supervisor.connect.pipe(Effect.flip);
      assert.equal(error._tag, "TuiEnvironmentReattachError");
      assert.deepEqual(yield* SubscriptionRef.get(supervisor.state), {
        _tag: "Failed",
        failure: "credential-missing",
      });
      yield* supervisor.release("terminate-owned");
    }),
  );

  it.effect("coalesces concurrent startup behind one captured child", () =>
    Effect.gen(function* () {
      const startEntered = yield* Deferred.make<void>();
      const allowStart = yield* Deferred.make<void>();
      const startCount = yield* Ref.make(0);
      const started = makeStartedEnvironment();
      const operations: TuiLocalEnvironmentSupervisorOperations = {
        reattach: () => Effect.fail(missingCredential()),
        start: () =>
          Ref.update(startCount, (count) => count + 1).pipe(
            Effect.andThen(Deferred.succeed(startEntered, undefined)),
            Effect.andThen(Deferred.await(allowStart)),
            Effect.as(started),
          ),
      };
      const supervisor = yield* makeTuiLocalEnvironmentSupervisorWithOperations(operations);

      const callers = yield* Effect.all([supervisor.connect, supervisor.connect], {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild);
      yield* Deferred.await(startEntered);

      assert.equal(yield* Ref.get(startCount), 1);
      assert.deepEqual(yield* SubscriptionRef.get(supervisor.state), { _tag: "Starting" });

      yield* Deferred.succeed(allowStart, undefined);
      const [first, second] = yield* Fiber.join(callers);
      assert.strictEqual(first, second);
      assert.deepEqual(yield* SubscriptionRef.get(supervisor.state), {
        _tag: "Ready",
        ownership: "foreground",
        pid: 4_321,
        environmentId: ENVIRONMENT_ID,
        httpOrigin: HTTP_ORIGIN,
      });
    }),
  );

  it.effect("reattaches without starting or terminating an external server", () =>
    Effect.gen(function* () {
      const startCount = yield* Ref.make(0);
      let unexpectedTerminationCount = 0;
      const attached = {
        ...makeReattachedEnvironment(),
        child: makeOwnedChild(() => {
          unexpectedTerminationCount += 1;
        }),
      } as unknown as ReattachedAuthenticatedTuiEnvironment;
      const supervisor = yield* makeTuiLocalEnvironmentSupervisorWithOperations({
        reattach: () => Effect.succeed(attached),
        start: () =>
          Ref.update(startCount, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("external reattachment must not start a child")),
          ),
      });

      const lease = yield* supervisor.connect;
      assert.equal(lease.ownership, "external");
      assert.equal(yield* Ref.get(startCount), 0);

      yield* supervisor.release("terminate-owned");
      assert.equal(unexpectedTerminationCount, 0);
      assert.equal(attached.bearer.cleared, true);
      assert.deepEqual(yield* SubscriptionRef.get(supervisor.state), { _tag: "Idle" });
    }),
  );

  it.effect("terminates a captured foreground child only under explicit policy", () =>
    Effect.gen(function* () {
      let keepAliveTerminations = 0;
      const keepAlive = yield* makeTuiLocalEnvironmentSupervisorWithOperations({
        reattach: () => Effect.fail(missingCredential()),
        start: () =>
          Effect.succeed(
            makeStartedEnvironment({
              onTerminate: () => {
                keepAliveTerminations += 1;
              },
            }),
          ),
      });
      yield* keepAlive.connect;
      yield* keepAlive.release("keep-alive");
      assert.equal(keepAliveTerminations, 0);

      let ownedTerminations = 0;
      const terminateOwned = yield* makeTuiLocalEnvironmentSupervisorWithOperations({
        reattach: () => Effect.fail(missingCredential()),
        start: () =>
          Effect.succeed(
            makeStartedEnvironment({
              onTerminate: () => {
                ownedTerminations += 1;
              },
            }),
          ),
      });
      yield* terminateOwned.connect;
      yield* terminateOwned.release("terminate-owned");
      yield* terminateOwned.release("terminate-owned");
      assert.equal(ownedTerminations, 1);
    }),
  );

  it.effect("surfaces unsafe or rejected credentials without falling through to startup", () =>
    Effect.gen(function* () {
      const startCount = yield* Ref.make(0);
      const scenarios = [
        { failure: "unsafe", stateFailure: "credential-unsafe" },
        { failure: "rejected", stateFailure: "credential-rejected" },
      ] as const;

      for (const scenario of scenarios) {
        const supervisor = yield* makeTuiLocalEnvironmentSupervisorWithOperations({
          reattach: () =>
            Effect.fail(
              new TuiEnvironmentReattachError({
                failure: scenario.failure,
              }),
            ),
          start: () =>
            Ref.update(startCount, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("invalid credentials must block startup")),
            ),
        });

        const error = yield* Effect.flip(supervisor.connect);
        assert.equal(error._tag, "TuiEnvironmentReattachError");
        if (error._tag !== "TuiEnvironmentReattachError") return;
        assert.equal(error.failure, scenario.failure);
        assert.deepEqual(yield* SubscriptionRef.get(supervisor.state), {
          _tag: "Failed",
          failure: scenario.stateFailure,
        });
      }

      assert.equal(yield* Ref.get(startCount), 0);
    }),
  );

  it.effect("keeps known bearer and bootstrap fixtures out of serialized state", () =>
    Effect.gen(function* () {
      const supervisor = yield* makeTuiLocalEnvironmentSupervisorWithOperations({
        reattach: () => Effect.fail(missingCredential()),
        start: () => Effect.succeed(makeStartedEnvironment()),
      });

      const lease = yield* supervisor.connect;
      const serialized = JSON.stringify({
        state: yield* SubscriptionRef.get(supervisor.state),
        lease,
      });

      assert.equal(serialized.includes(BEARER_SECRET), false);
      assert.equal(serialized.includes(BOOTSTRAP_SECRET), false);
      assert.equal(serialized.includes(HTTP_ORIGIN), true);
    }),
  );
});
