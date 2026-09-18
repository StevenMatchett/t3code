import { describe, expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/unstable/reactivity";
import { makeClientFixture } from "../../testing/clientFixture.ts";
import {
  makeNewThreadActions,
  type CreateThreadCommand,
  type NewThreadInput,
} from "./newThread.ts";
import type { VcsCreateWorktreeInput } from "@t3tools/contracts";

function input(
  fixture: ReturnType<typeof makeClientFixture>,
  mode: NewThreadInput["mode"],
): NewThreadInput {
  return {
    projectId: fixture.projects[0]!.id,
    title: "New task",
    modelSelection: fixture.details[0]!.modelSelection,
    runtimeMode: "auto",
    mode,
    baseRef: "HEAD",
  };
}

describe("new thread creation", () => {
  it("creates an empty checkout thread without worktree or provider turn commands", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    try {
      const id = await f.client.newThreads.create(registry, input(f, "local"));
      expect(f.creationCommands).toHaveLength(1);
      expect(f.creationCommands[0]).toMatchObject({
        type: "thread.create",
        threadId: id,
        branch: null,
        worktreePath: null,
        runtimeMode: "auto",
        title: "New task",
      });
      expect(f.commands).toHaveLength(0);
      expect(f.worktreeRequests).toHaveLength(0);
    } finally {
      registry.dispose();
    }
  });
  it("uses the worktree returned by the server before creating the thread and blocks double submission", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    const receipt = Promise.withResolvers<{ path: string; refName: string }>();
    const worktrees: VcsCreateWorktreeInput[] = [];
    const commands: CreateThreadCommand[] = [];
    const actions = makeNewThreadActions({
      shell: f.shell,
      connection: f.client.connection,
      providers: f.providers,
      createWorktree: async (_registry, request) => {
        worktrees.push(request);
        return receipt.promise;
      },
      recoverWorktree: async () => null,
      dispatch: async (_registry, command) => {
        commands.push(command);
        return true;
      },
    });
    try {
      const first = actions.create(registry, input(f, "worktree"));
      expect(await actions.create(registry, input(f, "worktree"))).toBeNull();
      expect(commands).toHaveLength(0);
      expect(worktrees).toHaveLength(1);
      expect(worktrees[0]).toMatchObject({
        cwd: f.projects[0]!.workspaceRoot,
        refName: "HEAD",
        path: null,
      });
      receipt.resolve({ path: "/remote/worktrees/task", refName: worktrees[0]!.newRefName! });
      await first;
      expect(commands[0]).toMatchObject({
        branch: worktrees[0]!.newRefName,
        worktreePath: "/remote/worktrees/task",
      });
    } finally {
      registry.dispose();
    }
  });
  it("retains a created worktree and reuses the same command after a failed thread request", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    let count = 0;
    const commands: CreateThreadCommand[] = [];
    const actions = makeNewThreadActions({
      shell: f.shell,
      connection: f.client.connection,
      providers: f.providers,
      createWorktree: async (_registry, request) => {
        count += 1;
        return { path: "/remote/tree", refName: request.newRefName! };
      },
      recoverWorktree: async () => null,
      dispatch: async (_registry, command) => {
        commands.push(command);
        return commands.length > 1;
      },
    });
    try {
      expect(await actions.create(registry, input(f, "worktree"))).toBeNull();
      expect(registry.get(actions.state).error).toContain("Worktree created");
      actions.reset(registry);
      expect(registry.get(actions.state).attempt?.worktree?.path).toBe("/remote/tree");
      await actions.create(registry, {
        ...input(f, "local"),
        title: "do not replace the failed intent",
      });
      expect(count).toBe(1);
      expect(commands[1]).toEqual(commands[0]);
    } finally {
      registry.dispose();
    }
  });
  it("recovers an unconfirmed worktree response by its generated branch rather than duplicating it", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    let creates = 0;
    let recovered = 0;
    const actions = makeNewThreadActions({
      shell: f.shell,
      connection: f.client.connection,
      providers: f.providers,
      createWorktree: async () => {
        creates += 1;
        throw new Error("lost reply");
      },
      recoverWorktree: async (_registry, request) => {
        recovered += 1;
        return { path: "/remote/recovered", refName: request.newRefName! };
      },
      dispatch: async () => true,
    });
    try {
      expect(await actions.create(registry, input(f, "worktree"))).toBeNull();
      const id = registry.get(actions.state).attempt!.command.threadId;
      expect(await actions.create(registry, input(f, "worktree"))).toBe(id);
      expect(creates).toBe(1);
      expect(recovered).toBe(1);
      expect(registry.get(actions.state).attempt!.command.worktreePath).toBe("/remote/recovered");
    } finally {
      registry.dispose();
    }
  });
  it("does not fall back to the checkout when a worktree cannot be created", async () => {
    const f = makeClientFixture();
    const registry = AtomRegistry.make();
    let dispatched = false;
    const actions = makeNewThreadActions({
      shell: f.shell,
      connection: f.client.connection,
      providers: f.providers,
      createWorktree: async () => {
        throw new Error("no commits");
      },
      recoverWorktree: async () => null,
      dispatch: async () => {
        dispatched = true;
        return true;
      },
    });
    try {
      expect(await actions.create(registry, input(f, "worktree"))).toBeNull();
      expect(dispatched).toBe(false);
      expect(registry.get(actions.state).phase).toBe("error");
    } finally {
      registry.dispose();
    }
  });
});
