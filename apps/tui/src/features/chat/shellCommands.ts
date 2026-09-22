import type { TerminalExecuteResult } from "@t3tools/contracts";

export interface ShellCommandInput {
  readonly cwd: string;
  readonly command: string;
}

export function shellCommandMessage(command: string, result: TerminalExecuteResult, cwd: string) {
  return [
    `Working directory: ${cwd}`,
    "I ran this shell command:",
    command,
    "",
    result.timedOut
      ? "Timed out after 120 seconds; partial output is unavailable."
      : `Exit code: ${result.exitCode ?? "unknown"}`,
    "stdout:",
    result.stdout || "(empty)",
    "stderr:",
    result.stderr || "(empty)",
    ...(result.truncated ? ["[Output truncated]"] : []),
  ].join("\n");
}
