import {
  EventId,
  TurnId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  type OrchestrationV2RunStatus,
} from "@t3tools/contracts";
import { projectedSubagentsToRuntime } from "@t3tools/client-runtime/state/subagentRuntime";
import { derivePendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { deriveThreadCheckpointSummaries } from "@t3tools/client-runtime/state/thread-checkpoints";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadState as NativeThreadState } from "@t3tools/client-runtime/state/threads";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type {
  TuiActivity,
  TuiLatestTurn,
  TuiMessage,
  TuiSession,
  TuiShellState,
  TuiThread,
  TuiThreadShell,
  TuiThreadState,
} from "./models.ts";

const iso = DateTime.formatIso;
const nullableIso = (value: DateTime.Utc | null | undefined) => (value == null ? null : iso(value));
function turnState(status: OrchestrationV2RunStatus | "idle"): TuiLatestTurn["state"] {
  if (status === "failed") return "error";
  if (status === "interrupted" || status === "cancelled") return "interrupted";
  return status === "completed" || status === "rolled_back" || status === "idle"
    ? "completed"
    : "running";
}
const shellCache = new WeakMap<OrchestrationV2ThreadShell, TuiThreadShell>();
export function presentShell(source: OrchestrationV2ThreadShell): TuiThreadShell {
  const cached = shellCache.get(source);
  if (cached) return cached;
  const latestTurn: TuiLatestTurn | null =
    source.latestRunId === null
      ? null
      : {
          turnId: TurnId.make(source.latestRunId),
          state: turnState(source.status),
          requestedAt: nullableIso(source.latestRunRequestedAt) ?? iso(source.updatedAt),
          startedAt: nullableIso(source.latestRunStartedAt),
          completedAt: nullableIso(source.latestRunCompletedAt),
          assistantMessageId: null,
        };
  const session: TuiSession = {
    threadId: source.id,
    providerName: null,
    providerInstanceId: source.providerInstanceId,
    runtimeMode: source.runtimeMode,
    activeTurnId: source.activeRunId ? TurnId.make(source.activeRunId) : null,
    status:
      source.status === "preparing" || source.status === "starting"
        ? "starting"
        : latestTurn?.state === "running"
          ? "running"
          : "ready",
    lastError: source.lastError ?? null,
    updatedAt: iso(source.updatedAt),
  };
  const result: TuiThreadShell = {
    ...source,
    pullRequests: source.pullRequests ?? [],
    latestTurn,
    session,
    createdAt: iso(source.createdAt),
    updatedAt: iso(source.updatedAt),
    archivedAt: nullableIso(source.archivedAt),
    deletedAt: nullableIso(source.deletedAt),
    settledAt: nullableIso(source.settledAt),
    unsettledAt: nullableIso(source.unsettledAt),
    snoozedAt: nullableIso(source.snoozedAt),
    snoozedUntil: nullableIso(source.snoozedUntil),
    pinnedAt: nullableIso(source.pinnedAt),
    latestUserMessageAt: nullableIso(source.latestUserMessageAt),
    hasPendingApprovals:
      source.pendingRuntimeRequest !== null &&
      source.pendingRuntimeRequest.kind !== "user_input" &&
      source.pendingRuntimeRequest.kind !== "auth_refresh",
    hasPendingUserInput: source.pendingRuntimeRequest?.kind === "user_input",
  };
  shellCache.set(source, result);
  return result;
}
const itemCache = new WeakMap<OrchestrationV2TurnItem, TuiActivity>();
function presentActivity(item: OrchestrationV2TurnItem, agentId: string | undefined): TuiActivity {
  const cached = itemCache.get(item);
  if (cached && (cached.payload as { agentId?: string }).agentId === agentId) return cached;
  const tool = [
    "command_execution",
    "file_change",
    "file_search",
    "web_search",
    "tool_call",
  ].includes(item.type);
  const detail =
    "output" in item
      ? item.output
      : "text" in item
        ? item.text
        : "message" in item
          ? item.message
          : "markdown" in item
            ? item.markdown
            : item.type === "error"
              ? item.failure.message
              : item.type === "todo_list"
                ? item.steps
                    .map((step) => `${step.status === "completed" ? "[x]" : "[ ]"} ${step.text}`)
                    .join("\n")
                : undefined;
  const summary =
    item.title ??
    (item.type === "command_execution"
      ? item.input
      : item.type === "error"
        ? item.failure.message
        : item.type === "file_change"
          ? item.fileName
          : detail || item.type.replaceAll("_", " "));
  const result: TuiActivity = {
    id: EventId.make(item.id),
    tone:
      item.type === "error"
        ? "error"
        : tool
          ? "tool"
          : item.type === "approval_request"
            ? "approval"
            : "info",
    kind: tool
      ? item.status === "running" || item.status === "pending"
        ? "tool.started"
        : "tool.completed"
      : item.type === "reasoning"
        ? "reasoning"
        : item.type,
    summary: String(summary),
    payload: {
      ...item,
      agentId,
      itemType: item.type,
      toolCallId: item.id,
      status: item.status === "running" || item.status === "pending" ? "inProgress" : item.status,
      detail,
      data: item.type === "command_execution" ? { command: item.input, output: item.output } : item,
    },
    turnId: item.runId === null ? null : TurnId.make(item.runId),
    sequence: item.ordinal,
    createdAt: iso(item.startedAt ?? item.updatedAt),
  };
  itemCache.set(item, result);
  return result;
}
type MessageItem = Extract<OrchestrationV2TurnItem, { type: "user_message" | "assistant_message" }>;
const messageCache = new WeakMap<MessageItem, TuiMessage>();
function presentMessage(item: MessageItem): TuiMessage {
  const cached = messageCache.get(item);
  if (cached) return cached;
  const message: TuiMessage = {
    id: item.messageId,
    role: item.type === "user_message" ? "user" : "assistant",
    text: item.text,
    attachments: item.attachments ?? [],
    turnId: item.runId === null ? null : TurnId.make(item.runId),
    streaming: item.type === "assistant_message" && item.streaming,
    createdAt: iso(item.startedAt ?? item.updatedAt),
    updatedAt: iso(item.updatedAt),
  };
  messageCache.set(item, message);
  return message;
}
const projectionCache = new WeakMap<OrchestrationV2ThreadProjection, TuiThread>();
export function presentThread(projection: OrchestrationV2ThreadProjection): TuiThread {
  const cached = projectionCache.get(projection);
  if (cached) return cached;
  const source = projection.thread;
  const visible = projection.visibleTurnItems.map((row) => row.item);
  const messages = visible.flatMap((item) =>
    item.type === "user_message" || item.type === "assistant_message" ? [presentMessage(item)] : [],
  );
  const nodes = new Map(projection.nodes.map((node) => [node.id, node]));
  const agents = new Set(projection.subagents.map((agent) => agent.id));
  const providerAgents = new Map(
    projection.subagents.flatMap((agent) =>
      agent.providerThreadId === null ? [] : [[agent.providerThreadId, agent.id] as const],
    ),
  );
  const agentForItem = (item: OrchestrationV2TurnItem) => {
    let nodeId = item.nodeId;
    const seen = new Set<string>();
    while (nodeId !== null && !seen.has(nodeId)) {
      if (agents.has(nodeId)) return nodeId;
      seen.add(nodeId);
      nodeId = nodes.get(nodeId)?.parentNodeId ?? null;
    }
    return item.providerThreadId == null ? undefined : providerAgents.get(item.providerThreadId);
  };
  const runs = projection.runs.filter(
    (run) => run.status !== "rolled_back" && run.status !== "queued" && run.status !== "cancelled",
  );
  const retainedRunIds = new Set(runs.map((run) => run.id));
  const run = runs.reduce<(typeof runs)[number] | null>(
    (latest, candidate) => (!latest || candidate.ordinal > latest.ordinal ? candidate : latest),
    null,
  );
  const latestTurn: TuiLatestTurn | null = run
    ? {
        turnId: TurnId.make(run.id),
        state: turnState(run.status),
        requestedAt: iso(run.requestedAt),
        startedAt: nullableIso(run.startedAt),
        completedAt: nullableIso(run.completedAt),
        assistantMessageId:
          messages.findLast(
            (message) => message.role === "assistant" && message.turnId === TurnId.make(run.id),
          )?.id ?? null,
      }
    : null;
  const result: TuiThread = {
    ...source,
    pullRequests: source.pullRequests ?? [],
    createdAt: iso(source.createdAt),
    updatedAt: iso(source.updatedAt),
    archivedAt: nullableIso(source.archivedAt),
    deletedAt: nullableIso(source.deletedAt),
    settledAt: nullableIso(source.settledAt),
    unsettledAt: nullableIso(source.unsettledAt),
    snoozedAt: nullableIso(source.snoozedAt),
    snoozedUntil: nullableIso(source.snoozedUntil),
    pinnedAt: nullableIso(source.pinnedAt),
    latestTurn,
    messages,
    activities: visible
      .filter((item) => !["user_message", "assistant_message", "checkpoint"].includes(item.type))
      .map((item) => presentActivity(item, agentForItem(item))),
    checkpoints: deriveThreadCheckpointSummaries(projection)
      .filter((checkpoint) => retainedRunIds.has(checkpoint.runId))
      .map((checkpoint) => ({ ...checkpoint, turnId: TurnId.make(checkpoint.runId) })),
    agents: projectedSubagentsToRuntime(projection.subagents),
    requests: derivePendingThreadRequests(projection),
    session: run
      ? {
          threadId: source.id,
          status:
            run.status === "starting" || run.status === "preparing"
              ? "starting"
              : latestTurn?.state === "running"
                ? "running"
                : "ready",
          providerName: null,
          providerInstanceId: source.providerInstanceId,
          runtimeMode: source.runtimeMode,
          activeTurnId: latestTurn?.state === "running" ? TurnId.make(run.id) : null,
          lastError: null,
          updatedAt: iso(projection.updatedAt),
        }
      : null,
  };
  projectionCache.set(projection, result);
  return result;
}
export function presentShellState(state: EnvironmentShellState): TuiShellState {
  return {
    ...state,
    snapshot: Option.map(state.snapshot, (snapshot) => ({
      ...snapshot,
      threads: snapshot.threads.map(presentShell),
      updatedAt: snapshot.threads.reduce(
        (latest, thread) => (iso(thread.updatedAt) > latest ? iso(thread.updatedAt) : latest),
        "",
      ),
    })),
  };
}
export function presentThreadState(state: NativeThreadState): TuiThreadState {
  return { ...state, data: Option.map(state.data, presentThread) };
}
