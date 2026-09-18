import {
  CommandId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ApprovalRequestId,
  type ClientOrchestrationCommand,
  type OrchestrationThread,
  type ModelSelection,
  type ProviderInstanceId,
  type ServerProviderSkill,
  type ProviderApprovalDecision,
  type ThreadId,
} from "@t3tools/contracts";
import {
  derivePendingRequests,
  type PendingApproval,
  type PendingUserInput,
} from "@t3tools/client-runtime/pending-requests";
import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
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

export type TuiThreadCommand = Extract<
  ClientOrchestrationCommand,
  {
    readonly type:
      | "thread.meta.update"
      | "thread.turn.start"
      | "thread.turn.interrupt"
      | "thread.approval.respond"
      | "thread.user-input.respond";
  }
>;
type PromptCommand = Extract<TuiThreadCommand, { readonly type: "thread.turn.start" }>;
export type QuestionAnswers = Readonly<Record<string, string | readonly string[]>>;
interface ReplyReceipt {
  readonly requestId: ApprovalRequestId;
  readonly kind: "approval" | "user-input";
  readonly failureId: string | null;
}
export interface ThreadInteractionState {
  readonly draft: string;
  readonly pending: "send" | "stop" | "reply" | "model" | null;
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
  readonly replies: readonly ReplyReceipt[];
}
const initial: ThreadInteractionState = {
  draft: "",
  pending: null,
  modelPending: null,
  skill: null,
  error: null,
  notice: null,
  attempt: null,
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
}) {
  const state = Atom.family((_threadId: ThreadId) =>
    Atom.make<ThreadInteractionState>(initial).pipe(Atom.keepAlive),
  );
  const update = (
    registry: AtomRegistry.AtomRegistry,
    threadId: ThreadId,
    patch: Partial<ThreadInteractionState>,
  ) => registry.update(state(threadId), (current) => ({ ...current, ...patch }));
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
              error: null,
              notice: "Prompt accepted.",
              draft: current.draft === current.attempt?.message.text ? "" : current.draft,
              skill: current.draft === current.attempt?.message.text ? null : current.skill,
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
  return {
    state,
    setDraft: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId, draft: string) => {
      const skill = registry.get(state(threadId)).skill;
      update(registry, threadId, {
        draft,
        skill: skill && draft.startsWith(skill.prefix) ? skill : null,
      });
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
      if (!current.draft.trim()) return error(registry, threadId, "Write a prompt first.");
      if (current.draft.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS)
        return error(registry, threadId, "The prompt exceeds the server's input limit.");
      const retry = current.attempt?.message.text === current.draft ? current.attempt : null;
      if (!retry && thread.latestTurn?.state === "running")
        return error(
          registry,
          threadId,
          "A turn is running. Wait for it or use Ctrl+X to stop it.",
        );
      const requests = derivePendingRequests(thread.activities);
      if (!retry && (requests.approvals.length || requests.userInputs.length))
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
          text: current.draft,
          attachments: [],
        },
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
      };
      update(registry, threadId, { attempt: command });
      if (!(await run(registry, command, "send"))) {
        observe(registry, threadId);
        return false;
      }
      const latest = registry.get(state(threadId));
      update(registry, threadId, {
        attempt: null,
        notice: "Prompt accepted.",
        draft: latest.draft === command.message.text ? "" : latest.draft,
        skill: latest.draft === command.message.text ? null : latest.skill,
      });
      return true;
    },
    interrupt: async (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => {
      if (registry.get(state(threadId)).pending) return false;
      const thread = currentThread(registry, threadId);
      if (!thread) return false;
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
