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
  it.each([false, true])(
    "starts on the top favorite and follows its rank (kitty=%s)",
    async (kitty) => {
      const { driver } = await setup(kitty);
      const openFavorites = async () => {
        await driver.input.pressKey("k", { ctrl: true });
        await driver.input.typeText("favorite models");
        await driver.input.pressKey("RETURN");
      };
      const newThread = async () => {
        await driver.input.pressKey("n");
        const form = driver.captureFrame();
        await click(driver, "new-thread-model");
        const menu = driver.captureFrame();
        await driver.input.pressKey("ESCAPE");
        await driver.input.pressKey("ESCAPE");
        return { form, menu };
      };
      const expectBefore = (frame: string, first: string, second: string) =>
        expect(frame.lastIndexOf(first)).toBeLessThan(frame.lastIndexOf(second));

      const initial = await newThread();
      expect(initial.form).toContain("Fixture Codex / Current model v");
      expectBefore(initial.menu, "/ Current model", "/ Alternate model");

      await openFavorites();
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("RETURN");
      let frame = driver.captureFrame();
      expect(frame).toContain("[x] Fixture Codex / Current model");
      expect(frame).toContain("[x] Fixture Codex / Alternate model");
      expect(frame).toContain("1. Fixture Codex / Current model");
      expect(frame).toContain("2. Fixture Codex / Alternate model");

      // Esc puts a held model back; Enter drops it where it is.
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ARROW_DOWN");
      expect(driver.captureFrame()).toContain("↕ 2. Fixture Codex / Current model");
      await driver.input.pressKey("ESCAPE");
      expect(driver.captureFrame()).toContain("1. Fixture Codex / Current model");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("RETURN");
      frame = driver.captureFrame();
      expect(frame).toContain("1. Fixture Codex / Alternate model");
      expect(frame).toContain("2. Fixture Codex / Current model");
      expect(frame).not.toContain("↕");
      await driver.input.pressKey("ESCAPE");

      const ranked = await newThread();
      expect(ranked.form).toContain("Fixture Codex / Alternate model v");
      expect(ranked.menu).toContain("★ Fixture Codex / Alternate model");
      expectBefore(ranked.menu, "/ Alternate model", "/ Current model");

      await openFavorites();
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("x");
      frame = driver.captureFrame();
      expect(frame).toContain("1. Fixture Codex / Current model");
      expect(frame).toContain("[ ] Fixture Codex / Alternate model");
      await driver.input.pressKey("x");
      expect(driver.captureFrame()).toContain("No favorites yet");
      await driver.input.pressKey("ESCAPE");

      const cleared = await newThread();
      expect(cleared.form).toContain("Fixture Codex / Current model v");
      expect(cleared.menu).not.toContain("★");
    },
  );
  it("keeps a favorite listed and removable after its provider stops offering it", async () => {
    const { driver, fixture } = await setup();
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("favorite models");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await act(async () => {
      driver.registry.set(fixture.providers, {
        providers: [{ ...fixture.provider, enabled: false }],
        status: "live",
      });
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("1. codex / gpt-5-codex (unavailable)");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("x");
    expect(driver.captureFrame()).toContain("No favorites yet");
  });
  it.each([false, true])(
    "navigates fields with arrows while preserving text cursor keys (kitty=%s)",
    async (kitty) => {
      const { driver, fixture } = await setup(kitty);
      await driver.input.pressKey("n");
      await driver.input.typeText("Task");
      await driver.input.pressKey("ARROW_LEFT");
      await driver.input.typeText("!");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ARROW_RIGHT");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Base ref");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ARROW_RIGHT");
      await driver.input.pressKey("RETURN");
      for (let index = 0; index < 3; index += 1) await driver.input.pressKey("ARROW_UP");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ARROW_UP");
      expect(driver.captureFrame()).toContain("Supervised v");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("RETURN");
      expect(fixture.creationCommands[0]).toMatchObject({
        title: "Tas!k",
        runtimeMode: "approval-required",
      });
      expect(fixture.worktreeRequests).toHaveLength(1);
    },
  );

  it.each(["approval-required", "auto-accept-edits", "auto", "full-access"] as const)(
    "creates a thread with %s access selected by mouse",
    async (runtimeMode) => {
      const { driver, fixture } = await setup();
      await driver.input.pressKey("n");
      await click(driver, "new-thread-permissions");
      await click(driver, `new-thread-access-${runtimeMode}`);
      await click(driver, "new-thread-create");
      expect(fixture.creationCommands[0]).toMatchObject({ runtimeMode });
      await driver.input.pressKey("i");
      await driver.input.typeText("first prompt");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands[0]).toMatchObject({ type: "thread.turn.start", runtimeMode });
    },
  );
  it.each([false, true])(
    "selects supervised access by keyboard and cancels picker changes (kitty=%s)",
    async (kitty) => {
      const { driver, fixture } = await setup(kitty);
      await driver.input.pressKey("n");
      for (let index = 0; index < 4; index += 1) await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      for (let index = 0; index < 3; index += 1) await driver.input.pressKey("ARROW_UP");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Supervised v");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ESCAPE");
      expect(driver.captureFrame()).toContain("Supervised v");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      expect(fixture.creationCommands[0]).toMatchObject({ runtimeMode: "approval-required" });
    },
  );
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
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      expect(fixture.worktreeRequests).toHaveLength(1);
      expect(fixture.worktreeRequests[0]).toMatchObject({
        refName: "main",
        cwd: "/workspace/alpha",
      });
      expect(fixture.creationCommands[0]!.worktreePath).toContain("/worktrees/");
      expect(driver.captureFrame()).toContain("Worktree  [D Changes]");
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
    await click(driver, "new-thread-permissions");
    await click(driver, "new-thread-access-approval-required");
    await click(driver, "new-thread-create");
    expect(driver.captureFrame()).toContain("/remote/retained-tree");
    await click(driver, "new-thread-permissions");
    expect(driver.captureFrame()).not.toContain("Access level · Esc cancels");
    await click(driver, "new-thread-create");
    expect(driver.registry.get(newThreads.state).attempt?.input.runtimeMode).toBe(
      "approval-required",
    );
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
