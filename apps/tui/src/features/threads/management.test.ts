import { describe, expect, it, vi } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";

import { makeThreadManagementActions, type ThreadManagementCommand } from "./management.ts";

describe("thread management actions", () => {
  it("dispatches shared rename/archive/unarchive/delete commands and refreshes archived state", async () => {
    const commands: ThreadManagementCommand[] = [];
    const refreshArchived = vi.fn();
    const actions = makeThreadManagementActions({
      dispatch: async (_registry, command) => {
        commands.push(command);
        return true;
      },
      refreshArchived,
    });
    const registry = AtomRegistry.make();
    const threadId = ThreadId.make("thread-1");
    try {
      expect(await actions.rename(registry, threadId, "  Better title  ")).toBe(true);
      expect(await actions.archive(registry, threadId)).toBe(true);
      expect(await actions.unarchive(registry, threadId)).toBe(true);
      expect(await actions.delete(registry, threadId)).toBe(true);
      expect(commands.map((command) => command.type)).toEqual([
        "thread.meta.update",
        "thread.archive",
        "thread.unarchive",
        "thread.delete",
      ]);
      expect(commands[0]).toMatchObject({ threadId, title: "Better title" });
      expect(refreshArchived).toHaveBeenCalledTimes(4);
    } finally {
      registry.dispose();
    }
  });

  it("rejects an empty title without dispatching", async () => {
    const dispatch = vi.fn(async () => true);
    const actions = makeThreadManagementActions({ dispatch, refreshArchived: () => {} });
    const registry = AtomRegistry.make();
    try {
      expect(await actions.rename(registry, ThreadId.make("thread-1"), "   ")).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      registry.dispose();
    }
  });
});
