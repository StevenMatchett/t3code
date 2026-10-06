import {
  NodeId,
  ProviderSessionId,
  OrchestrationV2TurnItem,
  RuntimeRequestId,
} from "@t3tools/contracts";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const decodeRequestId = Schema.decodeUnknownSync(RuntimeRequestId);
const decodeItem = Schema.decodeUnknownSync(OrchestrationV2TurnItem);

/** A native V2 request paired with its display item. */
export function requestFixture(kind: string, payload: Record<string, unknown>) {
  if (!kind.includes("approval") && !kind.includes("user-input"))
    return { approvals: [], userInputs: [] };
  const requestId = decodeRequestId(payload.requestId);
  const now = DateTime.makeUnsafe("2026-01-01T00:00:00.000Z");
  const userInput = kind.includes("user-input");
  const item = decodeItem({
    ...payload,
    id: "request-item",
    threadId: "thread-0",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "pending",
    title: null,
    startedAt: now,
    completedAt: null,
    updatedAt: now,
    type: userInput ? "user_input_request" : "approval_request",
    ...(userInput
      ? {}
      : { requestKind: payload.requestKind ?? "file-read", prompt: payload.detail }),
  });
  return derivePendingThreadRequests({
    runtimeRequests: [
      {
        id: requestId,
        nodeId: NodeId.make("request-node"),
        providerTurnId: null,
        nativeRequestRef: null,
        kind: userInput ? "user_input" : "file-read",
        status: "pending",
        responseCapability: {
          type: "live",
          providerSessionId: ProviderSessionId.make("fixture-session"),
        },
        createdAt: now,
        resolvedAt: null,
      },
    ],
    turnItems: [item],
  });
}
