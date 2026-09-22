import { afterEach, describe, expect, it } from "@effect/vitest";
import type { TextareaRenderable } from "@opentui/core";
import { act } from "react";
import { makeClientFixture } from "../testing/clientFixture.ts";
import { createTuiTestDriver, type TuiTestDriver } from "../testing/driver.tsx";
import { AppShell } from "./AppShell.tsx";

const drivers: TuiTestDriver[] = [];
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((driver) => driver.close()));
});
async function setup() {
  const fixture = makeClientFixture();
  const driver = await createTuiTestDriver(<AppShell client={fixture.client} />, {
    width: 96,
    height: 60,
    kittyKeyboard: true,
  });
  drivers.push(driver);
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("RETURN");
  await driver.input.pressKey("i");
  const composer = () => driver.renderer.root.findDescendantById("conversation-composer")!;
  const editor = () =>
    driver.renderer.root.findDescendantById("prompt-editor") as TextareaRenderable;
  const draft = async (text: string) => {
    await act(async () =>
      fixture.client.actions.setDraft(driver.registry, fixture.details[0]!.id, text),
    );
    await driver.flush();
  };
  return { driver, fixture, composer, editor, draft };
}

describe("composer content height", () => {
  it("grows with typing and newlines, caps at 30% of the window, and shrinks when cleared", async () => {
    const { driver, composer, editor, draft } = await setup();
    expect(composer().height).toBe(4);
    await driver.input.typeText("word ".repeat(30));
    expect(editor().height).toBe(editor().editorView.getTotalVirtualLineCount());
    expect(composer().height).toBeGreaterThan(4);
    await draft("one\ntwo\nthree\nfour");
    expect(editor().height).toBe(4);
    expect(composer().height).toBe(7);
    await draft(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n"));
    expect(composer().height).toBe(18);
    expect(editor().scrollY).toBeGreaterThan(0);
    await driver.input.typeText(" end");
    expect(driver.captureFrame()).toContain("line 29 end");
    await draft("");
    expect(composer().height).toBe(4);
    expect(editor().scrollY).toBe(0);
  });

  it("remeasures wrapping and the cap when the terminal is resized", async () => {
    const { driver, composer, editor, draft } = await setup();
    await draft("word ".repeat(30));
    const initial = editor().height;
    await driver.resize(44, 60);
    await driver.flush();
    expect(editor().height).toBeGreaterThan(initial);
    expect(editor().height).toBe(editor().editorView.getTotalVirtualLineCount());
    await draft("line\n".repeat(30));
    await driver.resize(44, 30);
    expect(composer().height).toBe(9);
    await driver.resize(96, 60);
    expect(composer().height).toBe(18);
  });
});
