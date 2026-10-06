import type { TuiThreadShell } from "../../connection/models.ts";
import type { EnvironmentId } from "@t3tools/contracts";
import { type AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

export type ThreadActivityPhase = AgentAwarenessPhase | "idle";

export function threadActivityPhase(
  _environmentId: EnvironmentId,
  thread: Pick<
    TuiThreadShell,
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
  if (thread.hasPendingUserInput) return "waiting_for_input";
  if (thread.hasPendingApprovals) return "waiting_for_approval";
  if (thread.session?.status === "starting") return "starting";
  if (thread.latestTurn?.state === "running") return "running";
  if (thread.latestTurn?.state === "error") return "failed";
  if (thread.latestTurn?.state === "completed") return "completed";
  return "idle";
}

export function isThreadWorking(phase: ThreadActivityPhase) {
  return phase === "running" || phase === "starting";
}
