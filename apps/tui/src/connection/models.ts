import type {
  ChatAttachment,
  ModelSelection,
  RuntimeMode,
  ProviderInteractionMode,
  ThreadId,
  ProjectId,
  TurnId,
  MessageId,
  EventId,
  CheckpointRef,
  ProviderInstanceId,
  ThreadLinkedPullRequest,
  ThreadPullRequestLink,
  OrchestrationProjectShell,
  OrchestrationMessageContext,
} from "@t3tools/contracts";
import type { ThreadHistoryMeta } from "@t3tools/client-runtime/state/threads";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import type * as Option from "effect/Option";

export interface TuiMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly attachments?: readonly ChatAttachment[] | undefined;
  readonly context?: OrchestrationMessageContext | undefined;
  readonly turnId: TurnId | null;
  readonly streaming: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface TuiActivity {
  readonly id: EventId;
  readonly tone: "info" | "tool" | "approval" | "error";
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly turnId: TurnId | null;
  readonly sequence?: number | undefined;
  readonly createdAt: string;
}
export interface TuiCheckpoint {
  readonly turnId: TurnId;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
  readonly status: "ready" | "missing" | "error" | "stale";
  readonly files: readonly {
    readonly path: string;
    readonly kind: string;
    readonly additions: number;
    readonly deletions: number;
  }[];
  readonly assistantMessageId: MessageId | null;
  readonly completedAt: string;
}
export interface TuiLatestTurn {
  readonly turnId: TurnId;
  readonly state: "running" | "interrupted" | "completed" | "error";
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly assistantMessageId: MessageId | null;
}
export interface TuiSession {
  readonly threadId: ThreadId;
  readonly status: "idle" | "starting" | "running" | "ready" | "interrupted" | "stopped" | "error";
  readonly providerName: string | null;
  readonly providerInstanceId?: ProviderInstanceId | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly activeTurnId: TurnId | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}
interface ThreadMetadata {
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly linkedPullRequest?: ThreadLinkedPullRequest | null | undefined;
  readonly branchPullRequest?: ThreadLinkedPullRequest | null | undefined;
  readonly pullRequests: readonly ThreadPullRequestLink[];
  readonly latestTurn: TuiLatestTurn | null;
  readonly session: TuiSession | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly settledOverride: "settled" | "active" | null;
  readonly settledAt: string | null;
  readonly unsettledAt?: string | null | undefined;
  readonly snoozedUntil?: string | null | undefined;
  readonly snoozedAt?: string | null | undefined;
  readonly pinnedAt?: string | null | undefined;
  readonly pinOrderKey?: string | null | undefined;
  readonly activeOrderKey?: string | null | undefined;
}
export interface TuiThreadShell extends ThreadMetadata {
  readonly latestUserMessageAt: string | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly backgroundLiveness?: "working" | "monitoring" | null | undefined;
}
export interface TuiThread extends ThreadMetadata {
  readonly messages: readonly TuiMessage[];
  readonly activities: readonly TuiActivity[];
  readonly checkpoints: readonly TuiCheckpoint[];
  readonly requests: PendingThreadRequests;
  readonly rollbackFailure?:
    | { readonly requestId: import("@t3tools/contracts").CommandId; readonly message: string }
    | null
    | undefined;
  readonly agents: readonly import("@t3tools/client-runtime/state/subagentRuntime").RuntimeSubagent[];
}
export interface TuiThreadState {
  readonly data: Option.Option<TuiThread>;
  readonly status: "empty" | "cached" | "synchronizing" | "live" | "deleted";
  readonly error: Option.Option<string>;
  readonly history: ThreadHistoryMeta;
}
export interface TuiShellState {
  readonly snapshot: Option.Option<{
    readonly projects: readonly OrchestrationProjectShell[];
    readonly threads: readonly TuiThreadShell[];
    readonly snapshotSequence: number;
    readonly updatedAt: string;
  }>;
  readonly status: "empty" | "cached" | "synchronizing" | "live";
  readonly error: Option.Option<string>;
}
