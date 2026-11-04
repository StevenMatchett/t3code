import type {
  TuiThread,
  TuiThreadShell,
  TuiShellState,
  TuiThreadState,
} from "../connection/models.ts";
import {
  DEFAULT_SERVER_SETTINGS,
  type ServerSettings,
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
  type UploadChatImageAttachment,
  type GitRunStackedActionResult,
  type GitStackedAction,
  type VcsRef,
  type VcsStatusResult,
  type ProjectEntry,
  type PullRequestActionInput,
  type PullRequestListEntry,
  type ProjectSearchEntriesInput,
  type ProjectWriteFileInput,
  type SecretRequestAnswerInput,
} from "@t3tools/contracts";
import {
  AVAILABLE_CONNECTION_STATE,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";

import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import { EMPTY_VCS_ACTION_STATE } from "@t3tools/client-runtime/state/vcs";
import * as Option from "effect/Option";
import { planThreadCommands } from "../features/chat/proposedPlan.ts";
import type { TuiCommand } from "../connection/commands.ts";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/reactivity";
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
  const details: TuiThread[] = [
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
    requests: { approvals: [], userInputs: [] },
    agents: [],
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
  const threads: TuiThreadShell[] = details.map((thread) => ({
    ...thread,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  }));
  const shell = Atom.make<TuiShellState>({
    snapshot: Option.some({ projects, threads, snapshotSequence: 1, updatedAt: time }),
    status: "live",
    error: Option.none(),
  });
  const states = details.map((thread) =>
    Atom.make<TuiThreadState>({
      ...EMPTY_ENVIRONMENT_THREAD_STATE,
      status: "live",
      data: Option.some(thread),
    }),
  );
  const empty = Atom.make<TuiThreadState>({
    ...EMPTY_ENVIRONMENT_THREAD_STATE,
    data: Option.none(),
  });
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
      if (
        accepted &&
        (command.type === "thread.runtime-mode.set" ||
          command.type === "thread.interaction-mode.set")
      ) {
        const atom = states[details.findIndex((item) => item.id === command.threadId)];
        if (atom)
          registry.update(atom, (value) => ({
            ...value,
            data: Option.map(value.data, (item) => ({
              ...item,
              ...(command.type === "thread.runtime-mode.set"
                ? { runtimeMode: command.runtimeMode }
                : { interactionMode: command.interactionMode }),
            })),
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
      const created: TuiThread = {
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
        createdAt: command.createdAt ?? time,
        updatedAt: command.createdAt ?? time,
      };
      const entry: TuiThreadShell = {
        ...created,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
      };
      details.push(created);
      states.push(
        Atom.make<TuiThreadState>({
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
        createdAt: command.createdAt ?? time,
        updatedAt: command.createdAt ?? time,
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
  const archivedRows: TuiThreadShell[] = [];
  const archivedThreads = Atom.make<{
    readonly status: "loading" | "live" | "error";
    readonly threads: readonly TuiThreadShell[];
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
  const secretAnswers: SecretRequestAnswerInput[] = [];
  const writtenFiles: ProjectWriteFileInput[] = [];
  const PR_ACTIONS = ["merge", "ready", "draft", "close", "reopen", "update-branch"] as const;
  const pullRequestEntry = (number: number, title: string, state: "open" | "closed") =>
    ({
      provider: "github",
      host: "github.com",
      projectId: threads[0]?.projectId,
      projectTitle: "Fixture",
      repository: "example/repo",
      number,
      title,
      url: `https://github.com/example/repo/pull/${number}`,
      author: { login: "ada" },
      headBranch: `feature-${number}`,
      baseBranch: "main",
      state,
      isDraft: false,
      mergeability: "mergeable",
      additions: 3,
      deletions: 1,
      createdAt: time,
      updatedAt: time,
      viewerReviewRequested: false,
      labels: [],
      checksState: "passing",
      reviewDecision: "approved",
    }) as unknown as PullRequestListEntry;
  const pullRequestEntries: PullRequestListEntry[] = [
    pullRequestEntry(42, "Add project search", "open"),
    pullRequestEntry(43, "Tidy the header", "open"),
    pullRequestEntry(7, "Old idea", "closed"),
  ];
  const pullRequestActionsRun: PullRequestActionInput[] = [];
  const pullRequestFailure: { current: string | null } = { current: null };
  const pullRequestThreads: number[] = [];
  const pullRequestReviews: object[] = [];
  const forks: { sourceThreadId: string; runId: string; title: string }[] = [];
  const gitActionState = Atom.make(EMPTY_VCS_ACTION_STATE);
  const gitStatus: { current: VcsStatusResult } = {
    current: {
      isRepo: true,
      hasPrimaryRemote: true,
      isDefaultRef: false,
      refName: "feature",
      hasWorkingTreeChanges: true,
      workingTree: {
        files: [{ path: "src/a.ts", insertions: 2, deletions: 1 }],
        insertions: 2,
        deletions: 1,
      },
      hasUpstream: true,
      aheadCount: 0,
      behindCount: 0,
      pr: null,
    },
  };
  const removedWorktrees: { cwd: string; path: string }[] = [];
  const worktreeFailure: { current: string | null } = { current: null };
  const gitRuns: { readonly target: object; readonly input: object }[] = [];
  const gitFailure: { current: string | null } = { current: null };
  const gitPulls = { current: 0 };
  const gitSwitches: string[] = [];
  const gitCreates: string[] = [];
  const gitRefs: VcsRef[] = [
    { name: "feature", current: true, isDefault: false, worktreePath: null },
    { name: "main", current: false, isDefault: true, worktreePath: null },
    { name: "taken", current: false, isDefault: false, worktreePath: "/elsewhere" },
  ];
  const gitResult = (action: GitStackedAction): GitRunStackedActionResult => ({
    action,
    branch: { status: "skipped_not_requested" },
    commit: { status: "created", commitSha: "abc1234", subject: "Fixture commit" },
    push: { status: "pushed", branch: "feature" },
    pr:
      action === "commit_push_pr" || action === "create_pr"
        ? { status: "created", url: "https://github.com/example/repo/pull/42", number: 42 }
        : { status: "skipped_not_requested" },
    toast: { title: "Done", cta: { kind: "none" } },
  });
  const pathSearches: ProjectSearchEntriesInput[] = [];
  const projectEntries: ProjectEntry[] = [
    { path: "src/projects/search.ts", kind: "file" },
    { path: "src/projects/search.test.ts", kind: "file" },
    { path: "src/projects", kind: "directory" },
  ];
  const planThreadStarts: TuiCommand[] = [];
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
      } else {
        const row = threads.find((item) => item.id === command.threadId);
        if (row) {
          const changes: Partial<Record<ThreadManagementCommand["type"], object>> = {
            "thread.pin": { pinnedAt: time },
            "thread.unpin": { pinnedAt: null },
            "thread.settle": { settledOverride: "settled", settledAt: time, pinnedAt: null },
            "thread.unsettle": { settledOverride: "active", settledAt: null },
            "thread.snooze":
              command.type === "thread.snooze"
                ? { snoozedUntil: command.snoozedUntil, snoozedAt: new Date().toISOString() }
                : {},
            "thread.unsnooze": { snoozedUntil: null, snoozedAt: null },
          };
          // Replaced, not mutated: presented shells are immutable and rows compare by identity.
          threads[threads.indexOf(row)] = { ...row, ...changes[command.type] };
        }
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
    git: {
      actionState: () => gitActionState,
      status: async () => gitStatus.current,
      run: async (_registry, target, input) => {
        gitRuns.push({ target, input });
        if (gitFailure.current) throw new Error(gitFailure.current);
        return gitResult(input.action);
      },
      removeWorktree: async (_registry, input) => {
        if (worktreeFailure.current) throw new Error(worktreeFailure.current);
        removedWorktrees.push(input);
      },
      pull: async () => {
        gitPulls.current += 1;
        return { status: "pulled", refName: "feature", upstreamRef: "origin/feature" };
      },
      listRefs: async () => gitRefs,
      switchRef: async (_registry, input) => {
        gitSwitches.push(input.refName);
        return input.refName;
      },
      createRef: async (_registry, input) => {
        gitCreates.push(input.refName);
        return input.refName;
      },
    },
    forkThreadFromRun: async (_registry, input) => {
      forks.push(input);
      return threads[1]?.id ?? input.sourceThreadId;
    },
    pullRequests: {
      list: async (_registry, { state }) =>
        pullRequestEntries.filter((entry) => state === "all" || entry.state === state),
      detail: async (_registry, reference) => {
        const entry = pullRequestEntries.find((item) => item.number === reference.number)!;
        return {
          ...entry,
          capabilities: { actions: PR_ACTIONS, mergeMethods: ["squash"] },
          viewerPermissions: {
            actions: PR_ACTIONS,
            verdicts: ["approve", "request-changes", "comment"],
          },
          body: "Adds the **search** index.",
        } as never;
      },
      checks: async () =>
        ({
          state: "open",
          checks: [{ name: "tests", status: "success", description: null, url: null }],
        }) as never,
      runAction: async (_registry, input) => {
        pullRequestActionsRun.push(input);
        if (pullRequestFailure.current) throw new Error(pullRequestFailure.current);
        const index = pullRequestEntries.findIndex((item) => item.number === input.number);
        if (input.action === "merge")
          pullRequestEntries[index] = { ...pullRequestEntries[index]!, state: "merged" };
      },
      activity: async () =>
        ({
          comments: [
            {
              id: "c1",
              kind: "comment",
              author: { login: "grace" },
              body: "Looks close.",
              createdAt: time,
              url: null,
              path: null,
              reviewState: null,
            },
          ],
          commentCount: 1,
          commentsTruncated: false,
          reviewThreads: [],
          commits: [{ oid: "abcdef1234", messageHeadline: "Add the index", committedDate: time }],
        }) as never,
      diff: () =>
        Atom.make(
          AsyncResult.success({
            patch:
              "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;\n",
            truncated: false,
            nextCursor: null,
          }),
        ),
      stack: async () =>
        ({
          id: "stack-1",
          number: 1,
          url: "https://github.com/example/repo/stack/1",
          base: "main",
          layers: [
            { number: 42, headBranch: "feature-42", state: "open" },
            { number: 43, headBranch: "feature-43", state: "open" },
          ],
        }) as never,
      submitReview: async (_registry, input) => {
        pullRequestReviews.push(input);
      },
      startThread: async (_registry, entry) => {
        pullRequestThreads.push(entry.number);
        return threads[1]?.id ?? threads[0]!.id;
      },
    },
    pathSearchDebounceMs: 0,
    searchProjectEntries: async (_registry, input) => {
      pathSearches.push(input);
      return {
        entries: projectEntries.filter((entry) => entry.path.includes(input.query)),
        truncated: false,
      };
    },
    writeProjectFile: async (_registry, input) => {
      writtenFiles.push(input);
      return true;
    },
    implementPlanInNewThread: async (_registry, source, plan) => {
      const [create, start] = planThreadCommands(source, plan);
      planThreadStarts.push(create, start);
      return create.threadId;
    },
    answerSecretRequest: async (_registry, input) => {
      secretAnswers.push(input);
    },
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
    threadCapabilities: Atom.make({ repositoryIdentity: false }),
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
    terminalAttachInputs,
    terminalBuffer,
    terminalCloseInputs,
    projectCloneRequests,
    managementCommands,
    secretAnswers,
    writtenFiles,
    pullRequestEntries,
    pullRequestActionsRun,
    pullRequestFailure,
    pullRequestThreads,
    pullRequestReviews,
    forks,
    gitStatus,
    gitActionState,
    gitRuns,
    removedWorktrees,
    worktreeFailure,
    gitFailure,
    gitPulls,
    gitSwitches,
    gitCreates,
    pathSearches,
    planThreadStarts,
    archivedRows,
    archivedThreads,
  };
}
