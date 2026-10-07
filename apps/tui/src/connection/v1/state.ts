import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom, type AtomRegistry } from "effect/reactivity";
import type { TuiShellState, TuiThreadState } from "../models.ts";
import * as V1 from "./contracts.ts";
import { currentClient, follow } from "./rpc.ts";
import { applyShellStreamEvent } from "./shellReducer.ts";
import { applyThreadDetailEvent } from "./threadReducer.ts";
import { presentV1Shell, presentV1Thread } from "./presentation.ts";

const emptyHistory = {
  historyCursor: null,
  hasMoreHistory: false,
  loading: false,
  error: null,
  expanded: false,
  latestLocalTurnOrdinal: null,
};
const emptyThread: TuiThreadState = {
  data: Option.none(),
  status: "empty",
  error: Option.none(),
  history: emptyHistory,
};
const emptyShell: TuiShellState = {
  snapshot: Option.none(),
  status: "empty",
  error: Option.none(),
};

export function createV1State<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
  environmentId: EnvironmentId,
) {
  const shellStream = createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "tui.v1.shell",
    subscribe: () =>
      follow(emptyShell, (client) => {
        let snapshot: V1.OrchestrationShellSnapshot | undefined;
        let live = false;
        return client["orchestration.subscribeShell"]({ requestCompletionMarker: true }).pipe(
          Stream.map((item): TuiShellState => {
            if (item.kind === "synchronized") live = true;
            if (item.kind === "snapshot") snapshot = item.snapshot;
            else if (snapshot && item.kind !== "synchronized")
              snapshot = applyShellStreamEvent(snapshot, item);
            return {
              snapshot: snapshot
                ? Option.some({ ...snapshot, threads: snapshot.threads.map(presentV1Shell) })
                : Option.none(),
              status: live ? "live" : "synchronizing",
              error: Option.none(),
            };
          }),
          Stream.catch(() =>
            Stream.succeed({ ...emptyShell, error: Option.some("Could not load projects.") }),
          ),
        );
      }),
  })({ environmentId, input: undefined });
  const shell = Atom.make((get) => {
    const result = get(shellStream);
    const value = AsyncResult.isFailure(result)
      ? { ...emptyShell, error: Option.some("Could not load projects.") }
      : Option.getOrElse(AsyncResult.value(result), () => emptyShell);
    const previous = Option.getOrNull(get.self<TuiShellState>());
    return Option.isNone(value.snapshot) && previous
      ? { ...value, snapshot: previous.snapshot, status: "synchronizing" as const }
      : value;
  });
  const limits = Atom.family((_id: ThreadId) => Atom.make(20));
  const detailStream = createEnvironmentSubscriptionAtomFamily(runtime, {
    label: "tui.v1.thread",
    idleTtlMs: 0,
    subscribe: (input: { threadId: ThreadId; turnLimit: number }) =>
      follow(emptyThread, (client) => {
        let detail: V1.OrchestrationThread | undefined;
        let sequence = -1;
        let live = false;
        let history: TuiThreadState["history"] = emptyHistory;
        return client["orchestration.subscribeThread"]({
          ...input,
          requestCompletionMarker: true,
        }).pipe(
          Stream.map((item): TuiThreadState => {
            let deleted = false;
            if (item.kind === "snapshot") {
              detail = item.snapshot.thread;
              sequence = item.snapshot.snapshotSequence;
              history = {
                ...emptyHistory,
                hasMoreHistory: item.snapshot.page?.hasMore ?? false,
                historyCursor: item.snapshot.page?.beforeCursor ?? null,
                expanded: input.turnLimit > 20,
              };
            } else if (item.kind === "synchronized") live = true;
            else if (detail && item.event.sequence > sequence) {
              const next = applyThreadDetailEvent(detail, item.event);
              sequence = item.event.sequence;
              if (next.kind === "updated") detail = next.thread;
              else if (next.kind === "deleted") {
                detail = undefined;
                deleted = true;
              }
            }
            return {
              data: detail ? Option.some(presentV1Thread(detail)) : Option.none(),
              status: deleted ? "deleted" : live ? "live" : "synchronizing",
              error: Option.none(),
              history,
            };
          }),
          Stream.catch(() =>
            Stream.succeed({ ...emptyThread, error: Option.some("Could not load this thread.") }),
          ),
        );
      }),
  });
  const shellStatus = Atom.map(shell, (state) => state.status);
  const metadata = Atom.family((threadId: ThreadId) =>
    Atom.make((get) =>
      Option.getOrNull(get(shell).snapshot)?.threads.find((thread) => thread.id === threadId),
    ),
  );
  const thread = Atom.family((threadId: ThreadId) =>
    Atom.make((get) => {
      const result = get(
        detailStream({ environmentId, input: { threadId, turnLimit: get(limits(threadId)) } }),
      );
      const detail = AsyncResult.isFailure(result)
        ? { ...emptyThread, error: Option.some("Could not load this thread.") }
        : Option.getOrElse(AsyncResult.value(result), () => emptyThread);
      const shared = get(metadata(threadId));
      // V1 sends metadata only on the shell stream; detail owns the collections.
      const value: TuiThreadState = {
        ...detail,
        status:
          detail.status === "live" && get(shellStatus) !== "live" ? "synchronizing" : detail.status,
        data: shared
          ? Option.map(detail.data, (data) => ({ ...data, ...shared, deletedAt: data.deletedAt }))
          : detail.data,
      };
      const previous = Option.getOrNull(get.self<TuiThreadState>());
      return value.status !== "deleted" && Option.isNone(value.data) && previous
        ? {
            ...value,
            data: previous.data,
            status: "synchronizing" as const,
            history: {
              ...previous.history,
              loading: Option.isNone(value.error),
              error: Option.getOrNull(value.error),
            },
          }
        : value;
    }),
  );
  return {
    shell,
    thread,
    loadOlder: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => {
      const history = registry.get(thread(threadId)).history;
      if (!history.hasMoreHistory || history.loading) return false;
      registry.set(limits(threadId), registry.get(limits(threadId)) + 20);
      return true;
    },
    orchestration: {
      archivedShellSnapshot: createEnvironmentQueryAtomFamily(runtime, {
        label: "tui.v1.archived",
        execute: (_input: {}) =>
          currentClient.pipe(
            Effect.flatMap((client) => client["orchestration.getArchivedShellSnapshot"]({})),
            Effect.map((snapshot) => ({
              ...snapshot,
              threads: snapshot.threads.map(presentV1Shell),
            })),
          ),
      }),
      threadSearch: createEnvironmentQueryAtomFamily(runtime, {
        label: "tui.v1.search",
        execute: (input: V1.OrchestrationSearchThreadsInput) =>
          currentClient.pipe(
            Effect.flatMap((client) => client["orchestration.searchThreads"](input)),
          ),
      }),
      turnDiff: createEnvironmentQueryAtomFamily(runtime, {
        label: "tui.v1.turnDiff",
        execute: (input: V1.OrchestrationGetTurnDiffInput) =>
          currentClient.pipe(
            Effect.flatMap((client) => client["orchestration.getTurnDiff"](input)),
          ),
      }),
      fullThreadDiff: createEnvironmentQueryAtomFamily(runtime, {
        label: "tui.v1.fullDiff",
        execute: (input: V1.OrchestrationGetFullThreadDiffInput) =>
          currentClient.pipe(
            Effect.flatMap((client) => client["orchestration.getFullThreadDiff"](input)),
          ),
      }),
    },
  };
}
