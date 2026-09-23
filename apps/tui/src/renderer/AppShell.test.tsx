import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { CliRenderEvents, type Selection } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { EMPTY_TERMINAL_BUFFER_STATE } from "@t3tools/client-runtime/state/terminal";
import {
  CheckpointRef,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";
import { UiProvider } from "../ui/context.tsx";
import { basicTerminalCapabilities } from "../ui/capabilities.ts";

const activeDrivers = new Set<TuiTestDriver>();
let agentActivitySequence = 0;
function agentActivity(
  kind: string,
  summary: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  agentActivitySequence += 1;
  return {
    id: `agent-activity-${agentActivitySequence}`,
    tone: kind.startsWith("tool.") ? "tool" : "info",
    kind,
    summary,
    payload,
    turnId: null,
    createdAt: `2026-01-01T00:00:${String(agentActivitySequence).padStart(2, "0")}.000Z`,
  } as unknown as OrchestrationThreadActivity;
}
async function renderShell(
  options?: Parameters<typeof createTuiTestDriver>[1],
  shellOptions?: { readonly searchDebounceMs?: number },
) {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(
    <AppShell client={fixture.client} {...shellOptions} />,
    options,
  );
  activeDrivers.add(driver);
  return { driver, fixture };
}
afterEach(async () => {
  await Promise.all([...activeDrivers].map((driver) => driver.close()));
  activeDrivers.clear();
});

const runtime = globalThis as typeof globalThis & {
  process?: { getBuiltinModule?: (id: string) => unknown };
};
const describeWithNativeFfi = runtime.process?.getBuiltinModule?.("node:ffi")
  ? describe
  : describe.skip;

describeWithNativeFfi("connected AppShell", () => {
  it("shows archived sidebar rows with project context and opens management by mouse", async () => {
    const { driver, fixture } = await renderShell({ width: 120, height: 32 });
    const archived = {
      ...fixture.threads[0]!,
      id: ThreadId.make("archived-one"),
      title: "Old work",
      archivedAt: "2026-01-01T00:00:00Z",
    };
    await act(async () =>
      driver.registry.set(fixture.archivedThreads, { status: "live", threads: [archived] }),
    );
    await driver.input.pressKey("ARROW_RIGHT");
    await driver.input.pressKey("ARROW_RIGHT");
    expect(driver.captureFrame()).toContain("Projects Recent [Archived]");
    expect(driver.captureFrame()).toContain("Archived threads (1)");
    const row = driver.renderer.root.findDescendantById("navigation-archived-one")!;
    expect(driver.captureRawFrame().split("\n")[row.screenY + 1]).toContain("Alpha");
    await driver.mouse.click(row.screenX + 1, row.screenY, MouseButtons.LEFT, { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Manage archived thread");
    expect(driver.captureFrame()).toContain("Restore thread");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("Archived threads (1)");
  });

  it.each([44, 120])(
    "switches sidebar views with Left/Right at width %i without intercepting editor arrows",
    async (width) => {
      const { driver, fixture } = await renderShell({ width, height: 28, kittyKeyboard: true });
      await driver.input.pressKey("ARROW_RIGHT");
      expect(driver.captureFrame()).toContain("Recent threads (3)");
      await driver.input.pressKey("ARROW_RIGHT");
      expect(driver.captureFrame()).toContain("Archived threads (0)");
      await driver.input.pressKey("ARROW_LEFT");
      expect(driver.captureFrame()).toContain("Recent threads (3)");
      await driver.input.pressKey("ARROW_LEFT");
      expect(driver.captureFrame()).toContain("Projects (2)");
      await driver.input.pressKey("b", { ctrl: true });
      expect(driver.captureFrame()).toContain("Recent threads (3)");
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("i");
      await driver.input.typeText("draft");
      await driver.input.pressKey("ARROW_LEFT");
      await driver.input.typeText("!");
      expect(driver.registry.get(fixture.client.actions.state(fixture.details[0]!.id)).draft).toBe(
        "draf!t",
      );
      expect(driver.captureFrame()).toContain("MESSAGE");
    },
  );
  it("toggles the recent sidebar, orders across projects, and opens threads with their project context", async () => {
    const { driver, fixture } = await renderShell({ width: 120, height: 32, kittyKeyboard: true });
    await act(async () =>
      driver.registry.update(fixture.shell, (value) => ({
        ...value,
        snapshot: Option.map(value.snapshot, (snapshot) => ({
          ...snapshot,
          threads: snapshot.threads.map((thread) => ({
            ...thread,
            updatedAt: thread.id === "thread-2" ? "2026-02-01T00:00:00.000Z" : thread.updatedAt,
          })),
        })),
      })),
    );
    await driver.input.pressKey("b", { ctrl: true });
    expect(driver.captureFrame()).toContain("Recent threads (3)");
    const newest = driver.renderer.root.findDescendantById("navigation-thread-2")!;
    const older = driver.renderer.root.findDescendantById("navigation-thread-0")!;
    expect(newest.screenY).toBeLessThan(older.screenY);
    expect(newest.height).toBe(2);
    expect(driver.captureFrame().split("\n")[newest.screenY + 1]).toContain("Beta");
    await driver.input.pressKey("ARROW_UP");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("reply-2");
    const toggle = driver.renderer.root.findDescendantById("sidebar-view-toggle")!;
    await driver.mouse.click(toggle.screenX + 1, toggle.screenY, MouseButtons.LEFT, { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Archived threads (0)");
    await driver.input.pressKey("b", { ctrl: true });
    await driver.input.pressKey("b", { ctrl: true });
    await driver.resize(44, 22);
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("Recent threads (3)");
    expect(driver.captureFrame()).toContain("Beta");
  });
  it.each(["arrows", "shortcut", "mouse"])(
    "resets sidebar selection when switching views with %s",
    async (method) => {
      const { driver } = await renderShell({ width: 120, height: 32, kittyKeyboard: true });
      const switchView = async (key: "ARROW_LEFT" | "ARROW_RIGHT") => {
        if (method === "arrows") await driver.input.pressKey(key);
        else if (method === "shortcut") await driver.input.pressKey("b", { ctrl: true });
        else {
          const toggle = driver.renderer.root.findDescendantById("sidebar-view-toggle")!;
          await driver.mouse.click(toggle.screenX + 1, toggle.screenY, MouseButtons.LEFT, {
            delayMs: 0,
          });
        }
      };
      await driver.input.pressKey("ARROW_DOWN");
      await switchView("ARROW_RIGHT");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("┌─First conversation");
      await driver.input.pressKey("ESCAPE");
      await driver.input.pressKey("ARROW_DOWN");
      await driver.input.pressKey("ARROW_DOWN");
      await switchView("ARROW_LEFT");
      if (method !== "arrows") {
        expect(driver.captureFrame()).toContain("Archived threads (0)");
        await switchView("ARROW_LEFT");
      }
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Threads (2) - Alpha");
    },
  );

  it("opens saved diffs and preserves the draft when closing", async () => {
    const { driver, fixture } = await renderShell({ width: 100, height: 28 });
    const working = vi.spyOn(fixture.client.review, "diffPreview");
    const turn = vi.spyOn(fixture.client.diffs, "turnDiff");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("d");
    expect(driver.captureFrame()).toContain("No saved changes yet");
    await driver.input.pressKey("w");
    expect(driver.captureFrame()).toContain("Uncommitted workspace changes");
    expect(working).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { cwd: "/workspace/alpha" },
      }),
    );
    expect(driver.captureFrame()).toContain("+new workspace");
    await driver.input.pressKey("ARROW_DOWN");
    expect(driver.captureFrame()).toContain("+new second");
    expect(driver.captureFrame()).not.toContain("+new workspace");
    await driver.resize(60, 28);
    expect(driver.captureFrame()).toContain("second.ts");
    expect(driver.captureFrame()).not.toContain("+new second");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("+new second");
    await driver.input.pressKey("ARROW_LEFT");
    expect(driver.captureFrame()).not.toContain("+new second");
    await driver.resize(100, 28);
    await driver.input.pressKey("ESCAPE");
    await act(async () => {
      driver.registry.update(fixture.states[0]!, (state) => ({
        ...state,
        data: Option.map(state.data, (thread) => ({
          ...thread,
          checkpoints: [
            {
              turnId: TurnId.make("diff-turn"),
              checkpointTurnCount: 1,
              checkpointRef: CheckpointRef.make("refs/checkpoints/test"),
              status: "ready" as const,
              files: [],
              assistantMessageId: null,
              completedAt: thread.createdAt,
            },
          ],
        })),
      }));
    });
    await driver.input.pressKey("i");
    await driver.input.typeText("keep draft");
    const action = driver.renderer.root.findDescendantById("thread-diff-action")!;
    await driver.mouse.click(action.screenX + 1, action.screenY, MouseButtons.LEFT, { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Saved changes through turn 1");
    expect(driver.captureFrame()).toContain("-old value");
    expect(driver.captureFrame()).toContain("+new value");
    await driver.input.pressKey("]");
    await driver.input.pressKey("]");
    expect(driver.captureFrame()).toContain("Turn 1 changes");
    expect(turn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { threadId: fixture.details[0]!.id, fromTurnCount: 0, toTurnCount: 1 },
      }),
    );
    expect(driver.captureFrame()).toContain("+after turn");
    expect(driver.captureFrame()).not.toContain("+new value");
    await driver.input.pressKey("s");
    expect(driver.captureFrame()).toContain("+new value");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("keep draft");
  });
  it("copies a mouse selection and reports the result in the status line", async () => {
    const { driver } = await renderShell({ width: 80, height: 24 });
    const copy = vi.spyOn(driver.renderer, "copyToClipboardOSC52").mockReturnValue(true);

    await act(async () => {
      driver.renderer.emit(CliRenderEvents.SELECTION, {
        getSelectedText: () => "selected conversation text",
      } as Selection);
    });
    await driver.flush();

    expect(copy).toHaveBeenCalledWith("selected conversation text");
    expect(driver.captureFrame()).toContain("Copied to clipboard.");

    copy.mockReturnValue(false);
    await act(async () => {
      driver.renderer.emit(CliRenderEvents.SELECTION, {
        getSelectedText: () => "another selection",
      } as Selection);
    });
    await driver.flush();

    expect(driver.captureFrame()).toContain("Copy unavailable in this terminal.");
  });

  it.each([false, true])(
    "opens actual project and thread selections with arrows, Tab, and Enter (kitty=%s)",
    async (kittyKeyboard) => {
      const { driver } = await renderShell({ width: 80, height: 24, kittyKeyboard });
      expect(driver.captureFrame()).toContain("> Alpha");
      await driver.input.pressKey("ARROW_DOWN");
      expect(driver.captureFrame()).toContain("> Beta");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Threads (1) - Beta");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("reply-2");
      await driver.input.pressKey("ARROW_LEFT");
      expect(driver.captureFrame()).toContain("> Other project conversation");
      await driver.input.pressKey("ESCAPE");
      expect(driver.captureFrame()).toContain("> Beta");
      await driver.input.pressKey("TAB", { shift: true });
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("TAB");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("reply-1");
      expect(driver.captureFrame()).toContain("Message / Enter to write");
      expect(driver.captureFrame()).not.toContain("connected / live");
      expect(driver.captureFrame()).not.toContain("Creation, Git, and terminal UI");
      expect(driver.captureFrame()).toContain("New project");
    },
  );

  it("opens projects and threads by clicking their rows", async () => {
    const { driver } = await renderShell({ width: 80, height: 24 });
    const beta = driver.renderer.root.findDescendantById("navigation-beta");
    expect(beta).toBeDefined();
    await driver.mouse.click(beta!.screenX + 1, beta!.screenY, MouseButtons.LEFT, { delayMs: 0 });
    expect(driver.captureFrame()).toContain("Threads (1) - Beta");

    const thread = driver.renderer.root.findDescendantById("navigation-thread-2");
    expect(thread).toBeDefined();
    await driver.mouse.click(thread!.screenX + 1, thread!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    expect(driver.captureFrame()).toContain("reply-2");
  });

  it("shows the active controls in a context-aware bottom hotkey bar", async () => {
    const { driver } = await renderShell({ width: 80, height: 24 });
    expect(driver.renderer.root.findDescendantById("active-hotkeys")).toBeDefined();
    expect(driver.captureFrame()).toContain("PROJECTS");
    expect(driver.captureFrame()).toContain("New project");

    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("THREADS");
    expect(driver.captureFrame()).toContain("Manage");

    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("CONVERSATION");
    expect(driver.captureFrame()).toContain("Write");
    expect(driver.captureFrame()).toContain("Scroll");

    await driver.input.pressKey("i");
    expect(driver.captureFrame()).toContain("MESSAGE");
    expect(driver.captureFrame()).toContain("Send");
    expect(driver.captureFrame()).toContain("Skills");

    await driver.input.typeText("/");
    expect(driver.captureFrame()).toContain("MENU");
    expect(driver.captureFrame()).toContain("Choose");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("MESSAGE");

    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("CONVERSATION");
  });

  it.each([34, 44, 80])("keeps the terminal shortcut visible at width %i", async (width) => {
    const { driver, fixture } = await renderShell({ width, height: 24, kittyKeyboard: true });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    const footer = () => driver.captureFrame().trimEnd().split("\n").slice(-2).join("\n");
    expect(footer()).toContain("Ctrl+T");
    expect(footer()).toContain("Terminal");

    await driver.input.pressKey("i");
    expect(footer()).toContain("Ctrl+T");
    expect(footer()).toContain("Terminal");
    await driver.input.pressKey("t", { ctrl: true });
    expect(fixture.terminalAttachInputs.at(-1)).toMatchObject({ terminalId: "term-1" });
  });

  it("searches projects and threads from the global command palette", async () => {
    const { driver } = await renderShell({ width: 96, height: 28 });
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).toContain("Search and commands");
    expect(driver.captureFrame()).toContain("COMMAND PALETTE");

    await driver.input.typeText("other project conversation");
    expect(driver.captureFrame()).toContain("Other project conversation");
    expect(driver.captureFrame()).not.toContain("First conversation");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("reply-2");
    expect(driver.captureFrame()).not.toContain("Search and commands");
  });

  it("finds threads by text from their conversation output", async () => {
    const { driver } = await renderShell({ width: 100, height: 28 }, { searchDebounceMs: 0 });
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("Visible line 42");
    await driver.flush();
    expect(driver.captureFrame()).toContain("First conversation");
    expect(driver.captureFrame()).toContain("Visible line 42");

    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Visible line 59");
  });

  it("opens palette commands with the mouse and preserves a conversation draft", async () => {
    const { driver, fixture } = await renderShell({ width: 96, height: 28 });
    const search = driver.renderer.root.findDescendantById("open-command-palette");
    expect(search).toBeDefined();
    await driver.mouse.click(search!.screenX + 1, search!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    const newProject = driver.renderer.root.findDescendantById(
      "command-palette-command:new-project",
    );
    expect(newProject).toBeDefined();
    await driver.mouse.click(newProject!.screenX + 1, newProject!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    expect(driver.captureFrame()).toContain("Add a project");
    await driver.input.pressKey("ESCAPE");

    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.typeText("keep this draft");
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("beta");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Threads (1) - Beta");
    expect(driver.registry.get(fixture.client.actions.state(fixture.threads[0]!.id)).draft).toBe(
      "keep this draft",
    );
  });

  it("passes Ctrl+K through while the embedded terminal has focus", async () => {
    const { driver } = await renderShell({ width: 96, height: 28, kittyKeyboard: true });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("t", { ctrl: true });
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).not.toContain("Search and commands");

    await driver.input.pressKey("\\", { ctrl: true });
    await driver.input.pressKey("k", { ctrl: true });
    expect(driver.captureFrame()).toContain("Search and commands");
  });

  it("archives, restores, and confirms deletion from thread management", async () => {
    const { driver, fixture } = await renderShell({ width: 96, height: 28 });
    const threadId = fixture.threads[0]!.id;
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("m");
    expect(driver.captureFrame()).toContain("Manage thread");
    expect(driver.captureFrame()).toContain("Archive thread");

    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(fixture.managementCommands.at(-1)).toMatchObject({
      type: "thread.archive",
      threadId,
    });
    expect(driver.captureFrame()).not.toContain("Manage thread");

    await driver.input.pressKey("a", { shift: true });
    expect(driver.captureFrame()).toContain("Archived threads");
    expect(driver.captureFrame()).toContain("First conversation");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Manage archived thread");
    expect(driver.captureFrame()).toContain("Restore thread");

    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(fixture.managementCommands.at(-1)).toMatchObject({
      type: "thread.unarchive",
    });
    expect(driver.captureFrame()).toContain("No archived threads");
    await driver.input.pressKey("ARROW_LEFT");

    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("m");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Confirm delete");
    expect(
      fixture.managementCommands.filter((command) => command.type === "thread.delete"),
    ).toHaveLength(0);
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(
      fixture.managementCommands.filter((command) => command.type === "thread.delete"),
    ).toHaveLength(1);
    expect(driver.captureFrame()).not.toContain("Second conversation");
  });

  it("renames a thread without treating prompt text as management shortcuts", async () => {
    const { driver, fixture } = await renderShell({ width: 96, height: 28 });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("m");
    await driver.input.pressKey("END");
    await driver.input.typeText(" renamed");
    await driver.input.pressKey("RETURN");
    await driver.flush();
    expect(fixture.managementCommands.at(-1)).toMatchObject({
      type: "thread.meta.update",
      title: "First conversation renamed",
    });
    expect(driver.captureFrame()).toContain("Thread renamed");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("First conversation renamed");

    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.typeText("manage this message");
    expect(driver.captureFrame()).toContain("manage this message");
    expect(driver.captureFrame()).not.toContain("Manage thread");
  });

  it("scrolls conversation history with the mouse wheel and returns live when composing", async () => {
    const { driver } = await renderShell({ width: 80, height: 24 });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Visible line 59");
    const history = driver.renderer.root.findDescendantById("conversation-history");
    expect(history).toBeDefined();
    await driver.input.pressKey("i");

    await driver.mouse.scroll(history!.screenX + 1, history!.screenY + 1, "up", { delayMs: 0 });
    expect(driver.captureFrame()).toContain("History / End: live");
    await driver.input.typeText("new prompt");
    expect(driver.captureFrame()).toContain("Visible line 59");
    expect(driver.captureFrame()).not.toContain("History / End: live");
  });

  it("shows queued prompts, allows editing, and delivers them after navigating away", async () => {
    const { driver, fixture } = await renderShell({ width: 100, height: 28, kittyKeyboard: true });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    const thread = fixture.details[0]!;
    const latestTurn = {
      turnId: TurnId.make("queued-turn"),
      state: "running" as const,
      requestedAt: thread.createdAt,
      startedAt: thread.createdAt,
      completedAt: null,
      assistantMessageId: null,
    };
    await act(async () => {
      driver.registry.update(fixture.states[0]!, (value) => ({
        ...value,
        data: Option.some({ ...thread, latestTurn }),
      }));
    });
    await driver.input.pressKey("i");
    await driver.input.typeText("Follow up after tool");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toHaveLength(0);
    expect(driver.captureFrame()).toContain("Queued (1): Follow up after tool");
    expect(driver.captureFrame()).toContain("Sends after next tool call");
    await driver.input.pressKey("u", { ctrl: true });
    expect(driver.renderer.root.findDescendantById("queued-message")).toBeUndefined();
    expect(driver.registry.get(fixture.client.actions.state(thread.id)).draft).toBe(
      "Follow up after tool",
    );
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ESCAPE");
    await act(async () => {
      driver.registry.update(fixture.states[0]!, (value) => ({
        ...value,
        data: Option.some({
          ...thread,
          latestTurn,
          activities: [agentActivity("tool.completed", "Finished tool", {})],
        }),
      }));
    });
    await driver.flush();
    expect(fixture.commands).toHaveLength(1);
    expect(fixture.commands[0]).toMatchObject({
      type: "thread.turn.start",
      message: { text: "Follow up after tool" },
    });
    expect(driver.registry.get(fixture.client.actions.state(thread.id)).queue).toEqual([]);
  });

  it("places thread activity immediately above the message composer", async () => {
    const { driver } = await renderShell({ width: 80, height: 24 });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");

    const history = driver.renderer.root.findDescendantById("conversation-history");
    const activity = driver.renderer.root.findDescendantById("conversation-activity");
    const composer = driver.renderer.root.findDescendantById("conversation-composer");
    expect(history).toBeDefined();
    expect(activity).toBeDefined();
    expect(composer).toBeDefined();
    expect(driver.renderer.root.findDescendantById("conversation-cancel-turn")).toBeUndefined();
    expect(activity!.screenY).toBeGreaterThan(history!.screenY);
    expect(activity!.screenY + activity!.height).toBe(composer!.screenY);
  });

  it("lists subagents below the composer and opens their attributed output", async () => {
    const { driver, fixture } = await renderShell({ width: 96, height: 30 });
    const thread = fixture.details[0]!;
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    const activities = [
      agentActivity("task.started", "Researcher started", {
        taskId: "agent-one",
        taskType: "subagent",
        agentKind: "agent",
        title: "Researcher",
        model: "gpt-5.6-sol",
      }),
      agentActivity("tool.started", "Reading repository", {
        agentId: "agent-one",
        itemType: "commandExecution",
        toolCallId: "read-one",
        detail: "Inspecting the repository structure",
      }),
      agentActivity("task.started", "Reviewer started", {
        taskId: "agent-two",
        taskType: "subagent",
        agentKind: "agent",
        title: "Reviewer",
      }),
      agentActivity("task.progress", "Reviewing tests", {
        taskId: "agent-two",
        agentKind: "agent",
        summary: "Checking regression coverage",
      }),
    ];
    await act(async () => {
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({ ...thread, activities }),
      });
    });
    await driver.flush();

    const swarm = driver.renderer.root.findDescendantById("agent-swarm");
    const composer = driver.renderer.root.findDescendantById("conversation-composer");
    expect(swarm).toBeDefined();
    expect(composer).toBeDefined();
    expect(swarm!.screenY).toBeGreaterThan(composer!.screenY);
    expect(driver.captureFrame()).toContain("[x] Show agents (2)");
    expect(driver.captureFrame()).toContain("Researcher");
    expect(driver.captureFrame()).toContain("Reviewer");

    const toggle = driver.renderer.root.findDescendantById("agent-swarm-toggle");
    expect(toggle).toBeDefined();
    await driver.mouse.click(toggle!.screenX + 1, toggle!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    expect(driver.captureFrame()).toContain("[ ] Show agents (2)");
    expect(driver.renderer.root.findDescendantById("agent-row-agent-one")).toBeUndefined();
    await driver.mouse.click(toggle!.screenX + 1, toggle!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    expect(driver.captureFrame()).toContain("[x] Show agents (2)");

    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("[ ] Show agents (2)");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("[x] Show agents (2)");
    await driver.input.pressKey("TAB");

    const researcher = driver.renderer.root.findDescendantById("agent-row-agent-one");
    expect(researcher).toBeDefined();
    await driver.mouse.click(researcher!.screenX + 2, researcher!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    expect(driver.captureFrame()).toContain("Agent: Researcher");
    expect(driver.captureFrame()).toContain("Reading repository");
    expect(driver.captureFrame()).not.toContain("Checking regression coverage");
    await driver.input.pressKey("ESCAPE");
    expect(driver.renderer.root.findDescendantById("agent-output-overlay")).toBeUndefined();

    await driver.input.pressKey("TAB");
    expect(driver.captureFrame()).toContain("Enter selects");
    await driver.input.pressKey("TAB", { shift: true });
    expect(driver.captureFrame()).toContain("Tab/G focus");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Agent: Reviewer");
    expect(driver.captureFrame()).toContain("Checking regression coverage");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    expect(driver.captureFrame()).toContain("Enter selects");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("Tab/G focus");
  });

  it("cancels a running prompt from the composer controls", async () => {
    const { driver, fixture } = await renderShell({ width: 80, height: 24 });
    const thread = fixture.details[0]!;
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await act(async () => {
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...thread,
          latestTurn: {
            turnId: TurnId.make("running-turn"),
            state: "running" as const,
            requestedAt: thread.createdAt,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      });
    });
    await driver.flush();

    expect(driver.captureFrame()).toContain("Working");
    const cancel = driver.renderer.root.findDescendantById("conversation-cancel-turn");
    const model = driver.renderer.root.findDescendantById("composer-models");
    expect(cancel).toBeDefined();
    expect(model).toBeDefined();
    expect(driver.captureFrame()).toContain("Cancel");
    expect(cancel!.screenX).toBeGreaterThan(model!.screenX);
    expect(cancel!.screenY).toBe(model!.screenY);
    expect(cancel!.width).toBe(model!.width);
    expect(cancel!.height).toBe(model!.height);

    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    await driver.flush();

    expect(fixture.commands).toContainEqual(
      expect.objectContaining({
        type: "thread.turn.interrupt",
        threadId: thread.id,
        turnId: TurnId.make("running-turn"),
      }),
    );

    await driver.mouse.click(cancel!.screenX + 2, cancel!.screenY, MouseButtons.LEFT, {
      delayMs: 0,
    });
    await driver.flush();
    expect(
      fixture.commands.filter((command) => command.type === "thread.turn.interrupt"),
    ).toHaveLength(2);
  });

  it("adds a browsed local folder as a project", async () => {
    const { driver, fixture } = await renderShell({ width: 96, height: 24 });
    await driver.input.pressKey("p");
    await driver.flush();
    expect(driver.captureFrame()).toContain("Add a project");
    expect(driver.captureFrame()).toContain("code/");

    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    await driver.flush();

    expect(fixture.projects.some((project) => project.workspaceRoot === "~/")).toBe(true);
    expect(driver.captureFrame()).toContain("Threads (0)");
  });

  it("clones and adds a project from a GitHub URL", async () => {
    const { driver, fixture } = await renderShell({ width: 100, height: 24 });
    await driver.input.pressKey("p");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    await driver.input.typeText("https://github.com/acme/widgets.git");
    expect(driver.captureFrame()).toContain("~/widgets");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.flush();

    expect(fixture.projects.some((project) => project.workspaceRoot === "~/widgets")).toBe(true);
    expect(fixture.projectCloneRequests).toMatchObject([
      {
        provider: "github",
        remoteUrl: "https://github.com/acme/widgets.git",
        destinationPath: "~/widgets",
      },
    ]);
    expect(driver.captureFrame()).toContain("Threads (0) - widgets");
  });

  it("scrolls history, keeps the viewport through help and updates, and resumes following at End", async () => {
    const { driver, fixture } = await renderShell({ width: 72, height: 16 });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Visible line 59");
    await driver.input.pressKey("HOME");
    expect(driver.captureFrame()).toContain("Visible line 0");
    await driver.input.pressKey("?");
    expect(driver.captureFrame()).toContain("Keyboard help");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Visible line 0");
    const thread = fixture.details[0]!;
    await act(async () => {
      driver.registry.set(fixture.states[0]!, {
        ...driver.registry.get(fixture.states[0]!),
        data: Option.some({
          ...thread,
          messages: [{ ...thread.messages[0]!, text: `${thread.messages[0]!.text}\nLive delta` }],
        }),
      });
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("Visible line 0");
    expect(driver.captureFrame()).not.toContain("Live delta");
    await driver.input.pressKey("END");
    expect(driver.captureFrame()).toContain("Live delta");
    await driver.resize(34, 18);
    expect(driver.captureFrame()).toContain("Live delta");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("> First conversation");
  });

  it("keeps a workspace sidebar on wide terminals and preserves an edited draft across compact resize", async () => {
    const { driver, fixture } = await renderShell({ width: 120, height: 32, kittyKeyboard: true });
    expect(driver.captureFrame()).toContain("Workspace");
    expect(driver.captureFrame()).toContain("/workspace/alpha");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("TAB");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Threads (2) - Alpha");
    expect(driver.captureFrame()).toContain("reply-1");
    await driver.input.pressKey("i");
    await driver.input.typeText("Keep this draft");
    await driver.resize(44, 20);
    expect(driver.captureFrame()).toContain("Keep this draft");
    expect(driver.captureFrame()).not.toContain("Threads (2) - Alpha");
    await driver.resize(120, 32);
    expect(driver.captureFrame()).toContain("Threads (2) - Alpha");
    expect(driver.captureFrame()).toContain("Keep this draft");
    expect(fixture.commands).toHaveLength(0);
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("TAB");
    expect(driver.captureFrame()).toContain("> Second conversation");
  });

  it("opens multiple shells in the thread directory and returns to chat", async () => {
    const { driver, fixture } = await renderShell({
      width: 96,
      height: 28,
      kittyKeyboard: true,
    });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("t", { ctrl: true });

    expect(driver.captureFrame()).toContain("[term-1]");
    expect(driver.captureFrame()).toContain("/workspace/alpha");
    expect(fixture.terminalAttachInputs.at(-1)).toMatchObject({
      threadId: "thread-0",
      terminalId: "term-1",
      cwd: "/workspace/alpha",
      worktreePath: null,
    });
    await driver.input.pressKey("\\", { ctrl: true });
    expect(driver.captureFrame()).toContain("New shell");
    await driver.input.pressKey("n");
    expect(driver.captureFrame()).toContain("[term-2]");
    expect(fixture.terminalAttachInputs.at(-1)).toMatchObject({ terminalId: "term-2" });
    await driver.input.pressKey("\\", { ctrl: true });
    await driver.input.pressKey("ARROW_LEFT");
    expect(driver.captureFrame()).toContain("[term-1]");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("Visible line 59");
  });

  it("returns to chat when the last shell exits", async () => {
    const { driver, fixture } = await renderShell({
      width: 96,
      height: 28,
      kittyKeyboard: true,
    });
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("t", { ctrl: true });
    expect(driver.captureFrame()).toContain("[term-1]");

    await act(async () =>
      driver.registry.set(
        fixture.terminalBuffer,
        AsyncResult.success({
          ...EMPTY_TERMINAL_BUFFER_STATE,
          status: "exited",
          version: 1,
        }),
      ),
    );
    await driver.flush();

    expect(driver.captureFrame()).toContain("Visible line 59");
    expect(driver.captureFrame()).not.toContain("[term-1]");
    expect(fixture.terminalCloseInputs).toContainEqual({
      terminalId: "term-1",
      deleteHistory: true,
      threadId: "thread-0",
    });

    await act(async () =>
      driver.registry.set(
        fixture.terminalBuffer,
        AsyncResult.success({
          ...EMPTY_TERMINAL_BUFFER_STATE,
          status: "running",
          version: 1,
        }),
      ),
    );
    await driver.input.pressKey("t", { ctrl: true });

    expect(driver.captureFrame()).toContain("[term-2]");
    expect(driver.captureFrame()).not.toContain("[term-1]");
    expect(fixture.terminalAttachInputs.at(-1)).toMatchObject({ terminalId: "term-2" });
  });

  it("keeps selection and navigation readable with ASCII borders and no color", async () => {
    const fixture = makeClientFixture();
    const driver = await createTuiTestDriver(
      <UiProvider capabilities={basicTerminalCapabilities}>
        <AppShell client={fixture.client} />
      </UiProvider>,
      { width: 80, height: 24 },
    );
    activeDrivers.add(driver);
    expect(driver.captureFrame()).toContain("+-Projects (2)");
    expect(driver.captureFrame()).toContain("> Alpha");
    await driver.input.pressKey("ARROW_DOWN");
    expect(driver.captureFrame()).toContain("> Beta");
    expect(driver.captureFrame()).not.toContain("┌");
  });

  it("distinguishes an unavailable connection from an empty project list", async () => {
    const { driver, fixture } = await renderShell({ width: 80, height: 24 });
    await act(async () =>
      driver.registry.set(fixture.shell, {
        snapshot: Option.none(),
        status: "empty",
        error: Option.some("Unavailable"),
      }),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("Connection unavailable");
    expect(driver.captureFrame()).not.toContain("No projects in this environment");
  });

  it("returns to the list if another client removes the open thread and handles empty lists", async () => {
    const { driver, fixture } = await renderShell();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    const snapshot = Option.getOrThrow(driver.registry.get(fixture.shell).snapshot);
    await act(async () => {
      driver.registry.set(fixture.shell, {
        ...driver.registry.get(fixture.shell),
        snapshot: Option.some({ ...snapshot, threads: [] }),
      });
    });
    await driver.flush();
    expect(driver.captureFrame()).toContain("No active threads");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("No active threads");
    await driver.input.pressKey("ESCAPE");
    expect(driver.captureFrame()).toContain("> Alpha");
  });
});
