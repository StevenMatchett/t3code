import { CommandId } from "@t3tools/contracts";
import type { TuiThread, TuiThreadShell } from "../models.ts";
import type { OrchestrationThread, OrchestrationThreadShell } from "./contracts.ts";
import { derivePendingRequests } from "./pendingRequests.ts";
import { foldSubagentActivities } from "./subagentRuntime.ts";

const shellCache = new WeakMap<OrchestrationThreadShell, TuiThreadShell>();
export function presentV1Shell(thread: OrchestrationThreadShell): TuiThreadShell {
  const cached = shellCache.get(thread);
  if (cached) return cached;
  const value = { ...thread, deletedAt: null, pullRequests: thread.pullRequests ?? [] };
  shellCache.set(thread, value);
  return value;
}
const cache = new WeakMap<OrchestrationThread, TuiThread>();
export function presentV1Thread(thread: OrchestrationThread): TuiThread {
  const cached = cache.get(thread);
  if (cached) return cached;
  const pending = derivePendingRequests(thread.activities);
  const failure = thread.activities.findLast(
    (activity) => activity.kind === "checkpoint.revert.failed",
  );
  const payload = failure?.payload;
  const result: TuiThread = {
    rollbackFailure: failure
      ? {
          requestId: CommandId.make(failure.id),
          message:
            typeof payload === "object" &&
            payload !== null &&
            "detail" in payload &&
            typeof payload.detail === "string"
              ? payload.detail
              : failure.summary,
        }
      : null,
    ...thread,
    pullRequests: thread.pullRequests ?? [],
    messages: thread.messages.map((message) => ({
      ...message,
      role: message.role === "reasoning" ? "system" : message.role,
    })),
    requests: {
      approvals: pending.approvals.map((approval) => ({ ...approval, responseCapability: "live" })),
      userInputs: pending.userInputs.map((input) => ({
        ...input,
        responseCapability: input.dismissible ? "message" : "live",
        questions: input.questions.map((question) => ({
          ...question,
          multiSelect: question.multiSelect ?? false,
        })),
      })),
    },
    agents: foldSubagentActivities(thread.activities, {
      sessionLive:
        thread.session?.status === "running" ||
        thread.session?.status === "ready" ||
        thread.session?.status === "starting",
    }),
  };
  cache.set(thread, result);
  return result;
}
