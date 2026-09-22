import { afterEach, describe, expect, it } from "@effect/vitest";
import { CheckpointRef, MessageId, TurnId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
});
async function setup(width: number) {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(
    <AppShell client={fixture.client} searchDebounceMs={0} />,
    { width, height: 32, kittyKeyboard: true },
  );
  drivers.push(driver);
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  const threadId = fixture.details[0]!.id;
  const turnId = TurnId.make("turn-1");
  const time = "2026-01-01T00:00:00.000Z";
  await act(async () =>
    driver.registry.update(fixture.states[0]!, (state) => ({
      ...state,
      data: Option.map(state.data, (thread) => ({
        ...thread,
        messages: [
          {
            id: MessageId.make("prompt"),
            role: "user" as const,
            text: "Fix the bug",
            turnId,
            streaming: false,
            createdAt: time,
            updatedAt: time,
          },
          {
            id: MessageId.make("reply"),
            role: "assistant" as const,
            text: "Fixed",
            turnId,
            streaming: false,
            createdAt: time,
            updatedAt: time,
          },
        ],
        checkpoints: [
          {
            turnId,
            checkpointTurnCount: 1,
            checkpointRef: CheckpointRef.make("refs/t3/one"),
            status: "ready" as const,
            files: [],
            assistantMessageId: MessageId.make("reply"),
            completedAt: time,
          },
        ],
      })),
    })),
  );
  return { driver, fixture, threadId };
}

describe("checkpoint restore UI", () => {
  it.each([54, 110])(
    "offers both choices and returns the restored prompt to the composer at width %i",
    async (width) => {
      const { driver, fixture, threadId } = await setup(width);
      await driver.input.pressKey("e");
      expect(driver.captureFrame()).toContain("Select a prompt");
      await driver.input.pressKey("RETURN");
      expect(driver.captureFrame()).toContain("Edit from here?");
      expect(driver.captureFrame()).toContain("Revert files too");
      expect(driver.captureFrame()).toContain("Revert and keep changes");
      await driver.input.pressKey("RETURN"); // Cancel is the initial selection.
      expect(fixture.commands).toHaveLength(0);
      await driver.input.pressKey("RETURN");
      await driver.input.pressKey("ARROW_UP"); // Last choice: preserve files.
      await driver.input.pressKey("RETURN");
      expect(fixture.commands).toMatchObject([
        { type: "thread.conversation.revert", turnCount: 0 },
      ]);
      expect(driver.captureFrame()).toContain("Waiting for the environment");
      await driver.input.pressKey("RETURN");
      expect(fixture.commands).toHaveLength(1);
      await act(async () =>
        driver.registry.update(fixture.states[0]!, (state) => ({
          ...state,
          data: Option.map(state.data, (thread) => ({
            ...thread,
            messages: [],
            checkpoints: [],
            latestTurn: null,
          })),
        })),
      );
      await driver.flush();
      expect(driver.registry.get(fixture.client.actions.state(threadId)).draft).toBe("Fix the bug");
      expect(driver.captureFrame()).not.toContain("Edit from here?");
      await driver.input.typeText(" please");
      expect(driver.registry.get(fixture.client.actions.state(threadId)).draft).toContain("please");
    },
  );

  it("opens through the palette and keeps E as ordinary composer text", async () => {
    const { driver, fixture, threadId } = await setup(110);
    await driver.input.pressKey("i");
    await driver.input.typeText("edit");
    expect(driver.registry.get(fixture.client.actions.state(threadId)).draft).toBe("edit");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("k", { ctrl: true });
    await driver.input.typeText("checkpoint");
    await driver.input.pressKey("RETURN");
    expect(driver.captureFrame()).toContain("Select a prompt");
    await driver.input.pressKey("ESCAPE");
    expect(fixture.commands).toHaveLength(0);
  });
});
