import type { TuiShutdownController, TuiShutdownReason } from "./shutdown.ts";

export interface TuiChildExit {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface TuiLifecycleRenderEvents {
  readonly onFatal: (error: unknown) => void;
  readonly onInterrupt: () => void;
}

export interface TuiLifecycleDependencies<Session, Runtime> {
  readonly shutdown: TuiShutdownController;
  readonly start: (signal: AbortSignal) => Promise<Session>;
  readonly render: (events: TuiLifecycleRenderEvents, session: Session) => Promise<Runtime>;
  readonly waitForChildExit: (session: Session) => Promise<TuiChildExit>;
  readonly drainChildOutput: (session: Session) => void;
  readonly closeRuntime: (runtime: Runtime) => Promise<void>;
  readonly clearBearer: (session: Session) => void;
  readonly terminateChild: (session: Session) => void | Promise<void>;
  readonly reportError: (error: unknown) => void;
}

type LifecycleReason =
  | TuiShutdownReason
  | { readonly kind: "child-exit"; readonly exit: TuiChildExit };

const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;

function reasonExitCode(reason: LifecycleReason): number {
  switch (reason.kind) {
    case "signal":
      return signalExitCodes[reason.signal];
    case "fatal":
      return 1;
    case "child-exit":
      return reason.exit.exitCode === 0 ? 0 : (reason.exit.exitCode ?? 1);
  }
}

export async function runTuiLifecycle<Session, Runtime>(
  dependencies: TuiLifecycleDependencies<Session, Runtime>,
): Promise<number> {
  let session: Session | undefined;
  let runtime: Runtime | undefined;
  let exitCode = 1;
  const errors: unknown[] = [];

  try {
    session = await dependencies.start(dependencies.shutdown.abortController.signal);
    dependencies.drainChildOutput(session);
    runtime = await dependencies.render(
      {
        onFatal: (error) => dependencies.shutdown.request({ kind: "fatal", error }),
        onInterrupt: () => dependencies.shutdown.request({ kind: "signal", signal: "SIGINT" }),
      },
      session,
    );

    const reason = await Promise.race<LifecycleReason>([
      dependencies.shutdown.requested,
      dependencies.waitForChildExit(session).then((exit) => ({ kind: "child-exit", exit })),
    ]);
    exitCode = reasonExitCode(reason);
    if (reason.kind === "fatal") errors.push(reason.error);
  } catch (error) {
    const requested = dependencies.shutdown.reason;
    if (requested?.kind === "signal") {
      exitCode = signalExitCodes[requested.signal];
    } else {
      errors.push(requested?.kind === "fatal" ? requested.error : error);
      exitCode = 1;
    }
  } finally {
    if (runtime !== undefined) {
      try {
        await dependencies.closeRuntime(runtime);
      } catch (error) {
        errors.push(error);
        exitCode = 1;
      }
    }
    if (session !== undefined) {
      try {
        dependencies.clearBearer(session);
      } catch (error) {
        errors.push(error);
        exitCode = 1;
      }
      try {
        await dependencies.terminateChild(session);
      } catch (error) {
        errors.push(error);
        exitCode = 1;
      }
    }
  }

  for (const error of errors) dependencies.reportError(error);
  return exitCode;
}
