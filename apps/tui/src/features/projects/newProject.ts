import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import {
  buildProjectCreateCommand,
  getCloneDirectoryName,
  normalizePastedCloneUrl,
} from "@t3tools/client-runtime/operations/projects";
import {
  ensureBrowseDirectoryPath,
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@t3tools/client-runtime/state/projects";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@t3tools/shared/git";
import {
  CommandId,
  ProjectId,
  type ClientOrchestrationCommand,
  type FilesystemBrowseResult,
  type ProjectCloneStartInput,
  type SourceControlCloneRepositoryInput,
  type SourceControlCloneRepositoryResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

type CreateProjectCommand = Extract<
  ClientOrchestrationCommand,
  { readonly type: "project.create" }
>;

export interface NewProjectState {
  readonly phase: "idle" | "creating" | "cloning" | "error" | "created";
  readonly projectId: ProjectId | null;
  readonly error: string | null;
}

const initial: NewProjectState = { phase: "idle", projectId: null, error: null };

function ids() {
  const value = Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  return {
    projectId: ProjectId.make(`tui-${value}`),
    commandId: CommandId.make(`tui-create-project-${value}`),
  };
}

export function defaultCloneDestination(baseDirectory: string, remoteUrl: string): string {
  const folder = getCloneDirectoryName(remoteUrl);
  const base = ensureBrowseDirectoryPath(baseDirectory.trim() || "~/");
  return folder ? `${base}${folder}` : base;
}

export function makeNewProjectActions(options: {
  readonly shell: Atom.Atom<EnvironmentShellState>;
  readonly connection: Atom.Atom<SupervisorConnectionState>;
  readonly projectCloneTracking: Atom.Atom<boolean>;
  readonly dispatch: (
    registry: AtomRegistry.AtomRegistry,
    command: CreateProjectCommand,
  ) => Promise<boolean>;
  readonly browse: (
    registry: AtomRegistry.AtomRegistry,
    partialPath: string,
  ) => Promise<FilesystemBrowseResult>;
  readonly startClone: (
    registry: AtomRegistry.AtomRegistry,
    input: ProjectCloneStartInput,
  ) => Promise<boolean>;
  readonly cloneRepository: (
    registry: AtomRegistry.AtomRegistry,
    input: SourceControlCloneRepositoryInput,
  ) => Promise<SourceControlCloneRepositoryResult>;
}) {
  const state = Atom.make<NewProjectState>(initial).pipe(Atom.keepAlive);
  const fail = (registry: AtomRegistry.AtomRegistry, message: string) => {
    registry.update(state, (current) => ({
      ...current,
      phase: "error" as const,
      error: message,
    }));
    return null;
  };
  const ready = (registry: AtomRegistry.AtomRegistry) => {
    const shell = registry.get(options.shell);
    return (
      registry.get(options.connection).phase === "connected" &&
      shell.status === "live" &&
      Option.isNone(shell.error)
    );
  };
  const createCommand = (projectId: ProjectId, commandId: CommandId, workspaceRoot: string) =>
    buildProjectCreateCommand({
      projectId,
      commandId,
      workspaceRoot,
      createdAt: DateTime.formatIso(DateTime.nowUnsafe()),
    });

  return {
    state,
    reset: (registry: AtomRegistry.AtomRegistry) => registry.set(state, initial),
    browse: options.browse,
    createLocal: async (registry: AtomRegistry.AtomRegistry, rawPath: string) => {
      if (!ready(registry))
        return fail(registry, "Connect to the environment before adding a project.");
      const workspaceRoot = rawPath.trim();
      if (!workspaceRoot) return fail(registry, "Choose a local folder.");
      const duplicate = findProjectByPath(
        Option.getOrNull(registry.get(options.shell).snapshot)?.projects ?? [],
        workspaceRoot,
      );
      if (duplicate) return fail(registry, "That folder is already a project.");
      const { projectId, commandId } = ids();
      registry.set(state, { phase: "creating", projectId, error: null });
      try {
        if (!(await options.dispatch(registry, createCommand(projectId, commandId, workspaceRoot))))
          return fail(registry, "Project creation was not confirmed. Try again.");
      } catch {
        return fail(registry, "Project creation was not confirmed. Try again.");
      }
      registry.set(state, { phase: "created", projectId, error: null });
      return projectId;
    },
    cloneGitHub: async (
      registry: AtomRegistry.AtomRegistry,
      rawUrl: string,
      rawDestination: string,
    ) => {
      if (!ready(registry))
        return fail(registry, "Connect to the environment before cloning a project.");
      const remoteUrl = normalizePastedCloneUrl(rawUrl);
      const destinationPath = rawDestination.trim();
      if (!parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remoteUrl))
        return fail(registry, "Enter a GitHub URL or owner/repository.");
      if (!destinationPath) return fail(registry, "Choose a clone destination.");
      const { projectId, commandId } = ids();
      registry.set(state, { phase: "cloning", projectId, error: null });
      try {
        if (registry.get(options.projectCloneTracking)) {
          const started = await options.startClone(registry, {
            projectId,
            title: inferProjectTitleFromPath(destinationPath),
            createdAt: DateTime.formatIso(DateTime.nowUnsafe()),
            provider: "github",
            remoteUrl,
            destinationPath,
          });
          if (!started) return fail(registry, "The GitHub clone could not be started.");
        } else {
          const cloned = await options.cloneRepository(registry, { remoteUrl, destinationPath });
          if (!(await options.dispatch(registry, createCommand(projectId, commandId, cloned.cwd))))
            return fail(registry, "The repository cloned, but project creation was not confirmed.");
        }
      } catch {
        return fail(
          registry,
          "The GitHub repository could not be cloned. Check the URL and destination.",
        );
      }
      registry.set(state, { phase: "created", projectId, error: null });
      return projectId;
    },
  };
}

export type NewProjectActions = ReturnType<typeof makeNewProjectActions>;
