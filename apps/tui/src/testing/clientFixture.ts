import { makeShellCommandRunner } from "../features/chat/shellCommands.ts";
import {
  DEFAULT_SERVER_SETTINGS,
  type ServerSettings,
  type TerminalOpenInput,
  type ProjectCloneStartInput,
  type OrchestrationThreadSearchMatch,
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
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import {
  EMPTY_TERMINAL_BUFFER_STATE,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import type { TuiClient } from "../connection/clientRuntime.ts";
import { makeNewThreadActions, type CreateThreadCommand } from "../features/chat/newThread.ts";
import { makeNewProjectActions } from "../features/projects/newProject.ts";
import {
  makeThreadManagementActions,
  type ThreadManagementCommand,
} from "../features/threads/management.ts";
import type { ProviderCatalog } from "../features/chat/providerChoices.ts";
import type { TuiSessionState } from "../persistence/sessionState.ts";
import { makeThreadInteractions, type TuiThreadCommand } from "../features/chat/interactions.ts";

const time = "2026-01-01T00:00:00.000Z";
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" };

export function makeClientFixture(
  dispatch: (command: TuiThreadCommand) => Promise<boolean> = async () => true,
  loadImageAttachment?: (path: string) => Promise<UploadChatImageAttachment>,
  session?: TuiSessionState,
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
    executeShell: (registry, input) =>
      makeShellCommandRunner(terminals, EnvironmentId.make("renderer-fixture"))(registry, input),
    ...(session ? { session } : {}),
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
  const terminalOpenInputs: TerminalOpenInput[] = [];
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
    open: {
      run: async (_registry: unknown, request: { input: TerminalOpenInput }) => {
        terminalOpenInputs.push(request.input);
        return AsyncResult.success(undefined);
      },
    },
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
  const projectCloneTracking = Atom.make(true);
  const projectCloneRequests: ProjectCloneStartInput[] = [];
  const addProjectToShell = (
    registry: Parameters<Parameters<typeof makeNewProjectActions>[0]["dispatch"]>[0],
    project: OrchestrationProjectShell,
  ) => {
    projects.push(project);
    registry.update(shell, (value) => ({
      ...value,
      snapshot: Option.map(value.snapshot, (snapshot) => ({
        ...snapshot,
        projects: [...snapshot.projects, project],
        snapshotSequence: snapshot.snapshotSequence + 1,
      })),
    }));
  };
  const newProjects = makeNewProjectActions({
    shell,
    connection,
    projectCloneTracking,
    browse: async (_registry, partialPath) => ({
      parentPath: partialPath === "~/" ? "~/" : "~/",
      entries:
        partialPath === "~/"
          ? [
              { name: "code", fullPath: "~/code/" },
              { name: "projects", fullPath: "~/projects/" },
            ]
          : [],
    }),
    dispatch: async (registry, command) => {
      addProjectToShell(registry, {
        id: command.projectId,
        title: command.title,
        workspaceRoot: command.workspaceRoot,
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      });
      return true;
    },
    startClone: async (registry, input) => {
      projectCloneRequests.push(input);
      addProjectToShell(registry, {
        id: input.projectId,
        title: input.title,
        workspaceRoot: input.destinationPath,
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      });
      return true;
    },
    cloneRepository: async (_registry, input) => ({
      cwd: input.destinationPath,
      remoteUrl: input.remoteUrl!,
      repository: null,
    }),
  });
  const archivedRows: OrchestrationThreadShell[] = [];
  const archivedThreads = Atom.make<{
    readonly status: "loading" | "live" | "error";
    readonly threads: readonly OrchestrationThreadShell[];
  }>({ status: "live", threads: archivedRows });
  const threadSearch = Atom.family((query: string) =>
    Atom.make(() => {
      const normalized = query.trim().toLocaleLowerCase();
      const matches: OrchestrationThreadSearchMatch[] = [];
      if (normalized.length >= 2)
        for (const thread of details) {
          const message = thread.messages.find((item) =>
            item.text.toLocaleLowerCase().includes(normalized),
          );
          if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
          const index = message.text.toLocaleLowerCase().indexOf(normalized);
          matches.push({
            threadId: thread.id,
            projectId: thread.projectId,
            source: message.role,
            snippet: message.text.slice(Math.max(0, index - 60), index + normalized.length + 120),
            messageCreatedAt: message.createdAt,
          });
        }
      return { matches, loading: false, failed: false };
    }),
  );
  const managementCommands: ThreadManagementCommand[] = [];
  const threadManagement = makeThreadManagementActions({
    dispatch: async (registry, command) => {
      managementCommands.push(command);
      if (command.type === "thread.meta.update" && command.title) {
        const detail = details.find((item) => item.id === command.threadId);
        if (detail) Object.assign(detail, { title: command.title });
        const row = threads.find((item) => item.id === command.threadId);
        if (row) Object.assign(row, { title: command.title });
        const archived = archivedRows.find((item) => item.id === command.threadId);
        if (archived) Object.assign(archived, { title: command.title });
      } else if (command.type === "thread.archive") {
        const index = threads.findIndex((item) => item.id === command.threadId);
        if (index >= 0) archivedRows.push({ ...threads.splice(index, 1)[0]!, archivedAt: time });
      } else if (command.type === "thread.unarchive") {
        const index = archivedRows.findIndex((item) => item.id === command.threadId);
        if (index >= 0) threads.push({ ...archivedRows.splice(index, 1)[0]!, archivedAt: null });
      } else if (command.type === "thread.delete") {
        const activeIndex = threads.findIndex((item) => item.id === command.threadId);
        if (activeIndex >= 0) threads.splice(activeIndex, 1);
        const archivedIndex = archivedRows.findIndex((item) => item.id === command.threadId);
        if (archivedIndex >= 0) archivedRows.splice(archivedIndex, 1);
      }
      registry.update(shell, (value) =>
        Option.map(value.snapshot, (snapshot) => ({
          ...value,
          snapshot: Option.some({
            ...snapshot,
            threads: [...threads],
            snapshotSequence: snapshot.snapshotSequence + 1,
          }),
        })).pipe(Option.getOrElse(() => value)),
      );
      registry.set(archivedThreads, { status: "live", threads: [...archivedRows] });
      return true;
    },
    refreshArchived: () => {},
  });
  const client: TuiClient = {
    ...(session ? { session } : {}),
    resolvePullRequest: async (_registry, target) => ({
      number: 42,
      title: "Fixture pull request",
      url: "https://github.com/example/repo/pull/42",
      baseBranch: "main",
      headBranch: target.branch ?? "feature",
      state: "open",
    }),
    environmentId: EnvironmentId.make("renderer-fixture"),
    label: "Shared test environment",
    httpOrigin: "http://localhost:43110",
    shell,
    connection,
    thread,
    actions,
    newThreads,
    newProjects,
    threadManagement,
    archivedThreads,
    refreshArchivedThreads: () => {},
    threadSearch,
    diffs: {
      turnDiff: ({ input }) =>
        Atom.make(
          AsyncResult.success({
            threadId: input.threadId,
            fromTurnCount: input.fromTurnCount,
            toTurnCount: input.toTurnCount,
            diff: "diff --git a/turn.ts b/turn.ts\n--- a/turn.ts\n+++ b/turn.ts\n@@ -1 +1 @@\n-before turn\n+after turn",
          }),
        ),
      fullThreadDiff: () =>
        Atom.make(
          AsyncResult.success({
            threadId: details[0]!.id,
            fromTurnCount: 0,
            toTurnCount: 1,
            diff: "diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-old value\n+new value",
          }),
        ),
    },
    review: {
      diffPreview: ({ input }) =>
        Atom.make(
          AsyncResult.success({
            cwd: input.cwd,
            generatedAt: DateTime.makeUnsafe(time),
            sources: [
              {
                id: "working",
                kind: "working-tree" as const,
                title: "Working tree",
                baseRef: null,
                headRef: null,
                diffHash: "fixture",
                truncated: false,
                diff: "diff --git a/work.ts b/work.ts\n--- a/work.ts\n+++ b/work.ts\n@@ -1 +1 @@\n-old workspace\n+new workspace\ndiff --git a/second.ts b/second.ts\n--- a/second.ts\n+++ b/second.ts\n@@ -1 +1 @@\n-old second\n+new second",
              },
            ],
          }),
        ),
    },
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
    terminalOpenInputs,
    terminalAttachInputs,
    terminalBuffer,
    terminalCloseInputs,
    projectCloneRequests,
    managementCommands,
    archivedRows,
  };
}
