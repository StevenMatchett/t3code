/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import { createElement } from "react";
import * as Effect from "effect/Effect";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import NodeProcess from "node:process";

import { startAndConnectAuthenticatedTuiEnvironment } from "../connection/authenticatedEnvironment.ts";
import { startRendererRuntime } from "../renderer/runtime.tsx";
import { runTuiLifecycle } from "./lifecycle.ts";
import { buildTuiLaunchOptions, type TuiCliOptions } from "./options.ts";
import { PrototypeApp } from "./PrototypeApp.tsx";
import { TuiShutdownController } from "./shutdown.ts";

export interface RunTuiPrototypeOptions {
  readonly cli: TuiCliOptions;
  readonly serverEntryPath: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export async function runTuiPrototype(options: RunTuiPrototypeOptions): Promise<number> {
  const shutdown = new TuiShutdownController();
  shutdown.attachToProcess(NodeProcess);
  const launch = buildTuiLaunchOptions(options.cli, {
    executable: NodeProcess.execPath,
    serverEntryPath: options.serverEntryPath,
    env: NodeProcess.env,
  });

  try {
    return await runTuiLifecycle({
      shutdown,
      start: (signal) =>
        Effect.runPromise(startAndConnectAuthenticatedTuiEnvironment(launch), { signal }),
      render: async ({ onFatal, onInterrupt }) =>
        startRendererRuntime({
          registry: AtomRegistry.make(),
          children: createElement(PrototypeApp, { onInterrupt }),
          onError: onFatal,
        }),
      waitForChildExit: (session) => Effect.runPromise(session.child.waitForExit()),
      drainChildOutput: (session) => {
        session.child.stdout.resume();
        session.child.stderr.resume();
      },
      closeRuntime: (runtime) => runtime.close(),
      clearBearer: (session) => session.bearer.clear(),
      terminateChild: (session) => {
        void session.child.terminate();
      },
      reportError: (error) => NodeProcess.stderr.write(`${errorMessage(error)}\n`),
    });
  } finally {
    shutdown.disposeProcessListeners();
  }
}
