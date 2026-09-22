import { TerminalExecuteError, type TerminalExecuteResult } from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as ProcessRunner from "../processRunner.ts";

export const executeShellCommand = Effect.fn("terminal.executeShellCommand")(function* (input: {
  readonly cwd: string;
  readonly command: string;
}) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  const result = yield* runner
    .run({
      command: platform === "win32" ? "powershell.exe" : env.SHELL || "/bin/sh",
      args:
        platform === "win32"
          ? ["-NoProfile", "-NonInteractive", "-Command", input.command]
          : ["-c", input.command],
      cwd: input.cwd,
      timeout: "120 seconds",
      timeoutBehavior: "timedOutResult",
      maxOutputBytes: 32_768,
      outputMode: "truncate",
    })
    .pipe(
      Effect.mapError(
        () =>
          new TerminalExecuteError({
            message: "Could not execute the shell command. Check its working directory and shell.",
          }),
      ),
    );
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code,
    timedOut: result.timedOut,
    truncated: result.stdoutTruncated || result.stderrTruncated,
  } satisfies TerminalExecuteResult;
});
