import {
  CommandId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  type ApprovalRequestId,
  type ClientOrchestrationCommand,
  type OrchestrationThread,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerProviderSkill,
  type ProviderApprovalDecision,
  type ThreadId,
  type UploadChatImageAttachment,
  type ChatAttachment,
} from "@t3tools/contracts";
import {
  derivePendingRequests,
  type PendingApproval,
  type PendingUserInput,
} from "@t3tools/client-runtime/pending-requests";
import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import { recallableComposerPrompt } from "./restoredPrompt.ts";
import { checkpointRestoreTargets, waitForCheckpointRestore } from "./checkpointRestore.ts";
import { completeSkillDraft, type SkillCompletion } from "./skillCompletion.ts";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import {
  modelChangeProblem,
  modelOptionsAreValid,
  selectableSkills,
  skillPrefix,
  type ProviderCatalog,
} from "./providerChoices.ts";
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import * as DateTime from "effect/DateTime";
import * as Encoding from "effect/Encoding";
import * as Predicate from "effect/Predicate";
import * as Option from "effect/Option";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import { loadImageAttachment as loadImageAttachmentFromDisk } from "./imageAttachments.ts";

export type TuiThreadCommand = Extract<
  ClientOrchestrationCommand,
  {
    readonly type:
      | "thread.checkpoint.revert"
      | "thread.conversation.revert"
      | "thread.meta.update"
      | "thread.turn.start"
      | "thread.turn.interrupt"
      | "thread.approval.respond"
      | "thread.user-input.respond";
  }
>;
type PromptCommand = Extract<TuiThreadCommand, { readonly type: "thread.turn.start" }>;
interface QueuedPrompt {
  readonly command: PromptCommand;
  readonly attachments: readonly (UploadChatImageAttachment | ChatAttachment)[];
  readonly afterTool: string | null;
  readonly afterTurn: string;
  readonly status: "queued" | "sending" | "held";
  readonly attempted: boolean;
}

function toolBoundary(thread: OrchestrationThread): string | null {
  const completed = thread.activities.filter((activity) => activity.kind === "tool.completed");
  return (
    completed.reduce<(typeof completed)[number] | null>(
      (latest, activity) =>
        !latest ||
        (activity.sequence ?? -1) > (latest.sequence ?? -1) ||
        ((activity.sequence ?? -1) === (latest.sequence ?? -1) &&
          activity.createdAt > latest.createdAt)
          ? activity
          : latest,
      null,
    )?.id ?? null
  );
}

const turnBoundary = (thread: OrchestrationThread) =>
  `${thread.latestTurn?.turnId ?? ""}:${thread.latestTurn?.state ?? ""}`;
export type QuestionAnswers = Readonly<Record<string, string | readonly string[]>>;
interface ReplyReceipt {
  readonly requestId: ApprovalRequestId;
  readonly kind: "approval" | "user-input";
  readonly failureId: string | null;
}
interface PastedText {
  readonly id: string;
  readonly marker: string;
  readonly text: string;
}
export interface ThreadInteractionState {
  readonly queue: readonly QueuedPrompt[];
  readonly draft: string;
  readonly pastes: readonly PastedText[];
  readonly pending: "send" | "stop" | "reply" | "model" | "rewind" | null;
  readonly attachmentPending: boolean;
  readonly attachments: readonly (UploadChatImageAttachment | ChatAttachment)[];
  readonly modelPending: ModelSelection | null;
  readonly skill: {
    readonly instanceId: ProviderInstanceId;
    readonly name: string;
    readonly path: string;
    readonly prefix: string;
  } | null;
  readonly error: string | null;
  readonly notice: string | null;
  readonly attempt: PromptCommand | null;
  readonly attemptDraft: string | null;
  readonly replies: readonly ReplyReceipt[];
}
const initial: ThreadInteractionState = {
  queue: [],
  draft: "",
  pastes: [],
  pending: null,
  attachmentPending: false,
  attachments: [],
  modelPending: null,
  skill: null,
  error: null,
  notice: null,
  attempt: null,
  attemptDraft: null,
  replies: [],
};

export function approvalOptions(request: PendingApproval) {
  return (
    request.options ?? [
      { decision: "cancel" as const, label: "Cancel" },
      { decision: "decline" as const, label: "Decline" },
      { decision: "acceptForSession" as const, label: "Allow for this session" },
      { decision: "accept" as const, label: "Approve once" },
    ]
  );
}

export function answersAreComplete(request: PendingUserInput, answers: QuestionAnswers): boolean {
  return (
    request.questions.every((question) => {
      const answer = answers[question.id];
      const values = new Set(question.options.map((option) => option.value ?? option.label));
      if (typeof answer === "string")
        return (
          values.has(answer) || (question.allowCustomAnswer !== false && answer.trim().length > 0)
        );
      return (
        question.multiSelect === true &&
        Array.isArray(answer) &&
        answer.length > 0 &&
        answer.every((value) => values.has(value))
      );
    }) &&
    Object.keys(answers).every((id) => request.questions.some((question) => question.id === id))
  );
}

function failureId(
  thread: OrchestrationThread,
  requestId: ApprovalRequestId,
  kind: ReplyReceipt["kind"],
): string | null {
  return (
    thread.activities.findLast(
      (activity) =>
        activity.kind === `provider.${kind}.respond.failed` &&
        Predicate.isObject(activity.payload) &&
        activity.payload.requestId === requestId,
    )?.id ?? null
  );
}

export function makeThreadInteractions(options: {
  readonly thread: (threadId: ThreadId) => Atom.Atom<EnvironmentThreadState>;
  readonly connection: Atom.Atom<SupervisorConnectionState>;
  readonly providers?: Atom.Atom<ProviderCatalog>;
  readonly shell?: Atom.Atom<EnvironmentShellState>;
  readonly dispatch: (
    registry: AtomRegistry.AtomRegistry,
    command: TuiThreadCommand,
  ) => Promise<boolean>;
  readonly prepareRestoredAttachments?: (
    registry: AtomRegistry.AtomRegistry,
    attachments: readonly ChatAttachment[],
  ) => Promise<readonly (UploadChatImageAttachment | ChatAttachment)[]>;
  readonly loadImageAttachment?: typeof loadImageAttachmentFromDisk;
}) {
  const expandPastes = (draft: string, pastes: readonly PastedText[]) => {
    let text = draft;
    let from = 0;
    for (const paste of pastes) {
      const index = text.indexOf(paste.marker, from);
      if (index < 0) continue;
      text = `${text.slice(0, index)}${paste.text}${text.slice(index + paste.marker.length)}`;
      from = index + paste.text.length;
    }
    return text;
  };
  const retainedPastes = (draft: string, pastes: readonly PastedText[]) => {
    let from = 0;
    return pastes.filter((paste) => {
      const index = draft.indexOf(paste.marker, from);
      if (index < 0) return false;
      from = index + paste.marker.length;
      return true;
    });
  };
  const state = Atom.family((_threadId: ThreadId) =>
    Atom.make<ThreadInteractionState>(initial).pipe(Atom.keepAlive),
  );
  const queuedThreads = Atom.make<readonly ThreadId[]>([]).pipe(Atom.keepAlive);
  const update = (
    registry: AtomRegistry.AtomRegistry,
    threadId: ThreadId,
    patch: Partial<ThreadInteractionState>,
  ) => {
    registry.update(state(threadId), (current) => ({ ...current, ...patch }));
    if (patch.queue) {
      const ids = registry.get(queuedThreads);
      if (patch.queue.length > 0 && !ids.includes(threadId))
        registry.set(queuedThreads, [...ids, threadId]);
      else if (patch.queue.length === 0 && ids.includes(threadId))
        registry.set(
          queuedThreads,
          ids.filter((id) => id !== threadId),
        );
    }
  };
  const error = (registry: AtomRegistry.AtomRegistry, threadId: ThreadId, message: string) => {
    update(registry, threadId, { error: message, notice: null });
    return false;
  };
  const currentThread = (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => {
    const value = registry.get(options.thread(threadId));
    if (
      registry.get(options.connection).phase !== "connected" ||
      value.status !== "live" ||
      Option.isSome(value.error)
    ) {
      error(registry, threadId, "Wait for a live connection before sending commands.");
      return null;
    }
    const thread = Option.getOrNull(value.data);
    if (thread === null || thread.deletedAt !== null || thread.archivedAt !== null) {
      error(registry, threadId, "This thread is no longer available for interaction.");
      return null;
    }
    return thread;
  };
  const providerContext = (registry: AtomRegistry.AtomRegistry, thread: OrchestrationThread) => {
    const catalog = options.providers ? registry.get(options.providers) : null;
    const snapshot = options.shell ? Option.getOrNull(registry.get(options.shell).snapshot) : null;
    return {
      provider:
        catalog?.status === "live"
          ? catalog.providers.find(
              (provider) => provider.instanceId === thread.modelSelection.instanceId,
            )
          : undefined,
      cwd:
        thread.worktreePath ??
        snapshot?.projects.find((project) => project.id === thread.projectId)?.workspaceRoot ??
        null,
    };
  };
  const metadata = () => ({
    commandId: CommandId.make(
      Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16))),
    ),
    createdAt: DateTime.formatIso(DateTime.nowUnsafe()),
  });
  const observe = (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => {
    const thread = Option.getOrNull(registry.get(options.thread(threadId)).data);
    if (!thread) return;
    const current = registry.get(state(threadId));
    const requests = derivePendingRequests(thread.activities);
    const failed = current.replies.some(
      (receipt) => failureId(thread, receipt.requestId, receipt.kind) !== receipt.failureId,
    );
    const replies = current.replies.filter(
      (receipt) =>
        (receipt.kind === "approval" ? requests.approvals : requests.userInputs).some(
          (request) => request.requestId === receipt.requestId,
        ) && failureId(thread, receipt.requestId, receipt.kind) === receipt.failureId,
    );
    const sent =
      current.pending !== "send" &&
      current.attempt !== null &&
      thread.messages.some((message) => message.id === current.attempt?.message.messageId);
    const modelChanged =
      current.modelPending !== null &&
      JSON.stringify(thread.modelSelection) !== JSON.stringify(current.modelPending);
    if (sent || modelChanged || replies.length !== current.replies.length)
      update(registry, threadId, {
        replies,
        ...(modelChanged ? { modelPending: null, notice: "Model updated." } : {}),
        ...(failed
          ? {
              error: "The provider could not apply the response. Review the request and retry.",
              notice: null,
            }
          : {}),
        ...(sent
          ? {
              attempt: null,
              attemptDraft: null,
              error: null,
              notice: "Prompt accepted.",
              draft: current.draft === current.attemptDraft ? "" : current.draft,
              pastes: current.draft === current.attemptDraft ? [] : current.pastes,
              attachments:
                current.attachments.map((attachment) => attachment.id).join("\0") ===
                current.attempt?.message.attachments.map((attachment) => attachment.id).join("\0")
                  ? []
                  : current.attachments,
              skill: current.draft === current.attemptDraft ? null : current.skill,
            }
          : {}),
      });
  };
  const run = async (
    registry: AtomRegistry.AtomRegistry,
    command: TuiThreadCommand,
    pending: NonNullable<ThreadInteractionState["pending"]>,
  ) => {
    update(registry, command.threadId, { pending, error: null, notice: null });
    try {
      if (await options.dispatch(registry, command)) return true;
      return error(
        registry,
        command.threadId,
        "Command was not confirmed. Check the thread before retrying; your input is kept.",
      );
    } catch {
      return error(
        registry,
        command.threadId,
        "Command was not confirmed. Check the connection and retry; your input is kept.",
      );
    } finally {
      update(registry, command.threadId, { pending: null });
    }
  };
  const flushQueue = async (
    registry: AtomRegistry.AtomRegistry,
    threadId: ThreadId,
    sendNow = false,
  ) => {
    const current = registry.get(state(threadId));
    const next = current.queue[0];
    if (!next || current.pending || next.status === "sending") return false;
    const value = registry.get(options.thread(threadId));
    const thread = Option.getOrNull(value.data);
    if (
      !thread ||
      value.status !== "live" ||
      Option.isSome(value.error) ||
      registry.get(options.connection).phase !== "connected"
    )
      return false;
    // A lost command receipt must not cause an already accepted prompt to be sent twice.
    if (thread.messages.some((message) => message.id === next.command.message.messageId)) {
      update(registry, threadId, {
        queue: current.queue.slice(1),
        error: null,
        notice: "Queued message sent.",
      });
      return true;
    }
    if (
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      current.modelPending ||
      current.attempt
    )
      return false;
    if (
      !sendNow &&
      next.status === "queued" &&
      (thread.latestTurn?.state === "interrupted" || thread.latestTurn?.state === "error")
    ) {
      update(registry, threadId, {
        queue: current.queue.map((entry) => ({ ...entry, status: "held" })),
      });
      return false;
    }
    const requests = derivePendingRequests(thread.activities);
    if (
      requests.approvals.length ||
      requests.userInputs.length ||
      thread.session?.status === "starting"
    )
      return false;
    const afterTool = toolBoundary(thread);
    const afterTurn = turnBoundary(thread);
    if (
      !sendNow &&
      (next.status === "held" ||
        (thread.latestTurn?.state === "running"
          ? next.afterTool === afterTool
          : next.afterTurn === afterTurn))
    )
      return false;
    // Re-anchor the rest so only one message is delivered at each boundary.
    update(registry, threadId, {
      queue: current.queue.map((entry, index) => ({
        ...entry,
        afterTool,
        afterTurn,
        status: index === 0 ? "sending" : entry.status,
        attempted: index === 0 || entry.attempted,
      })),
    });
    const accepted = await run(registry, next.command, "send");
    const queue = registry.get(state(threadId)).queue;
    update(registry, threadId, {
      queue: accepted ? queue.slice(1) : queue.map((entry) => ({ ...entry, status: "held" })),
      notice: accepted ? "Queued message sent." : null,
    });
    return accepted;
  };
  return {
    state,
    queuedThreads,
    flushQueue,
    restoreCheckpoint: async (
      registry: AtomRegistry.AtomRegistry,
      threadId: ThreadId,
      messageId: MessageId,
      restoreFiles: boolean,
    ) => {
      const current = registry.get(state(threadId));
      if (current.pending || current.attachmentPending)
        return error(registry, threadId, "Wait for the pending operation before rewinding.");
      const thread = currentThread(registry, threadId);
      if (!thread) return false;
      const catalog = options.providers ? registry.get(options.providers) : null;
      const provider =
        catalog?.status === "live"
          ? catalog.providers.find(
              (p) =>
                p.instanceId ===
                (thread.session?.providerInstanceId ?? thread.modelSelection.instanceId),
            )
          : undefined;
      if (!provider || provider.supportsConversationRollback === false)
        return error(
          registry,
          threadId,
          "This provider does not support reverting conversation history.",
        );
      if (
        thread.latestTurn?.state === "running" ||
        thread.session?.status === "running" ||
        thread.session?.status === "starting"
      )
        return error(
          registry,
          threadId,
          "Interrupt the current turn before reverting checkpoints.",
        );
      if (current.queue.length || current.attempt)
        return error(
          registry,
          threadId,
          "Resolve queued or unconfirmed messages before rewinding.",
        );
      const target = checkpointRestoreTargets(thread).find((t) => t.message.id === messageId);
      if (!target)
        return error(registry, threadId, "The message to rewind is no longer available.");
      const attachments = target.message.attachments ?? [];
      if (attachments.some((a) => a.type !== "image" && a.type !== "file"))
        return error(registry, threadId, "This message has an attachment that cannot be restored.");
      if (
        current.attachments.length + attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS ||
        attachments.some((a) => current.attachments.some((existing) => existing.id === a.id))
      )
        return error(
          registry,
          threadId,
          "Make room for this message's attachments in the composer before rewinding.",
        );
      update(registry, threadId, { pending: "rewind", error: null, notice: null });
      try {
        if (attachments.length && !options.prepareRestoredAttachments)
          throw new Error("Attachment restoration is unavailable.");
        const restoredAttachments = attachments.length
          ? await options.prepareRestoredAttachments!(registry, attachments)
          : [];
        const latest = currentThread(registry, threadId);
        if (
          !latest ||
          latest.latestTurn?.state === "running" ||
          latest.session?.status === "starting" ||
          latest.session?.status === "running" ||
          !checkpointRestoreTargets(latest).some(
            (entry) => entry.message.id === messageId && entry.turnCount === target.turnCount,
          )
        )
          throw new Error(
            "The thread changed while preparing the rewind. Review it and try again.",
          );
        await waitForCheckpointRestore(
          registry,
          options.thread(threadId),
          messageId,
          target.turnCount,
          () =>
            options.dispatch(registry, {
              type: restoreFiles ? "thread.checkpoint.revert" : "thread.conversation.revert",
              ...metadata(),
              threadId,
              turnCount: target.turnCount,
            }),
        );
        const draft = registry.get(state(threadId));
        update(registry, threadId, {
          draft: [draft.draft, recallableComposerPrompt(target.message.text)]
            .filter(Boolean)
            .join("\n\n"),
          attachments: [...draft.attachments, ...restoredAttachments],
          skill: null,
          attempt: null,
          attemptDraft: null,
          notice: "Chat rewound. Edit the restored prompt before sending.",
        });
        return true;
      } catch (cause) {
        return error(
          registry,
          threadId,
          cause instanceof Error ? cause.message : "Failed to rewind thread.",
        );
      } finally {
        update(registry, threadId, { pending: null });
      }
    },
    editQueued: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => {
      const current = registry.get(state(threadId));
      const next = current.queue[0];
      if (!next || current.pending || current.attachmentPending) return false;
      if (current.draft || current.attachments.length)
        return error(
          registry,
          threadId,
          "Clear or queue your draft before editing the queued message.",
        );
      update(registry, threadId, {
        queue: current.queue.slice(1),
        draft: next.command.message.text,
        pastes: [],
        attachments: next.attachments,
        skill: null,
        // Held messages may have reached the server despite a lost receipt.
        attempt: next.attempted ? next.command : null,
        attemptDraft: next.attempted ? next.command.message.text : null,
        error: null,
        notice: "Queued message returned to the composer.",
      });
      return true;
    },
    setDraft: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId, draft: string) => {
      const current = registry.get(state(threadId));
      const skill = current.skill;
      update(registry, threadId, {
        draft,
        pastes: retainedPastes(draft, current.pastes),
        skill: skill && draft.startsWith(skill.prefix) ? skill : null,
      });
    },
    addPaste: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId, text: string) => {
      const characters = Array.from(text).length;
      if (characters <= 200) return false;
      const current = registry.get(state(threadId));
      const marker = `[paste ${characters} characters]`;
      const id = Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
      update(registry, threadId, {
        draft: `${current.draft}${marker}`,
        pastes: [...current.pastes, { id, marker, text }],
        error: null,
        notice: null,
      });
      return true;
    },
    attachImages: async (
      registry: AtomRegistry.AtomRegistry,
      threadId: ThreadId,
      paths: readonly string[],
    ) => {
      const current = registry.get(state(threadId));
      if (current.pending || current.attachmentPending || paths.length === 0) return false;
      if (current.attachments.length + paths.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
        return error(
          registry,
          threadId,
          `A prompt can include up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images.`,
        );
      update(registry, threadId, { attachmentPending: true, error: null, notice: null });
      try {
        const loadImageAttachment = options.loadImageAttachment ?? loadImageAttachmentFromDisk;
        const attachments = await Promise.all(paths.map(loadImageAttachment));
        update(registry, threadId, {
          attachments: [...registry.get(state(threadId)).attachments, ...attachments],
          notice:
            attachments.length === 1
              ? `Added [Image #${current.attachments.length + 1}].`
              : `Added ${attachments.length} images.`,
        });
        return true;
      } catch (cause) {
        return error(
          registry,
          threadId,
          cause instanceof Error ? cause.message : "The image could not be attached.",
        );
      } finally {
        update(registry, threadId, { attachmentPending: false });
      }
    },
    removeAttachment: (
      registry: AtomRegistry.AtomRegistry,
      threadId: ThreadId,
      attachmentId: string,
    ) => {
      const current = registry.get(state(threadId));
      if (current.pending || current.attachmentPending) return false;
      const attachments = current.attachments.filter(
        (attachment) => attachment.id !== attachmentId,
      );
      if (attachments.length === current.attachments.length) return false;
      update(registry, threadId, { attachments, error: null, notice: "Image removed." });
      return true;
    },
    observe,
    selectSkill: (
      registry: AtomRegistry.AtomRegistry,
      threadId: ThreadId,
      chosen: ServerProviderSkill,
      completion?: SkillCompletion,
    ) => {
      const current = registry.get(state(threadId));
      if (
        current.pending ||
        current.modelPending ||
        (completion && completion.text !== current.draft)
      )
        return false;
      const thread = currentThread(registry, threadId);
      if (!thread) return false;
      const { provider, cwd } = providerContext(registry, thread);
      const skill =
        provider &&
        selectableSkills(provider, cwd).find(
          (item) => item.name === chosen.name && item.path === chosen.path,
        );
      if (
        !provider ||
        !provider.enabled ||
        provider.availability === "unavailable" ||
        !skill ||
        /\s/u.test(skill.name)
      )
        return error(
          registry,
          threadId,
          "That skill is not available for this provider and workspace. Refresh the skill list.",
        );
      const prefix = skillPrefix(provider, skill);
      const completed = completeSkillDraft(
        current.draft,
        prefix,
        completion,
        current.skill?.prefix,
      );
      update(registry, threadId, {
        draft: completed.text,
        skill: { instanceId: provider.instanceId, name: skill.name, path: skill.path, prefix },
        error: null,
        notice: "Skill added to draft; Enter sends it.",
      });
      return true;
    },
    changeModel: async (
      registry: AtomRegistry.AtomRegistry,
      threadId: ThreadId,
      selection: ModelSelection,
    ) => {
      if (registry.get(state(threadId)).pending) return false;
      observe(registry, threadId);
      const current = registry.get(state(threadId));
      if (current.modelPending)
        return error(registry, threadId, "Waiting for the server's model update. R reconnects.");
      if (current.attempt)
        return error(
          registry,
          threadId,
          "Resolve the unconfirmed prompt before changing its model.",
        );
      const thread = currentThread(registry, threadId);
      if (!thread) return false;
      const { provider } = providerContext(registry, thread);
      const problem = modelChangeProblem(thread, provider, selection);
      if (problem) return error(registry, threadId, problem);
      if (JSON.stringify(selection) === JSON.stringify(thread.modelSelection)) return true;
      if (!provider || !modelOptionsAreValid(provider, selection))
        return error(
          registry,
          threadId,
          "Those model options are no longer available. Reopen the model picker.",
        );
      if (
        !(await run(
          registry,
          {
            type: "thread.meta.update",
            commandId: metadata().commandId,
            threadId,
            modelSelection: selection,
          },
          "model",
        ))
      )
        return false;
      update(registry, threadId, {
        modelPending: thread.modelSelection,
        notice: "Model change accepted; awaiting shared state.",
      });
      observe(registry, threadId);
      return true;
    },
    send: async (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => {
      if (registry.get(state(threadId)).pending) return false;
      observe(registry, threadId);
      const current = registry.get(state(threadId));
      const thread = currentThread(registry, threadId);
      if (!thread) return false;
      if (current.modelPending)
        return error(registry, threadId, "Waiting for the server's model update before sending.");
      if (current.attachmentPending)
        return error(registry, threadId, "Wait for the image to finish loading before sending.");
      if (current.skill) {
        const { provider, cwd } = providerContext(registry, thread);
        if (
          !provider ||
          provider.instanceId !== current.skill.instanceId ||
          !selectableSkills(provider, cwd).some(
            (skill) => skill.name === current.skill?.name && skill.path === current.skill.path,
          )
        )
          return error(
            registry,
            threadId,
            "The selected skill is no longer available here. Remove its prefix or choose it again.",
          );
      }
      if (!current.draft.trim() && current.attachments.length === 0)
        return error(registry, threadId, "Write a prompt or attach an image first.");
      const messageText = expandPastes(current.draft, current.pastes);
      if (messageText.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS)
        return error(registry, threadId, "The prompt exceeds the server's input limit.");
      const retry =
        current.attempt?.message.text === messageText &&
        current.attempt.message.attachments.map((attachment) => attachment.id).join("\0") ===
          current.attachments.map((attachment) => attachment.id).join("\0")
          ? current.attempt
          : null;
      const requests = derivePendingRequests(thread.activities);
      const shouldQueue =
        !retry && (thread.latestTurn?.state === "running" || current.queue.length > 0);
      if (!retry && !shouldQueue && (requests.approvals.length || requests.userInputs.length))
        return error(
          registry,
          threadId,
          "Respond to the pending request before sending another prompt.",
        );
      const command: PromptCommand = retry ?? {
        type: "thread.turn.start",
        ...metadata(),
        threadId,
        message: {
          messageId: MessageId.make(
            Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16))),
          ),
          role: "user",
          text: messageText,
          attachments: [...current.attachments],
        },
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
      };
      if (shouldQueue) {
        update(registry, threadId, {
          queue: [
            ...current.queue,
            {
              command,
              attachments: [...current.attachments],
              afterTool: toolBoundary(thread),
              afterTurn: turnBoundary(thread),
              status: current.queue.some((entry) => entry.status === "held") ? "held" : "queued",
              attempted: false,
            },
          ],
          draft: "",
          pastes: [],
          attachments: [],
          skill: null,
          error: null,
          notice: "Queued — sends after the next tool call or when the turn ends.",
        });
        return true;
      }
      update(registry, threadId, { attempt: command, attemptDraft: current.draft });
      if (!(await run(registry, command, "send"))) {
        observe(registry, threadId);
        return false;
      }
      const latest = registry.get(state(threadId));
      update(registry, threadId, {
        attempt: null,
        attemptDraft: null,
        notice: "Prompt accepted.",
        draft: latest.draft === current.draft ? "" : latest.draft,
        pastes: latest.draft === current.draft ? [] : latest.pastes,
        attachments: [],
        skill: latest.draft === command.message.text ? null : latest.skill,
      });
      return true;
    },
    interrupt: async (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => {
      if (registry.get(state(threadId)).pending) return false;
      const queue = registry.get(state(threadId)).queue;
      if (queue.length)
        update(registry, threadId, {
          queue: queue.map((entry) => ({ ...entry, status: "held" })),
          notice: "Queued messages paused.",
        });
      const thread = currentThread(registry, threadId);
      if (!thread) return false;
      if (queue.length && thread.latestTurn?.state !== "running") return true;
      if (thread.latestTurn?.state !== "running")
        return error(registry, threadId, "There is no running turn to stop.");
      const accepted = await run(
        registry,
        {
          type: "thread.turn.interrupt",
          ...metadata(),
          threadId,
          turnId: thread.latestTurn.turnId,
        },
        "stop",
      );
      if (accepted) update(registry, threadId, { notice: "Stop requested." });
      return accepted;
    },
    reply: async (
      registry: AtomRegistry.AtomRegistry,
      threadId: ThreadId,
      reply:
        | {
            readonly kind: "approval";
            readonly requestId: ApprovalRequestId;
            readonly decision: ProviderApprovalDecision;
          }
        | {
            readonly kind: "user-input";
            readonly requestId: ApprovalRequestId;
            readonly answers: QuestionAnswers;
          },
    ) => {
      if (registry.get(state(threadId)).pending) return false;
      observe(registry, threadId);
      if (
        registry
          .get(state(threadId))
          .replies.some((receipt) => receipt.requestId === reply.requestId)
      )
        return false;
      const thread = currentThread(registry, threadId);
      if (!thread) return false;
      const requests = derivePendingRequests(thread.activities);
      let command: TuiThreadCommand;
      if (reply.kind === "approval") {
        const request = requests.approvals.find((item) => item.requestId === reply.requestId);
        if (
          !request ||
          !approvalOptions(request).some((option) => option.decision === reply.decision)
        )
          return error(registry, threadId, "That approval option is no longer available.");
        command = {
          type: "thread.approval.respond",
          ...metadata(),
          threadId,
          requestId: reply.requestId,
          decision: reply.decision,
        };
      } else {
        const request = requests.userInputs.find((item) => item.requestId === reply.requestId);
        if (!request || !answersAreComplete(request, reply.answers))
          return error(
            registry,
            threadId,
            "Answer every question using its available choices or permitted custom text.",
          );
        command = {
          type: "thread.user-input.respond",
          ...metadata(),
          threadId,
          requestId: reply.requestId,
          answers: reply.answers,
        };
      }
      const baseline = failureId(thread, reply.requestId, reply.kind);
      if (!(await run(registry, command, "reply"))) return false;
      update(registry, threadId, {
        replies: [
          ...registry.get(state(threadId)).replies,
          { requestId: reply.requestId, kind: reply.kind, failureId: baseline },
        ],
        notice: "Response accepted.",
      });
      observe(registry, threadId);
      return true;
    },
  };
}

export type ThreadInteractions = ReturnType<typeof makeThreadInteractions>;
