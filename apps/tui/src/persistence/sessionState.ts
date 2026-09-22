import {
  ClientOrchestrationCommand,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { Atom } from "effect/unstable/reactivity";
import type { ShellState } from "../app/state.ts";
import type { ThreadInteractionState } from "../features/chat/interactions.ts";

const PromptCommand = ClientOrchestrationCommand.pipe(Schema.toTaggedUnion("type")).cases[
  "thread.turn.start"
];
export const SavedInteraction = Schema.Struct({
  draft: Schema.String,
  pastes: Schema.Array(
    Schema.Struct({ id: Schema.String, marker: Schema.String, text: Schema.String }),
  ),
  attachments: PromptCommand.fields.message.fields.attachments,
  skill: Schema.NullOr(
    Schema.Struct({
      instanceId: ProviderInstanceId,
      name: Schema.String,
      path: Schema.String,
      prefix: Schema.String,
    }),
  ),
  queue: Schema.Array(
    Schema.Struct({
      command: PromptCommand,
      attachments: PromptCommand.fields.message.fields.attachments,
      afterTool: Schema.NullOr(Schema.String),
      afterTurn: Schema.String,
      status: Schema.Literals(["queued", "sending", "held"]),
      attempted: Schema.Boolean,
    }),
  ),
  attempt: Schema.NullOr(PromptCommand),
  attemptDraft: Schema.NullOr(Schema.String),
});
export type SavedInteraction = typeof SavedInteraction.Type;
export const SavedShell = Schema.Struct({
  route: Schema.Literals(["projects", "threads", "conversation"]),
  sidebarView: Schema.optionalKey(Schema.Literals(["projects", "recent"])),
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
});
export const ConversationView = Schema.Struct({
  mode: Schema.Literals(["history", "composer", "requests", "questions", "agents"]),
  anchor: Schema.NullOr(
    Schema.Struct({ id: Schema.String, line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
  ),
  terminalOpen: Schema.Boolean,
  showDetails: Schema.Boolean,
  agentsExpanded: Schema.Boolean,
  selectedAgentId: Schema.NullOr(Schema.String),
  expandedToolGroups: Schema.Array(Schema.Tuple([Schema.String, Schema.Boolean])),
});
export type ConversationView = typeof ConversationView.Type;
export const ComposerView = Schema.Struct({
  cursor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ComposerView = typeof ComposerView.Type;
export const TerminalView = Schema.Struct({ terminalId: Schema.String, focused: Schema.Boolean });
export type TerminalView = typeof TerminalView.Type;

export interface TuiSessionState {
  readonly error: Atom.Atom<string | null>;
  readonly shell: ShellState | undefined;
  readonly interactions: ReadonlyMap<ThreadId, SavedInteraction>;
  readonly saveShell: (state: ShellState) => void;
  readonly saveInteraction: (threadId: ThreadId, state: ThreadInteractionState) => void;
  readonly conversation: (threadId: ThreadId) => ConversationView | undefined;
  readonly saveConversation: (threadId: ThreadId, view: ConversationView) => void;
  readonly composer: (threadId: ThreadId) => ComposerView | undefined;
  readonly saveComposer: (threadId: ThreadId, view: ComposerView) => void;
  readonly terminal: (threadId: ThreadId) => TerminalView | undefined;
  readonly saveTerminal: (threadId: ThreadId, view: TerminalView) => void;
  readonly close: () => void;
}
