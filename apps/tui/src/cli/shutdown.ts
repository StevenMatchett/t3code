/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

export type TuiShutdownReason =
  | { readonly kind: "signal"; readonly signal: "SIGINT" | "SIGTERM" }
  | { readonly kind: "fatal"; readonly error: unknown };

export class TuiShutdownController {
  readonly abortController = new AbortController();
  readonly requested: Promise<TuiShutdownReason>;
  #resolve!: (reason: TuiShutdownReason) => void;
  #reason: TuiShutdownReason | undefined;
  #disposeProcessListeners: (() => void) | undefined;

  constructor() {
    this.requested = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  request(reason: TuiShutdownReason): void {
    if (this.#reason !== undefined) return;
    this.#reason = reason;
    this.abortController.abort();
    this.#resolve(reason);
  }

  get reason(): TuiShutdownReason | undefined {
    return this.#reason;
  }

  attachToProcess(process: NodeJS.Process): void {
    this.disposeProcessListeners();
    const onSigint = () => this.request({ kind: "signal", signal: "SIGINT" });
    const onSigterm = () => this.request({ kind: "signal", signal: "SIGTERM" });
    const onUncaughtException = (error: Error) => this.request({ kind: "fatal", error });
    const onUnhandledRejection = (error: unknown) => this.request({ kind: "fatal", error });

    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    process.once("uncaughtException", onUncaughtException);
    process.once("unhandledRejection", onUnhandledRejection);
    this.#disposeProcessListeners = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      process.off("uncaughtException", onUncaughtException);
      process.off("unhandledRejection", onUnhandledRejection);
    };
  }

  disposeProcessListeners(): void {
    this.#disposeProcessListeners?.();
    this.#disposeProcessListeners = undefined;
  }
}
