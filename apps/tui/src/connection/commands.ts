import {
  CommandId,
  MessageId,
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
});
type Intent<K extends string, V> = V & { readonly type: K };
export type TuiCommand =
  | typeof PromptCommand.Type
  | Intent<"thread.create", Commands.CreateThreadInput>
  | Intent<"project.create", Commands.CreateProjectInput>
  | Intent<"project.update", Commands.UpdateProjectInput>
  | Intent<"project.delete", Commands.DeleteProjectInput>
  | Intent<"thread.meta.update", Commands.UpdateThreadMetadataInput>
  | Intent<"thread.archive", Commands.ArchiveThreadInput>
  | Intent<"thread.unarchive", Commands.UnarchiveThreadInput>
  | Intent<"thread.delete", Commands.DeleteThreadInput>
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
    case "thread.archive":
      return yield* Commands.archiveThread(command);
    case "thread.unarchive":
      return yield* Commands.unarchiveThread(command);
    case "thread.delete":
      return yield* Commands.deleteThread(command);
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
