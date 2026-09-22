import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { HostProcessPlatform, HostProcessWorkingDirectory } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../processRunner.ts";
import { executeShellCommand } from "./executeShellCommand.ts";

const live = ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer));
describe("non-interactive shell execution", () => {
  it.effect("captures stdout, stderr, working directory and a nonzero exit", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcessPlatform;
      const cwd = yield* HostProcessWorkingDirectory;
      const command =
        platform === "win32"
          ? "Write-Output (Get-Location).Path; [Console]::Error.WriteLine('problem'); exit 7"
          : "pwd; printf problem >&2; exit 7";
      const result = yield* executeShellCommand({ cwd, command }).pipe(Effect.provide(live));
      expect(result.stdout.trim()).toBe(cwd);
      expect(result.stderr).toContain("problem");
      expect(result.exitCode).toBe(7);
      expect(result.timedOut).toBe(false);
    }),
  );
  it.effect("bounds output and reports truncation", () =>
    Effect.gen(function* () {
      const cwd = yield* HostProcessWorkingDirectory;
      const platform = yield* HostProcessPlatform;
      const command =
        platform === "win32"
          ? "[Console]::Out.Write(('x' * 40000))"
          : "head -c 40000 /dev/zero | tr '\\0' x";
      const result = yield* executeShellCommand({ cwd, command }).pipe(Effect.provide(live));
      expect(result.stdout.length).toBe(32768);
      expect(result.truncated).toBe(true);
    }),
  );
});
