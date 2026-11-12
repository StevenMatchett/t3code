/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import { createElement } from "react";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import * as NodeProcess from "node:process";
import * as NodePath from "node:path";

import {
  normalizeTuiHttpOrigin,
  pairExistingTuiEnvironment,
  reattachAuthenticatedTuiEnvironment,
  TuiEnvironmentReattachError,
} from "../connection/authenticatedEnvironment.ts";
import { createTuiClient } from "../connection/clientRuntime.ts";
import { makeTuiCredentialStore, type TuiCredentialStore } from "../connection/credentialStore.ts";
import {
  makeTuiLocalEnvironmentSupervisor,
  makeTuiLocalEnvironmentSupervisorWithOperations,
} from "../connection/localEnvironmentSupervisor.ts";
import type { TuiDaemon } from "../daemon/daemon.ts";
import { readPairingCredential } from "./pairingInput.ts";
import { App } from "../renderer/App.tsx";
import { UiProvider } from "../ui/context.tsx";
import { detectTerminalCapabilities } from "../ui/capabilities.ts";
import { startRendererRuntime } from "../renderer/runtime.tsx";
import { runTuiLifecycle } from "./lifecycle.ts";
import { buildTuiLaunchOptions, formatTuiCliError, type TuiCliOptions } from "./options.ts";
import { openTuiSessionState } from "../persistence/sessionStore.ts";
import type { TuiSessionState } from "../persistence/sessionState.ts";
import { TuiShutdownController } from "./shutdown.ts";

export interface RunTuiPrototypeOptions {
  readonly cli: TuiCliOptions;
  readonly serverEntryPath: string;
  /** The packaged build's background server, used when no other environment is saved. */
  readonly localDaemon?: Pick<TuiDaemon, "origin" | "ensureRunning" | "mintPairingToken">;
}

const isReattachError = Schema.is(TuiEnvironmentReattachError);

/**
 * The local daemon's origin when this launch should use it: no explicit
 * environment was requested and the saved credential, if any, is for it.
 */
async function resolveLocalDaemonOrigin(
  options: RunTuiPrototypeOptions,
  credentialStore: TuiCredentialStore,
): Promise<string | undefined> {
  const daemon = options.localDaemon;
  if (!daemon || options.cli.connect || options.cli.newEnvironment) return undefined;
  const origin = await daemon.origin();
  const saved = await Effect.runPromise(Effect.option(credentialStore.read()));
  if (saved._tag === "Some" && normalizeTuiHttpOrigin(saved.value.httpOrigin) !== origin) {
    return undefined;
  }
  return daemon.ensureRunning();
}

/** Reattaches to the local daemon, pairing through its own CLI when no usable credential exists. */
function makeLocalDaemonSupervisor(input: {
  readonly origin: string;
  readonly daemon: NonNullable<RunTuiPrototypeOptions["localDaemon"]>;
  readonly credentialStore: TuiCredentialStore;
}) {
  const pair = Effect.tryPromise({
    try: () => input.daemon.mintPairingToken(),
    catch: (error) => {
      NodeProcess.stderr.write(`${formatTuiCliError(error)}\n`);
      return new TuiEnvironmentReattachError({ failure: "rejected" });
    },
  }).pipe(
    Effect.flatMap((token) =>
      pairExistingTuiEnvironment({
        httpBaseUrl: input.origin,
        credential: new TextEncoder().encode(token),
        credentialStore: input.credentialStore,
      }),
    ),
    Effect.mapError((error) =>
      isReattachError(error) ? error : new TuiEnvironmentReattachError({ failure: "rejected" }),
    ),
  );
  return makeTuiLocalEnvironmentSupervisorWithOperations({
    reattach: () =>
      reattachAuthenticatedTuiEnvironment({
        credentialStore: input.credentialStore,
        expectedHttpBaseUrl: input.origin,
      }).pipe(
        Effect.catchIf(
          (error) => error.failure === "missing" || error.failure === "rejected",
          () => pair,
        ),
      ),
  });
}

export async function runTuiPrototype(options: RunTuiPrototypeOptions): Promise<number> {
  const stateDirectory = options.cli.newEnvironment
    ? NodePath.join(options.cli.stateDir, "standalone")
    : options.cli.stateDir;
  const credentialStore = makeTuiCredentialStore({ stateDirectory });
  if (options.cli.pairStdin && options.cli.connect) {
    const credential = await readPairingCredential(NodeProcess.stdin, options.cli.connect);
    try {
      const paired = await Effect.runPromise(
        pairExistingTuiEnvironment({
          httpBaseUrl: options.cli.connect,
          credential,
          credentialStore,
        }),
      );
      paired.bearer.clear();
      NodeProcess.stdout.write(
        "Paired with the existing T3 environment. Start the TUI again to attach.\n",
      );
      return 0;
    } finally {
      credential.fill(0);
    }
  }
  let sessionState: TuiSessionState | undefined;
  const shutdown = new TuiShutdownController();
  shutdown.attachToProcess(process);
  try {
    const localDaemonOrigin = await resolveLocalDaemonOrigin(options, credentialStore);
    const supervisor = await Effect.runPromise(
      localDaemonOrigin && options.localDaemon
        ? makeLocalDaemonSupervisor({
            origin: localDaemonOrigin,
            daemon: options.localDaemon,
            credentialStore,
          })
        : makeTuiLocalEnvironmentSupervisor({
            credentialStore,
            ...(options.cli.connect
              ? { reattach: { expectedHttpBaseUrl: options.cli.connect } }
              : {}),
            ...(options.cli.newEnvironment
              ? {
                  start: buildTuiLaunchOptions(
                    { ...options.cli, stateDir: stateDirectory },
                    {
                      executable: NodeProcess.execPath,
                      serverEntryPath: options.serverEntryPath,
                      env: NodeProcess.env,
                    },
                  ),
                }
              : {}),
          }),
    );
    return await runTuiLifecycle({
      shutdown,
      start: (signal) => Effect.runPromise(supervisor.connect, { signal }),
      render: async ({ onFatal, onInterrupt }, lease) => {
        const registry = AtomRegistry.make();
        sessionState = openTuiSessionState({
          stateDirectory,
          registry,
          environmentId: lease.environment.readiness.descriptor.environmentId,
          httpOrigin: lease.environment.readiness.httpBaseUrl,
        });
        return startRendererRuntime({
          registry,
          children: createElement(
            UiProvider,
            { capabilities: detectTerminalCapabilities(NodeProcess.env) },
            createElement(App, {
              onInterrupt,
              client: createTuiClient(lease.environment, sessionState),
            }),
          ),
          onError: onFatal,
        });
      },
      waitForChildExit: (lease) =>
        lease.ownership === "foreground"
          ? Effect.runPromise(lease.environment.child.waitForExit())
          : new Promise<never>(() => {}),
      drainChildOutput: (lease) => {
        if (lease.ownership === "foreground") {
          lease.environment.child.stdout.resume();
          lease.environment.child.stderr.resume();
        }
      },
      closeRuntime: (runtime) => runtime.close(),
      clearBearer: (lease) => lease.environment.bearer.clear(),
      terminateChild: () => Effect.runPromise(supervisor.release("terminate-owned")),
      reportError: (error) => NodeProcess.stderr.write(`${formatTuiCliError(error)}\n`),
    });
  } finally {
    sessionState?.close();
    shutdown.disposeProcessListeners();
  }
}
