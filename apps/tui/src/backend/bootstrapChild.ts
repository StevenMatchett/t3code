/// <reference types="node" />
// @effect-diagnostics nodeBuiltinImport:off

import {
  DesktopBackendBootstrap as DesktopBackendBootstrapSchema,
  type DesktopBackendBootstrap,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Schema from "effect/Schema";
import {
  spawn as spawnNodeChild,
  type ChildProcess,
  type SpawnOptions,
  type StdioOptions,
} from "node:child_process";
import { randomFillSync } from "node:crypto";
import type { Readable, Writable } from "node:stream";

const BOOTSTRAP_SECRET_BYTES = 24;

export const BootstrapDelivery = Schema.Literals(["fd3", "stdin"]);
export type BootstrapDelivery = typeof BootstrapDelivery.Type;

export const BootstrapChildStartPhase = Schema.Literals([
  "secret-generation",
  "envelope-encoding",
  "child-spawn",
  "bootstrap-write",
]);
export type BootstrapChildStartPhase = typeof BootstrapChildStartPhase.Type;

export class BootstrapChildStartError extends Schema.TaggedError<BootstrapChildStartError>()(
  "BootstrapChildStartError",
  {
    phase: BootstrapChildStartPhase,
    pid: Schema.optionalKey(Schema.Int),
    exitCode: Schema.optionalKey(Schema.Int),
    signal: Schema.optionalKey(Schema.String),
    systemCode: Schema.optionalKey(Schema.String),
  },
) {
  override get message(): string {
    switch (this.phase) {
      case "secret-generation":
        return "Failed to generate the child bootstrap secret.";
      case "envelope-encoding":
        return "Failed to encode the child bootstrap envelope.";
      case "child-spawn":
        return "Failed to spawn the child process.";
      case "bootstrap-write":
        return "Failed to write the child bootstrap envelope.";
    }
  }
}

export class BootstrapSecretClearedError extends Schema.TaggedError<BootstrapSecretClearedError>()(
  "BootstrapSecretClearedError",
  {},
) {
  override get message(): string {
    return "The child bootstrap secret has been cleared.";
  }
}

export interface BootstrapChildExit {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface StartBootstrapChildOptions {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly delivery: BootstrapDelivery;
  readonly bootstrap: Omit<DesktopBackendBootstrap, "desktopBootstrapToken">;
}

class BootstrapSecret {
  readonly #bytes: Uint8Array;
  #cleared = false;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  use<A, E, R>(
    f: (token: string) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | BootstrapSecretClearedError, R> {
    return Effect.suspend((): Effect.Effect<A, E | BootstrapSecretClearedError, R> =>
      this.#cleared ? Effect.fail(new BootstrapSecretClearedError()) : f(this.encode()),
    );
  }

  encode(): string {
    return Encoding.encodeHex(this.#bytes);
  }

  clear(): void {
    this.#bytes.fill(0);
    this.#cleared = true;
  }

  get cleared(): boolean {
    return this.#cleared;
  }
}

export class OwnedBootstrapChild {
  readonly pid: number;
  readonly bootstrapFd: 0 | 3;
  readonly #child: ChildProcess;
  readonly #bootstrapSecret: BootstrapSecret;

  constructor(child: ChildProcess, delivery: BootstrapDelivery, bootstrapSecret: BootstrapSecret) {
    if (child.pid === undefined) {
      throw new Error("A spawned bootstrap child must have a PID.");
    }
    this.pid = child.pid;
    this.bootstrapFd = delivery === "fd3" ? 3 : 0;
    this.#child = child;
    this.#bootstrapSecret = bootstrapSecret;
  }

  get stdout(): Readable {
    if (this.#child.stdout === null) {
      throw new Error("The bootstrap child stdout pipe is unavailable.");
    }
    return this.#child.stdout;
  }

  get stderr(): Readable {
    if (this.#child.stderr === null) {
      throw new Error("The bootstrap child stderr pipe is unavailable.");
    }
    return this.#child.stderr;
  }

  isOwnedPid(pid: number): boolean {
    return pid === this.pid;
  }

  useBootstrapToken<A, E, R>(
    f: (token: string) => Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | BootstrapSecretClearedError, R> {
    return this.#bootstrapSecret.use(f);
  }

  clearBootstrapSecret(): void {
    this.#bootstrapSecret.clear();
  }

  isBootstrapSecretCleared(): boolean {
    return this.#bootstrapSecret.cleared;
  }

  waitForExit(): Effect.Effect<BootstrapChildExit> {
    return Effect.callback<BootstrapChildExit>((resume) => {
      if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
        resume(
          Effect.succeed({
            exitCode: this.#child.exitCode,
            signal: this.#child.signalCode,
          }),
        );
        return;
      }

      const onExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        resume(Effect.succeed({ exitCode, signal }));
      };
      this.#child.once("exit", onExit);
      return Effect.sync(() => this.#child.off("exit", onExit));
    });
  }

  terminate(signal: NodeJS.Signals = "SIGTERM"): boolean {
    return this.#child.kill(signal);
  }

  toJSON(): { readonly pid: number; readonly bootstrapFd: 0 | 3 } {
    return { pid: this.pid, bootstrapFd: this.bootstrapFd };
  }
}

const encodeBootstrapEnvelope = Schema.encodeEffect(
  Schema.fromJsonString(DesktopBackendBootstrapSchema),
);

const bootstrapFd = (delivery: BootstrapDelivery): 0 | 3 => (delivery === "fd3" ? 3 : 0);

function systemCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

function isWritable(value: Readable | Writable | null | undefined): value is Writable {
  return value !== null && value !== undefined && "end" in value && typeof value.end === "function";
}

function childStdio(delivery: BootstrapDelivery): StdioOptions {
  return delivery === "fd3" ? ["ignore", "pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"];
}

const spawnAndWriteBootstrap = Effect.fn("tui.backend.spawnAndWriteBootstrap")(function* (input: {
  readonly options: StartBootstrapChildOptions;
  readonly payload: Uint8Array;
  readonly secret: BootstrapSecret;
}): Effect.fn.Return<OwnedBootstrapChild, BootstrapChildStartError> {
  return yield* Effect.callback<OwnedBootstrapChild, BootstrapChildStartError>((resume) => {
    const fd = bootstrapFd(input.options.delivery);
    const args = [...input.options.args, "--bootstrap-fd", String(fd)];
    const spawnOptions: SpawnOptions = {
      stdio: childStdio(input.options.delivery),
      detached: false,
      windowsHide: true,
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
      ...(input.options.env === undefined ? {} : { env: { ...input.options.env } }),
    };
    let child: ChildProcess;
    let bootstrapInput: Writable | undefined;
    let settled = false;

    const stopSpawnedChild = () => {
      if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill();
      }
    };
    const fail = (error: BootstrapChildStartError) => {
      if (settled) return;
      settled = true;
      cleanup();
      bootstrapInput?.on("error", () => undefined);
      stopSpawnedChild();
      resume(Effect.fail(error));
    };
    const onChildError = (error: Error) => {
      const code = systemCode(error);
      fail(
        new BootstrapChildStartError({
          phase: "child-spawn",
          ...(code === undefined ? {} : { systemCode: code }),
        }),
      );
    };
    const onBootstrapError = (error: Error) => {
      const code = systemCode(error);
      fail(
        new BootstrapChildStartError({
          phase: "bootstrap-write",
          ...(child.pid === undefined ? {} : { pid: child.pid }),
          ...(code === undefined ? {} : { systemCode: code }),
        }),
      );
    };
    const onEarlyExit = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      fail(
        new BootstrapChildStartError({
          phase: "bootstrap-write",
          ...(child.pid === undefined ? {} : { pid: child.pid }),
          ...(exitCode === null ? {} : { exitCode }),
          ...(signal === null ? {} : { signal }),
        }),
      );
    };
    const onSpawn = () => {
      if (settled) return;
      const candidate = fd === 0 ? child.stdin : child.stdio[fd];
      if (!isWritable(candidate)) {
        fail(
          new BootstrapChildStartError({
            phase: "bootstrap-write",
            ...(child.pid === undefined ? {} : { pid: child.pid }),
          }),
        );
        return;
      }

      bootstrapInput = candidate;
      child.once("exit", onEarlyExit);
      bootstrapInput.once("error", onBootstrapError);
      bootstrapInput.write(input.payload, (error) => {
        if (settled) return;
        if (error) {
          onBootstrapError(error);
          return;
        }
        bootstrapInput?.end(() => {
          if (settled) return;
          settled = true;
          cleanup();
          resume(
            Effect.succeed(new OwnedBootstrapChild(child, input.options.delivery, input.secret)),
          );
        });
      });
    };
    const cleanup = () => {
      child?.off("error", onChildError);
      child?.off("spawn", onSpawn);
      child?.off("exit", onEarlyExit);
      bootstrapInput?.off("error", onBootstrapError);
    };

    try {
      child = spawnNodeChild(input.options.executable, args, spawnOptions);
    } catch (error) {
      const code = systemCode(error);
      resume(
        Effect.fail(
          new BootstrapChildStartError({
            phase: "child-spawn",
            ...(code === undefined ? {} : { systemCode: code }),
          }),
        ),
      );
      return;
    }

    child.once("error", onChildError);
    child.once("spawn", onSpawn);

    return Effect.sync(() => {
      if (settled) return;
      settled = true;
      cleanup();
      stopSpawnedChild();
    });
  });
});

export const startBootstrapChild = Effect.fn("tui.backend.startBootstrapChild")(function* (
  options: StartBootstrapChildOptions,
): Effect.fn.Return<OwnedBootstrapChild, BootstrapChildStartError> {
  const secretBytes = yield* Effect.try({
    try: () => randomFillSync(new Uint8Array(BOOTSTRAP_SECRET_BYTES)),
    catch: () => new BootstrapChildStartError({ phase: "secret-generation" }),
  });
  const secret = new BootstrapSecret(secretBytes);

  return yield* Effect.gen(function* () {
    const envelope = yield* encodeBootstrapEnvelope({
      ...options.bootstrap,
      desktopBootstrapToken: secret.encode(),
    }).pipe(Effect.mapError(() => new BootstrapChildStartError({ phase: "envelope-encoding" })));
    const payload = new TextEncoder().encode(`${envelope}\n`);
    return yield* spawnAndWriteBootstrap({ options, payload, secret }).pipe(
      Effect.ensuring(Effect.sync(() => payload.fill(0))),
    );
  }).pipe(Effect.tapError(() => Effect.sync(() => secret.clear())));
});
