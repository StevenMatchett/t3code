import { describe, expect, it } from "vite-plus/test";
import {
  MessageId,
  PlanId,
  RunId,
  TurnItemId,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { presentThread, presentShell } from "./presentation.ts";

const v2Now = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
const v2ProjectId = ProjectId.make("project-v2");
const v2ThreadId = ThreadId.make("thread-v2");
const v2ProviderInstanceId = ProviderInstanceId.make("codex");

const v2ThreadShell: OrchestrationV2ThreadShell = {
  id: v2ThreadId,
  projectId: v2ProjectId,
  title: "Thread",
  providerInstanceId: v2ProviderInstanceId,
  modelSelection: { instanceId: v2ProviderInstanceId, model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { rootThreadId: v2ThreadId, parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: v2Now,
  updatedAt: v2Now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};

const v2Projection: OrchestrationV2ThreadProjection = {
  thread: {
    id: v2ThreadShell.id,
    projectId: v2ThreadShell.projectId,
    title: v2ThreadShell.title,
    providerInstanceId: v2ThreadShell.providerInstanceId,
    modelSelection: v2ThreadShell.modelSelection,
    runtimeMode: v2ThreadShell.runtimeMode,
    interactionMode: v2ThreadShell.interactionMode,
    branch: v2ThreadShell.branch,
    worktreePath: v2ThreadShell.worktreePath,
    activeProviderThreadId: v2ThreadShell.activeProviderThreadId,
    lineage: v2ThreadShell.lineage,
    forkedFrom: v2ThreadShell.forkedFrom,
    createdBy: v2ThreadShell.createdBy,
    creationSource: v2ThreadShell.creationSource,
    createdAt: v2Now,
    updatedAt: v2Now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  },
  runs: [],
  attempts: [],
  nodes: [],
  subagents: [],
  providerSessions: [],
  providerThreads: [],
  providerTurns: [],
  runtimeRequests: [],
  messages: [],
  plans: [],
  turnItems: [],
  checkpointScopes: [],
  checkpoints: [],
  contextHandoffs: [],
  contextTransfers: [],
  visibleTurnItems: [],
  updatedAt: v2Now,
};

const run: OrchestrationV2Run = {
  id: RunId.make("run-1"),
  threadId: v2Projection.thread.id,
  ordinal: 1,
  providerInstanceId: v2Projection.thread.providerInstanceId,
  modelSelection: v2Projection.thread.modelSelection,
  providerThreadId: null,
  userMessageId: MessageId.make("user-1"),
  rootNodeId: null,
  activeAttemptId: null,
  status: "running",
  requestedAt: v2Now,
  startedAt: v2Now,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
};
const message: OrchestrationV2TurnItem = {
  id: TurnItemId.make("assistant-item"),
  threadId: run.threadId,
  runId: run.id,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "running",
  title: null,
  startedAt: v2Now,
  completedAt: null,
  updatedAt: v2Now,
  type: "assistant_message",
  messageId: MessageId.make("assistant-1"),
  text: "Working",
  streaming: true,
};
const tool: OrchestrationV2TurnItem = {
  ...message,
  id: TurnItemId.make("tool-item"),
  type: "command_execution",
  input: "pwd",
  output: "/workspace",
  exitCode: 0,
  status: "completed",
};
const row = (item: OrchestrationV2TurnItem, position = 0) => ({
  position,
  visibility: "local" as const,
  sourceThreadId: item.threadId,
  sourceItemId: item.id,
  item,
});

describe("native orchestration presentation", () => {
  it("renders visible streaming messages and tool output, preserving unchanged item identities", () => {
    const projection = {
      ...v2Projection,
      runs: [run],
      turnItems: [message, tool],
      visibleTurnItems: [row(message), row(tool, 1)],
    };
    const thread = presentThread(projection);
    expect(thread.messages[0]).toMatchObject({ text: "Working", streaming: true, turnId: run.id });
    expect(thread.activities[0]).toMatchObject({
      kind: "tool.completed",
      payload: { data: { command: "pwd", output: "/workspace" } },
    });
    expect(thread.latestTurn).toMatchObject({
      state: "running",
      assistantMessageId: message.messageId,
    });
    expect(presentThread(projection)).toBe(thread);
    const updated = presentThread({
      ...projection,
      thread: { ...projection.thread, title: "Renamed" },
    });
    expect(updated.messages[0]).toBe(thread.messages[0]);
    expect(updated.activities[0]).toBe(thread.activities[0]);
  });

  it("does not restore hidden messages or a rolled-back run from retained history", () => {
    const thread = presentThread({
      ...v2Projection,
      runs: [{ ...run, status: "rolled_back" }],
      turnItems: [message],
      visibleTurnItems: [],
    });
    expect(thread.messages).toEqual([]);
    expect(thread.latestTurn).toBeNull();
    expect(thread.session).toBeNull();
  });

  it("presents the latest run's proposed plan over a newer one from an older run", () => {
    const plan = (id: string, runId: string | null, status: "active" | "superseded") =>
      ({
        id: PlanId.make(id),
        threadId: v2ThreadId,
        runId: runId === null ? null : RunId.make(runId),
        nodeId: run.rootNodeId,
        status,
        kind: "proposed_plan",
        markdown: `# ${id}`,
      }) as OrchestrationV2ThreadProjection["plans"][number];
    const thread = presentThread({
      ...v2Projection,
      runs: [run],
      plans: [plan("current", run.id, "active"), plan("old", "older-run", "superseded")],
    });
    expect(thread.proposedPlan).toEqual({ id: "current", markdown: "# current", status: "active" });
    expect(presentThread({ ...v2Projection, plans: [] }).proposedPlan).toBeNull();
  });

  it("reports context use from the active provider thread only", () => {
    const providerThreadId = "provider-1";
    const projection = {
      ...v2Projection,
      thread: { ...v2Projection.thread, activeProviderThreadId: providerThreadId },
      providerThreads: [
        { id: "provider-0", contextUsage: { usedTokens: 1 } },
        { id: providerThreadId, contextUsage: { usedTokens: 50_000, maxTokens: 200_000 } },
      ],
    } as unknown as OrchestrationV2ThreadProjection;
    expect(presentThread(projection).contextUsage).toEqual({
      usedTokens: 50_000,
      maxTokens: 200_000,
      percent: 25,
    });
    expect(presentThread(v2Projection).contextUsage).toBeNull();
  });

  it("keeps a waiting secret request out of the transcript and answers show their outcome", () => {
    const secret = (
      id: string,
      secretStatus: "pending" | "saved",
    ): Extract<OrchestrationV2TurnItem, { type: "secret_request" }> =>
      ({
        ...tool,
        id: TurnItemId.make(id),
        type: "secret_request",
        label: "GitHub token",
        reason: "To open the pull request",
        secretStatus,
      }) as Extract<OrchestrationV2TurnItem, { type: "secret_request" }>;
    const thread = presentThread({
      ...v2Projection,
      turnItems: [secret("waiting", "pending"), secret("done", "saved")],
      visibleTurnItems: [
        row(secret("waiting", "pending"), 0),
        row(secret("done", "saved"), 1),
        { ...row(secret("forked", "pending"), 2), visibility: "inherited" },
      ],
    });
    expect(thread.secretRequests?.map((request) => request.id)).toEqual(["waiting"]);
    expect(thread.activities.map((activity) => activity.summary)).toEqual([
      "GitHub token · Saved securely and kept private",
      "GitHub token · Waiting for an answer in the original thread",
    ]);
  });

  it("uses native shell request state and timestamps", () => {
    const shell = {
      ...v2ThreadShell,
      latestRunId: run.id,
      activeRunId: run.id,
      status: "running" as const,
    };
    const result = presentShell(shell);
    expect(result.latestTurn).toMatchObject({ turnId: run.id, state: "running" });
    expect(result.createdAt).toBe("2026-06-20T00:00:00.000Z");
    expect(presentShell(shell)).toBe(result);
  });
});
