import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime/state/terminal";
import * as Encoding from "effect/Encoding";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";

export interface ShellCommandInput {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly command: string;
}

export function makeShellCommandRunner(
  terminals: Pick<ReturnType<typeof createTerminalEnvironmentAtoms>, "open" | "write">,
  environmentId: EnvironmentId,
) {
  return async (registry: AtomRegistry.AtomRegistry, input: ShellCommandInput) => {
    // A new shell avoids injecting commands into an existing foreground process.
    const terminalId = `shell-${Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16)))}`;
    const opened = await terminals.open.run(registry, {
      environmentId,
      input: {
        threadId: input.threadId,
        terminalId,
        cwd: input.cwd,
        worktreePath: input.worktreePath,
      },
    });
    if (!AsyncResult.isSuccess(opened))
      throw new Error("Could not open a shell. Your command was kept.");
    const written = await terminals.write.run(registry, {
      environmentId,
      input: {
        threadId: input.threadId,
        terminalId,
        data: `${input.command.replace(/\r?\n/g, "\r")}\r`,
      },
    });
    if (!AsyncResult.isSuccess(written))
      throw new Error(
        "Shell command delivery was not confirmed. Check the terminal before retrying.",
      );
    return terminalId;
  };
}
