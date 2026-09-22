// @effect-diagnostics nodeBuiltinImport:off
import { afterEach, describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { act } from "react";
import { openTuiSessionState } from "../persistence/sessionStore.ts";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";
import type { ShellState } from "../app/state.ts";

const drivers: TuiTestDriver[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
  cleanups
    .splice(0)
    .toReversed()
    .forEach((cleanup) => cleanup());
});
function directory() {
  const path = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tui-session-ui-"));
  cleanups.push(() => NodeFS.rmSync(path, { recursive: true, force: true }));
  return path;
}
function setup(path: string) {
  const registry = AtomRegistry.make();
  const session = openTuiSessionState({
    stateDirectory: path,
    environmentId: EnvironmentId.make("test-env"),
    httpOrigin: "http://localhost:3773",
    registry,
  });
  cleanups.push(() => session.close());
  const fixture = makeClientFixture(undefined, undefined, session);
  let state: ShellState | undefined;
  return {
    registry,
    session,
    fixture,
    state: () => state,
    render: async () => {
      const driver = await createTuiTestDriver(
        <AppShell
          client={fixture.client}
          onStateChange={(next) => {
            state = next;
          }}
        />,
        { width: 110, height: 30, kittyKeyboard: true, registry },
      );
      drivers.push(driver);
      return driver;
    },
  };
}

describe("restoring the TUI session", () => {
  it("reopens the selected thread with its draft and composer focus", async () => {
    const path = directory();
    const first = setup(path);
    const driver = await first.render();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.typeText("Unsent after restart");
    const before = first.state();
    await driver.close();
    const second = setup(path);
    const reopened = await second.render();
    expect(second.state()).toMatchObject(before!);
    expect(reopened.captureFrame()).toContain("Unsent after restart");
    await reopened.input.typeText("!");
    expect(second.registry.get(second.fixture.client.actions.state(before!.threadId!)).draft).toBe(
      "Unsent after restart!",
    );
    expect(second.fixture.commands).toEqual([]);
  });

  it("restores the caret inside an unfinished draft", async () => {
    const path = directory();
    const first = setup(path);
    const driver = await first.render();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.typeText("ab");
    await driver.input.pressKey("ARROW_LEFT");
    const id = first.state()!.threadId!;
    await driver.close();
    const second = setup(path);
    const reopened = await second.render();
    await reopened.input.typeText("X");
    expect(second.registry.get(second.fixture.client.actions.state(id)).draft).toBe("aXb");
  });

  it("keeps the saved selection while waiting for the environment snapshot", async () => {
    const path = directory();
    const first = setup(path);
    first.session.saveShell({
      route: "conversation",
      projectId: ProjectId.make("beta"),
      threadId: ThreadId.make("thread-2"),
      modal: null,
    });
    const second = setup(path);
    const original = second.registry.get(second.fixture.shell);
    second.registry.set(second.fixture.shell, { ...original, snapshot: Option.none() });
    const driver = await second.render();
    expect(second.state()?.threadId).toBe("thread-2");
    await act(async () => second.registry.set(second.fixture.shell, original));
    await driver.flush();
    expect(second.state()?.threadId).toBe("thread-2");
    expect(driver.captureFrame()).toContain("Other project conversation");
  });

  it("falls back to available navigation when a saved thread was removed", async () => {
    const path = directory();
    const first = setup(path);
    first.session.saveShell({
      route: "conversation",
      projectId: ProjectId.make("alpha"),
      threadId: ThreadId.make("deleted-thread"),
      modal: null,
    });
    const second = setup(path);
    await second.render();
    expect(second.state()).toMatchObject({ route: "threads", threadId: "thread-0" });
  });

  it("reattaches the saved terminal tab", async () => {
    const path = directory();
    const first = setup(path);
    const id = ThreadId.make("thread-0");
    first.session.saveShell({
      route: "conversation",
      projectId: ProjectId.make("alpha"),
      threadId: id,
      modal: null,
    });
    first.session.saveConversation(id, {
      mode: "history",
      anchor: null,
      terminalOpen: true,
      showDetails: false,
      agentsExpanded: true,
      selectedAgentId: null,
      expandedToolGroups: [],
    });
    first.session.saveTerminal(id, { terminalId: "term-2", focused: false });
    const second = setup(path);
    await second.render();
    expect(second.fixture.terminalAttachInputs).toContainEqual(
      expect.objectContaining({ terminalId: "term-2", threadId: id }),
    );
    expect(second.session.terminal(id)).toEqual({ terminalId: "term-2", focused: false });
  });

  it("restores the conversation scroll anchor and tool detail preference", async () => {
    const path = directory();
    const first = setup(path);
    const driver = await first.render();
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("t");
    await driver.input.pressKey("ARROW_UP");
    const id = first.state()!.threadId!;
    const saved = first.session.conversation(id)!;
    expect(saved.anchor).not.toBeNull();
    expect(saved.showDetails).toBe(true);
    const frame = driver.captureFrame();
    await driver.close();
    const second = setup(path);
    const reopened = await second.render();
    expect(second.session.conversation(id)).toEqual(saved);
    expect(reopened.captureFrame()).toBe(frame);
  });
});
