import {
  CommandId,
  MessageId,
  PlanId,
  ThreadId,
  RuntimeMode,
  ProviderInteractionMode,
  ModelSelection,
  ChatAttachment,
  UploadChatAttachment,
} from "@t3tools/contracts";
import * as Commands from "@t3tools/client-runtime/operations";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// Persisted composer intents are independent of the server's wire protocol.
export const PromptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: Schema.String,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(Schema.Union([UploadChatAttachment, ChatAttachment])),
  }),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  sourceProposedPlan: Schema.optionalKey(Schema.Struct({ threadId: ThreadId, planId: PlanId })),
});
type Intent<K extends string, V> = V & { readonly type: K };
export type TuiCommand =
  | typeof PromptCommand.Type
  | Intent<"thread.create", Commands.CreateThreadInput>
  | Intent<"project.create", Commands.CreateProjectInput>
  | Intent<"project.update", Commands.UpdateProjectInput>
  | Intent<"project.delete", Commands.DeleteProjectInput>
  | Intent<"thread.meta.update", Commands.UpdateThreadMetadataInput>
  | Intent<"thread.fork", Commands.ForkThreadFromRunInput>
  | Intent<"thread.archive", Commands.ArchiveThreadInput>
  | Intent<"thread.unarchive", Commands.UnarchiveThreadInput>
  | Intent<"thread.delete", Commands.DeleteThreadInput>
  | Intent<"thread.settle", Commands.SettleThreadInput>
  | Intent<"thread.unsettle", Commands.UnsettleThreadInput>
  | Intent<"thread.snooze", Commands.SnoozeThreadInput>
  | Intent<"thread.unsnooze", Commands.UnsnoozeThreadInput>
  | Intent<"thread.pin", Commands.PinThreadInput>
  | Intent<"thread.unpin", Commands.UnpinThreadInput>
  | Intent<"thread.pin.reorder", Commands.ReorderPinnedThreadInput>
  | Intent<"thread.active.reorder", Commands.ReorderActiveThreadInput>
  | Intent<"thread.auto-settle.set", Commands.SetThreadAutoSettleInput>
  | Intent<"thread.visit", Commands.VisitThreadInput>
  | Intent<"thread.mark-unread", Commands.MarkThreadUnreadInput>
  | Intent<"thread.runtime-mode.set", Commands.SetThreadRuntimeModeInput>
  | Intent<"thread.interaction-mode.set", Commands.SetThreadInteractionModeInput>
  | Intent<"thread.turn.interrupt", Commands.InterruptThreadTurnInput>
  | Intent<"thread.approval.respond", Commands.RespondToThreadApprovalInput>
  | Intent<"thread.user-input.respond", Commands.RespondToThreadUserInputInput>
  | Intent<
      "thread.checkpoint.revert" | "thread.conversation.revert",
      Commands.RevertThreadCheckpointInput
    >;

export const executeTuiCommand = Effect.fn("tui.executeCommand")(function* (command: TuiCommand) {
  switch (command.type) {
    case "thread.turn.start":
      return yield* Commands.startThreadTurn(command);
    case "thread.create":
      return yield* Commands.createThread(command);
    case "project.create":
      return yield* Commands.createProject(command);
    case "project.update":
      return yield* Commands.updateProject(command);
    case "project.delete":
      return yield* Commands.deleteProject(command);
    case "thread.meta.update":
      return yield* Commands.updateThreadMetadata(command);
    case "thread.fork":
      return yield* Commands.forkThreadFromRun(command);
    case "thread.archive":
      return yield* Commands.archiveThread(command);
    case "thread.unarchive":
      return yield* Commands.unarchiveThread(command);
    case "thread.delete":
      return yield* Commands.deleteThread(command);
    case "thread.settle":
      return yield* Commands.settleThread(command);
    case "thread.unsettle":
      return yield* Commands.unsettleThread(command);
    case "thread.snooze":
      return yield* Commands.snoozeThread(command);
    case "thread.unsnooze":
      return yield* Commands.unsnoozeThread(command);
    case "thread.pin":
      return yield* Commands.pinThread(command);
    case "thread.unpin":
      return yield* Commands.unpinThread(command);
    case "thread.pin.reorder":
      return yield* Commands.reorderPinnedThread(command);
    case "thread.active.reorder":
      return yield* Commands.reorderActiveThread(command);
    case "thread.auto-settle.set":
      return yield* Commands.setThreadAutoSettle(command);
    case "thread.visit":
      return yield* Commands.visitThread(command);
    case "thread.mark-unread":
      return yield* Commands.markThreadUnread(command);
    case "thread.runtime-mode.set":
      return yield* Commands.setThreadRuntimeMode(command);
    case "thread.interaction-mode.set":
      return yield* Commands.setThreadInteractionMode(command);
    case "thread.turn.interrupt":
      return yield* Commands.interruptThreadTurn(command);
    case "thread.approval.respond":
      return yield* Commands.respondToThreadApproval(command);
    case "thread.user-input.respond":
      return yield* Commands.respondToThreadUserInput(command);
    case "thread.checkpoint.revert":
    case "thread.conversation.revert":
      return yield* Commands.revertThreadCheckpoint({
        ...command,
        restoreFiles: command.type === "thread.checkpoint.revert",
      });
  }
});
