import {
  DEFAULT_SERVER_SETTINGS,
  type ServerSettings,
  type VcsCreateWorktreeInput,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type UploadChatImageAttachment,
} from "@t3tools/contracts";
import {
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime/state/threads";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import {
  EMPTY_TERMINAL_BUFFER_STATE,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { makeNewThreadActions, type CreateThreadCommand } from "../features/chat/newThread.ts";
import type { ProviderCatalog } from "../features/chat/providerChoices.ts";
import { makeThreadInteractions, type TuiThreadCommand } from "../features/chat/interactions.ts";

const time = "2026-01-01T00:00:00.000Z";
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };

export function makeClientFixture(
  dispatch: (command: TuiThreadCommand) => Promise<boolean> = async () => true,
  loadImageAttachment?: (path: string) => Promise<UploadChatImageAttachment>,
) {
  const projects: OrchestrationProjectShell[] = ["Alpha", "Beta"].map((title) => ({
    id: ProjectId.make(title.toLowerCase()),
    title,
    workspaceRoot: `/workspace/${title.toLowerCase()}`,
    defaultModelSelection: modelSelection,
    scripts: [],
    createdAt: time,
    updatedAt: time,
  }));
  const details: OrchestrationThread[] = [
    "First conversation",
    "Second conversation",
    "Other project conversation",
  ].map((title, index) => ({
    id: ThreadId.make(`thread-${index}`),
    projectId: projects[index === 2 ? 1 : 0]!.id,
    title,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: time,
    updatedAt: time,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    pullRequests: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    messages: [
      {
        id: MessageId.make(`reply-${index}`),
        role: "assistant",
        text:
          index === 0
            ? Array.from({ length: 60 }, (_, line) => `Visible line ${line}`).join("\n")
            : `reply-${index}`,
        turnId: null,
        streaming: false,
        createdAt: time,
        updatedAt: time,
      },
    ],
  }));
  const threads: OrchestrationThreadShell[] = details.map((thread) => ({
    ...thread,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  }));
  const shell = Atom.make<EnvironmentShellState>({
    snapshot: Option.some({ projects, threads, snapshotSequence: 1, updatedAt: time }),
    status: "live",
    error: Option.none(),
  });
  const states = details.map((thread) =>
    Atom.make<EnvironmentThreadState>({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      status: "live",
      data: Option.some(thread),
    }),
  );
  const empty = Atom.make(EMPTY_ENVIRONMENT_THREAD_STATE);
  const connection = Atom.make<SupervisorConnectionState>({
    ...AVAILABLE_CONNECTION_STATE,
    desired: true,
    network: "online",
    phase: "connected",
  });
  const thread = (id: ThreadId) => states[details.findIndex((item) => item.id === id)] ?? empty;
  const commands: TuiThreadCommand[] = [];
  const provider: ServerProvider = {
    instanceId: modelSelection.instanceId,
    driver: ProviderDriverKind.make("codex"),
    displayName: "Fixture Codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: time,
    models: [
      { slug: modelSelection.model, name: "Current model", isCustom: false, capabilities: null },
      {
        slug: "opaque/model-b",
        name: "Alternate model",
        isCustom: false,
        capabilities: {
          optionDescriptors: [
            {
              id: "budget-tier",
              label: "Reasoning",
              type: "select",
              options: [
                { id: "small:v1", label: "Quick", isDefault: true },
                { id: "deep:v2", label: "Deep" },
              ],
            },
          ],
        },
      },
    ],
    slashCommands: [],
    skills: [
      {
        name: "review:changes",
        displayName: "Review changes",
        path: "/workspace/alpha/.agents/skills/review/SKILL.md",
        scope: "project",
        enabled: true,
        description: "Review the current changes",
      },
    ],
  };
  const providers = Atom.make<ProviderCatalog>({ providers: [provider], status: "live" });
  const actions = makeThreadInteractions({
    connection,
    thread,
    providers,
    shell,
    dispatch: async (registry, command) => {
      commands.push(command);
      const accepted = await dispatch(command);
      if (accepted && command.type === "thread.meta.update" && command.modelSelection) {
        const atom = states[details.findIndex((item) => item.id === command.threadId)];
        const selection = command.modelSelection;
        if (atom)
          registry.update(atom, (value) => ({
            ...value,
            data: Option.map(value.data, (item) => ({ ...item, modelSelection: selection })),
          }));
      }
      return accepted;
    },
    ...(loadImageAttachment ? { loadImageAttachment } : {}),
  });
  const settings = Atom.make<ServerSettings | null>({
    ...DEFAULT_SERVER_SETTINGS,
    defaultModelSelection: modelSelection,
  });
  const creationCommands: CreateThreadCommand[] = [];
  const worktreeRequests: VcsCreateWorktreeInput[] = [];
  const terminalWrites: string[] = [];
  const terminalAttachInputs: Array<{
    readonly threadId: string;
    readonly terminalId: string;
    readonly cwd: string;
    readonly worktreePath: string | null;
  }> = [];
  const terminalCloseInputs: Array<{
    readonly threadId?: string;
    readonly terminalId?: string;
    readonly deleteHistory?: boolean;
  }> = [];
  const terminalMetadata = Atom.make(AsyncResult.success([]));
  const terminalBuffer = Atom.make(
    AsyncResult.success<TerminalBufferState>({
      ...EMPTY_TERMINAL_BUFFER_STATE,
      status: "running",
    }),
  );
  const terminalSuccess = { run: async () => AsyncResult.success(undefined) };
  const terminals = {
    metadata: () => terminalMetadata,
    attach: (request: {
      readonly input: {
        readonly threadId: string;
        readonly terminalId: string;
        readonly cwd?: string;
        readonly worktreePath?: string | null;
      };
    }) => {
      terminalAttachInputs.push({
        threadId: request.input.threadId,
        terminalId: request.input.terminalId,
        cwd: request.input.cwd!,
        worktreePath: request.input.worktreePath ?? null,
      });
      return terminalBuffer;
    },
    write: {
      run: async (_registry: unknown, request: { readonly input: { readonly data: string } }) => {
        terminalWrites.push(request.input.data);
        return AsyncResult.success(undefined);
      },
    },
    resize: terminalSuccess,
    close: {
      run: async (
        _registry: unknown,
        request: {
          readonly input: {
            readonly threadId?: string;
            readonly terminalId?: string;
            readonly deleteHistory?: boolean;
          };
        },
      ) => {
        terminalCloseInputs.push(request.input);
        return AsyncResult.success(undefined);
      },
    },
  } as unknown as NonNullable<TuiClient["terminals"]>;
  const newThreads = makeNewThreadActions({
    shell,
    connection,
    providers,
    createWorktree: async (_registry, input) => {
      worktreeRequests.push(input);
      return { refName: input.newRefName!, path: `/worktrees/${input.newRefName!}` };
    },
    recoverWorktree: async () => null,
    dispatch: async (registry, command) => {
      creationCommands.push(command);
      const created: OrchestrationThread = {
        ...details[0]!,
        id: command.threadId,
        projectId: command.projectId,
        title: command.title,
        modelSelection: command.modelSelection,
        runtimeMode: command.runtimeMode,
        interactionMode: command.interactionMode,
        branch: command.branch,
        worktreePath: command.worktreePath,
        messages: [],
        activities: [],
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      };
      const entry: OrchestrationThreadShell = {
        ...created,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
      };
      details.push(created);
      states.push(
        Atom.make<EnvironmentThreadState>({
          ...EMPTY_ENVIRONMENT_THREAD_STATE,
          status: "live",
          data: Option.some(created),
        }),
      );
      registry.update(shell, (value) => ({
        ...value,
        snapshot: Option.map(value.snapshot, (snapshot) => ({
          ...snapshot,
          threads: [...snapshot.threads, entry],
          snapshotSequence: snapshot.snapshotSequence + 1,
        })),
      }));
      return true;
    },
  });
  const client: TuiClient = {
    environmentId: EnvironmentId.make("renderer-fixture"),
    label: "Shared test environment",
    httpOrigin: "http://localhost:43110",
    shell,
    connection,
    thread,
    actions,
    newThreads,
    settings,
    providers,
    terminals,
    refreshProvider: async () => true,
    retry: async () => {},
    loadOlder: () => false,
  };
  return {
    client,
    shell,
    states,
    details,
    projects,
    threads,
    commands,
    providers,
    provider,
    settings,
    creationCommands,
    worktreeRequests,
    terminalWrites,
    terminalAttachInputs,
    terminalBuffer,
    terminalCloseInputs,
  };
}
