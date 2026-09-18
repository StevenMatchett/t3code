import { afterEach, describe, expect, it } from "@effect/vitest";
import { MouseButtons } from "@opentui/core/testing";
import * as Option from "effect/Option";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";
import { makeNewThreadActions } from "../features/chat/newThread.ts";

const drivers = new Set<TuiTestDriver>();
afterEach(async () => {
  await Promise.all([...drivers].map((driver) => driver.close()));
  drivers.clear();
});
async function setup(kittyKeyboard = true) {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 100,
    height: 28,
    kittyKeyboard,
  });
  drivers.add(driver);
  return { driver, fixture };
}
async function click(driver: TuiTestDriver, id: string) {
  const element = driver.renderer.root.findDescendantById(id);
  expect(element).toBeDefined();
  await driver.mouse.click(element!.screenX + 1, element!.screenY, MouseButtons.LEFT, {
    delayMs: 0,
  });
}

describe("new thread form", () => {
  it("opens an empty shared thread in the current checkout from the visible action", async () => {
    const { driver, fixture } = await setup();
    await click(driver, "new-thread-action");
    expect(driver.captureFrame()).toContain("New thread in Alpha");
    await driver.input.typeText("Checkout task");
    await click(driver, "new-thread-create");
    expect(fixture.creationCommands).toHaveLength(1);
    expect(fixture.creationCommands[0]).toMatchObject({
      title: "Checkout task",
      worktreePath: null,
      branch: null,
    });
    expect(fixture.commands).toHaveLength(0);
    expect(fixture.worktreeRequests).toHaveLength(0);
    expect(driver.captureFrame()).toContain("Checkout task");
    expect(driver.captureFrame()).toContain("No messages in this thread");
    await driver.input.pressKey("i");
    await driver.input.typeText("first prompt");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.turn.start",
      threadId: fixture.creationCommands[0]!.threadId,
      message: { text: "first prompt" },
    });
  });
  it.each([false, true])(
    "creates a worktree thread from keyboard fields (kitty=%s)",
    async (kitty) => {
      const { driver, fixture } = await setup(kitty);
      await driver.input.pressKey("n");
      await driver.input.typeText("Isolated task");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Base ref");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      expect(fixture.worktreeRequests).toHaveLength(1);
      expect(fixture.worktreeRequests[0]).toMatchObject({
        refName: "HEAD",
        cwd: "/workspace/alpha",
      });
      expect(fixture.creationCommands[0]!.worktreePath).toContain("/worktrees/");
      expect(driver.captureFrame()).toContain("Worktree:");
      expect(driver.captureFrame()).toContain("No messages in this thread");
      expect(fixture.commands).toHaveLength(0);
      await driver.input.pressKey("ESCAPE");
      expect(driver.captureFrame()).toContain("Isolated task [WT]");
    },
  );
  it("cancels before creation without changing the existing draft or sending commands", async () => {
    const { driver, fixture } = await setup();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.typeText("keep existing draft");
    await click(driver, "new-thread-action");
    await click(driver, "new-thread-worktree");
    await driver.input.pressKey("ESCAPE");
    expect(fixture.creationCommands).toHaveLength(0);
    expect(fixture.worktreeRequests).toHaveLength(0);
    expect(driver.captureFrame()).toContain("keep existing draft");
  });
  it("requires confirmation before starting over after partial creation and keeps the worktree", async () => {
    const fixture = makeClientFixture();
    let worktrees = 0;
    const newThreads = makeNewThreadActions({
      shell: fixture.shell,
      connection: fixture.client.connection,
      providers: fixture.providers,
      createWorktree: async (_registry, input) => {
        worktrees += 1;
        return { path: "/remote/retained-tree", refName: input.newRefName! };
      },
      recoverWorktree: async () => null,
      dispatch: async () => false,
    });
    const driver = await createTuiTestDriver(
      <AppShell client={{ ...fixture.client, newThreads }} />,
      { width: 100, height: 28 },
    );
    drivers.add(driver);
    await driver.input.pressKey("n");
    await click(driver, "new-thread-worktree");
    await click(driver, "new-thread-create");
    expect(driver.captureFrame()).toContain("/remote/retained-tree");
    await click(driver, "new-thread-restart");
    expect(driver.registry.get(newThreads.state).attempt).not.toBeNull();
    expect(driver.captureFrame()).toContain("Start over keeps");
    await click(driver, "new-thread-restart");
    expect(driver.registry.get(newThreads.state).attempt).toBeNull();
    expect(worktrees).toBe(1);
    expect(fixture.creationCommands).toHaveLength(0);
  });

  it("does not switch creation to another project when the selected project disappears", async () => {
    const { driver, fixture } = await setup();
    await driver.input.pressKey("n");
    await act(async () =>
      driver.registry.update(fixture.shell, (state) => ({
        ...state,
        snapshot: Option.map(state.snapshot, (snapshot) => ({
          ...snapshot,
          projects: [fixture.projects[1]!],
          threads: fixture.threads.filter((thread) => thread.projectId === fixture.projects[1]!.id),
        })),
      })),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("project is no longer available");
    await driver.input.pressKey("ESCAPE");
    expect(fixture.creationCommands).toHaveLength(0);
  });
});
