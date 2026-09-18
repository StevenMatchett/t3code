import {
  CommandId,
  ThreadId,
  type ClientOrchestrationCommand,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type VcsCreateWorktreeInput,
  type VcsCreateWorktreeResult,
} from "@t3tools/contracts";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { SupervisorConnectionState } from "@t3tools/client-runtime/connection";
import * as DateTime from "effect/DateTime";
import * as Encoding from "effect/Encoding";
import * as Option from "effect/Option";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";
import type { ProviderCatalog } from "./providerChoices.ts";

export interface NewThreadInput {
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly mode: "local" | "worktree";
  readonly baseRef: string;
}
export type CreateThreadCommand = Extract<
  ClientOrchestrationCommand,
  { readonly type: "thread.create" }
>;
type Worktree = VcsCreateWorktreeResult["worktree"];
interface CreationAttempt {
  readonly input: NewThreadInput;
  readonly cwd: string;
  readonly command: CreateThreadCommand;
  readonly worktreeInput: VcsCreateWorktreeInput | null;
  readonly worktreeAttempted: boolean;
  readonly worktree: Worktree | null;
}
export interface NewThreadState {
  readonly phase: "idle" | "worktree" | "thread" | "error" | "created";
  readonly attempt: CreationAttempt | null;
  readonly error: string | null;
}
const initial: NewThreadState = { phase: "idle", attempt: null, error: null };

export function makeNewThreadActions(options: {
  readonly shell: Atom.Atom<EnvironmentShellState>;
  readonly connection: Atom.Atom<SupervisorConnectionState>;
  readonly providers: Atom.Atom<ProviderCatalog>;
  readonly createWorktree: (
    registry: AtomRegistry.AtomRegistry,
    input: VcsCreateWorktreeInput,
  ) => Promise<Worktree>;
  readonly recoverWorktree: (
    registry: AtomRegistry.AtomRegistry,
    input: VcsCreateWorktreeInput,
  ) => Promise<Worktree | null>;
  readonly dispatch: (
    registry: AtomRegistry.AtomRegistry,
    command: CreateThreadCommand,
  ) => Promise<boolean>;
}) {
  const state = Atom.make<NewThreadState>(initial).pipe(Atom.keepAlive);
  const patch = (registry: AtomRegistry.AtomRegistry, value: Partial<NewThreadState>) =>
    registry.update(state, (current) => ({ ...current, ...value }));
  return {
    state,
    reset: (registry: AtomRegistry.AtomRegistry) => {
      const current = registry.get(state);
      if (!current.attempt || current.phase === "created") registry.set(state, initial);
    },
    abandon: (registry: AtomRegistry.AtomRegistry) => {
      if (registry.get(state).phase !== "error") return false;
      registry.set(state, initial);
      return true;
    },
    create: async (
      registry: AtomRegistry.AtomRegistry,
      input: NewThreadInput,
    ): Promise<ThreadId | null> => {
      const current = registry.get(state);
      if (current.phase === "worktree" || current.phase === "thread") return null;
      if (current.phase === "created") return current.attempt!.command.threadId;
      const fail = (message: string) => {
        patch(registry, { phase: "error", error: message });
        return null;
      };
      const shared = registry.get(options.shell);
      if (
        registry.get(options.connection).phase !== "connected" ||
        shared.status !== "live" ||
        Option.isSome(shared.error)
      )
        return fail("Connect to the environment before creating a thread.");
      const actual = current.attempt?.input ?? input;
      const project = Option.getOrNull(shared.snapshot)?.projects.find(
        (item) => item.id === actual.projectId,
      );
      if (!project) return fail("This project is no longer available.");
      if (current.attempt && project.workspaceRoot !== current.attempt.cwd)
        return fail(
          "The project directory changed. Any created worktree is retained; inspect it in T3 before continuing.",
        );
      let attempt = current.attempt;
      if (!attempt) {
        const catalog = registry.get(options.providers);
        const provider = catalog.providers.find(
          (item) => item.instanceId === actual.modelSelection.instanceId,
        );
        if (
          catalog.status !== "live" ||
          !provider?.enabled ||
          !provider.installed ||
          provider.availability === "unavailable" ||
          provider.status === "error" ||
          provider.auth.status === "unauthenticated" ||
          !provider.models.some((model) => model.slug === actual.modelSelection.model)
        )
          return fail("Choose an available provider model before creating a thread.");
        const baseRef = actual.baseRef.trim() || "HEAD";
        if (
          actual.mode === "worktree" &&
          (baseRef.startsWith("-") || baseRef.includes("\0") || /[\r\n]/u.test(baseRef))
        )
          return fail("Enter a Git branch or commit ref, such as HEAD or main.");
        const id = Encoding.encodeHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
        const threadId = ThreadId.make(`tui-${id}`);
        attempt = {
          input: { ...actual, baseRef },
          cwd: project.workspaceRoot,
          command: {
            type: "thread.create",
            commandId: CommandId.make(`tui-create-${id}`),
            threadId,
            projectId: project.id,
            title: actual.title.trim() || "New thread",
            modelSelection: actual.modelSelection,
            runtimeMode: actual.runtimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt: DateTime.formatIso(DateTime.nowUnsafe()),
          },
          worktreeInput:
            actual.mode === "worktree"
              ? {
                  cwd: project.workspaceRoot,
                  refName: baseRef,
                  newRefName: `t3-tui/${id}`,
                  path: null,
                }
              : null,
          worktreeAttempted: false,
          worktree: null,
        };
        patch(registry, { attempt });
      }
      const remember = (next: CreationAttempt) => {
        attempt = next;
        patch(registry, { attempt: next });
      };
      try {
        if (attempt.worktreeInput && !attempt.worktree) {
          patch(registry, { phase: "worktree", error: null });
          const recovered = attempt.worktreeAttempted
            ? await options.recoverWorktree(registry, attempt.worktreeInput)
            : null;
          remember({ ...attempt, worktreeAttempted: true });
          const worktree =
            recovered ?? (await options.createWorktree(registry, attempt.worktreeInput!));
          remember({
            ...attempt,
            worktree,
            command: { ...attempt.command, branch: worktree.refName, worktreePath: worktree.path },
          });
        }
        const latestProject = Option.getOrNull(registry.get(options.shell).snapshot)?.projects.find(
          (item) => item.id === attempt!.command.projectId,
        );
        if (!latestProject || latestProject.workspaceRoot !== attempt.cwd)
          return fail(
            "The project changed during creation. The worktree, if created, is retained for recovery.",
          );
        const existing = Option.getOrNull(registry.get(options.shell).snapshot)?.threads.find(
          (item) => item.id === attempt!.command.threadId,
        );
        if (!existing) {
          patch(registry, { phase: "thread", error: null });
          if (!(await options.dispatch(registry, attempt.command)))
            return fail(
              attempt.worktree
                ? "Worktree created, but thread creation was not confirmed. Retry reuses this worktree and thread ID."
                : "Thread creation was not confirmed. Retry reuses the same thread ID.",
            );
        }
        patch(registry, { phase: "created", error: null });
        return attempt.command.threadId;
      } catch {
        return fail(
          attempt.worktree
            ? "The worktree is retained. Retry to finish creating the same thread."
            : attempt.worktreeInput
              ? "Creation was not confirmed. Check the base ref and connection. Retry checks for the same worktree before creating anything else."
              : "Thread creation was not confirmed. Retry reuses the same thread ID.",
        );
      }
    },
  };
}
export type NewThreadActions = ReturnType<typeof makeNewThreadActions>;
