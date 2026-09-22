import { afterEach, describe, expect, it } from "@effect/vitest";
import type { TextareaRenderable } from "@opentui/core";
import { MessageId, TurnId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
});
async function setup(prompts = ["First request", "Canceled request"], kittyKeyboard = true) {
  const fixture = makeClientFixture(undefined, async () => ({
    type: "image",
    id: "fixture-image",
    name: "fixture.png",
    mimeType: "image/png",
    sizeBytes: 1,
    dataUrl: "data:image/png;base64,AA==",
  }));
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 90,
    height: 30,
    kittyKeyboard,
  });
  drivers.push(driver);
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  const id = fixture.details[0]!.id;
  const time = "2026-01-01T00:00:00.000Z";
  await act(async () =>
    driver.registry.update(fixture.states[0]!, (state) => ({
      ...state,
      data: Option.map(state.data, (thread) => ({
        ...thread,
        messages: prompts.map((text, index) => ({
          id: MessageId.make(`user-${index}`),
          role: "user" as const,
          text,
          turnId: TurnId.make(`turn-${index}`),
          streaming: false,
          createdAt: time,
          updatedAt: time,
        })),
        latestTurn: {
          turnId: TurnId.make("canceled-turn"),
          state: "interrupted" as const,
          requestedAt: time,
          startedAt: time,
          completedAt: time,
          assistantMessageId: null,
        },
      })),
    })),
  );
  await driver.input.pressKey("i");
  const draft = () => driver.registry.get(fixture.client.actions.state(id)).draft;
  const editor = () =>
    driver.renderer.root.findDescendantById("prompt-editor") as TextareaRenderable;
  return { driver, fixture, id, draft, editor };
}

describe("composer prompt history", () => {
  it.each([false, true])(
    "recalls canceled prompts and walks back to an empty draft without sending (kitty=%s)",
    async (kitty) => {
      const { driver, fixture, draft } = await setup(undefined, kitty);
      await driver.input.pressKey("ARROW_UP");
      expect(draft()).toBe("Canceled request");
      await driver.input.pressKey("ARROW_UP");
      expect(draft()).toBe("First request");
      await driver.input.pressKey("ARROW_UP");
      expect(draft()).toBe("First request");
      await driver.input.pressKey("ARROW_DOWN");
      expect(draft()).toBe("Canceled request");
      await driver.input.pressKey("ARROW_DOWN");
      expect(draft()).toBe("");
      expect(fixture.commands).toEqual([]);
    },
  );

  it("protects typed drafts", async () => {
    const { driver, draft } = await setup();
    await driver.input.typeText("Unsent draft");
    await driver.input.pressKey("ARROW_UP");
    expect(draft()).toBe("Unsent draft");
  });

  it("keeps an edited recall as a draft", async () => {
    const { driver, draft } = await setup();
    await driver.input.pressKey("ARROW_UP");
    await driver.input.typeText(" with more detail");
    await driver.input.pressKey("ARROW_UP");
    await driver.input.pressKey("ARROW_DOWN");
    expect(draft()).toBe("Canceled request with more detail");
  });

  it.each(["first line\nsecond line", "wrapped words ".repeat(30)])(
    "moves within multiline or wrapped recalls before navigating history",
    async (prompt) => {
      const { driver, draft, editor } = await setup(["Older prompt", prompt]);
      await driver.input.pressKey("ARROW_UP");
      expect(draft()).toBe(prompt.trim());
      expect(editor().virtualLineCount).toBeGreaterThan(1);
      await driver.input.pressKey("ARROW_UP");
      expect(draft()).toBe(prompt.trim());
      expect(editor().cursorOffset).toBeLessThan(editor().plainText.length);
      await act(async () => {
        editor().cursorOffset = 0;
      });
      await driver.input.pressKey("ARROW_DOWN");
      expect(draft()).toBe(prompt.trim());
      await act(async () => {
        editor().cursorOffset = 0;
      });
      await driver.input.pressKey("ARROW_UP");
      expect(draft()).toBe("Older prompt");
      await driver.input.pressKey("ARROW_DOWN");
      expect(draft()).toBe(prompt.trim());
      await driver.input.pressKey("ARROW_DOWN");
      expect(draft()).toBe("");
    },
  );

  it("does not mix old text into a draft with attachments", async () => {
    const { driver, fixture, id, draft } = await setup();
    await act(async () => {
      expect(
        await fixture.client.actions.attachImages(driver.registry, id, ["/tmp/fixture.png"]),
      ).toBe(true);
    });
    await driver.flush();
    await driver.input.pressKey("ARROW_UP");
    expect(draft()).toBe("");
  });

  it("does not attach an image path from a recalled prompt", async () => {
    const { driver, fixture, id, draft } = await setup(["Inspect /tmp/fixture.png"]);
    await driver.input.pressKey("ARROW_UP");
    expect(draft()).toBe("Inspect /tmp/fixture.png");
    expect(driver.registry.get(fixture.client.actions.state(id)).attachments).toEqual([]);
    expect(fixture.commands).toEqual([]);
  });

  it("keeps recall scoped to the current thread", async () => {
    const { driver, draft } = await setup();
    await driver.input.pressKey("ARROW_UP");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ESCAPE");
    await driver.input.pressKey("ARROW_DOWN");
    await driver.input.pressKey("RETURN");
    await driver.input.pressKey("i");
    await driver.input.pressKey("ARROW_UP");
    expect(
      (driver.renderer.root.findDescendantById("prompt-editor") as TextareaRenderable).plainText,
    ).toBe("");
    expect(draft()).toBe("Canceled request");
  });

  it("recalls slash commands without opening the skills menu", async () => {
    const { driver, draft } = await setup(["First request", "/review"]);
    await driver.input.pressKey("ARROW_UP");
    expect(draft()).toBe("/review");
    await driver.input.pressKey("ARROW_UP");
    expect(draft()).toBe("First request");
  });
});
