import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { TurnId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
  vi.restoreAllMocks();
});
async function setup() {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 100,
    height: 35,
    kittyKeyboard: true,
  });
  drivers.push(driver);
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("i");
  const id = fixture.details[0]!.id;
  const state = () => driver.registry.get(fixture.client.actions.state(id));
  return { fixture, driver, id, state };
}

describe("shell commands from the composer", () => {
  it("runs ! commands in the worktree shell and opens its output without an agent turn", async () => {
    const { fixture, driver, id, state } = await setup();
    await act(async () =>
      driver.registry.update(fixture.states[0]!, (value) => ({
        ...value,
        data: Option.map(value.data, (thread) => ({ ...thread, worktreePath: "/worktrees/task" })),
      })),
    );
    await driver.input.typeText("! /bin/echo hello");
    expect(driver.captureFrame()).toContain("Shell command");
    expect(driver.captureFrame()).toContain("Run shell");
    expect(driver.captureFrame()).not.toContain("No matches");
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toEqual([]);
    expect(fixture.terminalWrites).toEqual(["/bin/echo hello\r"]);
    expect(fixture.terminalOpenInputs).toEqual([
      expect.objectContaining({
        threadId: id,
        cwd: "/worktrees/task",
        worktreePath: "/worktrees/task",
      }),
    ]);
    expect(fixture.terminalAttachInputs).toContainEqual(
      expect.objectContaining({ terminalId: fixture.terminalOpenInputs[0]!.terminalId }),
    );
    expect(state().draft).toBe("");
  });

  it("expands pasted commands and runs immediately while the agent is busy", async () => {
    const { fixture, driver, id, state } = await setup();
    const actions = fixture.client.actions;
    await act(async () => {
      driver.registry.update(fixture.states[0]!, (value) => ({
        ...value,
        data: Option.map(value.data, (thread) => ({
          ...thread,
          latestTurn: {
            turnId: TurnId.make("busy"),
            state: "running" as const,
            requestedAt: thread.createdAt,
            startedAt: null,
            completedAt: null,
            assistantMessageId: null,
          },
        })),
      }));
      actions.setDraft(driver.registry, id, "!");
      actions.addPaste(driver.registry, id, `echo ${"x".repeat(220)}\necho done`);
      await actions.send(driver.registry, id);
    });
    expect(fixture.commands).toEqual([]);
    expect(state().queue).toEqual([]);
    expect(fixture.terminalWrites).toEqual([`echo ${"x".repeat(220)}\recho done\r`]);
    expect(fixture.terminalOpenInputs[0]?.cwd).toBe("/workspace/alpha");
  });

  it("keeps empty or failed shell commands out of the agent and preserves the draft", async () => {
    const { fixture, driver, state } = await setup();
    await driver.input.typeText("!");
    await driver.input.pressKey("RETURN");
    expect(state().error).toContain("after !");
    expect(fixture.terminalOpenInputs).toEqual([]);
    vi.spyOn(fixture.client.terminals!.open, "run").mockResolvedValue(
      AsyncResult.failure(Cause.die(new Error("offline"))),
    );
    await driver.input.typeText("echo test");
    await driver.input.pressKey("RETURN");
    expect(state().draft).toBe("!echo test");
    expect(state().error).toContain("Could not open a shell");
    expect(state().pending).toBeNull();
    expect(fixture.terminalWrites).toEqual([]);
    expect(fixture.commands).toEqual([]);
  });
  it("blocks repeated submission and preserves edits made during shell startup", async () => {
    const { fixture, driver, id, state } = await setup();
    const terminals = fixture.client.terminals!;
    const openResult = await terminals.open.run(driver.registry, {
      environmentId: fixture.client.environmentId,
      input: { threadId: id, terminalId: "existing", cwd: "/workspace/alpha" },
    });
    const opening = Promise.withResolvers<typeof openResult>();
    const open = vi.spyOn(fixture.client.terminals!.open, "run").mockReturnValue(opening.promise);
    const actions = fixture.client.actions;
    await act(async () => actions.setDraft(driver.registry, id, "!echo first"));
    const sending = actions.send(driver.registry, id);
    expect(await actions.send(driver.registry, id)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    await act(async () => {
      actions.setDraft(driver.registry, id, "new draft");
      opening.resolve(openResult);
      await sending;
    });
    expect(state().draft).toBe("new draft");
    expect(fixture.terminalWrites).toEqual(["echo first\r"]);
  });

  it("preserves the draft when terminal delivery fails and never sends it to the agent", async () => {
    const { fixture, driver, state } = await setup();
    vi.spyOn(fixture.client.terminals!.write, "run").mockResolvedValue(
      AsyncResult.failure(Cause.die(new Error("disconnected"))),
    );
    await driver.input.typeText("!echo test");
    await driver.input.pressKey("RETURN");
    expect(state().draft).toBe("!echo test");
    expect(state().error).toContain("not confirmed");
    expect(fixture.commands).toEqual([]);
  });
  it("recognizes a whole shell command in a folded paste", async () => {
    const { fixture, driver, id } = await setup();
    const text = `!echo ${"x".repeat(220)}`;
    await act(async () => fixture.client.actions.addPaste(driver.registry, id, text));
    await driver.flush();
    await driver.input.pressKey("RETURN");
    expect(fixture.commands).toEqual([]);
    expect(fixture.terminalWrites).toEqual([`${text.slice(1)}\r`]);
    expect(fixture.terminalAttachInputs).toContainEqual(
      expect.objectContaining({ terminalId: fixture.terminalOpenInputs[0]!.terminalId }),
    );
  });
});
