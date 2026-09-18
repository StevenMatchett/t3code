import type { EnvironmentId, OrchestrationThreadShell } from "@t3tools/contracts";
import { projectThreadAwareness, type AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

export type ThreadActivityPhase = AgentAwarenessPhase | "idle";

export function threadActivityPhase(
  environmentId: EnvironmentId,
  thread: Pick<
    OrchestrationThreadShell,
    | "id"
    | "title"
    | "modelSelection"
    | "session"
    | "latestTurn"
    | "updatedAt"
    | "hasPendingApprovals"
    | "hasPendingUserInput"
  >,
  live: boolean,
): ThreadActivityPhase {
  if (!live) return "stale";
  return projectThreadAwareness({ environmentId, project: { title: "" }, thread })?.phase ?? "idle";
}

export function isThreadWorking(phase: ThreadActivityPhase) {
  return phase === "running" || phase === "starting";
}
