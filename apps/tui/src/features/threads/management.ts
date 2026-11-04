import type { TuiCommand } from "../../connection/commands.ts";
import { CommandId, type ThreadId } from "@t3tools/contracts";
import type { AtomRegistry } from "effect/reactivity";

export type ThreadManagementCommand = Extract<
  TuiCommand,
  {
    readonly type:
      | "thread.meta.update"
      | "thread.archive"
      | "thread.unarchive"
      | "thread.delete"
      | "thread.settle"
      | "thread.unsettle"
      | "thread.snooze"
      | "thread.unsnooze"
      | "thread.pin"
      | "thread.unpin"
      | "thread.pin.reorder"
      | "thread.active.reorder"
      | "thread.auto-settle.set"
      | "thread.visit"
      | "thread.mark-unread";
  }
>;

export interface ThreadManagementActions {
  readonly rename: (
    registry: AtomRegistry.AtomRegistry,
    threadId: ThreadId,
    title: string,
  ) => Promise<boolean>;
  readonly archive: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => Promise<boolean>;
  readonly unarchive: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => Promise<boolean>;
  readonly delete: (registry: AtomRegistry.AtomRegistry, threadId: ThreadId) => Promise<boolean>;
  /** Records the branch the thread's checkout moved to. */
  readonly setBranch: (
    registry: AtomRegistry.AtomRegistry,
    threadId: ThreadId,
    branch: string,
  ) => Promise<boolean>;
  readonly lifecycle: (
    registry: AtomRegistry.AtomRegistry,
    threadId: ThreadId,
    change: ThreadLifecycleChange,
  ) => Promise<boolean>;
}

/** What the GUI sidebar can do to a thread. None of it changes which threads are archived. */
export type ThreadLifecycleChange =
  | { readonly type: "unpin" | "settle" | "unsettle" | "wake" | "mark-unread" }
  | { readonly type: "pin"; readonly orderKey?: string }
  | { readonly type: "regenerate-title" }
  | { readonly type: "snooze"; readonly until: string }
  | { readonly type: "visit"; readonly at: string }
  | { readonly type: "auto-settle"; readonly enabled: boolean }
  | { readonly type: "reorder"; readonly shelf: "pinned" | "active"; readonly orderKey: string };

/**
 * How to put a thread back after a change. Restoring a pin clears a snooze on the server, so the
 * snooze comes back last.
 */
export function planThreadUndo(
  action: "settle" | "snooze" | "unpin",
  thread: {
    readonly pinnedAt?: string | null | undefined;
    readonly pinOrderKey?: string | null | undefined;
    readonly snoozedUntil?: string | null | undefined;
  },
): readonly ThreadLifecycleChange[] {
  if (action === "snooze") return [{ type: "wake" }];
  const pin: ThreadLifecycleChange = {
    type: "pin",
    ...(thread.pinOrderKey != null ? { orderKey: thread.pinOrderKey } : {}),
  };
  const snooze: readonly ThreadLifecycleChange[] =
    thread.snoozedUntil != null ? [{ type: "snooze", until: thread.snoozedUntil }] : [];
  if (action === "unpin") return [pin, ...snooze];
  return [{ type: "unsettle" }, ...(thread.pinnedAt != null ? [pin] : []), ...snooze];
}

const commandId = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return CommandId.make(
    `tui-thread-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
};

function lifecycleCommand(
  threadId: ThreadId,
  change: ThreadLifecycleChange,
): ThreadManagementCommand {
  const base = { commandId: commandId(), threadId };
  switch (change.type) {
    case "pin":
      return {
        ...base,
        type: "thread.pin",
        ...(change.orderKey === undefined ? {} : { orderKey: change.orderKey }),
      };
    case "unpin":
      return { ...base, type: "thread.unpin" };
    case "settle":
      return { ...base, type: "thread.settle" };
    case "unsettle":
      return { ...base, type: "thread.unsettle", reason: "user" };
    case "wake":
      return { ...base, type: "thread.unsnooze", reason: "user" };
    case "mark-unread":
      return { ...base, type: "thread.mark-unread" };
    case "regenerate-title":
      return { ...base, type: "thread.meta.update", regenerateTitle: true };
    case "snooze":
      return { ...base, type: "thread.snooze", snoozedUntil: change.until };
    case "visit":
      return { ...base, type: "thread.visit", visitedAt: change.at };
    case "auto-settle":
      return { ...base, type: "thread.auto-settle.set", enabled: change.enabled };
    case "reorder":
      return {
        ...base,
        type: change.shelf === "pinned" ? "thread.pin.reorder" : "thread.active.reorder",
        orderKey: change.orderKey,
      };
  }
}

export function makeThreadManagementActions(options: {
  readonly dispatch: (
    registry: AtomRegistry.AtomRegistry,
    command: ThreadManagementCommand,
  ) => Promise<boolean>;
  readonly refreshArchived: (registry: AtomRegistry.AtomRegistry) => void;
}): ThreadManagementActions {
  const run = async (registry: AtomRegistry.AtomRegistry, command: ThreadManagementCommand) => {
    const accepted = await options.dispatch(registry, command);
    if (accepted) options.refreshArchived(registry);
    return accepted;
  };
  return {
    rename: (registry, threadId, title) => {
      const trimmed = title.trim();
      if (!trimmed) return Promise.resolve(false);
      return run(registry, {
        type: "thread.meta.update",
        commandId: commandId(),
        threadId,
        title: trimmed,
      });
    },
    setBranch: (registry, threadId, branch) =>
      run(registry, { type: "thread.meta.update", commandId: commandId(), threadId, branch }),
    archive: (registry, threadId) =>
      run(registry, { type: "thread.archive", commandId: commandId(), threadId }),
    unarchive: (registry, threadId) =>
      run(registry, { type: "thread.unarchive", commandId: commandId(), threadId }),
    delete: (registry, threadId) =>
      run(registry, { type: "thread.delete", commandId: commandId(), threadId }),
    // Archives are unaffected, so these skip the archive refresh that `run` does.
    lifecycle: (registry, threadId, change) =>
      options.dispatch(registry, lifecycleCommand(threadId, change)),
  };
}
