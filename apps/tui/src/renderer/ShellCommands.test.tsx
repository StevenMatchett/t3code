import { afterEach, describe, expect, it } from "@effect/vitest";
import { TurnId, type TerminalExecuteResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
});
const result: TerminalExecuteResult = {
  stdout: "hello\n",
  stderr: "warning\n",
  exitCode: 7,
  timedOut: false,
  truncated: false,
};
async function setup(executeShell = async () => result, dispatch = async () => true) {
  const fixture = makeClientFixture(dispatch, undefined, undefined, executeShell);
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

describe("shell commands in the conversation", () => {
  it("sends the command, stdout, stderr and exit status to the LLM without opening a terminal", async () => {
    const { fixture, driver, state } = await setup();
    await act(async () =>
      driver.registry.update(fixture.states[0]!, (value) => ({
        ...value,
        data: Option.map(value.data, (thread) => ({ ...thread, worktreePath: "/worktrees/task" })),
      })),
    );
    await driver.input.typeText("! /bin/echo hello");
    expect(driver.captureFrame()).toContain("Shell command");
    await driver.input.pressKey("RETURN");
    expect(fixture.shellCommands).toEqual([{ cwd: "/worktrees/task", command: "/bin/echo hello" }]);
    const command = fixture.commands[0]!;
    expect(command.type).toBe("thread.turn.start");
    if (command.type !== "thread.turn.start") throw new Error("Expected a user turn");
    expect(command.message.text).toContain("/bin/echo hello");
    expect(command.message.text).toContain("stdout:\nhello");
    expect(command.message.text).toContain("stderr:\nwarning");
    expect(command.message.text).toContain("Exit code: 7");
    expect(fixture.terminalAttachInputs).toEqual([]);
    expect(fixture.terminalWrites).toEqual([]);
    expect(state().draft).toBe("");
    await act(async () =>
      driver.registry.update(fixture.states[0]!, (value) => ({
        ...value,
        data: Option.map(value.data, (thread) => ({
          ...thread,
          messages: [
            ...thread.messages,
            {
              id: command.message.messageId,
              role: "user" as const,
              text: command.message.text,
              turnId: null,
              streaming: false,
              createdAt: command.createdAt,
              updatedAt: command.createdAt,
            },
          ],
        })),
      })),
    );
    await driver.flush();
    expect(driver.captureFrame()).toContain("Exit code: 7");
    expect(driver.captureFrame()).toContain("hello");
  });

  it("queues the completed output when the agent is busy", async () => {
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
      actions.addPaste(driver.registry, id, `!echo ${"x".repeat(220)}\necho done`);
      await actions.send(driver.registry, id);
    });
    expect(fixture.commands).toEqual([]);
    expect(fixture.shellCommands[0]?.command).toBe(`echo ${"x".repeat(220)}\necho done`);
    expect(state().queue[0]?.command.message.text).toContain("Exit code: 7");
    expect(state().queue[0]?.command.message.text).toContain("hello");
  });

  it("keeps empty and failed executions out of the LLM and preserves the draft", async () => {
    const { fixture, driver, state } = await setup(async () => {
      throw new Error("Could not execute");
    });
    await driver.input.typeText("!");
    await driver.input.pressKey("RETURN");
    expect(state().error).toContain("after !");
    expect(fixture.shellCommands).toEqual([]);
    await driver.input.typeText("echo test");
    await driver.input.pressKey("RETURN");
    expect(state().draft).toBe("!echo test");
    expect(state().error).toContain("Could not execute");
    expect(state().pending).toBeNull();
    expect(fixture.commands).toEqual([]);
  });

  it("blocks duplicate executions and preserves edits made while running", async () => {
    const pending = Promise.withResolvers<TerminalExecuteResult>();
    const { fixture, driver, id, state } = await setup(() => pending.promise);
    const actions = fixture.client.actions;
    await act(async () => actions.setDraft(driver.registry, id, "!echo first"));
    const sending = actions.send(driver.registry, id);
    expect(await actions.send(driver.registry, id)).toBe(false);
    expect(fixture.shellCommands).toHaveLength(1);
    await act(async () => {
      actions.setDraft(driver.registry, id, "new draft");
      pending.resolve(result);
      await sending;
    });
    expect(state().draft).toBe("new draft");
    expect(fixture.commands).toHaveLength(1);
  });

  it("retries LLM delivery without reexecuting the command", async () => {
    const { fixture, driver, state } = await setup(undefined, async () => false);
    await driver.input.typeText("!echo test");
    await driver.input.pressKey("RETURN");
    expect(state().draft).toBe("!echo test");
    await driver.input.pressKey("RETURN");
    expect(fixture.shellCommands).toHaveLength(1);
    expect(fixture.commands).toHaveLength(2);
    expect(fixture.commands[0]).toEqual(fixture.commands[1]);
  });
});
