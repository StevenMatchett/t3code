import {
  Connection,
  ConnectionBlockedError,
  Connectivity,
  CredentialStore,
  EnvironmentRegistry,
  PrimaryConnectionRegistration,
  PrimaryConnectionTarget,
  ProfileStore,
  Wakeups,
  AVAILABLE_CONNECTION_STATE,
  environmentMismatchError,
  mapRemoteEnvironmentError,
  type SupervisorConnectionState,
} from "@t3tools/client-runtime/connection";
import {
  ConnectionPersistenceError,
  ConnectionRegistrationStore,
  ConnectionTargetStore,
  EnvironmentCacheStore,
  SshEnvironmentGateway,
} from "@t3tools/client-runtime/platform";
import { resolveRemoteWebSocketConnectionUrl } from "@t3tools/client-runtime/authorization";
import {
  deriveWsBaseUrl,
  fetchRemoteEnvironmentDescriptor,
} from "@t3tools/client-runtime/environment";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";
import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import { createEnvironmentSessionAtoms } from "@t3tools/client-runtime/state/session";
import { createTerminalEnvironmentAtoms } from "@t3tools/client-runtime/state/terminal";
import { createOrchestrationEnvironmentAtoms } from "@t3tools/client-runtime/state/orchestration";
import { createReviewEnvironmentAtoms } from "@t3tools/client-runtime/state/review";
import { mergeEnvironmentThread } from "@t3tools/client-runtime/state/threads";
import { scopeThread, scopeThreadShell } from "@t3tools/client-runtime/state/models";
import type { ProviderCatalog } from "../features/chat/providerChoices.ts";
import {
  createEnvironmentShellAtoms,
  shellSnapshotLoaderLayer,
  type EnvironmentShellState,
} from "@t3tools/client-runtime/state/shell";
import {
  createEnvironmentThreadStateAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  requestOlderThreadTurns,
  threadSnapshotLoaderLayer,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime/state/threads";
import {
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type ServerSettings,
  type UploadChatImageAttachment,
  type ChatAttachment,
  type EnvironmentId,
  type FilesystemBrowseResult,
  type OrchestrationThreadSearchMatch,
  type OrchestrationThreadShell,
  type ThreadId,
  type GitResolvedPullRequest,
} from "@t3tools/contracts";
import { makeNewThreadActions, type NewThreadActions } from "../features/chat/newThread.ts";
import { makeNewProjectActions, type NewProjectActions } from "../features/projects/newProject.ts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { makeThreadInteractions, type ThreadInteractions } from "../features/chat/interactions.ts";
import {
  makeThreadManagementActions,
  type ThreadManagementActions,
} from "../features/threads/management.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, type AtomRegistry } from "effect/unstable/reactivity";
import * as Socket from "effect/unstable/socket/Socket";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";

import type { TuiSessionState } from "../persistence/sessionState.ts";
import type { ReattachedAuthenticatedTuiEnvironment } from "./authenticatedEnvironment.ts";

export interface TuiClient {
  readonly session?: TuiSessionState;
  readonly resolvePullRequest: (
    registry: AtomRegistry.AtomRegistry,
    target: { readonly cwd: string; readonly branch: string | null },
  ) => Promise<GitResolvedPullRequest>;
  readonly diffs: Pick<
    ReturnType<typeof createOrchestrationEnvironmentAtoms>,
    "fullThreadDiff" | "turnDiff"
  >;
  readonly review: Pick<ReturnType<typeof createReviewEnvironmentAtoms>, "diffPreview">;
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpOrigin: string;
  readonly shell: Atom.Atom<EnvironmentShellState>;
  readonly connection: Atom.Atom<SupervisorConnectionState>;
  readonly thread: (threadId: ThreadId) => Atom.Atom<EnvironmentThreadState>;
  readonly retry: (registry: AtomRegistry.AtomRegistry) => Promise<void>;
  readonly loadOlder: (threadId: ThreadId) => boolean;
  readonly actions: ThreadInteractions;
  readonly newThreads: NewThreadActions;
  readonly newProjects: NewProjectActions;
  readonly threadManagement: ThreadManagementActions;
  readonly archivedThreads: Atom.Atom<{
    readonly status: "loading" | "live" | "error";
    readonly threads: readonly OrchestrationThreadShell[];
  }>;
  readonly refreshArchivedThreads: (registry: AtomRegistry.AtomRegistry) => void;
  readonly threadSearch: (query: string) => Atom.Atom<{
    readonly matches: readonly OrchestrationThreadSearchMatch[];
    readonly loading: boolean;
    readonly failed: boolean;
  }>;
  readonly settings: Atom.Atom<ServerSettings | null>;
  readonly providers: Atom.Atom<ProviderCatalog>;
  readonly terminals?: ReturnType<typeof createTerminalEnvironmentAtoms>;
  readonly refreshProvider: (
    registry: AtomRegistry.AtomRegistry,
    threadId: ThreadId,
    models: boolean,
  ) => Promise<boolean>;
}

const unsupported = () =>
  Effect.fail(
    new ConnectionBlockedError({
      reason: "unsupported",
      detail: "Manage connections through the TUI command line.",
    }),
  );
const readOnlyCatalog = (
  operation: "register-connection" | "remove-connection" | "set-connection-enabled",
) =>
  Effect.fail(
    new ConnectionPersistenceError({
      operation,
      message: "This TUI session owns one command-line-selected connection.",
    }),
  );

function platformLayer() {
  return Layer.mergeAll(
    Layer.succeed(ConnectionTargetStore, {
      list: Effect.succeed([]),
      listDisabled: Effect.succeed([]),
    }),
    Layer.succeed(ConnectionRegistrationStore, {
      register: () => readOnlyCatalog("register-connection"),
      remove: () => readOnlyCatalog("remove-connection"),
      setEnabled: () => readOnlyCatalog("set-connection-enabled"),
    }),
    Layer.succeed(ProfileStore.ConnectionProfileStore, {
      get: () => Effect.succeedNone,
      put: unsupported,
      remove: unsupported,
    }),
    Layer.succeed(CredentialStore.ConnectionCredentialStore, {
      get: () => Effect.succeedNone,
      put: unsupported,
      remove: unsupported,
    }),
    Layer.succeed(SshEnvironmentGateway, {
      prepare: unsupported,
      provision: unsupported,
      disconnect: unsupported,
    }),
    Layer.succeed(EnvironmentCacheStore, {
      loadShell: () => Effect.succeedNone,
      saveShell: () => Effect.void,
      loadThread: () => Effect.succeedNone,
      saveThread: () => Effect.void,
      removeThread: () => Effect.void,
      loadServerConfig: () => Effect.succeedNone,
      saveServerConfig: () => Effect.void,
      loadVcsRefs: () => Effect.succeedNone,
      saveVcsRefs: () => Effect.void,
      removeVcsRefs: () => Effect.void,
      clearVcsRefs: () => Effect.void,
      clear: () => Effect.void,
    }),
    Connectivity.layer({ status: Effect.succeed("online"), changes: Stream.never }),
    Wakeups.layer({ changes: Stream.never }),
  );
}

export function createTuiClient(
  environment: Pick<ReattachedAuthenticatedTuiEnvironment, "readiness" | "bearer">,
  session?: TuiSessionState,
): TuiClient {
  const { descriptor, httpBaseUrl } = environment.readiness;
  const environmentId = descriptor.environmentId;
  const target = new PrimaryConnectionTarget({
    environmentId,
    label: descriptor.label,
    httpBaseUrl,
    wsBaseUrl: deriveWsBaseUrl(httpBaseUrl),
  });
  const http = remoteHttpClientLayer(globalThis.fetch).pipe(
    Layer.provideMerge(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "error" })),
  );
  const connections = Connection.layerWithResolver({
    prepare: Effect.fn("tui.client.prepare")(function* (entry) {
      if (entry.target.environmentId !== environmentId)
        return yield* environmentMismatchError({
          expected: environmentId,
          actual: entry.target.environmentId,
        });
      const current = yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl }).pipe(
        Effect.mapError(mapRemoteEnvironmentError),
      );
      if (current.environmentId !== environmentId)
        return yield* environmentMismatchError({
          expected: environmentId,
          actual: current.environmentId,
        });
      return yield* environment.bearer
        .use((token) =>
          Effect.gen(function* () {
            const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
              httpBaseUrl,
              wsBaseUrl: target.wsBaseUrl,
              bearerToken: token,
              clientMetadata: { label: "T3 Code TUI", deviceType: "bot", surface: "cli" },
              connectionMethod: "direct",
            }).pipe(Effect.mapError(mapRemoteEnvironmentError));
            return {
              environmentId,
              label: current.label,
              httpBaseUrl,
              socketUrl,
              httpAuthorization: { _tag: "Bearer" as const, token },
              target,
            };
          }),
        )
        .pipe(
          Effect.catchTag("TuiBearerSessionClearedError", () =>
            Effect.fail(
              new ConnectionBlockedError({
                reason: "authentication",
                detail: "The saved credential is unavailable. Pair again through the command line.",
              }),
            ),
          ),
        );
    }, Effect.provide(http)),
  });
  const started = Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry;
      yield* registry.start;
      yield* registry.registerPlatform(new PrimaryConnectionRegistration({ target }));
    }),
  ).pipe(Layer.provideMerge(connections));
  const runtime = Atom.runtime(
    Layer.mergeAll(shellSnapshotLoaderLayer, threadSnapshotLoaderLayer).pipe(
      Layer.provideMerge(started),
      Layer.provideMerge(platformLayer()),
      Layer.provideMerge(http),
      Layer.provide(
        Layer.succeed(Socket.WebSocketConstructor, (url) => new globalThis.WebSocket(url)),
      ),
      Layer.provideMerge(Logger.layer([])),
    ),
  );
  const catalog = createEnvironmentCatalogAtoms(runtime);
  const shell = createEnvironmentShellAtoms(runtime);
  const sessions = createEnvironmentSessionAtoms(runtime);
  const server = createServerEnvironmentAtoms(runtime, {
    initialConfigValueAtom: sessions.initialConfigValueAtom,
  });
  const providers = Atom.make<ProviderCatalog>((get) => {
    const result = get(server.configProjection({ environmentId, input: {} }));
    const projection = Option.getOrNull(AsyncResult.value(result));
    const config = get(server.configValueAtom(environmentId));
    return {
      providers: config?.providers ?? [],
      status: AsyncResult.isFailure(result)
        ? "error"
        : projection?.source === "live"
          ? "live"
          : "loading",
    };
  }).pipe(Atom.keepAlive);
  const threads = createEnvironmentThreadStateAtoms(runtime);
  const terminals = createTerminalEnvironmentAtoms(runtime);
  const orchestration = createOrchestrationEnvironmentAtoms(runtime);
  const archivedSnapshot = orchestration.archivedShellSnapshot({ environmentId, input: {} });
  const archivedThreads = Atom.make((get) => {
    const result = get(archivedSnapshot);
    return {
      status: AsyncResult.isFailure(result)
        ? ("error" as const)
        : AsyncResult.isSuccess(result)
          ? ("live" as const)
          : ("loading" as const),
      threads: Option.getOrNull(AsyncResult.value(result))?.threads ?? [],
    };
  }).pipe(Atom.keepAlive);
  const emptyThreadSearch = Atom.make({
    matches: [] as readonly OrchestrationThreadSearchMatch[],
    loading: false,
    failed: false,
  });
  const threadSearch = Atom.family((query: string) => {
    const normalized = query.trim().slice(0, 200);
    if (normalized.length < 2) return emptyThreadSearch;
    const resultAtom = orchestration.threadSearch({
      environmentId,
      input: { query: normalized, limit: 50 },
    });
    return Atom.make((get) => {
      const result = get(resultAtom);
      return {
        matches: Option.getOrNull(AsyncResult.value(result))?.matches ?? [],
        loading: result.waiting,
        failed: AsyncResult.isFailure(result),
      };
    });
  });
  const shellStatus = Atom.make((get) => get(shell.stateValueAtom(environmentId)).status);
  const threadMetadata = Atom.family((threadId: ThreadId) =>
    Atom.make(
      (get) =>
        Option.getOrNull(get(shell.stateValueAtom(environmentId)).snapshot)?.threads.find(
          (item) => item.id === threadId,
        ) ?? null,
    ),
  );
  const thread = Atom.family((threadId: ThreadId) =>
    Atom.make((get) => {
      const result = get(threads.stateAtom(environmentId, threadId));
      const detail = AsyncResult.isFailure(result)
        ? { ...EMPTY_ENVIRONMENT_THREAD_STATE, error: Option.some("Could not load this thread.") }
        : Option.getOrElse(AsyncResult.value(result), () => EMPTY_ENVIRONMENT_THREAD_STATE);
      const sharedStatus = get(shellStatus);
      const metadata = get(threadMetadata(threadId));
      const merged = mergeEnvironmentThread(
        Option.match(detail.data, {
          onNone: () => null,
          onSome: (value) => scopeThread(environmentId, value),
        }),
        metadata ? scopeThreadShell(environmentId, metadata) : null,
      );
      return {
        ...detail,
        status:
          detail.status === "live" && sharedStatus !== "live" ? ("cached" as const) : detail.status,
        data: Option.fromNullishOr(merged),
      };
    }),
  );
  const connection = Atom.make((get) => {
    const result = get(catalog.stateAtom(environmentId));
    return AsyncResult.isFailure(result)
      ? { ...AVAILABLE_CONNECTION_STATE, phase: "blocked" as const }
      : Option.getOrElse(AsyncResult.value(result), () => AVAILABLE_CONNECTION_STATE);
  });
  const command = createEnvironmentRpcCommand(runtime, {
    label: "tui.thread.command",
    tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
  });
  const createWorktree = createEnvironmentRpcCommand(runtime, {
    label: "tui.create-worktree",
    tag: WS_METHODS.vcsCreateWorktree,
  });
  const listRefs = createEnvironmentRpcCommand(runtime, {
    label: "tui.recover-worktree",
    tag: WS_METHODS.vcsListRefs,
  });
  const resolvePullRequest = createEnvironmentRpcCommand(runtime, {
    label: "tui.resolve-pull-request",
    tag: WS_METHODS.gitResolvePullRequest,
  });
  const refreshVcsStatus = createEnvironmentRpcCommand(runtime, {
    label: "tui.pr-branch-status",
    tag: WS_METHODS.vcsRefreshStatus,
  });
  const browseFilesystem = createEnvironmentRpcCommand(runtime, {
    label: "tui.browse-filesystem",
    tag: WS_METHODS.filesystemBrowse,
  });
  const startProjectClone = createEnvironmentRpcCommand(runtime, {
    label: "tui.start-project-clone",
    tag: WS_METHODS.projectCloneStart,
  });
  const cloneRepository = createEnvironmentRpcCommand(runtime, {
    label: "tui.clone-repository",
    tag: WS_METHODS.sourceControlCloneRepository,
  });
  const projectCloneTracking = Atom.make(
    (get) =>
      get(server.configValueAtom(environmentId))?.environment.capabilities.projectCloneTracking ===
      true,
  );
  const newThreads = makeNewThreadActions({
    shell: shell.stateValueAtom(environmentId),
    connection,
    providers,
    dispatch: async (registry, input) =>
      AsyncResult.isSuccess(await command.run(registry, { environmentId, input })),
    createWorktree: async (registry, input) => {
      const result = await createWorktree.run(registry, { environmentId, input });
      if (!AsyncResult.isSuccess(result)) throw new Error("Worktree creation was not confirmed.");
      return result.value.worktree;
    },
    recoverWorktree: async (registry, input) => {
      let cursor: number | undefined;
      for (let page = 0; page < 100; page += 1) {
        const result = await listRefs.run(registry, {
          environmentId,
          input: {
            cwd: input.cwd,
            query: input.newRefName!,
            refKind: "local",
            refresh: true,
            limit: 100,
            ...(cursor === undefined ? {} : { cursor }),
          },
        });
        if (!AsyncResult.isSuccess(result))
          throw new Error("Could not verify the previous worktree request.");
        const branch = result.value.refs.find(
          (ref) => ref.name === input.newRefName && ref.isRemote !== true,
        );
        if (branch) {
          if (!branch.worktreePath)
            throw new Error("The creation branch exists without an attached worktree.");
          return { refName: branch.name, path: branch.worktreePath };
        }
        if (result.value.nextCursor === null) return null;
        cursor = result.value.nextCursor;
      }
      throw new Error("Worktree recovery exceeded the bounded ref search.");
    },
  });
  const createAssetUrl = createEnvironmentRpcCommand(runtime, {
    label: "tui.restore-attachment-url",
    tag: WS_METHODS.assetsCreateUrl,
  });
  const createUploadUrl = createEnvironmentRpcCommand(runtime, {
    label: "tui.restore-attachment-upload",
    tag: WS_METHODS.attachmentsCreateUploadUrl,
  });
  const actions = makeThreadInteractions({
    ...(session ? { session } : {}),
    prepareRestoredAttachments: async (registry, attachments) => {
      const restored: (UploadChatImageAttachment | ChatAttachment)[] = [];
      for (const attachment of attachments) {
        if (attachment.type !== "image" && attachment.type !== "file")
          throw new Error("Unsupported attachment.");
        const result = await createAssetUrl.run(registry, {
          environmentId,
          input: {
            resource: {
              _tag: "attachment",
              attachmentId: attachment.id,
              fileName: attachment.name,
              mimeType: attachment.mimeType,
            },
          },
        });
        if (!AsyncResult.isSuccess(result))
          throw new Error(`Could not restore attachment: ${attachment.name}`);
        const response = await fetch(new URL(result.value.relativeUrl, httpBaseUrl), {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`Could not restore attachment: ${attachment.name}`);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== attachment.sizeBytes)
          throw new Error(`Attachment size changed: ${attachment.name}`);
        if (attachment.type === "image") {
          restored.push({
            type: "image",
            id: `tui-${crypto.randomUUID()}`,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: bytes.byteLength,
            dataUrl: `data:${attachment.mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
          });
        } else {
          const upload = await createUploadUrl.run(registry, {
            environmentId,
            input: {
              type: "file",
              name: attachment.name,
              mimeType: attachment.mimeType,
              sizeBytes: bytes.byteLength,
            },
          });
          if (!AsyncResult.isSuccess(upload))
            throw new Error(`Could not prepare attachment: ${attachment.name}`);
          const uploaded = await fetch(new URL(upload.value.relativeUrl, httpBaseUrl), {
            method: "PUT",
            headers: { "Content-Type": attachment.mimeType },
            body: bytes,
            signal: AbortSignal.timeout(30_000),
          });
          if (!uploaded.ok) throw new Error(`Could not upload attachment: ${attachment.name}`);
          restored.push({ ...attachment, id: upload.value.attachmentId });
        }
      }
      return restored;
    },
    connection,
    thread,
    providers,
    shell: shell.stateValueAtom(environmentId),
    dispatch: async (registry, input) =>
      AsyncResult.isSuccess(await command.run(registry, { environmentId, input })),
  });
  const refreshArchivedThreads = (registry: AtomRegistry.AtomRegistry) => {
    registry.refresh(archivedSnapshot);
  };
  const threadManagement = makeThreadManagementActions({
    dispatch: async (registry, input) =>
      AsyncResult.isSuccess(await command.run(registry, { environmentId, input })),
    refreshArchived: refreshArchivedThreads,
  });
  const newProjects = makeNewProjectActions({
    shell: shell.stateValueAtom(environmentId),
    connection,
    projectCloneTracking,
    dispatch: async (registry, input) =>
      AsyncResult.isSuccess(await command.run(registry, { environmentId, input })),
    browse: async (registry, partialPath) => {
      const result = await browseFilesystem.run(registry, {
        environmentId,
        input: { partialPath },
      });
      if (!AsyncResult.isSuccess(result)) throw new Error("Could not browse that folder.");
      return result.value as FilesystemBrowseResult;
    },
    startClone: async (registry, input) =>
      AsyncResult.isSuccess(await startProjectClone.run(registry, { environmentId, input })),
    cloneRepository: async (registry, input) => {
      const result = await cloneRepository.run(registry, { environmentId, input });
      if (!AsyncResult.isSuccess(result)) throw new Error("Could not clone that repository.");
      return result.value;
    },
  });
  return {
    environmentId,
    label: descriptor.label,
    httpOrigin: httpBaseUrl,
    shell: shell.stateValueAtom(environmentId),
    connection,
    actions,
    newThreads,
    newProjects,
    threadManagement,
    archivedThreads,
    refreshArchivedThreads,
    threadSearch,
    diffs: orchestration,
    review: createReviewEnvironmentAtoms(runtime),
    resolvePullRequest: async (registry, target) => {
      let branch = target.branch;
      if (!branch) {
        const status = await refreshVcsStatus.run(registry, {
          environmentId,
          input: { cwd: target.cwd },
        });
        if (!AsyncResult.isSuccess(status) || !status.value.isRepo)
          throw new Error("Could not read this project's Git branch.");
        branch = status.value.refName;
      }
      if (!branch) throw new Error("This checkout has no branch (detached HEAD).");
      const result = await resolvePullRequest.run(registry, {
        environmentId,
        input: { cwd: target.cwd, reference: branch },
      });
      if (!AsyncResult.isSuccess(result))
        throw new Error(
          `Could not find a PR for ${branch}. Check that it exists and the server is signed in to your Git host.`,
        );
      return result.value.pullRequest;
    },
    ...(session ? { session } : {}),
    settings: server.settingsValueAtom(environmentId),
    providers,
    terminals,
    refreshProvider: async (registry, threadId, models) => {
      const value = Option.getOrNull(registry.get(thread(threadId)).data);
      if (!value || registry.get(connection).phase !== "connected") return false;
      const snapshot = Option.getOrNull(registry.get(shell.stateValueAtom(environmentId)).snapshot);
      const cwd =
        value.worktreePath ??
        snapshot?.projects.find((project) => project.id === value.projectId)?.workspaceRoot;
      return AsyncResult.isSuccess(
        await server.refreshProviders.run(registry, {
          environmentId,
          input: {
            instanceId: value.modelSelection.instanceId,
            ...(cwd ? { cwd } : {}),
            refreshModels: models,
          },
        }),
      );
    },
    thread,
    retry: async (registry) => {
      await catalog.retryNow.run(registry, environmentId);
    },
    loadOlder: (threadId) => requestOlderThreadTurns(environmentId, threadId),
  };
}
