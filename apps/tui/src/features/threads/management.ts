import { CommandId, type ClientOrchestrationCommand, type ThreadId } from "@t3tools/contracts";
import type { AtomRegistry } from "effect/unstable/reactivity";

export type ThreadManagementCommand = Extract<
  ClientOrchestrationCommand,
  {
    readonly type: "thread.meta.update" | "thread.archive" | "thread.unarchive" | "thread.delete";
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
}

const commandId = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return CommandId.make(
    `tui-thread-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
};

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
    archive: (registry, threadId) =>
      run(registry, { type: "thread.archive", commandId: commandId(), threadId }),
    unarchive: (registry, threadId) =>
      run(registry, { type: "thread.unarchive", commandId: commandId(), threadId }),
    delete: (registry, threadId) =>
      run(registry, { type: "thread.delete", commandId: commandId(), threadId }),
  };
}
